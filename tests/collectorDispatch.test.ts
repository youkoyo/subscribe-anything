import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArticleCandidate } from '../src/lib/collection/articleTypes';
import {
  createCollectorDispatcher,
} from '../src/lib/collection/collectors';
import { createJsonSourceCollector } from '../src/lib/collection/collectors/jsonSourceCollector';
import { createRssSourceCollector } from '../src/lib/collection/collectors/rssSourceCollector';
import { createSearchSourceCollector } from '../src/lib/collection/collectors/searchSourceCollector';
import { createScriptSourceCollector } from '../src/lib/collection/collectors/scriptSourceCollector';
import type {
  CollectorSource,
  SourceCollector,
} from '../src/lib/collection/collectors/types';
import type { SearchPlan } from '../src/lib/search/queryPlan';
import {
  clearRetry,
  getRetryState,
  type CollectResultInfo,
} from '../src/lib/scheduler/retryManager';

function source(
  collectorType: CollectorSource['collectorType'],
  overrides: Partial<CollectorSource> = {},
): CollectorSource {
  return {
    id: `source-${collectorType}`,
    subscriptionId: 'subscription-1',
    title: `${collectorType} source`,
    collectorType,
    collectorConfigJson: '{}',
    url: 'https://example.com/feed',
    script: 'async function collect() { return []; }',
    cronExpression: '0 * * * *',
    ...overrides,
  };
}

function searchPlan(queries = ['first query', 'second query']): SearchPlan {
  return {
    version: 1,
    freshnessDays: 14,
    requirePublishedAt: true,
    queries: queries.map((query, index) => ({
      id: `query-${index + 1}`,
      query,
      category: 'event',
      enabled: true,
    })),
  };
}

function response(body: string, contentType: string) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

test('search dispatch executes the persisted plan without invoking the script collector', async () => {
  let scriptCalls = 0;
  const searchCollector = createSearchSourceCollector({
    async searchFn() {
      return [{
        title: '晋江鞋厂发生火灾',
        url: 'https://news.example.com/shoe-factory-fire',
        snippet: '当地消防部门正在处置。',
        publishedAt: '2026-07-12T08:00:00Z',
        publisherName: '示例新闻社',
      }];
    },
  });
  const scriptCollector = createScriptSourceCollector({
    async runScriptFn() {
      scriptCalls += 1;
      return { success: true, items: [] };
    },
  });
  const dispatcher = createCollectorDispatcher({
    search: searchCollector,
    rss: scriptCollector,
    json: scriptCollector,
    feed_script: scriptCollector,
  });

  const candidates = await dispatcher(source('search', {
    collectorConfigJson: JSON.stringify(searchPlan(['shoe fire'])),
  }));

  assert.equal(scriptCalls, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].origin, 'search');
  assert.equal(candidates[0].publishedAt, '2026-07-12T08:00:00Z');
  assert.equal(candidates[0].publisherName, '示例新闻社');
  assert.deepEqual(candidates[0].queryEvidence?.map((item) => item.queryId), ['query-1']);
});

test('search collector isolates one failed query and keeps ordered evidence from successes', async () => {
  const calls: string[] = [];
  const collector = createSearchSourceCollector({
    async searchFn(query) {
      calls.push(query);
      if (query === 'first query') throw new Error('provider timeout');
      return [{
        title: '泉州鞋企安全事故通报',
        url: 'https://news.example.com/incident?utm_source=mail',
        snippet: '事故发生后已启动调查。',
        publishedAt: '2026-07-11T09:30:00Z',
      }];
    },
  });

  const candidates = await collector.collectCandidates(source('search', {
    collectorConfigJson: JSON.stringify(searchPlan()),
  }));

  assert.deepEqual(calls, ['first query', 'second query']);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].url, 'https://news.example.com/incident');
  assert.deepEqual(candidates[0].queryEvidence?.map((item) => item.queryId), ['query-2']);
});

test('search collector treats a successful zero-result plan as a healthy empty collection', async () => {
  const collector = createSearchSourceCollector({
    async searchFn() {
      return [];
    },
  });

  assert.deepEqual(
    await collector.collectCandidates(source('search', {
      collectorConfigJson: JSON.stringify(searchPlan(['no matches'])),
    })),
    [],
  );
});

test('search collector fails when every enabled query fails or no query is enabled', async () => {
  const collector = createSearchSourceCollector({
    async searchFn() {
      throw new Error('search provider unavailable');
    },
  });

  await assert.rejects(
    collector.collectCandidates(source('search', {
      collectorConfigJson: JSON.stringify(searchPlan(['one', 'two'])),
    })),
    /all enabled search queries failed/i,
  );
  await assert.rejects(
    collector.collectCandidates(source('search', {
      collectorConfigJson: JSON.stringify(searchPlan([])),
    })),
    /enabled search query/i,
  );
});

