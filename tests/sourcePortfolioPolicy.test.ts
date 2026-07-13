import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildValidatedSourceDecisionRecord,
  orderValidatedSources,
} from '../src/lib/ai/agents/sourcePortfolioPolicy';

test('formats a per-candidate rejection with article-level validation evidence', () => {
  const record = buildValidatedSourceDecisionRecord({
    source: {
      title: '鞋业行业网 RSS',
      url: 'https://industry.example.cn/rss/shoes.xml',
      description: '鞋业行业新闻 RSS',
      sourceType: 'industry_vertical',
    },
    collectionMode: 'rss',
    validationOutcome: 'rejected',
    exclusionReason: '稳定源没有近期匹配样本：文章发布时间超过最近 30 天',
    evidence: [{
      url: 'https://industry.example.cn/news/old-fire',
      title: '2023 年鞋厂火灾旧闻',
      publishedAt: '2023-07-12T08:00:00Z',
      validationOutcome: 'rejected',
      rejectionCode: 'stale',
      exclusionReason: '文章发布时间超过最近 30 天',
    }],
  });

  assert.equal(record.source.collectionMode, 'rss');
  assert.equal(record.decision, 'rejected');
  assert.equal(record.validationOutcome, 'rejected');
  assert.match(record.reason, /30 天/);
  assert.equal(record.evidence[0].rejectionCode, 'stale');
});

test('formats accepted search evidence with the query, date, publisher, and match reason', () => {
  const record = buildValidatedSourceDecisionRecord({
    source: {
      title: '鞋业检索方案',
      url: 'search://collection-plan/v1',
      description: '确定性检索计划',
    },
    collectionMode: 'search',
    validationOutcome: 'accepted',
    acceptedReason: '1 篇当前搜索文章通过验证',
    queries: [{ queryId: 'query-1', query: '鞋业 火灾' }],
    evidence: [{
      queryId: 'query-1',
      query: '鞋业 火灾',
      url: 'https://news.example.cn/fire',
      title: '晋江鞋厂火灾通报',
      publishedAt: '2026-07-12T08:00:00Z',
      publisherName: '福建新闻社',
      validationOutcome: 'accepted',
      evidenceLevel: 'search',
      matchReason: '命中鞋业与火灾',
    }],
  });

  assert.equal(record.decision, 'accepted');
  assert.equal(record.collectionMode, 'search');
  assert.equal(record.evidence[0].query, '鞋业 火灾');
  assert.equal(record.evidence[0].publisherName, '福建新闻社');
  assert.equal(record.evidence[0].validationOutcome, 'accepted');
});

test('orders the validated search collector first without imposing a five-source gate', () => {
  const ordered = orderValidatedSources([
    {
      title: '普通静态源',
      url: 'https://example.cn/news',
      description: '静态列表',
      collectionMode: 'feed_script' as const,
    },
    {
      title: '推荐 RSS',
      url: 'https://example.cn/rss.xml',
      description: 'RSS',
      collectionMode: 'rss' as const,
      recommended: true,
    },
    {
      title: '检索方案',
      url: 'search://collection-plan/v1',
      description: 'search',
      collectionMode: 'search' as const,
      recommended: true,
    },
  ]);

  assert.deepEqual(ordered.map((source) => source.collectionMode), [
    'search',
    'rss',
    'feed_script',
  ]);
});
