import assert from 'node:assert/strict';
import test from 'node:test';
import type { ArticleCandidate } from '../src/lib/collection/articleTypes';
import {
  classifyDiscoveryCollectionMode,
  discoverCollectionPlan,
} from '../src/lib/collection/discoveryPlan';
import type { FoundSource } from '../src/types/wizard';

const now = new Date('2026-07-13T12:00:00Z');
const input = {
  topic: '鞋业动态资讯',
  criteria: '关注最近30天鞋业安全事故和火灾',
  sourcePreferences: [],
};

function currentSearchResult(overrides: Record<string, unknown> = {}) {
  return {
    title: '福建晋江一鞋厂发生火灾，当地正在处置',
    url: 'https://news.example.cn/2026/jinjiang-shoe-factory-fire',
    snippet: '事故发生在制鞋产业集聚区，相关部门已开展应急处置。',
    publishedAt: '2026-07-12T08:00:00Z',
    publisherName: '福建新闻社',
    ...overrides,
  } as {
    title: string;
    url: string;
    snippet: string;
    publishedAt?: string;
    publisherName?: string;
  };
}

function feedArticle(overrides: Partial<ArticleCandidate> = {}): ArticleCandidate {
  return {
    origin: 'feed',
    title: '福建晋江一鞋厂发生火灾，当地正在处置',
    url: 'https://industry.example.cn/news/jinjiang-shoe-factory-fire',
    summary: '事故发生在制鞋产业集聚区，相关部门已开展应急处置。',
    publishedAt: '2026-07-12T08:00:00Z',
    publisherName: '鞋业行业网',
    ...overrides,
  };
}

function stableSource(overrides: Partial<FoundSource> = {}): FoundSource {
  return {
    title: '鞋业行业网 RSS',
    url: 'https://industry.example.cn/rss/shoes.xml',
    description: '鞋业行业新闻 RSS',
    recommended: true,
    sourceType: 'industry_vertical',
    ...overrides,
  };
}

test('turns current search result articles directly into the single search collector samples', async () => {
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [currentSearchResult()],
  });

  const searchSources = result.sources.filter((source) => source.collectionMode === 'search');
  assert.equal(searchSources.length, 1);
  assert.equal(searchSources[0].discoveryVersion, 1);
  assert.deepEqual(searchSources[0].searchPlan, result.searchPlan);
  assert.equal(searchSources[0].initialItems?.length, 1);
  assert.deepEqual(searchSources[0].initialItems?.[0], {
    title: '福建晋江一鞋厂发生火灾，当地正在处置',
    url: 'https://news.example.cn/2026/jinjiang-shoe-factory-fire',
    summary: '事故发生在制鞋产业集聚区，相关部门已开展应急处置。',
    publishedAt: '2026-07-12T08:00:00Z',
    publisherName: '福建新闻社',
    evidenceLevel: 'search',
    relevanceScore: searchSources[0].initialItems?.[0].relevanceScore,
    matchReason: searchSources[0].initialItems?.[0].matchReason,
    queryEvidence: searchSources[0].initialItems?.[0].queryEvidence,
  });

  const audit = result.auditRecords.find((record) => record.collectionMode === 'search');
  assert.equal(audit?.validationOutcome, 'accepted');
  assert.ok(audit?.evidence[0]?.query);
  assert.equal(audit?.evidence[0]?.publishedAt, '2026-07-12T08:00:00Z');
  assert.equal(audit?.evidence[0]?.validationOutcome, 'accepted');
});

test('does not admit a stable source merely because a same-domain article exists from 2023', async () => {
  const candidate = stableSource();
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [currentSearchResult()],
    discoverStableCandidates: async () => [candidate],
    sampleStableCandidate: async () => [feedArticle({
      url: 'https://industry.example.cn/news/old-shoe-factory-fire',
      publishedAt: '2023-07-12T08:00:00Z',
    })],
  });

  assert.deepEqual(result.sources.map((source) => source.collectionMode), ['search']);
  const audit = result.auditRecords.find((record) => record.source.url === candidate.url);
  assert.equal(audit?.decision, 'rejected');
  assert.equal(audit?.validationOutcome, 'rejected');
  assert.match(audit?.exclusionReason ?? '', /30 天|过期|发布时间/);
  assert.equal(audit?.evidence[0]?.validationOutcome, 'rejected');
  assert.equal(audit?.evidence[0]?.rejectionCode, 'stale');
});

test('rejects product and about pages before they can be treated as stable sources', async () => {
  const candidates = [
    stableSource({ title: '鞋类产品', url: 'https://industry.example.cn/products/shoes' }),
    stableSource({ title: '关于我们', url: 'https://industry.example.cn/about' }),
  ];
  let sampleCalls = 0;
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [currentSearchResult()],
    discoverStableCandidates: async () => candidates,
    sampleStableCandidate: async () => {
      sampleCalls += 1;
      return [feedArticle()];
    },
  });

  assert.equal(sampleCalls, 0);
  for (const candidate of candidates) {
    const audit = result.auditRecords.find((record) => record.source.url === candidate.url);
    assert.equal(audit?.decision, 'rejected');
    assert.match(audit?.exclusionReason ?? '', /商品|关于|页面类型/);
  }
});

