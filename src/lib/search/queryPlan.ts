import { getRequiredSourceDomains, type SourcePreference } from '../ai/agents/sourcePreferences';

const DEFAULT_FRESHNESS_DAYS = 14;
const MAX_QUERY_LENGTH = 80;
const MAX_ENABLED_QUERIES = 16;

const INDUSTRY_TERMS = [
  '制鞋企业', '制鞋', '鞋厂', '鞋业', '鞋帽', '皮革',
  '危化品', '化工园区', '化工', '纺织', '食品', '餐饮',
] as const;

const EVENT_TERMS = [
  '事故', '火灾', '爆炸', '泄漏', '伤亡', '召回', '停产', '处罚', '违法', '污染', '通报',
] as const;

const BUSINESS_TERMS = [
  '经营', '并购', '订单', '融资', '营收', '利润', '业绩', '价格', '产能', '扩产',
  '投资', '供应链', '出口', '进口', '招标', '中标', '破产', '裁员', '上市', '合作',
] as const;

const REGION_TERMS = [
  '北京', '天津', '上海', '重庆', '河北', '山西', '辽宁', '吉林', '黑龙江', '江苏', '浙江',
  '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南',
  '陕西', '甘肃', '青海', '台湾', '内蒙古', '广西', '西藏', '宁夏', '新疆', '香港', '澳门',
] as const;

export interface MonitoringIntent {
  topic: string;
  criteria: string;
  industryTerms: string[];
  eventTerms: string[];
  businessTerms: string[];
  entities: string[];
  regions: string[];
  freshnessDays: number;
  requirePublishedAt: true;
}

export type SearchPlanQueryCategory = 'event' | 'business' | 'entity' | 'region' | 'required_source';

export interface SearchPlanQuery {
  id: string;
  query: string;
  category: SearchPlanQueryCategory;
  enabled: true;
}

export interface SearchPlan {
  version: 1;
  freshnessDays: number;
  requirePublishedAt: true;
  queries: SearchPlanQuery[];
}

