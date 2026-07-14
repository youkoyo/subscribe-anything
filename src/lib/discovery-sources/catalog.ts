import {
  OPML_SOURCE_CATEGORIES,
  type CatalogSummary,
  type CuratedSourceCatalogEntry,
  type CuratedSourceMatch,
  type CuratedSourceMatchInput,
  type CuratedSourceSeed,
  type OpmlSourceCategory,
  type SourcePreference,
  type TrustLevel,
  type UsageRole,
} from './types';

const CATEGORY_PREFERENCES: Record<OpmlSourceCategory, SourcePreference[]> = {
  新闻: ['mainstream', 'trend'],
  科技: ['industry', 'trend'],
  知识: ['research'],
  娱乐: ['trend'],
  财经: ['business', 'industry'],
  生活: ['industry'],
  编程: ['developer', 'research'],
  外国媒体: ['mainstream', 'research'],
  公众号: ['creator', 'trend'],
};

const HIGH_TRUST_TITLE = /新华网|新华社|人民网|人民日报|求是网|光明日报|经济日报|中国日报|央视|中国政府网|国务院|国家统计局|财新|第一财经|华尔街见闻|BBC|路透|Reuters|联合早报/i;
const RESEARCH_TITLE = /MIT|科技评论|科学|研究|学术|知识|Nature|Science|经济学人|The Economist/i;
const DEVELOPER_TITLE = /GitHub|开发|编程|程序员|开源|Solidot|少数派|V2EX|InfoQ/i;
const BUSINESS_TITLE = /财经|财新|金融|证券|商业|经济|华尔街|36氪|虎嗅|界面/i;
const INDUSTRY_TITLE = /产业|工业|制造|汽车|芯片|能源|农业|医药|科技|IT|互联网/i;

const DOMAIN_RULES: Array<{
  patterns: RegExp;
  categories: OpmlSourceCategory[];
  preferences: SourcePreference[];
  label: string;
}> = [
  {
    patterns: /人工智能|大模型|生成式|机器学习|深度学习|芯片|半导体|软件|开源|程序员|编程|ai\b|llm\b/i,
    categories: ['科技', '编程'],
    preferences: ['developer', 'research', 'industry'],
    label: '科技与开发主题',
  },
  {
    patterns: /财经|金融|银行|证券|股票|基金|宏观|经济|商业|融资|上市|价格|市场|企业|产业链/i,
    categories: ['财经', '新闻'],
    preferences: ['business', 'mainstream'],
    label: '财经与产业主题',
  },
  {
    patterns: /政策|监管|处罚|事故|风险|政府|部门|通报|公告|召回|安全生产|环保|检查/i,
    categories: ['新闻'],
    preferences: ['authoritative', 'mainstream'],
    label: '政策与风险主题',
  },
  {
    patterns: /国际|海外|全球|美国|欧洲|日本|东南亚|出口|外贸/i,
    categories: ['外国媒体', '新闻'],
    preferences: ['mainstream', 'research'],
    label: '国际主题',
  },
  {
    patterns: /科研|论文|研究|科普|教育|知识|科学/i,
    categories: ['知识', '科技'],
    preferences: ['research'],
    label: '研究与知识主题',
  },
  {
    patterns: /消费|生活|食品|健康|旅游|住房|汽车/i,
    categories: ['生活', '财经', '新闻'],
    preferences: ['industry', 'mainstream'],
    label: '消费与生活主题',
  },
  {
    patterns: /舆情|热点|社交|社媒|公众号|自媒体|观点|趋势/i,
    categories: ['公众号', '新闻'],
    preferences: ['creator', 'trend'],
    label: '舆情与趋势主题',
  },
];