test('feed-script collector is the only adapter that runs legacy JavaScript and rejects empty output', async () => {
  const scripts: string[] = [];
  const collector = createScriptSourceCollector({
    async runScriptFn(script) {
      scripts.push(script);
      return {
        success: true,
        items: [{
          title: '鞋企发布安全整改公告',
          url: 'https://example.com/notices/safety',
          summary: '企业公布整改进展。',
          publishedAt: '2026-07-12T10:00:00Z',
        }],
      };
    },
  });
  const scriptSource = source('feed_script', { script: 'return legacyItems();' });

  const candidates = await collector.collectCandidates(scriptSource);
  assert.deepEqual(scripts, ['return legacyItems();']);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].origin, 'feed');
  assert.equal(candidates[0].publishedAt, '2026-07-12T10:00:00Z');

  const emptyCollector = createScriptSourceCollector({
    async runScriptFn() {
      return { success: true, items: [] };
    },
  });
  await assert.rejects(
    emptyCollector.collectCandidates(scriptSource),
    /did not return any data/i,
  );

  const failedCollector = createScriptSourceCollector({
    async runScriptFn() {
      return { success: false, error: 'sandbox execution failed' };
    },
  });
  await assert.rejects(
    failedCollector.collectCandidates(scriptSource),
    /sandbox execution failed/i,
  );

  const thrownFailure = new Error('isolated runtime unavailable');
  const throwingCollector = createScriptSourceCollector({
    async runScriptFn() {
      throw thrownFailure;
    },
  });
  await assert.rejects(
    throwingCollector.collectCandidates(scriptSource),
    (error) => error === thrownFailure,
  );
});

test('RSS collector parses RSS 2.0 in-process with CDATA, entities, dates, and publisher', async () => {
  let fetchCalls = 0;
  const collector = createRssSourceCollector({
    async fetchFn() {
      fetchCalls += 1;
      return response(`<?xml version="1.0"?>
        <rss version="2.0"><channel>
          <title>Shoe &amp; Safety News</title>
          <item>
            <title><![CDATA[晋江鞋厂发生火灾]]></title>
            <link>https://news.example.com/rss-fire</link>
            <description><![CDATA[<p>消防部门正在处置。</p>]]></description>
            <pubDate>Sun, 12 Jul 2026 08:00:00 GMT</pubDate>
          </item>
        </channel></rss>`, 'application/rss+xml');
    },
  });

  const candidates = await collector.collectCandidates(source('rss'));
  assert.equal(fetchCalls, 1);
  assert.deepEqual(candidates, [{
    origin: 'feed',
    url: 'https://news.example.com/rss-fire',
    title: '晋江鞋厂发生火灾',
    summary: '消防部门正在处置。',
    publishedAt: 'Sun, 12 Jul 2026 08:00:00 GMT',
    publisherName: 'Shoe & Safety News',
    raw: {
      title: '晋江鞋厂发生火灾',
      url: 'https://news.example.com/rss-fire',
      summary: '消防部门正在处置。',
      publishedAt: 'Sun, 12 Jul 2026 08:00:00 GMT',
      publisherName: 'Shoe & Safety News',
    },
  }]);
});

test('RSS collector parses Atom alternate links and accepts a structurally valid empty feed', async () => {
  const documents = [
    `<feed xmlns="http://www.w3.org/2005/Atom">
      <title>Industry Wire</title>
      <entry>
        <title>鞋企事故调查进展</title>
        <link href='https://news.example.com/atom-incident' rel='alternate'/>
        <summary>调查组已进驻现场。</summary>
        <published>2026-07-12T11:00:00Z</published>
      </entry>
    </feed>`,
    `<rss version="2.0"><channel><title>Empty Feed</title></channel></rss>`,
  ];
  const collector = createRssSourceCollector({
    async fetchFn() {
      return response(documents.shift() ?? '', 'application/xml');
    },
  });

  const candidates = await collector.collectCandidates(source('rss'));
  assert.equal(candidates[0].url, 'https://news.example.com/atom-incident');
  assert.equal(candidates[0].publishedAt, '2026-07-12T11:00:00Z');
  assert.equal(candidates[0].publisherName, 'Industry Wire');
  assert.deepEqual(await collector.collectCandidates(source('rss')), []);
});

