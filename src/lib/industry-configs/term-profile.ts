import {
  SOURCE_PREFERENCES,
  type SourcePreference,
} from '@/lib/discovery-sources/types';

export type RelevanceLabel = 'strong' | 'related' | 'irrelevant';

/**
 * The model-generated, persisted understanding of an industry. Terms are not
 * administered by hand: they are produced from the administrator's natural
 * language target and safely normalized before use in collection.
 */
export interface IndustryTermProfile {
  version: 2;
  canonicalIndustry: string;
  strictTerms: string[];
  entityTerms: string[];
  productTerms: string[];
  supplyChainTerms: string[];
  riskEventTerms: string[];
  industryContextTerms: string[];
  exclusionTerms: string[];
  sourcePreferences: SourcePreference[];
}

export interface IndustryProfileInput {
  topic: string;
  criteria?: string;
  sourcePreferences?: SourcePreference[];
}

export interface ProfileRelevance {
  label: RelevanceLabel;
  matchedTerms: string[];
  reason: string;
}

const DEFAULT_DISCOVERY_PREFERENCES: SourcePreference[] = [
  'authoritative',
  'mainstream',
  'business',
  'industry',
  'trend',
  'creator',
];

function uniqueTerms(value: unknown, limit = 16): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of value) {
    const term = String(candidate ?? '').replace(/\s+/g, ' ').trim();
    if (!term || term.length > 48 || seen.has(term)) continue;
    seen.add(term);
    result.push(term);
    if (result.length >= limit) break;
  }
  return result;
}

function uniquePreferences(value: unknown): SourcePreference[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is SourcePreference =>
    typeof item === 'string' && SOURCE_PREFERENCES.includes(item as SourcePreference)
  ))];
}

/** Safe profile when the LLM is unavailable. It deliberately makes no domain-specific expansion. */
export function buildFallbackIndustryTermProfile(input: IndustryProfileInput): IndustryTermProfile {
  const canonicalIndustry = input.topic.replace(/\s+/g, ' ').trim() || '未命名产业';
  const selectedPreferences = uniquePreferences(input.sourcePreferences);
  return {
    version: 2,
    canonicalIndustry,
    strictTerms: [canonicalIndustry],
    entityTerms: [],
    productTerms: [],
    supplyChainTerms: [],
    riskEventTerms: [],
    industryContextTerms: [],
    exclusionTerms: [],
    sourcePreferences: selectedPreferences.length > 0
      ? selectedPreferences
      : DEFAULT_DISCOVERY_PREFERENCES,
  };
}

export function normalizeIndustryTermProfile(
  candidate: Partial<IndustryTermProfile> | null | undefined,
  input: IndustryProfileInput
): IndustryTermProfile {
  const fallback = buildFallbackIndustryTermProfile(input);
  const canonicalIndustry = String(candidate?.canonicalIndustry ?? '').replace(/\s+/g, ' ').trim()
    || fallback.canonicalIndustry;
  const strictTerms = uniqueTerms(candidate?.strictTerms);
  const effectiveStrictTerms = strictTerms.length > 0 ? strictTerms : [canonicalIndustry];
  const sourcePreferences = uniquePreferences(candidate?.sourcePreferences);

  return {
    version: 2,
    canonicalIndustry,
    strictTerms: effectiveStrictTerms,
    entityTerms: uniqueTerms(candidate?.entityTerms, 24),
    productTerms: uniqueTerms(candidate?.productTerms, 24),
    supplyChainTerms: uniqueTerms(candidate?.supplyChainTerms, 24),
    riskEventTerms: uniqueTerms(candidate?.riskEventTerms, 24),
    industryContextTerms: uniqueTerms(candidate?.industryContextTerms),
    exclusionTerms: uniqueTerms(candidate?.exclusionTerms),
    sourcePreferences: sourcePreferences.length > 0 ? sourcePreferences : fallback.sourcePreferences,
  };
}

/**
 * A versioned profile can still be the deliberately minimal fallback that is
 * used when profile generation was unavailable.  It is valid data, but it is
 * not a useful industry portrait for discovery: it has no terms that can
 * surface reports which mention a factory, product, or supply-chain role
 * instead of the industry's canonical name.
 */
export function needsIndustryProfileExpansion(profile: IndustryTermProfile): boolean {
  return profile.entityTerms.length === 0
    && profile.productTerms.length === 0
    && profile.supplyChainTerms.length === 0;
}

/** Terms that can make an item a candidate for AI relevance classification. */
export function profileCandidateTerms(profile: IndustryTermProfile): string[] {
  return uniqueTerms([
    ...profile.strictTerms,
    ...profile.entityTerms,
    ...profile.productTerms,
    ...profile.supplyChainTerms,
  ], 96);
}

function matchingTerms(terms: readonly string[], text: string): string[] {
  const normalized = text.toLocaleLowerCase('zh-CN');
  return terms.filter((term) => normalized.includes(term.toLocaleLowerCase('zh-CN')));
}

/**
 * Fast, explainable pre-filter. The AI classifier is used for candidates that
 * survive this step; obvious unrelated content never consumes an LLM call.
 */
export function classifyProfileRelevance(
  profile: IndustryTermProfile,
  item: { title: string; summary?: string | null }
): ProfileRelevance {
  const text = `${item.title} ${item.summary ?? ''}`.replace(/\s+/g, ' ').trim();
  const strictMatches = matchingTerms(profile.strictTerms, text);
  const excluded = matchingTerms(profile.exclusionTerms, text);

  if (strictMatches.length > 0) {
    return {
      label: 'strong',
      matchedTerms: strictMatches,
      reason: `命中产业核心词：${strictMatches.join('、')}`,
    };
  }

  if (excluded.length > 0) {
    return {
      label: 'irrelevant',
      matchedTerms: excluded,
      reason: `命中排除语境：${excluded.join('、')}`,
    };
  }

  return { label: 'irrelevant', matchedTerms: [], reason: '未命中产业画像' };
}

export function acceptsIntoInformationPool(result: ProfileRelevance): boolean {
  return result.label === 'strong' || result.label === 'related';
}
