export interface ArticleMetadata {
  canonicalUrl?: string;
  title?: string;
  description?: string;
  publisherName?: string;
  publishedAt?: string;
}

type JsonRecord = Record<string, unknown>;

interface HtmlMeta {
  key: string;
  content: string;
}

const ARTICLE_TYPES = new Set([
  'article',
  'blogposting',
  'newsarticle',
  'reportagenewsarticle',
  'analysisnewsarticle',
]);

function nonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
  };

  return value.replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (entity, decimal, hex, name) => {
    if (name) return named[String(name).toLowerCase()] ?? entity;
    const codePoint = Number.parseInt(decimal ?? hex, decimal ? 10 : 16);
    try {
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : entity;
    } catch {
      return entity;
    }
  });
}

function parseAttributes(source: string) {
  const attributes = new Map<string, string>();
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

  for (const match of source.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    attributes.set(name, decodeHtmlEntities(value));
  }

  return attributes;
}

function extractHtmlMeta(html: string) {
  const meta: HtmlMeta[] = [];

  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1]);
    const key = nonBlankString(
      attributes.get('property') ?? attributes.get('name') ?? attributes.get('itemprop'),
    )?.toLowerCase();
    const content = nonBlankString(attributes.get('content'));
    if (key && content) meta.push({ key, content });
  }

  return meta;
}

function firstMeta(meta: HtmlMeta[], keys: string[]) {
  for (const key of keys) {
    const value = meta.find((entry) => entry.key === key)?.content;
    if (value) return value;
  }
  return undefined;
}

function resolveUrl(value: unknown, pageUrl: string) {
  const candidate = nonBlankString(value);
  if (!candidate) return undefined;

  try {
    return new URL(candidate).toString();
  } catch {
    try {
      return new URL(candidate, pageUrl).toString();
    } catch {
      return undefined;
    }
  }
}

function extractCanonicalLink(html: string, pageUrl: string) {
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1]);
    const rel = nonBlankString(attributes.get('rel'))?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.includes('canonical')) continue;
    const canonicalUrl = resolveUrl(attributes.get('href'), pageUrl);
    if (canonicalUrl) return canonicalUrl;
  }
  return undefined;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArticleNode(record: JsonRecord) {
  const rawType = record['@type'];
  const types = Array.isArray(rawType) ? rawType : [rawType];
  return types.some((type) => (
    typeof type === 'string' && ARTICLE_TYPES.has(type.toLowerCase())
  )) || typeof record.datePublished === 'string';
}

function collectArticleNodes(value: unknown, nodes: JsonRecord[]) {
  if (Array.isArray(value)) {
    for (const entry of value) collectArticleNodes(entry, nodes);
    return;
  }
  if (!isJsonRecord(value)) return;

  if (isArticleNode(value)) nodes.push(value);
  for (const nested of Object.values(value)) {
    if (typeof nested === 'object' && nested !== null) collectArticleNodes(nested, nodes);
  }
}

function extractPublisher(value: unknown): string | undefined {
  if (typeof value === 'string') return nonBlankString(value);
  if (Array.isArray(value)) {
    for (const entry of value) {
      const publisher: string | undefined = extractPublisher(entry);
      if (publisher) return publisher;
    }
  }
  if (isJsonRecord(value)) return nonBlankString(value.name);
  return undefined;
}

function extractJsonLdUrl(record: JsonRecord, pageUrl: string) {
  const directUrl = resolveUrl(record.url, pageUrl);
  if (directUrl) return directUrl;

  const mainEntity = record.mainEntityOfPage;
  if (typeof mainEntity === 'string') return resolveUrl(mainEntity, pageUrl);
  if (isJsonRecord(mainEntity)) {
    return resolveUrl(mainEntity['@id'] ?? mainEntity.url, pageUrl);
  }
  return undefined;
}

function extractJsonLd(html: string, pageUrl: string): ArticleMetadata {
  const nodes: JsonRecord[] = [];

  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = parseAttributes(match[1]);
    if (attributes.get('type')?.toLowerCase() !== 'application/ld+json') continue;

    try {
      collectArticleNodes(JSON.parse(match[2]), nodes);
    } catch {
      // A malformed block must not hide usable metadata from other blocks/tags.
    }
  }

  let canonicalUrl: string | undefined;
  let title: string | undefined;
  let description: string | undefined;
  let publisherName: string | undefined;
  let publishedAt: string | undefined;

  for (const record of nodes) {
    canonicalUrl ??= extractJsonLdUrl(record, pageUrl);
    title ??= nonBlankString(record.headline) ?? nonBlankString(record.name);
    description ??= nonBlankString(record.description);
    publisherName ??= extractPublisher(record.publisher);
    publishedAt ??= nonBlankString(record.datePublished);
  }

  return {
    ...(canonicalUrl ? { canonicalUrl } : {}),
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(publisherName ? { publisherName } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}

function extractTitleTag(html: string) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return match ? nonBlankString(decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' '))) : undefined;
}

export function extractArticleMetadata(html: string, pageUrl: string): ArticleMetadata {
  try {
    if (typeof html !== 'string' || !html) return {};

    const jsonLd = extractJsonLd(html, pageUrl);
    const meta = extractHtmlMeta(html);
    const canonicalUrl = extractCanonicalLink(html, pageUrl) ?? jsonLd.canonicalUrl;
    const title = jsonLd.title
      ?? firstMeta(meta, ['og:title', 'twitter:title', 'headline'])
      ?? extractTitleTag(html);
    const description = jsonLd.description
      ?? firstMeta(meta, ['og:description', 'description', 'twitter:description']);
    const publisherName = jsonLd.publisherName
      ?? firstMeta(meta, ['og:site_name', 'application-name', 'publisher']);
    const publishedAt = jsonLd.publishedAt
      ?? firstMeta(meta, ['article:published_time', 'og:published_time', 'datepublished', 'pubdate', 'date']);

    return {
      ...(canonicalUrl ? { canonicalUrl } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(publisherName ? { publisherName } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    };
  } catch {
    return {};
  }
}