test('rejects product and about URLs returned as search article candidates', async () => {
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [
      currentSearchResult({ url: 'https://industry.example.cn/products/running-shoe' }),
      currentSearchResult({ url: 'https://industry.example.cn/about' }),
    ],
  });

  assert.equal(result.sources.length, 0);
  const searchAudit = result.auditRecords[0];
  assert.equal(searchAudit.collectionMode, 'search');
  assert.equal(searchAudit.validationOutcome, 'rejected');
  assert.deepEqual(
    searchAudit.evidence.map((evidence) => evidence.rejectionCode),
    ['page_type', 'page_type'],
  );
});

test('classifies dynamic search pages as search and never as feed_script', async () => {
  const candidate = stableSource({
    title: '站内动态搜索',
    url: 'https://industry.example.cn/search?q=%E9%9E%8B%E4%B8%9A',
    collectionMode: 'feed_script',
  });

  assert.equal(classifyDiscoveryCollectionMode(candidate), 'search');

  let sampleCalls = 0;
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [currentSearchResult()],
    discoverStableCandidates: async () => [candidate],
    sampleStableCandidate: async () => {
      sampleCalls += 1;
      return [feedArticle()];
    },
  });

  assert.equal(sampleCalls, 0);
  assert.equal(result.sources.filter((source) => source.collectionMode === 'search').length, 1);
  const audit = result.auditRecords.find((record) => record.source.url === candidate.url);
  assert.equal(audit?.collectionMode, 'search');
  assert.equal(audit?.decision, 'rejected');
  assert.match(audit?.exclusionReason ?? '', /统一搜索采集器|动态搜索页/);
});

test('excludes a feed with no recent match without failing the validated search plan', async () => {
  const candidate = stableSource();
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [currentSearchResult()],
    discoverStableCandidates: async () => [candidate],
    sampleStableCandidate: async () => [],
  });

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].collectionMode, 'search');
  const audit = result.auditRecords.find((record) => record.source.url === candidate.url);
  assert.equal(audit?.decision, 'rejected');
  assert.match(audit?.exclusionReason ?? '', /近期匹配样本/);
});

test('admits a stable feed only after a live current matching sample passes validation', async () => {
  const candidate = stableSource();
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [currentSearchResult()],
    discoverStableCandidates: async () => [candidate],
    sampleStableCandidate: async (_source, mode) => {
      assert.equal(mode, 'rss');
      return [feedArticle()];
    },
  });

  assert.deepEqual(result.sources.map((source) => source.collectionMode), ['search', 'rss']);
  assert.equal(result.sources[1].initialItems?.length, 1);
  const audit = result.auditRecords.find((record) => record.source.url === candidate.url);
  assert.equal(audit?.validationOutcome, 'accepted');
  assert.equal(audit?.evidence[0]?.validationOutcome, 'accepted');
});

test('admits validated JSON and static-list candidates without inferring either from same-domain evidence', async () => {
  const json = stableSource({
    title: '鞋业 JSON API',
    url: 'https://industry.example.cn/api/shoes.json',
    collectionMode: 'json',
    collectorConfigJson: JSON.stringify({
      endpoint: 'https://industry.example.cn/api/shoes.json',
      itemsPath: 'items',
      fields: { title: 'title', url: 'url', publishedAt: 'publishedAt' },
    }),
  });
  const staticList = stableSource({
    title: '鞋业静态新闻列表',
    url: 'https://industry.example.cn/news-list',
    collectionMode: 'feed_script',
  });
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [currentSearchResult()],
    discoverStableCandidates: async () => [json, staticList],
    sampleStableCandidate: async (_source, mode) => [feedArticle({
      url: `https://industry.example.cn/news/${mode}-shoe-factory-fire`,
    })],
  });

  assert.deepEqual(result.sources.map((source) => source.collectionMode), [
    'search',
    'json',
    'feed_script',
  ]);
  assert.equal(result.sources[1].collectorConfigJson, json.collectorConfigJson);
  assert.equal(result.sources[2].initialItems?.length, 1);
});

test('can fall back to a validated stable source when every search query fails', async () => {
  const candidate = stableSource();
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => {
      throw new Error('search provider unavailable');
    },
    discoverStableCandidates: async () => [candidate],
    sampleStableCandidate: async () => [feedArticle()],
  });

  assert.deepEqual(result.sources.map((source) => source.collectionMode), ['rss']);
  assert.equal(result.auditRecords[0].validationOutcome, 'rejected');
  assert.match(result.auditRecords[0].exclusionReason ?? '', /所有检索查询均失败/);
  assert.equal(result.auditRecords[1].validationOutcome, 'accepted');
});

test('keeps deterministic search usable when optional LLM stable-source discovery fails', async () => {
  const result = await discoverCollectionPlan(input, {
    now,
    searchFn: async () => [currentSearchResult()],
    discoverStableCandidates: async () => {
      throw new Error('LLM quota exhausted');
    },
  });

  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].collectionMode, 'search');
  assert.ok(result.auditRecords.some((record) => (
    record.collectionMode === 'feed_script'
      && record.validationOutcome === 'rejected'
      && /LLM quota exhausted/.test(record.exclusionReason ?? '')
  )));
});
