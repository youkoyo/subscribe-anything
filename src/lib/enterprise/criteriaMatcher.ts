export interface CriteriaTermGroup {
  name: string;
  weight: number;
  terms: string[];
}

export interface ParsedDeliveryCriteria {
  originalText: string;
  timeWindowDays: number | null;
  groups: CriteriaTermGroup[];
}

export interface CriteriaCardLike {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string | null;
  publishedAt: Date | string | null;
  createdAt: Date | string;
}

export interface CriteriaMatchResult {
  matched: boolean;
  score: number;
  reason: string;
  matchedTerms: string[];
}

interface DictionaryRule {
  name: string;
  weight: number;
  triggers: string[];
  terms: string[];
}

const DICTIONARY_RULES: DictionaryRule[] = [
  {
    name: '鞋业',
    weight: 52,
    triggers: ['鞋业', '制鞋', '鞋厂', '鞋企', '鞋类', '运动鞋', '鞋服'],
    terms: ['鞋业', '制鞋', '鞋厂', '鞋企', '鞋类', '运动鞋', '鞋服'],
  },
  {
    name: '行业',
    weight: 22,
    triggers: ['化工', '危化品', '化学品', '化工原料', '化工企业'],
    terms: ['化工', '化工企业', '化工厂', '危化品', '危险化学品', '化学品', '化工原料'],
  },
  {
    name: '食品餐饮',
    weight: 22,
    triggers: ['食品', '食品安全', '餐饮', '食安'],
    terms: ['食品安全', '食品', '餐饮', '餐饮公司', '食品行业', '食安'],
  },
  {
    name: '安全事件',
    weight: 34,
    triggers: ['安全', '事故', '风险', '泄漏', '爆炸', '火灾'],
    terms: ['安全事故', '事故', '爆炸', '泄漏', '火灾', '伤亡', '中毒', '应急处置'],
  },
  {
    name: '供应链影响',
    weight: 24,
    triggers: ['供应链', '供应', '稳定', '停产', '停车', '限产', '物流'],
    terms: ['供应链', '供应', '供应中断', '供应偏紧', '停产', '限产', '停车', '装置停车', '物流受阻'],
  },
  {
    name: '监管风险',
    weight: 16,
    triggers: ['监管', '处罚', '整改', '检查', '通报', '合规'],
    terms: ['监管', '处罚', '整改', '检查', '通报', '合规', '立案', '行政处罚'],
  },
  {
    name: '经营影响',
    weight: 18,
    triggers: ['影响', '成本', '经营', '公司', '企业', '合规'],
    terms: ['影响', '成本', '经营', '公司', '企业', '合规', '采购计划', '停业'],
  },
  {
    name: '价格波动',
    weight: 24,
    triggers: ['价格', '报价', '涨价', '下跌', '波动', '行情'],
    terms: ['价格', '报价', '涨价', '上涨', '下跌', '波动', '行情', '供应偏紧'],
  },
];

const GENERIC_SUFFIXES = [
  '价格异常波动',
  '价格波动',
  '异常波动',
  '安全事故',
  '风险事件',
  '相关信息',
  '相关',
];

const LEADING_NOISE = /^(关注|监控|跟踪|了解|最近[一二两三四五六七八九十\d]+[天日内]*|近[一二两三四五六七八九十\d]+[天日内]*|有关|关于)/;

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export const DEFAULT_DELIVERY_TIME_WINDOW_DAYS = 14;

function parseChineseNumber(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (map[value.slice(1)] ?? 0);
  if (value.endsWith('十')) return (map[value.slice(0, 1)] ?? 0) * 10;
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (map[tens] ?? 1) * 10 + (map[ones] ?? 0);
  }
  return map[value] ?? null;
}

function parseTimeWindowDays(text: string) {
  const match = text.match(/(?:最近|近)\s*([一二两三四五六七八九十\d]+)\s*[天日]/);
  if (!match) return DEFAULT_DELIVERY_TIME_WINDOW_DAYS;
  const days = parseChineseNumber(match[1]);
  return days && days > 0 ? days : DEFAULT_DELIVERY_TIME_WINDOW_DAYS;
}

