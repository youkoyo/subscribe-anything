import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCuratedSourceCatalog,
  mapIndustrySourceTypesToPreferences,
  matchCuratedSources,
  summarizeCatalog,
} from '../src/lib/discovery-sources/catalog';
import { CURATED_SOURCE_SEEDS } from '../src/lib/discovery-sources/catalog-seeds';

const EXPECTED_CATEGORY_COUNTS = {
  新闻: 28,
  科技: 28,
  知识: 9,
  娱乐: 2,
  财经: 12,
  生活: 3,
  编程: 5,
  外国媒体: 12,
  公众号: 105,
};

test('imports every unique feed from the supplied OPML', () => {
  assert.equal(CURATED_SOURCE_SEEDS.length, 204);
  assert.equal(new Set(CURATED_SOURCE_SEEDS.map((source) => source.feedUrl)).size, 204);

  const summary = summarizeCatalog(CURATED_SOURCE_SEEDS);
  assert.deepEqual(summary.categoryCounts, EXPECTED_CATEGORY_COUNTS);
  assert.equal(summary.anyfeederCount, 198);
});

test('classifies catalog entries by preference, trust, usage and transport provider', () => {
  const catalog = buildCuratedSourceCatalog(CURATED_SOURCE_SEEDS);
  const xinhua = catalog.find((source) => source.title.includes('新华网'));
  const solidot = catalog.find((source) => source.title === 'Solidot');
  const creator = catalog.find((source) => source.originalCategory === '公众号');

  assert.ok(xinhua);
  assert.ok(xinhua.preferences.includes('authoritative'));
  assert.equal(xinhua.trustLevel, 'high');
  assert.equal(xinhua.defaultUsage, 'primary');
  assert.equal(xinhua.feedProvider, 'anyfeeder');

  assert.ok(solidot);
  assert.ok(solidot.preferences.includes('developer'));
  assert.equal(solidot.feedProvider, 'direct');

  assert.ok(creator);
  assert.ok(creator.preferences.includes('creator'));
  assert.notEqual(creator.trustLevel, 'high');
});

test('maps legacy industry source types to the richer preference vocabulary', () => {
  assert.deepEqual(
    mapIndustrySourceTypesToPreferences(['authority', 'news']),
    ['authoritative', 'mainstream']
  );
  assert.deepEqual(
    mapIndustrySourceTypesToPreferences(['wechat', 'social', 'custom']),
    ['creator', 'trend', 'industry']
  );
});

test('ranks directly relevant and preferred sources with explainable reasons', () => {
  const catalog = buildCuratedSourceCatalog(CURATED_SOURCE_SEEDS);
  const matches = matchCuratedSources(catalog, {
    topic: '人工智能与大模型产业',
    criteria: '关注 AI 技术、开源模型、芯片和科技公司动态',
    preferences: ['developer', 'research', 'industry'],
    limit: 8,
  });

  assert.ok(matches.length >= 3);
  assert.ok(matches.every((match) => match.score > 0));
  assert.ok(matches.some((match) => match.source.originalCategory === '科技'));
  assert.ok(matches.some((match) => match.source.originalCategory === '编程'));
  assert.ok(matches.some((match) => match.directMatch));
  assert.ok(matches.every((match) => match.reasons.length > 0));
});

test('does not treat a delivery host as source identity or authority', () => {
  const catalog = buildCuratedSourceCatalog(CURATED_SOURCE_SEEDS);
  const anyfeederSources = catalog.filter((source) => source.feedProvider === 'anyfeeder');

  assert.equal(anyfeederSources.length, 198);
  assert.ok(anyfeederSources.some((source) => source.trustLevel === 'low'));
  assert.ok(anyfeederSources.some((source) => source.trustLevel === 'high'));
});

test('keeps every enabled catalog feed in an explicitly selected preference unless a preview limit is requested', () => {
  const catalog = buildCuratedSourceCatalog(CURATED_SOURCE_SEEDS);
  const allCreatorFeeds = matchCuratedSources(catalog, {
    topic: '化工产业风险监测',
    preferences: ['creator'],
  });
  const previewCreatorFeeds = matchCuratedSources(catalog, {
    topic: '化工产业风险监测',
    preferences: ['creator'],
    limit: 6,
  });

  assert.equal(allCreatorFeeds.length, 105);
  assert.ok(allCreatorFeeds.every((match) => match.source.preferences.includes('creator')));
  assert.equal(previewCreatorFeeds.length, 6);
});
