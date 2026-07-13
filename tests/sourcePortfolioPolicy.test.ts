import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSourceDecisionRecords,
  collectSourceEvidence,
  evaluateSourcePortfolio,
  getRecommendedSourcesMissingEvidence,
} from '../src/lib/ai/agents/sourcePortfolioPolicy';

const source = (title: string, url: string, sourceType: 'general_news' | 'local_news' | 'industry_vertical' | 'finance', recommended = true) => ({
  title,
  url,
  description: title,
  sourceType,
  recommended,
});

test('rejects a domestic request containing only foreign or Taiwan industry sources', () => {
  const result = evaluateSourcePortfolio({
    criteria: '近期国内鞋业相关新闻资讯',
    sources: [
      source('WWD Footwear News', 'https://wwd.com/footwear-news/feed', 'industry_vertical'),
      source('台湾鞋讯', 'http://tfn.bestmotion.com', 'industry_vertical'),
      source('环球鞋网', 'https://www.shoes.net.cn', 'industry_vertical'),
    ],
    evidence: [],
  });

  assert.equal(result.valid, false);
  assert.match(result.reasons.join(' '), /至少 5 个/);
  assert.match(result.reasons.join(' '), /国内综合或地方新闻源/);
});

test('accepts a complete domestic portfolio with evidence for recommended sources', () => {
  const sources = [
    source('中新网福建', 'http://www.fj.chinanews.com.cn', 'general_news'),
    source('泉州市人民政府', 'https://www.quanzhou.gov.cn/news', 'local_news'),
    source('环球鞋网', 'https://www.shoes.net.cn', 'industry_vertical'),
    source('中国皮革协会', 'https://www.chinaleather.org', 'industry_vertical'),
    source('人民网财经', 'https://www.people.com.cn/finance', 'finance'),
  ];
  const result = evaluateSourcePortfolio({
    criteria: '近期国内鞋业相关新闻资讯',
    sources,
    evidence: sources.map((item) => ({ url: `${item.url}/recent-shoe-news`, title: '鞋厂火灾最新通报' })),
  });

  assert.equal(result.valid, true);
});

test('records accepted and rejected candidates with a reason and matching evidence', () => {
  const accepted = source('中国新闻网福建', 'http://www.fj.chinanews.com.cn', 'general_news');
  const rejected = source('WWD Footwear News', 'https://wwd.com/footwear-news/feed', 'industry_vertical');
  const records = buildSourceDecisionRecords({
    acceptedSources: [accepted],
    candidateSources: [accepted, rejected],
    evidence: [
      { url: 'http://www.fj.chinanews.com.cn/news/2026/587350.html', title: '鞋厂火灾通报' },
      { url: 'https://wwd.com/footwear-news/story', title: 'Foreign footwear news' },
    ],
    rejectedReasons: ['缺少国内综合或地方新闻源'],
  });

  assert.deepEqual(records.map((record) => record.decision), ['accepted', 'rejected']);
  assert.match(records[0].reason, /通过实时新闻准入/);
  assert.match(records[1].reason, /缺少国内综合或地方新闻源/);
  assert.equal(records[0].evidence[0]?.title, '鞋厂火灾通报');
});

test('retains evidence returned by an agent web search after preflight search', () => {
  const evidence = collectSourceEvidence(
    [{ url: 'https://www.example.cn/preflight', title: 'preflight' }],
    [{ url: 'https://www.fj.chinanews.com.cn/news/2026/587350.html', title: '鞋厂火灾通报' }],
  );
  const result = evaluateSourcePortfolio({
    criteria: '近期国内鞋业相关新闻资讯',
    sources: [
      source('中国新闻网福建', 'http://www.fj.chinanews.com.cn', 'general_news'),
      source('泉州市人民政府', 'https://www.quanzhou.gov.cn/news', 'local_news'),
      source('环球鞋网', 'https://www.shoes.net.cn', 'industry_vertical'),
      source('中国皮革协会', 'https://www.chinaleather.org', 'industry_vertical'),
      source('人民网财经', 'https://www.people.com.cn/finance', 'finance', false),
    ],
    evidence: [
      ...evidence,
      { url: 'https://www.quanzhou.gov.cn/news/1', title: '本地鞋业动态' },
      { url: 'https://www.shoes.net.cn/news/1', title: '鞋业新闻' },
      { url: 'https://www.chinaleather.org/news/1', title: '行业新闻' },
    ],
  });

  assert.equal(evidence.some((item) => item.url.includes('fj.chinanews.com.cn')), true);
  assert.equal(result.valid, true);
});

test('treats sibling Chinese news subdomains as one evidence domain', () => {
  const records = buildSourceDecisionRecords({
    acceptedSources: [source('中国新闻网滚动新闻', 'https://www.chinanews.com.cn/scroll-news', 'general_news')],
    candidateSources: [source('中国新闻网滚动新闻', 'https://www.chinanews.com.cn/scroll-news', 'general_news')],
    evidence: [{ url: 'http://www.fj.chinanews.com.cn/news/2026/587350.html', title: '鞋厂火灾通报' }],
    rejectedReasons: [],
  });

  assert.equal(records[0].evidence.length, 1);
});

test('identifies recommended sources that need a direct confirmation search', () => {
  const missing = getRecommendedSourcesMissingEvidence([
    source('中国新闻网', 'https://www.chinanews.com.cn/', 'general_news'),
    source('澎湃新闻', 'https://www.thepaper.cn/', 'general_news'),
  ], [{ url: 'https://www.chinanews.com.cn/china/1.html', title: '新闻' }]);
  assert.deepEqual(missing.map((item) => item.title), ['澎湃新闻']);
});