function cleanUserTerm(value: string) {
  let term = value.trim().replace(LEADING_NOISE, '').trim();
  for (const suffix of GENERIC_SUFFIXES) {
    if (term.endsWith(suffix) && term.length > suffix.length + 1) {
      term = term.slice(0, -suffix.length).trim();
    }
  }
  return term;
}

function extractUserTerms(text: string) {
  const terms: string[] = [];
  const parts = text
    .split(/[\s,，、;；。！？!?.：:（）()《》"“”]+/)
    .map(cleanUserTerm)
    .filter((part) => part.length >= 2);

  for (const part of parts) {
    if (!includesAny(part, ['最近', '关注', '监控'])) terms.push(part);
    const latinTerms = part.match(/[A-Za-z][A-Za-z0-9+#./-]*/g) ?? [];
    terms.push(...latinTerms);
  }

  return unique(terms).slice(0, 12);
}

export function parseDeliveryCriteria(criteria: string): ParsedDeliveryCriteria {
  const originalText = criteria.trim();
  const groups: CriteriaTermGroup[] = [];

  for (const rule of DICTIONARY_RULES) {
    if (includesAny(originalText, rule.triggers)) {
      groups.push({
        name: rule.name,
        weight: rule.weight,
        terms: unique(rule.terms),
      });
    }
  }

  const dictionaryTerms = new Set(groups.flatMap((group) => group.terms));
  const userTerms = extractUserTerms(originalText).filter((term) => !dictionaryTerms.has(term));
  if (userTerms.length > 0) {
    groups.push({
      name: '用户条件',
      weight: 52,
      terms: userTerms,
    });
  }

  return {
    originalText,
    timeWindowDays: parseTimeWindowDays(originalText),
    groups,
  };
}

function scoreTermInFields(term: string, title: string, summary: string, sourceName: string) {
  if (title.includes(term)) return 1;
  if (summary.includes(term)) return 0.78;
  if (sourceName.includes(term)) return 0.58;
  return 0;
}

function formatMatchedReason(matches: Array<{ group: string; terms: string[] }>) {
  if (matches.length === 0) return '未命中用户条件';
  return matches
    .map((match) => `命中${match.group}：${match.terms.slice(0, 5).join('、')}`)
    .join('；');
}

export function scoreCardAgainstCriteria(
  card: CriteriaCardLike,
  criteria: ParsedDeliveryCriteria,
  now: Date
): CriteriaMatchResult {
  const referenceDate = card.publishedAt ? new Date(card.publishedAt) : new Date(card.createdAt);
  if (criteria.timeWindowDays) {
    const ageMs = now.getTime() - referenceDate.getTime();
    if (Number.isFinite(ageMs) && ageMs > criteria.timeWindowDays * 24 * 60 * 60 * 1000) {
      return {
        matched: false,
        score: 0,
        reason: `发布时间超过最近 ${criteria.timeWindowDays} 天`,
        matchedTerms: [],
      };
    }
  }

  const title = card.title;
  const summary = card.summary ?? '';
  const sourceName = card.sourceName ?? '';
  let score = 0;
  const matches: Array<{ group: string; terms: string[] }> = [];

  for (const group of criteria.groups) {
    const matchedTerms = group.terms.filter((term) =>
      scoreTermInFields(term, title, summary, sourceName) > 0
    );
    if (matchedTerms.length === 0) continue;

    const bestFieldScore = Math.max(
      ...matchedTerms.map((term) => scoreTermInFields(term, title, summary, sourceName))
    );
    const coverageBoost = Math.min(1, matchedTerms.length / Math.min(3, group.terms.length));
    score += group.weight * Math.max(bestFieldScore, 0.65) * (0.75 + coverageBoost * 0.25);
    matches.push({ group: group.name, terms: matchedTerms });
  }

  const roundedScore = Math.min(100, Math.round(score));
  const matchedTerms = unique(matches.flatMap((match) => match.terms));

  return {
    matched: roundedScore >= 45,
    score: roundedScore,
    reason: formatMatchedReason(matches),
    matchedTerms,
  };
}