test('JSON collector maps root and nested arrays through simple field paths', async () => {
  const documents: unknown[] = [
    [{
      headline: '鞋业安全快讯',
      link: 'https://api.example.com/articles/1',
      date: '2026-07-12T06:00:00Z',
    }],
    {
      data: {
        items: [{
          headline: '制鞋企业事故通报',
          link: 'https://api.example.com/articles/2',
          details: { summary: '监管部门发布调查信息。' },
          date: '2026-07-12T07:00:00Z',
          outlet: { name: '产业新闻社' },
        }],
      },
    },
    [],
  ];
  const collector = createJsonSourceCollector({
    async fetchFn() {
      return new Response(JSON.stringify(documents.shift()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const fields = {
    title: 'headline',
    url: 'link',
    publishedAt: 'date',
  };

  const root = await collector.collectCandidates(source('json', {
    collectorConfigJson: JSON.stringify({ fields }),
    url: 'https://api.example.com/root',
  }));
  assert.equal(root[0].title, '鞋业安全快讯');
  assert.equal(root[0].origin, 'feed');

  const nested = await collector.collectCandidates(source('json', {
    collectorConfigJson: JSON.stringify({
      endpoint: 'https://api.example.com/nested',
      itemsPath: 'data.items',
      fields: {
        ...fields,
        summary: 'details.summary',
        publisherName: 'outlet.name',
      },
    }),
  }));
  assert.equal(nested[0].summary, '监管部门发布调查信息。');
  assert.equal(nested[0].publisherName, '产业新闻社');

  assert.deepEqual(await collector.collectCandidates(source('json', {
    collectorConfigJson: JSON.stringify({ fields }),
    url: 'https://api.example.com/empty',
  })), []);
});

test('JSON collector rejects unsafe or incomplete configuration instead of guessing', async () => {
  const collector = createJsonSourceCollector({
    async fetchFn() {
      throw new Error('fetch should not run');
    },
  });

  await assert.rejects(
    collector.collectCandidates(source('json', {
      collectorConfigJson: JSON.stringify({
        fields: { title: 'title', url: 'url' },
      }),
    })),
    /publishedAt/i,
  );
  await assert.rejects(
    collector.collectCandidates(source('json', {
      collectorConfigJson: '{not-json',
    })),
    /JSON collector config/i,
  );
});

test('dispatcher rejects an unknown collector type without falling back to script', async () => {
  let scriptCalls = 0;
  const unused: SourceCollector = { async collectCandidates() { return []; } };
  const script: SourceCollector = {
    async collectCandidates() {
      scriptCalls += 1;
      return [];
    },
  };
  const dispatcher = createCollectorDispatcher({
    search: unused,
    rss: unused,
    json: unused,
    feed_script: script,
  });

  await assert.rejects(
    dispatcher(source('feed_script', {
      collectorType: 'unknown' as CollectorSource['collectorType'],
    })),
    /unknown collector type/i,
  );
  assert.equal(scriptCalls, 0);
});

interface SchedulerDbResult {
  db: unknown;
  updates: Array<Record<string, unknown>>;
}

function schedulerDb(collectorType: CollectorSource['collectorType']): SchedulerDbResult {
  const selections = [[source(collectorType)], [{
    id: 'subscription-1',
    topic: '鞋业动态资讯',
    criteria: '关注最近30天鞋业安全事故',
  }]];
  const updates: Array<Record<string, unknown>> = [];

  return {
    updates,
    db: {
      select() {
        return {
          from() {
            return {
              async where() {
                return selections.shift() ?? [];
              },
            };
          },
        };
      },
      update() {
        return {
          set(values: Record<string, unknown>) {
            updates.push(values);
            return { async where() {} };
          },
        };
      },
    },
  };
}

type SchedulerDependencies = {
  db: unknown;
  collectCandidates: (source: CollectorSource) => Promise<ArticleCandidate[]>;
  ingestArticles: (input: { candidates: readonly ArticleCandidate[] }) => Promise<{
    inserted: number;
    rejected: number;
    duplicates: number;
  }>;
  setLastResult: (sourceId: string, result: CollectResultInfo) => void;
};

test('scheduler treats zero search candidates as a successful zero-item run', async () => {
  const { collectWithDependencies } = await import('../src/lib/scheduler/collector');
  const sourceId = 'source-search';
  const { db, updates } = schedulerDb('search');
  let recorded: CollectResultInfo | undefined;
  clearRetry(sourceId);

  try {
    const result = await collectWithDependencies(sourceId, {
      db,
      async collectCandidates() {
        return [];
      },
      async ingestArticles(input) {
        assert.deepEqual(input.candidates, []);
        return { inserted: 0, rejected: 0, duplicates: 0 };
      },
      setLastResult(_sourceId, resultInfo) {
        recorded = resultInfo;
      },
    } as SchedulerDependencies as never);

    assert.deepEqual(result, { newItems: 0, skipped: 0 });
    assert.equal(recorded?.success, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].lastRunSuccess, true);
  } finally {
    clearRetry(sourceId);
  }
});

test('scheduler routes collector failures through retry state and a failed result', async () => {
  const { collectWithDependencies } = await import('../src/lib/scheduler/collector');
  const sourceId = 'source-feed_script';
  const { db, updates } = schedulerDb('feed_script');
  let recorded: CollectResultInfo | undefined;
  clearRetry(sourceId);

  try {
    const result = await collectWithDependencies(sourceId, {
      db,
      async collectCandidates() {
        throw new Error('feed script did not return any data');
      },
      async ingestArticles() {
        throw new Error('ingestion should not run');
      },
      setLastResult(_recordedSourceId, resultInfo) {
        recorded = resultInfo;
      },
    } as SchedulerDependencies as never);

    assert.equal(result.error, 'feed script did not return any data');
    assert.equal(getRetryState(sourceId)?.attempt, 1);
    assert.equal(recorded?.success, false);
    assert.equal(updates[0].lastRunSuccess, false);
  } finally {
    clearRetry(sourceId);
  }
});
