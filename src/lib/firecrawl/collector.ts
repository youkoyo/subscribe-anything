import type { CollectedItem } from '@/lib/sandbox/contract';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { firecrawlConfig } from '@/lib/db/schema';

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';
const FIRECRAWL_TIMEOUT_MS = 45_000;
const MAX_NEWS_AGE_DAYS = 180;
const MAX_FUTURE_SKEW_DAYS = 2;

export interface FirecrawlSourceInput {
  title: string;
  url: string;
  description?: string;
  criteria?: string;
  apiKey?: string;
  signal?: AbortSignal;
}

interface FirecrawlArticle {
  title?: unknown;
  url?: unknown;
  link?: unknown;
  summary?: unknown;
  description?: unknown;
  publishedAt?: unknown;
  published_at?: unknown;
  date?: unknown;
}

export async function getFirecrawlApiKey(): Promise<string | null> {
  try {
    const db = getDb();
    const config = (await db.select({ apiKey: firecrawlConfig.apiKey })
      .from(firecrawlConfig)
      .where(eq(firecrawlConfig.id, 'default')))[0];
    if (config?.apiKey.trim()) return config.apiKey.trim();
  } catch (error) {
    console.warn('[Firecrawl] unable to load the managed configuration, falling back to environment:', error);
  }
  return process.env.FIRECRAWL_API_KEY?.trim() || null;
}

export async function isFirecrawlConfigured(): Promise<boolean> {
  return (await getFirecrawlApiKey()) !== null;
}

/**
 * Extract the latest news cards from a public source page through Firecrawl.
 * Firecrawl handles page rendering and returns structured records; this app
 * remains responsible for relevance classification, deduplication and storage.
 */
export async function collectWithFirecrawl(input: FirecrawlSourceInput): Promise<CollectedItem[]> {
  const apiKey = input.apiKey ?? await getFirecrawlApiKey();
  if (!apiKey) throw new Error('Firecrawl API key is not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIRECRAWL_TIMEOUT_MS);
  const abort = () => controller.abort();
  input.signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(FIRECRAWL_SCRAPE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: input.url,
        formats: [{
          type: 'json',
          prompt: buildExtractionPrompt(input),
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    url: { type: 'string' },
                    summary: { type: 'string' },
                    publishedAt: { type: 'string' },
                  },
                  required: ['title', 'url'],
                },
              },
            },
            required: ['items'],
          },
        }],
        onlyMainContent: true,
        blockAds: true,
        proxy: 'auto',
        maxAge: 0,
        timeout: 30_000,
      }),
    });

    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || payload?.success === false) {
      throw new Error(readFirecrawlError(response.status, payload));
    }

    const items = normalizeItems(payload, input.url);
    if (items.length === 0) throw new Error('Firecrawl returned no usable current news items');
    return items;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', abort);
  }
}

function buildExtractionPrompt(input: FirecrawlSourceInput): string {
  const context = [input.title, input.description, input.criteria]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('；');
  return [
    '从当前页面提取实际展示的最新新闻或资讯条目，禁止编造内容、日期或链接。',
    '每条必须包含标题和该条新闻自身的链接；不要返回导航、专题标签、广告或重复条目。',
    context ? `只保留与以下主题或监控上下文强相关或有关的资讯：${context}。` : '',
  ].filter(Boolean).join('\n');
}

function normalizeItems(payload: Record<string, unknown> | null, sourceUrl: string): CollectedItem[] {
  const data = payload?.data as Record<string, unknown> | undefined;
  const json = data?.json ?? payload?.json;
  const records = isRecord(json) && Array.isArray(json.items) ? json.items : [];
  const seen = new Set<string>();

  return records.flatMap((record) => {
    if (!isRecord(record)) return [];
    const article = record as FirecrawlArticle;
    const title = readText(article.title);
    const rawUrl = readText(article.url) ?? readText(article.link);
    if (!title || !rawUrl) return [];

    let url: string;
    try {
      url = new URL(rawUrl, sourceUrl).toString();
    } catch {
      return [];
    }
    const publishedAt = readText(article.publishedAt) ?? readText(article.published_at) ?? readText(article.date);
    if (!publishedAt || !isCurrentPublication(publishedAt)) return [];
    const key = `${title}\n${url}`;
    if (seen.has(key)) return [];
    seen.add(key);

    return [{
      title,
      url,
      summary: readText(article.summary) ?? readText(article.description),
      publishedAt,
    }];
  });
}

/** Web-page extraction is only a validation source when it can prove recency.
 * A page without a real publication date must not seed an information pool. */
function isCurrentPublication(value: string): boolean {
  const publishedAt = new Date(value);
  if (Number.isNaN(publishedAt.getTime())) return false;
  const now = Date.now();
  const oldestAllowed = now - MAX_NEWS_AGE_DAYS * 24 * 60 * 60 * 1000;
  const newestAllowed = now + MAX_FUTURE_SKEW_DAYS * 24 * 60 * 60 * 1000;
  return publishedAt.getTime() >= oldestAllowed && publishedAt.getTime() <= newestAllowed;
}

function readFirecrawlError(status: number, payload: Record<string, unknown> | null): string {
  const error = readText(payload?.error) ?? readText(payload?.message);
  return error ? `Firecrawl request failed (${status}): ${error}` : `Firecrawl request failed (${status})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
