interface ProfileLike {
  id: string;
  title: string;
  seedCriteria: string;
  criteriaSummary: string | null;
  keywordsJson: string | null;
  targetEntitiesJson: string | null;
  status: string;
}

export interface ProfileMatchInput {
  customCriteria: string;
  profiles: ProfileLike[];
  autoProfileExpansion: boolean;
}

export type ProfileMatchResult =
  | { action: 'reuse'; profileId: string; score: number; reason: string }
  | {
      action: 'create';
      profileId?: undefined;
      score: number;
      suggestedTitle: string;
      criteriaSummary: string;
      reason: string;
    }
  | {
      action: 'pending';
      profileId?: undefined;
      score: number;
      suggestedTitle: string;
      criteriaSummary: string;
      reason: string;
    };

const DOMAIN_TERMS = [
  '食品安全',
  '管理条例',
  '条例',
  '法规',
  '政策',
  '监管',
  '处罚',
  '召回',
  '事故',
  '餐饮',
  '公司',
  '企业',
  '成本',
  '合规',
  '影响',
  '舆情',
  '价格',
  '供应',
];

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function normalizeIndustryToken(value: string) {
  return value
    .replace(/中国国内|国内|中国/g, '')
    .replace(/产业信息|行业动态|动态监测|相关信息|相关/g, '')
    .trim();
}

export function summarizeCriteriaTokens(criteria: string): string[] {
  const text = criteria.trim();
  const matches = DOMAIN_TERMS
    .map((term) => ({ term, index: text.indexOf(term) }))
    .filter((match) => match.index >= 0)
    .sort((a, b) => a.index - b.index || b.term.length - a.term.length);
  const result: string[] = [];
  const coveredRanges: Array<{ start: number; end: number }> = [];

  for (const match of matches) {
    const start = match.index;
    const end = match.index + match.term.length;
    const isCovered = coveredRanges.some((range) => start >= range.start && end <= range.end);
    if (!isCovered && !result.includes(match.term)) {
      result.push(match.term);
      coveredRanges.push({ start, end });
    }
  }
  if (result.length > 0) return result;
  return text
    .split(/[\s,，、;；。]+/)
    .map((item) => normalizeIndustryToken(item))
    .filter((item) => item.length >= 2)
    .slice(0, 8);
}

function scoreProfile(criteriaTokens: string[], profile: ProfileLike): number {
  const profileTokens = new Set([
    ...summarizeCriteriaTokens(profile.title),
    ...summarizeCriteriaTokens(profile.seedCriteria),
    ...summarizeCriteriaTokens(profile.criteriaSummary ?? ''),
    ...parseJsonList(profile.keywordsJson),
    ...parseJsonList(profile.targetEntitiesJson),
  ]);
  if (criteriaTokens.length === 0 || profileTokens.size === 0) return 0;
  const overlap = criteriaTokens.filter((token) =>
    Array.from(profileTokens).some((profileToken) =>
      profileToken.includes(token) || token.includes(profileToken)
    )
  ).length;
  const union = new Set([...criteriaTokens, ...profileTokens]).size;
  return overlap / union;
}

function suggestTitle(criteria: string, tokens: string[]): string {
  if (tokens.includes('餐饮') || tokens.includes('公司') || tokens.includes('企业')) {
    return '餐饮企业经营影响';
  }
  if (tokens.includes('法规') || tokens.includes('政策') || tokens.includes('管理条例')) {
    return '法规政策监控';
  }
  if (tokens.includes('处罚') || tokens.includes('召回') || tokens.includes('事故')) {
    return '风险事件监控';
  }
  return criteria.trim().slice(0, 24) || '产业动态监控';
}

export function matchMonitoringProfile(input: ProfileMatchInput): ProfileMatchResult {
  const tokens = summarizeCriteriaTokens(input.customCriteria);
  const candidates = input.profiles.filter((profile) =>
    profile.status === 'active' || profile.status === 'creating'
  );

  let best: { profile: ProfileLike; score: number } | null = null;
  for (const profile of candidates) {
    const score = scoreProfile(tokens, profile);
    if (!best || score > best.score) best = { profile, score };
  }

  if (best && best.score >= 0.30) {
    return {
      action: 'reuse',
      profileId: best.profile.id,
      score: best.score,
      reason: `与监控需求簇「${best.profile.title}」关键词重合度较高`,
    };
  }

  const suggestedTitle = suggestTitle(input.customCriteria, tokens);
  const criteriaSummary = tokens.length > 0
    ? `关注${tokens.join('、')}相关信息`
    : `关注${input.customCriteria.trim()}相关信息`;

  return {
    action: input.autoProfileExpansion ? 'create' : 'pending',
    score: best?.score ?? 0,
    suggestedTitle,
    criteriaSummary,
    reason: input.autoProfileExpansion
      ? '未找到足够相似的监控需求簇，按产业方向配置自动创建新簇'
      : '未找到足够相似的监控需求簇，需要管理员确认扩展',
  };
}
