/**
 * checkFeed — lightweight RSS/Atom feed validator with parallel execution.
 *
 * Checks per URL:
 *   1. Template pattern match (free, no network)
 *   2. HTTP 2xx + XML feed markers
 *   3. (Optional) Keyword search in feed body
 *   4. Freshness data (latest item date, item count)
 *
 * All URLs validated in parallel (max 8 concurrent), each with its own 10s timeout.
 * Freshness is a soft signal for the LLM — it never causes valid=false alone.
 */

import { findMatchingTemplateUrl } from './rssRadar';

const TIMEOUT_MS = 10_000;
const MAX_CONCURRENT = 8;
const MAX_READ_BYTES_NO_KW = 64 * 1024;
const MAX_READ_BYTES_WITH_KW = 256 * 1024;

export interface CheckFeedResult {
  valid: boolean;
  status: number;
  templateMismatch?: boolean;
  keywordFound?: boolean;
  errorMessage?: string;
  hint?: string;
  latestItemDate?: string | null;
  itemCount?: number;
  freshness?: string;
}

// ── helpers ─────────────────────────────────────────────────────────────

function extractRssHubError(html: string): string | undefined {
  const match = html.match(/<code[^>]+class="[^"]*\bdetails\b[^"]*"[^>]*>([\s\S]*?)<\/code>/i);
  if (!match) return undefined;
  return match[1]
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, c: string) => String.fromCharCode(parseInt(c, 10)))
    .trim();
}

type DateBuilder = (m: RegExpExecArray) => Date;

const DATE_PATTERNS: [RegExp, DateBuilder][] = [
  [
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/i,
    (m) => {
      const months: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
      return new Date(parseInt(m[3]), months[m[2].toLowerCase()], parseInt(m[1]), parseInt(m[4]), parseInt(m[5]), parseInt(m[6]));
    },
  ],
  [/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/, (m) => new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), parseInt(m[4]), parseInt(m[5]), parseInt(m[6]))],
  [/(\d{4})-(\d{2})-(\d{2})/, (m) => new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]))],
];

function tryParseDate(str: string): Date | null {
  for (const [re, builder] of DATE_PATTERNS) {
    const m = re.exec(str);
    if (m) { const d = builder(m as unknown as RegExpExecArray); if (!isNaN(d.getTime())) return d; }
  }
  return null;
}

function extractFreshness(xml: string): { latestItemDate: string | null; itemCount: number; freshness: string } {
  const rssItems = (xml.match(/<item[\s>]/gi) || []).length;
  const atomEntries = (xml.match(/<entry[\s>]/gi) || []).length;
  const itemCount = rssItems + atomEntries;

  const dates: Date[] = [];
  for (const pat of [/<pubDate>([\s\S]*?)<\/pubDate>/gi, /<dc:date>([\s\S]*?)<\/dc:date>/gi, /<published>([\s\S]*?)<\/published>/gi, /<updated>([\s\S]*?)<\/updated>/gi]) {
    let m; while ((m = pat.exec(xml)) !== null) { const d = tryParseDate(m[1].trim()); if (d) dates.push(d); }
  }
  const buildMatch = /<lastBuildDate>([\s\S]*?)<\/lastBuildDate>/i.exec(xml);
  if (buildMatch) { const d = tryParseDate(buildMatch[1].trim()); if (d) dates.push(d); }

  let latestItemDate: string | null = null;
  let freshness: string;
  if (dates.length > 0) {
    const latest = new Date(Math.max(...dates.map((d) => d.getTime())));
    latestItemDate = latest.toISOString();
    const ageDays = Math.round((Date.now() - latest.getTime()) / 86400000);
    if (ageDays <= 1) freshness = `活跃 (最新内容 ${ageDays === 0 ? '今天' : '1天前'})`;
    else if (ageDays <= 3) freshness = `活跃 (最新内容 ${ageDays} 天前)`;
    else if (ageDays <= 7) freshness = `较新 (最新内容 ${ageDays} 天前)`;
    else if (ageDays <= 30) freshness = `较旧 (最新内容 ${ageDays} 天前)`;
    else if (ageDays <= 90) freshness = `陈旧 (最新内容 ${ageDays} 天前)`;
    else if (ageDays <= 365) freshness = `非常陈旧 (最新内容 ${Math.round(ageDays / 30)} 个月前)`;
    else freshness = `疑似死站 (最新内容 ${Math.round(ageDays / 365)} 年前)`;
  } else {
    freshness = '无法判断 (未提取到发布时间)';
  }
  return { latestItemDate, itemCount, freshness };
}

