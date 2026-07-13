/**
 * webSearch tool — wraps Tavily or Serper based on DB search provider config.
 *
 * Returns an array of search result objects:
 *   { title: string; url: string; snippet: string }[]
 *
 * Throws a user-friendly error if:
 *   - No search provider is configured (provider = 'none')
 *   - The API call fails
 */

import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { searchProviderConfig } from '@/lib/db/schema';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  publisherName?: string;
}

interface TavilyResult {
  title: string;
  url: string;
  content?: string;
  published_date?: string;
  publishedDate?: string;
  publisher?: string;
  source?: string;
}

interface SerperResult {
  title: string;
  link: string;
  snippet?: string;
  date?: string;
  publisher?: string;
  source?: string;
}

function explicitPublisher(result: { publisher?: string; source?: string }) {
  if (typeof result.publisher === 'string') return result.publisher;
  if (typeof result.source === 'string') return result.source;
  return undefined;
}

export function mapTavilyResult(result: TavilyResult): SearchResult {
  const publishedAt = typeof result.published_date === 'string'
    ? result.published_date
    : result.publishedDate;
  const publisherName = explicitPublisher(result);

  return {
    title: result.title,
    url: result.url,
    snippet: (result.content ?? '').slice(0, 200),
    ...(typeof publishedAt === 'string' ? { publishedAt } : {}),
    ...(publisherName !== undefined ? { publisherName } : {}),
  };
}

export function mapSerperResult(result: SerperResult): SearchResult {
  const publisherName = explicitPublisher(result);

  return {
    title: result.title,
    url: result.link,
    snippet: (result.snippet ?? '').slice(0, 200),
    ...(typeof result.date === 'string' ? { publishedAt: result.date } : {}),
    ...(publisherName !== undefined ? { publisherName } : {}),
  };
}

export interface WebSearchOptions {
  signal?: AbortSignal;
}

async function searchTavily(
  query: string,
  apiKey: string,
  options: WebSearchOptions,
): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 10,
    }),
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily search failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  // Tavily returns { results: [{ title, url, content, ... }] }
  return (data.results ?? []).map(mapTavilyResult);
}

async function searchSerper(
  query: string,
  apiKey: string,
  options: WebSearchOptions,
): Promise<SearchResult[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ q: query, num: 10 }),
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Serper search failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  // Serper returns { organic: [{ title, link, snippet, ... }] }
  return (data.organic ?? []).map(mapSerperResult);
}

/** Runs a web search using the configured provider. Throws if not configured. */
export async function webSearch(
  query: string,
  options: WebSearchOptions = {},
): Promise<SearchResult[]> {
  const db = getDb();
  const config = (await db
    .select()
    .from(searchProviderConfig)
    .where(eq(searchProviderConfig.id, 'default')))[0];

  const provider = config?.provider ?? 'none';
  const apiKey = config?.apiKey ?? '';

  if (provider === 'none' || !apiKey) {
    throw new Error(
      'No search provider configured. Please go to Settings → 搜索供应商 and configure Tavily or Serper.'
    );
  }

  if (provider === 'tavily') return searchTavily(query, apiKey, options);
  if (provider === 'serper') return searchSerper(query, apiKey, options);

  throw new Error(`Unknown search provider: ${provider}`);
}

/** OpenAI tool definition for webSearch */
export const webSearchToolDef = {
  type: 'function' as const,
  function: {
    name: 'webSearch',
    description: 'Search the web for information. Use this to find data sources and websites.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
      },
      required: ['query'],
    },
  },
};
