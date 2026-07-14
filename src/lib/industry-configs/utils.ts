import {
  DEFAULT_SOURCE_PREFERENCES,
  SOURCE_TYPE_OPTIONS,
  type IndustryConfigSnapshot,
  type IndustrySourceType,
  type IndustrySubscriptionSuggestion,
} from './types';
import {
  mapIndustrySourceTypesToPreferences,
} from '@/lib/discovery-sources/catalog';
import {
  SOURCE_PREFERENCES,
  type SourcePreference,
} from '@/lib/discovery-sources/types';
import { normalizeIndustryTermProfile, type IndustryTermProfile } from './term-profile';

interface IndustryConfigRowLike {
  id: string;
  name: string;
  category: string | null;
  subCategory: string | null;
  description: string | null;
  keywordsJson: string | null;
  riskTermsJson: string | null;
  regionsJson: string | null;
  entitiesJson: string | null;
  sourceTypesJson: string | null;
  sourcePreferencesJson?: string | null;
  allowAiDiscoveryFallback?: boolean | null;
  termProfileJson?: string | null;
  alertLevel: string | null;
}

function decodeTermProfile(
  value: string | null | undefined,
  input: { topic: string; criteria?: string; sourcePreferences: SourcePreference[] }
): IndustryTermProfile {
  try {
    return normalizeIndustryTermProfile(value ? JSON.parse(value) : null, input);
  } catch {
    return normalizeIndustryTermProfile(null, input);
  }
}

export function normalizeStringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }

  return result;
}

export function encodeStringList(value: unknown): string {
  return JSON.stringify(normalizeStringList(value));
}

export function decodeStringList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return normalizeStringList(JSON.parse(value));
  } catch {
    return [];
  }
}

export function normalizeSourceTypes(value: unknown): IndustrySourceType[] {
  return normalizeStringList(value).filter((item): item is IndustrySourceType =>
    SOURCE_TYPE_OPTIONS.includes(item as IndustrySourceType)
  );
}

export function normalizeSourcePreferences(value: unknown): SourcePreference[] {
  return normalizeStringList(value).filter((item): item is SourcePreference =>
    SOURCE_PREFERENCES.includes(item as SourcePreference)
  );
}

export function buildIndustryConfigSnapshot(row: IndustryConfigRowLike): IndustryConfigSnapshot {
  const sourceTypes = normalizeSourceTypes(decodeStringList(row.sourceTypesJson));
  const sourcePreferences = normalizeSourcePreferences(
    decodeStringList(row.sourcePreferencesJson)
  );
  const resolvedSourcePreferences = sourcePreferences.length > 0
    ? sourcePreferences
    : (mapIndustrySourceTypesToPreferences(sourceTypes).length > 0
      ? mapIndustrySourceTypesToPreferences(sourceTypes)
      : DEFAULT_SOURCE_PREFERENCES);
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? '',
    subCategory: row.subCategory ?? '',
    description: row.description ?? '',
    keywords: decodeStringList(row.keywordsJson),
    riskTerms: decodeStringList(row.riskTermsJson),
    regions: decodeStringList(row.regionsJson),
    entities: decodeStringList(row.entitiesJson),
    sourceTypes,
    sourcePreferences: resolvedSourcePreferences,
    allowAiDiscoveryFallback: row.allowAiDiscoveryFallback !== false,
    termProfile: decodeTermProfile(row.termProfileJson, {
      topic: row.name,
      criteria: row.description ?? undefined,
      sourcePreferences: resolvedSourcePreferences,
    }),
    alertLevel: row.alertLevel ?? '一般关注',
  };
}

export function buildIndustrySubscriptionSuggestion(
  snapshot: IndustryConfigSnapshot
): IndustrySubscriptionSuggestion {
  const criteriaParts = [
    ...snapshot.keywords,
    ...snapshot.riskTerms,
    ...snapshot.regions,
    ...snapshot.entities,
  ];

  if (criteriaParts.length === 0) {
    criteriaParts.push(snapshot.name, snapshot.category, snapshot.subCategory, snapshot.description);
  }

  return {
    topic: `${snapshot.name}动态监测`,
    criteria: normalizeStringList(criteriaParts).join('、'),
  };
}
