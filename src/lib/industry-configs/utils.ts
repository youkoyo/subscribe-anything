import {
  SOURCE_TYPE_OPTIONS,
  type IndustryConfigSnapshot,
  type IndustrySourceType,
  type IndustrySubscriptionSuggestion,
} from './types';

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
  alertLevel: string | null;
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

export function buildIndustryConfigSnapshot(row: IndustryConfigRowLike): IndustryConfigSnapshot {
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
    sourceTypes: normalizeSourceTypes(decodeStringList(row.sourceTypesJson)),
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

  return {
    topic: `${snapshot.name}动态监测`,
    criteria: normalizeStringList(criteriaParts).join('、'),
  };
}
