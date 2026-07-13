import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SOURCE_PREFERENCES,
  buildPreferredSourceQueries,
  type SourcePreference,
} from '../src/lib/ai/agents/sourcePreferences';
import { buildMonitoringIntent, buildSearchQueryPlan } from '../src/lib/search/queryPlan';

const shoeTopic = '鞋业动态';
const shoeCriteria = '关注鞋厂、制鞋企业的火灾、爆炸、事故，以及安踏的并购、订单、融资和经营变化，范围包含浙江，最近7天';

test('buildMonitoringIntent extracts monitoring dimensions and an explicit seven-day window', () => {
  const intent = buildMonitoringIntent(shoeTopic, shoeCriteria);

  assert.equal(intent.topic, shoeTopic);
  assert.equal(intent.criteria, shoeCriteria);
  assert.equal(intent.freshnessDays, 7);
  assert.equal(intent.requirePublishedAt, true);
  assert.ok(intent.industryTerms.some((term) => /鞋/.test(term)));
  assert.ok(intent.eventTerms.includes('事故'));
  assert.ok(intent.businessTerms.includes('经营'));
  assert.ok(intent.entities.includes('安踏'));
  assert.ok(intent.regions.includes('浙江'));
});

test('shoe monitoring creates short accident and business queries instead of using the full criteria', () => {
  const intent = buildMonitoringIntent(shoeTopic, shoeCriteria);
  const plan = buildSearchQueryPlan(intent, DEFAULT_SOURCE_PREFERENCES);

  assert.equal(plan.version, 1);
  assert.equal(plan.freshnessDays, 7);
  assert.equal(plan.requirePublishedAt, true);
  assert.ok(plan.queries.some((item) => item.category === 'event' && /事故|火灾|爆炸/.test(item.query)));
  assert.ok(plan.queries.some((item) => item.category === 'business' && /并购|订单|融资|经营/.test(item.query)));
  assert.ok(plan.queries.every((item) => item.enabled));
  assert.ok(plan.queries.every((item) => item.query.length <= 80));
  assert.ok(plan.queries.length <= 16);
  assert.equal(plan.queries.some((item) => item.query.includes(shoeCriteria)), false);
  assert.doesNotThrow(() => JSON.stringify(plan));
});

test('required administrator domains get site queries without regional defaults', () => {
  const intent = buildMonitoringIntent(shoeTopic, '关注鞋厂火灾和企业经营，最近7天');
  const plan = buildSearchQueryPlan(intent, DEFAULT_SOURCE_PREFERENCES);
  const queries = plan.queries.map((item) => item.query);

  assert.ok(queries.some((query) => query.includes('site:news.cn')));
  assert.ok(queries.some((query) => query.includes('site:people.com.cn')));
  assert.equal(queries.some((query) => /福建|泉州|晋江|fj\./i.test(query)), false);
});

test('query planning is stable and deduplicates terms and administrator domains', () => {
  const preferences: SourcePreference[] = [
    ...DEFAULT_SOURCE_PREFERENCES,
    { name: '新华网重复配置', url: 'https://news.cn/more', sourceType: 'general_news', priority: 'required', isEnabled: true },
  ];
  const intent = buildMonitoringIntent('鞋业 鞋业', '鞋厂 鞋厂 事故 事故 经营 经营');
  const first = buildSearchQueryPlan(intent, preferences);
  const second = buildSearchQueryPlan(intent, preferences);
  const queries = first.queries.map((item) => item.query);

  assert.deepEqual(first, second);
  assert.equal(new Set(queries).size, queries.length);
  assert.equal(queries.filter((query) => query.includes('site:news.cn')).length, 1);
});

test('monitoring intent defaults to fourteen days when no window is supplied', () => {
  const intent = buildMonitoringIntent('鞋业动态', '关注鞋厂事故与企业经营');

  assert.equal(intent.freshnessDays, 14);
  assert.equal(intent.requirePublishedAt, true);
});

test('monitoring intent converts an explicit three-week window to twenty-one days', () => {
  const intent = buildMonitoringIntent('鞋业动态', '关注鞋厂事故与企业经营，最近3周');

  assert.equal(intent.freshnessDays, 21);
});

test('monitoring intent converts an explicit two-month window to sixty days', () => {
  const intent = buildMonitoringIntent('鞋业动态', '关注鞋厂事故与企业经营，过去2个月');

  assert.equal(intent.freshnessDays, 60);
});

test('every enabled query respects the eighty-character cap for long administrator domains', () => {
  const preferences: SourcePreference[] = [{
    name: '长域名来源',
    url: `https://${'administrator-managed-source-domain-segment'.repeat(2)}.example.com`,
    sourceType: 'general_news',
    priority: 'required',
    isEnabled: true,
  }];
  const intent = buildMonitoringIntent(shoeTopic, shoeCriteria);
  const plan = buildSearchQueryPlan(intent, preferences);

  assert.ok(plan.queries.every((item) => item.query.length <= 80));
});

