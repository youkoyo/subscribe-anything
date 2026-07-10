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
  if (!match) return null;
  const days = parseChineseNumber(match[1]);
  return days && days > 0 ? days : null;
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
    // Single-character keywords ("鞋", "车", "房") used to be silently dropped here,
    // which meant writing "鞋" as a criterion returned 0 cards even when 28 of them
    // were about shoes. Keep ≥ 1 so common single-character category words work;
    // pure stopwords ("的", "了", "和", etc.) are filtered below.
    .filter((part) => part.length >= 1);

  for (const part of parts) {
    if (isStopword(part)) continue;
    if (!includesAny(part, ['最近', '关注', '监控'])) terms.push(part);
    const latinTerms = part.match(/[A-Za-z][A-Za-z0-9+#./-]*/g) ?? [];
    terms.push(...latinTerms);
  }

  return unique(terms).slice(0, 12);
}

/** Common Chinese single-character stopwords that would create false-positive matches if
 *  passed through to title/summary search. 保持小且只放"任何文档几乎都出现"的字。 */
const STOPWORDS = new Set([
  '的', '了', '和', '与', '或', '及', '在', '是', '有', '我', '你', '他', '她', '它',
  '这', '那', '此', '哪', '谁', '为', '以', '所', '而', '但', '也', '都', '就', '还',
]);

function isStopword(term: string): boolean {
  return term.length === 1 && STOPWORDS.has(term);
}

/**
 * Common single-character industry terms that users type as a shorthand for the
 * whole vertical. When the user writes just "鞋" they mean everything shoe-related
 * (鞋业/鞋类/皮鞋/运动鞋/球鞋/制鞋/鞋厂...) — without expansion they'd only see
 * the few items that happen to contain the literal character "鞋".
 *
 * Keep this list small and high-signal. Each entry maps a short keyword to the
 * realistic set of surface forms the term appears under in real-world news.
 */
const SYNONYM_EXPANSIONS: Record<string, string[]> = {
  鞋: ['鞋业', '鞋类', '皮鞋', '运动鞋', '球鞋', '制鞋', '鞋厂', '鞋企', '布鞋', '童鞋', '帆布鞋', '胶鞋'],
  车: ['汽车', '车辆', '轿车', '客车', '货车', '新能源车', '电动车', '汽车业', '整车'],
  房: ['房地产', '楼市', '房产', '楼盘', '住房', '住宅'],
  医: ['医疗', '医药', '医院', '医生', '医药行业', '医疗器械'],
  食: ['食品', '食品安全', '餐饮', '食安', '食品行业'],
  衣: ['服装', '纺织', '服装业', '纺织业', '服饰'],
  钢: ['钢铁', '钢材', '钢铁行业', '粗钢'],
  煤: ['煤炭', '煤矿', '煤化工', '煤炭行业'],
  电: ['电力', '电网', '电池', '电池行业', '电力行业'],
  药: ['医药', '药品', '制药', '医药行业', '药企'],
  化: ['化工', '化学品', '化工行业', '化工厂', '化工企业'],
  网: ['互联网', '网络', '网络安全', '互联网行业', '网络平台'],
};

/** Expand a user term by adding common synonym/surface forms. The original term
 *  is always kept (no-op if no entry in SYNONYM_EXPANSIONS). */
function expandSynonyms(term: string): string[] {
  const expansions = SYNONYM_EXPANSIONS[term];
  if (!expansions) return [term];
  return [term, ...expansions];
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
  const rawUserTerms = extractUserTerms(originalText).filter((term) => !dictionaryTerms.has(term));
  // Expand single-character industry terms to their common surface forms
  // ("鞋" → 鞋业/鞋类/皮鞋/...) so users get the full vertical of news, not
  // just items that happen to contain the bare character. Longer terms pass
  // through unchanged via expandSynonyms' default branch.
  const userTerms = unique(rawUserTerms.flatMap(expandSynonyms));
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