// ── per-URL validation ─────────────────────────────────────────────────

async function validateOneFeed(
  url: string, signal: AbortSignal, maxBytes: number, keywords?: string[]
): Promise<CheckFeedResult> {
  // Check 1: template pattern (free)
  const matchedTemplate = findMatchingTemplateUrl(url);
  if (matchedTemplate !== null) {
    let urlPath: string;
    try { urlPath = new URL(url).pathname; } catch {
      return { valid: false, status: 0, templateMismatch: true, hint: `"${url}" is not a valid URL.` };
    }
    if (urlPath.split('/').some((seg) => seg.startsWith(':'))) {
      return { valid: false, status: 0, templateMismatch: true, hint: `URL still has :param placeholders.` };
    }
  }

  // Checks 2+3: HTTP + XML markers
  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SubscribeAnything/1.0)', Accept: 'application/rss+xml,application/atom+xml,text/xml,application/xml,*/*' },
    });
  } catch {
    return { valid: false, status: 0 };
  }

  if (res.status < 200 || res.status >= 300) {
    const em = await res.text().catch(() => '').then(extractRssHubError);
    return { valid: false, status: res.status, ...(em ? { errorMessage: em } : {}) };
  }

  const reader = res.body?.getReader();
  let text = '';
  if (reader) {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let received = 0;
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      received += value.byteLength;
    }
    reader.cancel().catch(() => {});
  }

  const isXml = text.includes('<rss') || text.includes('<feed') || text.includes('<item>') || text.includes('<item ') || text.includes('<entry>') || text.includes('<entry ');
  if (!isXml) {
    const em = extractRssHubError(text);
    return { valid: false, status: res.status, ...(em ? { errorMessage: em } : {}) };
  }

  const { latestItemDate, itemCount, freshness } = extractFreshness(text);

  // Check 4: keywords (optional)
  if (keywords?.length) {
    const textLower = text.toLowerCase();
    const found = keywords.some((kw) => textLower.includes(kw.toLowerCase()));
    return {
      valid: found, status: res.status, keywordFound: found,
      latestItemDate, itemCount: itemCount || undefined, freshness,
      hint: found ? undefined : `Keywords not found in feed body.`,
    };
  }

  return { valid: true, status: res.status, latestItemDate, itemCount: itemCount || undefined, freshness };
}

// ── public API ──────────────────────────────────────────────────────────

export async function checkFeed(urls: string[], keywords?: string[]): Promise<CheckFeedResult[]> {
  const maxBytes = keywords?.length ? MAX_READ_BYTES_WITH_KW : MAX_READ_BYTES_NO_KW;
  const results: CheckFeedResult[] = new Array(urls.length);

  let nextIndex = 0;
  const workers: Promise<void>[] = [];

  for (let i = 0; i < MAX_CONCURRENT && i < urls.length; i++) {
    workers.push((async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= urls.length) return;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
        try { results[idx] = await validateOneFeed(urls[idx], ctl.signal, maxBytes, keywords); }
        catch { results[idx] = { valid: false, status: 0 }; }
        finally { clearTimeout(timer); }
      }
    })());
  }

  await Promise.all(workers);
  return results;
}

/** OpenAI tool definition */
export const checkFeedToolDef = {
  type: 'function' as const,
  function: {
    name: 'checkFeed',
    description: 'Validate multiple RSS/Atom feed URLs in parallel (max 8 concurrent, 10s timeout each). Returns per-URL: valid, status, freshness, itemCount, keywordFound.',
    parameters: {
      type: 'object',
      properties: {
        urls: { type: 'array', items: { type: 'string' }, description: 'List of RSS/Atom feed URLs to validate.' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'Entity names to search in feed body (case-insensitive).' },
      },
      required: ['urls'],
    },
  },
};