test('required source domain deduplication preserves a zero query limit', () => {
  assert.deepEqual(buildPreferredSourceQueries('鞋厂事故', DEFAULT_SOURCE_PREFERENCES, 0), []);
});

test('a bare month word is not mistaken for an explicit freshness window', () => {
  const intent = buildMonitoringIntent('鞋业月报', '关注鞋业月度经营数据');

  assert.equal(intent.freshnessDays, 14);
});

test('an exactly eighty-character site suffix remains valid and capped', () => {
  const domain = `${'a'.repeat(63)}.${'b'.repeat(7)}.com`;
  const preferences: SourcePreference[] = [{
    name: '极限长度域名',
    url: `https://${domain}`,
    sourceType: 'general_news',
    priority: 'required',
    isEnabled: true,
  }];
  const plan = buildSearchQueryPlan(buildMonitoringIntent(shoeTopic, shoeCriteria), preferences);
  const siteQuery = plan.queries.find((item) => item.category === 'required_source');

  assert.ok(siteQuery);
  assert.equal(siteQuery.query, `site:${domain}`);
  assert.equal(siteQuery.query.length, 80);
});

test('the sixteen-query budget retains every populated intent dimension', () => {
  const criteria = [
    '鞋厂事故火灾爆炸泄漏伤亡召回停产处罚违法污染通报',
    '安踏的经营并购订单融资营收利润业绩价格产能扩产投资供应链出口进口招标中标破产裁员上市合作',
    '范围包含浙江',
  ].join('，');
  const plan = buildSearchQueryPlan(buildMonitoringIntent(shoeTopic, criteria), DEFAULT_SOURCE_PREFERENCES);
  const categories = new Set(plan.queries.map((item) => item.category));

  assert.equal(plan.queries.length, 16);
  assert.deepEqual(
    [...categories].sort(),
    ['business', 'entity', 'event', 'region', 'required_source'].sort(),
  );
});

test('query planning retains a fifth required administrator domain when budget permits', () => {
  const preferences: SourcePreference[] = Array.from({ length: 5 }, (_, index) => ({
    name: `管理员来源 ${index + 1}`,
    url: `https://source-${index + 1}.example.com`,
    sourceType: 'general_news',
    priority: 'required',
    isEnabled: true,
  }));
  const plan = buildSearchQueryPlan(
    buildMonitoringIntent('鞋业动态', '关注鞋厂事故'),
    preferences,
  );

  assert.ok(plan.queries.some((item) => item.query.includes('site:source-5.example.com')));
});

test('required administrator domains take the budget after one open event query', () => {
  const preferences: SourcePreference[] = Array.from({ length: 20 }, (_, index) => ({
    name: `管理员来源 ${index + 1}`,
    url: `https://source-${String(index + 1).padStart(2, '0')}.example.com`,
    sourceType: 'general_news',
    priority: 'required',
    isEnabled: true,
  }));
  const plan = buildSearchQueryPlan(
    buildMonitoringIntent('鞋业动态', '关注企业经营'),
    preferences,
  );
  const requiredQueries = plan.queries.filter((item) => item.category === 'required_source');

  assert.equal(plan.queries.length, 16);
  assert.equal(requiredQueries.length, 15);
  assert.deepEqual(
    requiredQueries.map((item) => item.query.match(/site:([^\s]+)/)?.[1]),
    Array.from({ length: 15 }, (_, index) => `source-${String(index + 1).padStart(2, '0')}.example.com`),
  );
  assert.ok(plan.queries.some((item) => item.category === 'event' && !item.query.includes('site:')));
});

test('an unusable required domain does not consume an enabled-query budget slot', () => {
  const preferences: SourcePreference[] = [
    {
      name: '超长域名来源',
      url: `https://${'administrator-managed-source-domain-segment'.repeat(2)}.example.com`,
      sourceType: 'general_news',
      priority: 'required',
      isEnabled: true,
    },
    ...Array.from({ length: 16 }, (_, index) => ({
      name: `管理员来源 ${index + 1}`,
      url: `https://source-${String(index + 1).padStart(2, '0')}.example.com`,
      sourceType: 'general_news' as const,
      priority: 'required' as const,
      isEnabled: true,
    })),
  ];
  const plan = buildSearchQueryPlan(
    buildMonitoringIntent('鞋业动态', '关注鞋厂事故'),
    preferences,
  );
  const requiredQueries = plan.queries.filter((item) => item.category === 'required_source');

  assert.equal(plan.queries.length, 16);
  assert.equal(requiredQueries.length, 15);
  assert.ok(requiredQueries.some((item) => item.query.includes('site:source-15.example.com')));
});