function stableUnique(values: Iterable<string>) {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ');
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function extractKnownTerms(text: string, terms: readonly string[]) {
  return stableUnique(terms.filter((term) => text.includes(term)));
}

function topicIndustryTerm(topic: string) {
  return topic
    .trim()
    .replace(/(?:动态|资讯|信息)?(?:追踪|监测|订阅)?$/u, '')
    .trim();
}

function extractEntities(text: string, industryTerms: string[]) {
  const signals = [...EVENT_TERMS, ...BUSINESS_TERMS].join('|');
  const pattern = new RegExp(`([\\p{Script=Han}A-Za-z0-9·]{2,20})的(?:${signals})`, 'gu');
  const generic = new Set(industryTerms);
  const entities: string[] = [];

  for (const match of text.matchAll(pattern)) {
    const entity = match[1]
      .replace(/^(?:关注|以及|及|和|与)/u, '')
      .trim();
    if (entity && !generic.has(entity) && !REGION_TERMS.includes(entity as typeof REGION_TERMS[number])) {
      entities.push(entity);
    }
  }

  return stableUnique(entities);
}

function explicitFreshnessDays(text: string) {
  const numeric = text.match(/(?:最近|近|过去|前)\s*(\d{1,3})\s*(?:天|日)/u)
    ?? text.match(/(\d{1,3})\s*(?:天|日)内/u);
  if (numeric) {
    const days = Number(numeric[1]);
    if (days > 0) return days;
  }
  const numericWeeks = text.match(/(?:最近|近|过去|前)\s*(\d{1,3})\s*(?:周|星期)/u)
    ?? text.match(/(\d{1,3})\s*(?:周|星期)\s*内/u);
  if (numericWeeks) {
    const weeks = Number(numericWeeks[1]);
    if (weeks > 0) return weeks * 7;
  }
  const numericMonths = text.match(/(?:最近|近|过去|前)\s*(\d{1,3})\s*(?:个)?月/u)
    ?? text.match(/(\d{1,3})\s*(?:个)?月\s*内/u);
  if (numericMonths) {
    const months = Number(numericMonths[1]);
    if (months > 0) return months * 30;
  }
  if (/(?:最近|近|过去|前)\s*(?:1|一|一个)?\s*(?:周|星期)|(?:1|一|一个)\s*(?:周|星期)\s*内/u.test(text)) return 7;
  if (/(?:最近|近|过去|前)\s*(?:1|一|一个)?\s*月|(?:1|一|一个)\s*月\s*内/u.test(text)) return 30;
  return DEFAULT_FRESHNESS_DAYS;
}

export function buildMonitoringIntent(topic: string, criteria: string): MonitoringIntent {
  const combined = `${topic} ${criteria}`.trim();
  const inferredTopicTerm = topicIndustryTerm(topic);
  const industryTerms = stableUnique([
    ...(inferredTopicTerm ? [inferredTopicTerm] : []),
    ...extractKnownTerms(combined, INDUSTRY_TERMS),
  ]);

  return {
    topic: topic.trim(),
    criteria: criteria.trim(),
    industryTerms,
    eventTerms: extractKnownTerms(combined, EVENT_TERMS),
    businessTerms: extractKnownTerms(combined, BUSINESS_TERMS),
    entities: extractEntities(combined, industryTerms),
    regions: extractKnownTerms(combined, REGION_TERMS),
    freshnessDays: explicitFreshnessDays(combined),
    requirePublishedAt: true,
  };
}

function cappedQuery(parts: string[], suffix = '') {
  const query = parts.filter(Boolean).join(' ').trim().replace(/\s+/g, ' ');
  if (suffix.length > MAX_QUERY_LENGTH) return '';
  if (suffix.length === MAX_QUERY_LENGTH) return suffix;
  const reserved = suffix ? suffix.length + 1 : 0;
  const base = query.slice(0, MAX_QUERY_LENGTH - reserved).trim();
  return suffix ? `${base} ${suffix}`.trim() : base;
}

export function buildSearchQueryPlan(intent: MonitoringIntent, preferences: SourcePreference[]): SearchPlan {
  const queries: SearchPlanQuery[] = [];
  const seen = new Set<string>();
  const industry = intent.industryTerms[0] ?? intent.topic.trim();

  const add = (category: SearchPlanQueryCategory, query: string) => {
    const key = query.toLowerCase();
    if (!query || seen.has(key) || queries.length >= MAX_ENABLED_QUERIES) return;
    seen.add(key);
    queries.push({ id: `query-${queries.length + 1}`, query, category, enabled: true });
  };

  const eventQueries = intent.eventTerms.map((term) => cappedQuery([industry, term]));
  const businessQueries = intent.businessTerms.map((term) => cappedQuery([industry, term]));
  const signal = intent.eventTerms[0] ?? intent.businessTerms[0] ?? industry;
  const entityQueries = intent.entities.map((entity) => cappedQuery([entity, signal]));
  const regionQueries = intent.regions.map((region) => cappedQuery([region, industry, signal]));

  const openEventQuery = eventQueries[0] ?? cappedQuery([industry, '事件']);
  add('event', openEventQuery);

  const siteSeed = openEventQuery || businessQueries[0] || cappedQuery([industry]);
  for (const domain of getRequiredSourceDomains(preferences, preferences.length)) {
    if (queries.length >= MAX_ENABLED_QUERIES) break;
    add('required_source', cappedQuery([siteSeed], `site:${domain}`));
  }

  if (businessQueries[0]) add('business', businessQueries[0]);
  if (entityQueries[0]) add('entity', entityQueries[0]);
  if (regionQueries[0]) add('region', regionQueries[0]);

  const remainingGroups: Array<[SearchPlanQueryCategory, string[]]> = [
    ['event', eventQueries.slice(1)],
    ['business', businessQueries.slice(1)],
    ['entity', entityQueries.slice(1)],
    ['region', regionQueries.slice(1)],
  ];
  const remainingLength = Math.max(0, ...remainingGroups.map(([, values]) => values.length));
  for (let index = 0; index < remainingLength && queries.length < MAX_ENABLED_QUERIES; index += 1) {
    for (const [category, values] of remainingGroups) {
      if (values[index]) add(category, values[index]);
    }
  }

  return {
    version: 1,
    freshnessDays: intent.freshnessDays,
    requirePublishedAt: true,
    queries,
  };
}
