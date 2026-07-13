import type { ArticleCandidate, JsonValue } from '../articleTypes';
import {
  fetchCollectorText,
  type CollectorHttpDependencies,
} from './httpCollectorFetch';
import type { CollectorSource, SourceCollector } from './types';

export type RssSourceCollectorDependencies = CollectorHttpDependencies;

interface ParsedFeedItem {
  title: string;
  url: string;
  summary?: string;
  publishedAt?: string;
  publisherName?: string;
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function unwrapCdata(value: string) {
  const match = value.trim().match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  return match ? match[1] : value;
}

function plainText(value: string) {
  return decodeXmlEntities(unwrapCdata(value))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(xml: string, tags: readonly string[]) {
  for (const tag of tags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = xml.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i'));
    if (match) return plainText(match[1]);
  }
  return undefined;
}

function blocks(xml: string, tag: string) {
  const result: string[] = [];
  const expression = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
  for (const match of xml.matchAll(expression)) result.push(match[1]);
  return result;
}

function resolveUrl(value: string | undefined, baseUrl: string) {
  if (!value) return '';
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function atomLink(entry: string, baseUrl: string) {
  let fallback: string | undefined;
  for (const match of entry.matchAll(/<link\b([^>]*)\/?\s*>/gi)) {
    const attributes = new Map<string, string>();
    for (const attribute of match[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attributes.set(attribute[1].toLowerCase(), attribute[2] ?? attribute[3] ?? '');
    }
    const href = attributes.get('href');
    if (!href) continue;
    const decodedHref = decodeXmlEntities(href);
    fallback ??= decodedHref;
    const rel = attributes.get('rel');
    if (!rel || rel.toLowerCase() === 'alternate') {
      return resolveUrl(decodedHref, baseUrl);
    }
  }
  return resolveUrl(fallback ?? extractTag(entry, ['id']), baseUrl);
}

function rawItem(item: ParsedFeedItem): JsonValue {
  return {
    title: item.title,
    url: item.url,
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    ...(item.publisherName ? { publisherName: item.publisherName } : {}),
  };
}

function candidate(item: ParsedFeedItem): ArticleCandidate {
  return {
    origin: 'feed',
    url: item.url,
    title: item.title,
    ...(item.summary ? { summary: item.summary } : {}),
    ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
    ...(item.publisherName ? { publisherName: item.publisherName } : {}),
    raw: rawItem(item),
  };
}

function parseRss(xml: string, feedUrl: string) {
  const channelStart = xml.search(/<channel\b/i);
  const channelXml = channelStart >= 0 ? xml.slice(channelStart) : xml;
  const header = channelXml.split(/<item\b/i, 1)[0] ?? channelXml;
  const publisherName = extractTag(header, ['title']);

  return blocks(channelXml, 'item').map((itemXml) => candidate({
    title: extractTag(itemXml, ['title']) ?? '',
    url: resolveUrl(extractTag(itemXml, ['link', 'guid']), feedUrl),
    ...(extractTag(itemXml, ['description', 'summary', 'content:encoded'])
      ? { summary: extractTag(itemXml, ['description', 'summary', 'content:encoded']) }
      : {}),
    ...(extractTag(itemXml, ['pubDate', 'dc:date', 'published'])
      ? { publishedAt: extractTag(itemXml, ['pubDate', 'dc:date', 'published']) }
      : {}),
    ...(publisherName ? { publisherName } : {}),
  }));
}

function parseAtom(xml: string, feedUrl: string) {
  const header = xml.split(/<entry\b/i, 1)[0] ?? xml;
  const publisherName = extractTag(header, ['title']);

  return blocks(xml, 'entry').map((entryXml) => candidate({
    title: extractTag(entryXml, ['title']) ?? '',
    url: atomLink(entryXml, feedUrl),
    ...(extractTag(entryXml, ['summary', 'content'])
      ? { summary: extractTag(entryXml, ['summary', 'content']) }
      : {}),
    ...(extractTag(entryXml, ['published'])
      ? { publishedAt: extractTag(entryXml, ['published']) }
      : {}),
    ...(publisherName ? { publisherName } : {}),
  }));
}

export function parseFeedXml(xml: string, feedUrl: string): ArticleCandidate[] {
  if (/<feed\b/i.test(xml)) return parseAtom(xml, feedUrl);
  if (/<rss\b/i.test(xml) || /<channel\b/i.test(xml)) return parseRss(xml, feedUrl);
  throw new Error('Response is not a valid RSS 2.0 or Atom 1.0 feed');
}

export function createRssSourceCollector(
  dependencies: RssSourceCollectorDependencies = {},
): SourceCollector {
  return {
    async collectCandidates(source: CollectorSource) {
      const response = await fetchCollectorText(source.url, dependencies, {
        label: 'RSS',
        headers: {
          Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
          'User-Agent': 'SubscribeAnything/1.0; runtime feed collector',
        },
      });
      return parseFeedXml(response.text, response.finalUrl);
    },
  };
}
