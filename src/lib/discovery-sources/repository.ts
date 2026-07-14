import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { discoverySourceCatalog } from '@/lib/db/schema';
import { buildCuratedSourceCatalog } from './catalog';
import { CURATED_SOURCE_SEEDS } from './catalog-seeds';
import type {
  CuratedSourceCatalogEntry,
  FeedProvider,
  TrustLevel,
  UsageRole,
} from './types';

type CatalogRow = typeof discoverySourceCatalog.$inferSelect;

export function catalogSeedValues(now = new Date()) {
  return buildCuratedSourceCatalog(CURATED_SOURCE_SEEDS).map((source) => ({
    id: source.id,
    title: source.title,
    feedUrl: source.feedUrl,
    feedProvider: source.feedProvider,
    originalCategory: source.originalCategory,
    preferencesJson: JSON.stringify(source.preferences),
    trustLevel: source.trustLevel,
    defaultUsage: source.defaultUsage,
    topicTagsJson: JSON.stringify(source.topicTags),
    keywordsJson: JSON.stringify(source.keywords),
    isEnabled: true,
    healthStatus: 'unknown' as const,
    lastValidatedAt: null,
    lastValidationError: null,
    createdAt: now,
    updatedAt: now,
  }));
}

function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function toCatalogEntry(row: CatalogRow): CuratedSourceCatalogEntry {
  return {
    id: row.id,
    title: row.title,
    feedUrl: row.feedUrl,
    feedProvider: row.feedProvider as FeedProvider,
    originalCategory: row.originalCategory as CuratedSourceCatalogEntry['originalCategory'],
    preferences: parseList(row.preferencesJson) as CuratedSourceCatalogEntry['preferences'],
    trustLevel: row.trustLevel as TrustLevel,
    defaultUsage: row.defaultUsage as UsageRole,
    topicTags: parseList(row.topicTagsJson),
    keywords: parseList(row.keywordsJson),
  };
}

/** Read enabled, persistent catalog entries. The code snapshot is a safe fallback for an empty dev DB. */
export async function listEnabledCatalogSources(): Promise<CuratedSourceCatalogEntry[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(discoverySourceCatalog)
    .where(eq(discoverySourceCatalog.isEnabled, true));

  return rows.length > 0
    ? rows.map(toCatalogEntry)
    : buildCuratedSourceCatalog(CURATED_SOURCE_SEEDS);
}
