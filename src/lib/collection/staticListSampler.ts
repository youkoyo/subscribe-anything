import type { ArticleCandidate } from './articleTypes';
import { fetchCollectorText } from './collectors/httpCollectorFetch';

const MAX_ARTICLE_LINKS = 8;
const MIN_ARTICLE_LINKS = 2;
const FETCH_CONCURRENCY = 3;
const MAX_HTML_BYTES = 1024 * 1024;
const NON_ARTICLE_SEGMENTS = new Set([
  'about',
  'aboutus',
  'archive',
  'archives',
  'catalog',
  'category',
  'contact',
  'contactus',
  'find',
  'list',
  'product',
  'products',
  'search',
  'shop',
  'tag',
  'tags',
]);
const ASSET_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|pdf|png|svg|webp|zip)$/i;

export interface StaticListTextResponse {
  text: string;
  finalUrl: string;
}

export interface StaticListSamplerDependencies {
  fetchText?: (url: string) => Promise<StaticListTextResponse>;
}

interface ArticleLink {
  title: string;
  url: string;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function plainText(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pageToken(segment: string) {
  return segment
    .replace(/\.(?:s?html?|aspx?|jspx?|php\d?|cgi|do|action)$/i, '')
    .replace(/[-_]/g, '')
    .toLowerCase();
}

function hrefFromAttributes(attributes: string) {
  const match = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return decodeHtmlEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function articleLikeUrl(value: string, baseUrl: string) {
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;

  const base = new URL(baseUrl);
  if (url.origin !== base.origin) return undefined;
  if (ASSET_EXTENSION.test(url.pathname)) return undefined;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return undefined;
  if (segments.some((segment) => NON_ARTICLE_SEGMENTS.has(pageToken(segment)))) return undefined;
  url.hash = '';
  return url.toString();
}

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function sameListOrigin(value: string, listUrl: string) {
  const origin = normalizedOrigin(value);
  return !!origin && origin === normalizedOrigin(listUrl);
}

function isArticleDocument(html: string) {
  return /["']@type["']\s*:\s*["'](?:NewsArticle|Article|ReportageNewsArticle)["']/i.test(html)
    || /article:published_time/i.test(html)
    || /(?:property|name)\s*=\s*["']og:type["'][^>]*content\s*=\s*["']article["']/i.test(html)
    || /content\s*=\s*["']article["'][^>]*(?:property|name)\s*=\s*["']og:type["']/i.test(html);
}

function isExplicitListDocument(html: string) {
  return /["']@type["']\s*:\s*["'](?:ItemList|CollectionPage)["']/i.test(html);
}

function classFromAttributes(attributes: string) {
  const match = attributes.match(/\bclass\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
}

function hasRepeatedListStructure(html: string, baseUrl: string) {
  const content = html.replace(/<(?:aside|nav|footer)\b[^>]*>[\s\S]*?<\/(?:aside|nav|footer)\s*>/gi, ' ');

  const articleBlocks = Array.from(content.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi));
  if (articleBlocks.filter((match) => extractStaticArticleLinks(match[1], baseUrl).length > 0).length >= MIN_ARTICLE_LINKS) {
    return true;
  }

  for (const match of content.matchAll(/<(?:ul|ol)\b[^>]*>([\s\S]*?)<\/(?:ul|ol)\s*>/gi)) {
    if (extractStaticArticleLinks(match[1], baseUrl).length >= MIN_ARTICLE_LINKS) return true;
  }

  const repeatedClasses = new Map<string, number>();
  for (const match of content.matchAll(/<(div|section)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi)) {
    if (extractStaticArticleLinks(match[3], baseUrl).length === 0) continue;
    const semanticClasses = classFromAttributes(match[2])
      .split(/\s+/)
      .filter((name) => /(?:^|[-_])(?:article|card|entry|item|news|post|result)(?:$|[-_])/i.test(name))
      .map((name) => name.toLowerCase())
      .sort();
    if (semanticClasses.length === 0) continue;
    const key = `${match[1].toLowerCase()}:${semanticClasses.join('.')}`;
    const count = (repeatedClasses.get(key) ?? 0) + 1;
    if (count >= MIN_ARTICLE_LINKS) return true;
    repeatedClasses.set(key, count);
  }

  return false;
}

export function extractStaticArticleLinks(html: string, baseUrl: string): ArticleLink[] {
  const links: ArticleLink[] = [];
  const seen = new Set<string>();

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const title = plainText(match[2]);
    if (title.length < 4) continue;
    const url = articleLikeUrl(hrefFromAttributes(match[1]), baseUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    links.push({ title, url });
    if (links.length >= MAX_ARTICLE_LINKS) break;
  }

  return links;
}

async function defaultFetchText(url: string) {
  return fetchCollectorText(url, { maxResponseBytes: MAX_HTML_BYTES }, {
    label: 'Static article list',
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'SubscribeAnything/1.0; discovery static-list sampler',
    },
  });
}

/** Fetch a static list and its linked article pages so Task 3 can validate real metadata. */
export async function sampleStaticArticleList(
  listUrl: string,
  dependencies: StaticListSamplerDependencies = {},
): Promise<ArticleCandidate[]> {
  const fetchText = dependencies.fetchText ?? defaultFetchText;
  const list = await fetchText(listUrl);
  if (isArticleDocument(list.text)) return [];
  const links = extractStaticArticleLinks(list.text, list.finalUrl);
  if (!isExplicitListDocument(list.text) && !hasRepeatedListStructure(list.text, list.finalUrl)) return [];
  const candidates = new Array<ArticleCandidate | undefined>(links.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < links.length) {
      const index = nextIndex;
      nextIndex += 1;
      const link = links[index];
      try {
        const article = await fetchText(link.url);
        if (!sameListOrigin(article.finalUrl, list.finalUrl)) continue;
        candidates[index] = {
          origin: 'feed',
          url: article.finalUrl,
          title: link.title,
          rawHtml: article.text,
        };
      } catch {
        // One blocked or stale link does not invalidate other list entries.
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(FETCH_CONCURRENCY, links.length) },
    () => worker(),
  ));
  return candidates.filter((candidate): candidate is ArticleCandidate => candidate !== undefined);
}
