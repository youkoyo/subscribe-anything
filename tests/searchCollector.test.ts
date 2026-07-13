import assert from 'node:assert/strict';
import test from 'node:test';
import { mapSerperResult, mapTavilyResult, type SearchResult } from '../src/lib/ai/tools/webSearch';
import { executeSearchPlan } from '../src/lib/search/searchCollector';
import type { SearchPlan } from '../src/lib/search/queryPlan';

function plan(queries: Array<{ id: string; query: string }>): SearchPlan {
  return {
    version: 1,
    freshnessDays: 14,
    requirePublishedAt: true,
    queries: queries.map((query) => ({ ...query, category: 'event', enabled: true })),
  };
}

test('preserves successful results when another query fails', async () => {
  const result = await executeSearchPlan(
    plan([
      { id: 'query-1', query: 'first query' },
      { id: 'query-2', query: 'broken query' },
      { id: 'query-3', query: 'empty query' },
    ]),
    async (query): Promise<SearchResult[]> => {
      if (query === 'broken query') throw new Error('provider unavailable');
      if (query === 'empty query') return [];
      return [{ title: 'First result', url: 'https://example.com/story', snippet: 'Found it' }];
    },
  );

  assert.deepEqual(result.executions, [
    { queryId: 'query-1', query: 'first query', status: 'success', resultCount: 1 },
    { queryId: 'query-2', query: 'broken query', status: 'error', resultCount: 0, error: 'provider unavailable' },
    { queryId: 'query-3', query: 'empty query', status: 'success', resultCount: 0 },
  ]);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.candidates[0].queryIds, ['query-1']);
});

test('limits concurrent search executions', async () => {
  let active = 0;
  let maximumActive = 0;

  await executeSearchPlan(
    plan(Array.from({ length: 7 }, (_, index) => ({
      id: `query-${index + 1}`,
      query: `query ${index + 1}`,
    }))),
    async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return [];
    },
  );

  assert.equal(maximumActive, 3);
});

test('merges duplicate canonical URLs and accumulates ordered evidence', async () => {
  const delays: Record<string, number> = { 'first query': 20, 'second query': 0 };
  const results: Record<string, SearchResult[]> = {
    'first query': [{
      title: 'Original headline',
      url: 'https://Example.com/news?id=7&utm_source=mail#section',
      snippet: 'Original snippet',
      publishedAt: '3 hours ago',
      publisherName: 'Example Wire',
    }],
    'second query': [
      {
        title: 'Second headline',
        url: 'https://example.com/news?fbclid=abc&id=7',
        snippet: 'Second snippet',
        publishedAt: '2026-07-13T08:00:00Z',
      },
      {
        title: 'Another story',
        url: 'https://example.com/other?z=2&gclid=tracker&a=1',
        snippet: 'Another snippet',
      },
    ],
  };

  const result = await executeSearchPlan(
    plan([
      { id: 'query-1', query: 'first query' },
      { id: 'query-2', query: 'second query' },
    ]),
    async (query) => {
      await new Promise((resolve) => setTimeout(resolve, delays[query]));
      return results[query];
    },
  );

  assert.deepEqual(result.executions.map((execution) => execution.queryId), ['query-1', 'query-2']);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].url, 'https://example.com/news?id=7');
  assert.deepEqual(result.candidates[0].queryIds, ['query-1', 'query-2']);
  assert.deepEqual(result.candidates[0].evidence, [
    {
      queryId: 'query-1',
      query: 'first query',
      title: 'Original headline',
      url: 'https://Example.com/news?id=7&utm_source=mail#section',
      snippet: 'Original snippet',
      publishedAt: '3 hours ago',
      publisherName: 'Example Wire',
    },
    {
      queryId: 'query-2',
      query: 'second query',
      title: 'Second headline',
      url: 'https://example.com/news?fbclid=abc&id=7',
      snippet: 'Second snippet',
      publishedAt: '2026-07-13T08:00:00Z',
    },
  ]);
  assert.equal(result.candidates[1].url, 'https://example.com/other?a=1&z=2');
});

test('maps provider dates and explicit publishers without inventing metadata', () => {
  assert.deepEqual(
    mapSerperResult({
      title: 'Serper result',
      link: 'https://example.com/serper',
      snippet: 'Serper snippet',
      date: '2 days ago',
      source: 'Named Serper Source',
    }),
    {
      title: 'Serper result',
      url: 'https://example.com/serper',
      snippet: 'Serper snippet',
      publishedAt: '2 days ago',
      publisherName: 'Named Serper Source',
    },
  );
  assert.deepEqual(
    mapTavilyResult({
      title: 'Tavily result',
      url: 'https://example.com/tavily',
      content: 'Tavily snippet',
      published_date: '2026-07-12T01:02:03.000Z',
      publisher: 'Named Tavily Publisher',
    }),
    {
      title: 'Tavily result',
      url: 'https://example.com/tavily',
      snippet: 'Tavily snippet',
      publishedAt: '2026-07-12T01:02:03.000Z',
      publisherName: 'Named Tavily Publisher',
    },
  );
  assert.equal(
    mapTavilyResult({
      title: 'Camel date',
      url: 'https://news.example/camel',
      content: '',
      publishedDate: 'Yesterday at 9:15 PM',
    }).publishedAt,
    'Yesterday at 9:15 PM',
  );

  const serperWithoutMetadata = mapSerperResult({
    title: 'Hostname is not a publisher',
    link: 'https://publisher.example/story',
    snippet: 'No provider metadata',
  });
  const tavilyWithoutMetadata = mapTavilyResult({
    title: 'Dated-looking title 2026-07-13',
    url: 'https://publisher.example/story',
    content: 'No provider metadata',
  });
  assert.equal(serperWithoutMetadata.publishedAt, undefined);
  assert.equal(serperWithoutMetadata.publisherName, undefined);
  assert.equal(tavilyWithoutMetadata.publishedAt, undefined);
  assert.equal(tavilyWithoutMetadata.publisherName, undefined);
});
