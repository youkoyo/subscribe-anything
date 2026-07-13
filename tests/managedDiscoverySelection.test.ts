import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autoSelectSources,
  isValidatedDiscoverySource,
  isReusableDiscoverySource,
  selectRequestedDiscoverySources,
} from '../src/lib/managed/pipeline';
import type { FoundSource } from '../src/types/wizard';

function source(index: number, overrides: Partial<FoundSource> = {}): FoundSource {
  return {
    title: `来源 ${index}`,
    url: `https://example.cn/rss/${index}.xml`,
    description: '已验证 RSS',
    recommended: true,
    collectionMode: 'rss',
    discoveryVersion: 1,
    initialItems: [{
      title: '鞋厂火灾通报',
      url: `https://example.cn/news/${index}`,
      publishedAt: '2026-07-12T08:00:00Z',
      evidenceLevel: 'feed',
      relevanceScore: 80,
      matchReason: '命中鞋业与火灾',
      queryEvidence: [],
    }],
    ...overrides,
  };
}

test('auto-selection reserves the first slot for the validated search collector', () => {
  const search = source(99, {
    title: '检索方案',
    url: 'search://collection-plan/v1',
    recommended: false,
    collectionMode: 'search',
    searchPlan: {
      version: 1,
      freshnessDays: 30,
      requirePublishedAt: true,
      queries: [{ id: 'query-1', query: '鞋业 火灾', category: 'event', enabled: true }],
    },
  });
  const selected = autoSelectSources([
    source(1), source(2), source(3), source(4), source(5), search,
  ]);

  assert.equal(selected.length, 5);
  assert.equal(selected[0], search);
  assert.equal(selected[0].collectionMode, 'search');
});

test('client selections are mapped back to canonical server-validated source objects', () => {
  const canonical = [source(1), source(2)];
  const requested = [{
    ...source(2),
    title: '伪造标题',
    initialItems: [],
  }];

  const selected = selectRequestedDiscoverySources(canonical, requested);
  assert.equal(selected.length, 1);
  assert.equal(selected[0], canonical[1]);
  assert.equal(selected[0].title, '来源 2');
  assert.equal(selected[0].initialItems?.length, 1);
});

test('legacy same-domain discovery payloads are not considered validated', () => {
  assert.equal(isValidatedDiscoverySource({
    title: '旧来源',
    url: 'https://example.cn/',
    description: '旧日志只有同域证据',
    recommended: true,
  }), false);
  assert.equal(isValidatedDiscoverySource(source(1)), true);
  assert.equal(isValidatedDiscoverySource(null), false);
});

test('reused discovery sources must still have a current matching sample', () => {
  const current = source(1);
  const stale = source(2, {
    initialItems: [{
      ...source(2).initialItems![0],
      publishedAt: '2020-07-12T08:00:00Z',
    }],
  });

  assert.equal(isReusableDiscoverySource(
    current,
    '鞋业动态资讯',
    '关注最近30天鞋业安全事故和火灾',
    new Date('2026-07-13T12:00:00Z'),
  ), true);
  assert.equal(isReusableDiscoverySource(
    stale,
    '鞋业动态资讯',
    '关注最近30天鞋业安全事故和火灾',
    new Date('2026-07-13T12:00:00Z'),
  ), false);
});
