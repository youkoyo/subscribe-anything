import assert from 'node:assert/strict';
import test from 'node:test';

import { collectWithFirecrawl } from '../src/lib/firecrawl/collector';

test('Firecrawl collector normalizes article URLs returned from a source page', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), 'https://api.firecrawl.dev/v2/scrape');
    assert.match(String((init as RequestInit).headers && JSON.stringify((init as RequestInit).headers)), /Bearer test-key/);
    return new Response(JSON.stringify({
      success: true,
      data: {
        json: {
          items: [{
            title: '鞋厂订单回暖',
            url: '/news/shoes-1',
            summary: '制造业订单动态',
            publishedAt: '2026-07-15T08:00:00.000Z',
          }],
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const items = await collectWithFirecrawl({
      title: '鞋业资讯',
      url: 'https://example.com/industry/shoes',
      description: '鞋业行业新闻',
      apiKey: 'test-key',
    });

    assert.deepEqual(items, [{
      title: '鞋厂订单回暖',
      url: 'https://example.com/news/shoes-1',
      summary: '制造业订单动态',
      publishedAt: '2026-07-15T08:00:00.000Z',
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Firecrawl collector rejects a successful response with no usable articles', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    data: { json: { items: [] } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => collectWithFirecrawl({
        title: '鞋业资讯',
        url: 'https://example.com/industry/shoes',
        apiKey: 'test-key',
      }),
      /no usable current news items/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Firecrawl collector rejects undated and stale extracted items instead of treating them as current news', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    data: { json: { items: [
      { title: '缺少发布时间的条目', url: '/undated' },
      { title: '很久以前的条目', url: '/stale', publishedAt: '2020-01-01' },
    ] } },
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    await assert.rejects(
      () => collectWithFirecrawl({ title: '测试资讯', url: 'https://example.com/news', apiKey: 'test-key' }),
      /no usable current news items/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('legacy AI discovery marks webpage sources for Firecrawl when the service is configured', async () => {
  const { readFile } = await import('node:fs/promises');
  const [pipeline, schema, collector] = await Promise.all([
    readFile('src/lib/managed/pipeline.ts', 'utf8'),
    readFile('src/lib/db/schema.ts', 'utf8'),
    readFile('src/lib/scheduler/collector.ts', 'utf8'),
  ]);

  assert.match(pipeline, /getFirecrawlApiKey\(\)/);
  assert.match(pipeline, /collectionStrategy:\s*'firecrawl_scrape'/);
  assert.match(schema, /'firecrawl_scrape'/);
  assert.match(collector, /source\.collectionStrategy === 'firecrawl_scrape'/);
  const step3 = await readFile('src/components/wizard/Step3ScriptGen.tsx', 'utf8');
  assert.match(step3, /collectionStrategy === 'firecrawl_scrape'/);
});

test('legacy discovery keeps real RSS feeds on native parsing and profile-filters their initial items', async () => {
  const pipeline = await (await import('node:fs/promises')).readFile('src/lib/managed/pipeline.ts', 'utf8');

  assert.match(pipeline, /isNativeRssSource/);
  assert.match(pipeline, /rssFetch\(source\.url, \{ maxItems: 'all' \}\)/);
  assert.match(pipeline, /classifyProfileItems\(source\.termProfile/);
  assert.match(pipeline, /buildProfileCollectionHint\(source\.termProfile, criteria\)/);
});

test('scheduled Firecrawl collection passes the stored industry portrait to extraction', async () => {
  const collector = await (await import('node:fs/promises')).readFile('src/lib/scheduler/collector.ts', 'utf8');

  assert.match(collector, /buildProfileCollectionHint\(industryProfile, subscription\?\.criteria/);
});

test('Firecrawl pages without current dated news are skipped instead of falling back to an unverified AI script', async () => {
  const pipeline = await (await import('node:fs/promises')).readFile('src/lib/managed/pipeline.ts', 'utf8');

  assert.match(pipeline, /function hasNoCurrentFirecrawlItems/);
  assert.match(pipeline, /未找到带可信发布时间的近期资讯，已跳过该网页源/);
});