const LEGACY_SOURCE_TYPE_PREFERENCES: Record<string, SourcePreference> = {
  authority: 'authoritative',
  news: 'mainstream',
  social: 'trend',
  wechat: 'creator',
  custom: 'industry',
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function stableCatalogId(feedUrl: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < feedUrl.length; index += 1) {
    hash ^= feedUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `preset-${(hash >>> 0).toString(36)}`;
}

function titleParts(title: string): string[] {
  return unique(
    title
      .split(/[\s/／:：|｜·•—–_-]+/)
      .map((part) => part.trim().toLowerCase())
      .filter((part) => part.length >= 2)
  );
}

function classifyPreferences(seed: CuratedSourceSeed): SourcePreference[] {
  const preferences = [...CATEGORY_PREFERENCES[seed.originalCategory]];
  if (HIGH_TRUST_TITLE.test(seed.title)) preferences.unshift('authoritative');
  if (RESEARCH_TITLE.test(seed.title)) preferences.push('research');
  if (DEVELOPER_TITLE.test(seed.title)) preferences.push('developer');
  if (BUSINESS_TITLE.test(seed.title)) preferences.push('business');
  if (INDUSTRY_TITLE.test(seed.title)) preferences.push('industry');
  return unique(preferences);
}

function classifyTrust(seed: CuratedSourceSeed): TrustLevel {
  if (HIGH_TRUST_TITLE.test(seed.title)) return 'high';
  if (seed.originalCategory === '公众号' || seed.originalCategory === '娱乐') return 'low';
  return 'medium';
}

function classifyUsage(trustLevel: TrustLevel): UsageRole {
  if (trustLevel === 'high') return 'primary';
  if (trustLevel === 'low') return 'discovery';
  return 'supplementary';
}

export function buildCuratedSourceCatalog(
  seeds: readonly CuratedSourceSeed[]
): CuratedSourceCatalogEntry[] {
  return seeds.map((seed) => {
    const trustLevel = classifyTrust(seed);
    const parts = titleParts(seed.title);
    return {
      ...seed,
      id: stableCatalogId(seed.feedUrl),
      feedProvider: /^https?:\/\/plink\.anyfeeder\.com\//i.test(seed.feedUrl)
        ? 'anyfeeder'
        : 'direct',
      preferences: classifyPreferences(seed),
      trustLevel,
      defaultUsage: classifyUsage(trustLevel),
      topicTags: unique([seed.originalCategory.toLowerCase(), ...parts]),
      keywords: parts,
    };
  });
}

export function summarizeCatalog(seeds: readonly CuratedSourceSeed[]): CatalogSummary {
  const categoryCounts = Object.fromEntries(
    OPML_SOURCE_CATEGORIES.map((category) => [category, 0])
  ) as Record<OpmlSourceCategory, number>;

  for (const seed of seeds) categoryCounts[seed.originalCategory] += 1;

  return {
    total: seeds.length,
    anyfeederCount: seeds.filter((seed) =>
      /^https?:\/\/plink\.anyfeeder\.com\//i.test(seed.feedUrl)
    ).length,
    categoryCounts,
  };
}

export function mapIndustrySourceTypesToPreferences(sourceTypes: readonly string[]): SourcePreference[] {
  return unique(
    sourceTypes
      .map((sourceType) => LEGACY_SOURCE_TYPE_PREFERENCES[sourceType])
      .filter((preference): preference is SourcePreference => Boolean(preference))
  );
}

function extractQueryTerms(value: string): string[] {
  const normalized = value.toLowerCase();
  const knownTerms = [
    '人工智能', '大模型', '机器学习', '芯片', '半导体', '软件', '开源', '科技', '编程',
    '财经', '金融', '银行', '证券', '股票', '基金', '经济', '商业', '融资', '价格', '市场',
    '政策', '监管', '处罚', '事故', '风险', '公告', '召回', '安全生产', '环保',
    '国际', '海外', '全球', '美国', '欧洲', '日本', '东南亚', '出口', '外贸',
    '科研', '论文', '研究', '科普', '教育', '知识', '科学',
    '消费', '生活', '食品', '健康', '旅游', '住房', '汽车',
    '舆情', '热点', '社交', '社媒', '公众号', '自媒体', '观点', '趋势',
  ].filter((term) => normalized.includes(term));

  const fragments = normalized
    .split(/[\s,，。.!！?？、;；:：/／|｜()（）\[\]【】]+/)
    .flatMap((fragment) => fragment.split(/(?:关注|监测|产业|行业|动态|信息|新闻|公司|企业|技术|以及|或者|与|和|及|的)+/))
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length >= 2 && fragment.length <= 20);

  const latinTerms = normalized.match(/[a-z][a-z0-9+.#-]{1,19}/g) ?? [];
  return unique([...knownTerms, ...fragments, ...latinTerms]);
}

export function matchCuratedSources(
  catalog: readonly CuratedSourceCatalogEntry[],
  input: CuratedSourceMatchInput
): CuratedSourceMatch[] {
  const query = `${input.topic} ${input.criteria ?? ''}`.trim().toLowerCase();
  if (!query) return [];

  const terms = extractQueryTerms(query);
  const inferredCategories = new Set<OpmlSourceCategory>();
  const inferredPreferences = new Set<SourcePreference>();
  const domainReasons = new Map<OpmlSourceCategory, string>();

  for (const rule of DOMAIN_RULES) {
    if (!rule.patterns.test(query)) continue;
    for (const category of rule.categories) {
      inferredCategories.add(category);
      domainReasons.set(category, rule.label);
    }
    for (const preference of rule.preferences) inferredPreferences.add(preference);
  }

  const explicitPreferences = unique([
    ...(input.preferences ?? []),
    ...mapIndustrySourceTypesToPreferences(input.sourceTypes ?? []),
  ]);
  const requestedPreferences = unique([
    ...explicitPreferences,
    ...inferredPreferences,
  ]);

  const candidates = explicitPreferences.length > 0
    ? catalog.filter((source) => source.preferences.some((preference) => explicitPreferences.includes(preference)))
    : catalog;

  const matches = candidates.map((source): CuratedSourceMatch => {
    let score = 0;
    let directMatch = false;
    const reasons: string[] = [];
    const searchable = `${source.title} ${source.topicTags.join(' ')} ${source.keywords.join(' ')}`.toLowerCase();

    if (inferredCategories.has(source.originalCategory)) {
      score += 9;
      directMatch = true;
      reasons.push(domainReasons.get(source.originalCategory) ?? `匹配${source.originalCategory}分类`);
    }

    const matchingTerms = terms.filter((term) => searchable.includes(term));
    if (matchingTerms.length > 0) {
      score += Math.min(18, matchingTerms.length * 6);
      directMatch = true;
      reasons.push(`命中关键词：${matchingTerms.slice(0, 3).join('、')}`);
    }

    const matchingPreferences = requestedPreferences.filter((preference) =>
      source.preferences.includes(preference)
    );
    if (matchingPreferences.length > 0) {
      score += Math.min(8, matchingPreferences.length * 4);
      reasons.push(`符合来源偏好：${matchingPreferences.join('、')}`);
    }

    if (source.trustLevel === 'high') {
      score += 3;
      reasons.push('高可信主源');
    } else if (source.trustLevel === 'medium') {
      score += 1;
    }

    if (source.defaultUsage === 'primary') score += 1;

    return { source, score, reasons, directMatch };
  });

  const trustRank: Record<TrustLevel, number> = { high: 3, medium: 2, low: 1 };
  const sorted = matches
    .filter((match) => match.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || Number(right.directMatch) - Number(left.directMatch)
      || trustRank[right.source.trustLevel] - trustRank[left.source.trustLevel]
      || left.source.title.localeCompare(right.source.title, 'zh-CN')
    );

  const limit = input.limit === undefined ? Number.POSITIVE_INFINITY : Math.max(1, input.limit);
  const selected: CuratedSourceMatch[] = [];
  const selectedIds = new Set<string>();

  // Preserve category coverage before filling by raw score. Without this, a broad
  // category such as “科技” can crowd every “编程” source out of a short preview.
  for (const category of inferredCategories) {
    const representative = sorted.find(
      (match) => match.directMatch && match.source.originalCategory === category
    );
    if (!representative || selectedIds.has(representative.source.id) || selected.length >= limit) {
      continue;
    }
    selected.push(representative);
    selectedIds.add(representative.source.id);
  }

  for (const match of sorted) {
    if (selected.length >= limit) break;
    if (selectedIds.has(match.source.id)) continue;
    selected.push(match);
    selectedIds.add(match.source.id);
  }

  return selected.sort((left, right) => right.score - left.score);
}
