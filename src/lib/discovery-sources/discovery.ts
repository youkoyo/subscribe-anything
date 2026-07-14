import pLimit from 'p-limit';
import { rssFetch, type FeedItem } from '@/lib/ai/tools/rssFetch';
import {
  acceptsIntoInformationPool,
  type IndustryTermProfile,
  type ProfileRelevance,
} from '@/lib/industry-configs/term-profile';
import { classifyProfileItems } from '@/lib/industry-configs/profile-classifier';
import type { CollectedItem } from '@/lib/sandbox/contract';
import type { FoundSource } from '@/types/wizard';
import { matchCuratedSources } from './catalog';
import { listEnabledCatalogSources } from './repository';
import type { CuratedSourceCatalogEntry } from './types';

export interface CatalogDiscoveryResult {
  sources: FoundSource[];
  matchedFeedCount: number;
  validFeedCount: number;
  qualifiedItemCount: number;
  failures: Array<{ title: string; error: string }>;
}

function sourcePreference(
  source: CuratedSourceCatalogEntry,
  profile: IndustryTermProfile
) {
  return profile.sourcePreferences.find((preference) => source.preferences.includes(preference))
    ?? source.preferences[0];
}

function toCollectedItem(item: FeedItem, relevance: ProfileRelevance): CollectedItem {
  return {
    title: item.title,
    url: item.url,
    summary: item.summary,
    publishedAt: item.publishedAt,
    relevanceLabel: relevance.label === 'strong' ? 'strong' : 'related',
    relevanceReason: relevance.reason,
    matchedTerms: relevance.matchedTerms,
  };
}

/**
 * Run every selected preset feed with bounded network concurrency. There is no
 * source-count cap and no cross-source article merging; only feed validation
 * failures are omitted from provisioning.
 */
export async function discoverFromCuratedCatalog(
  input: { topic: string; criteria?: string; profile: IndustryTermProfile; userId?: string | null }
): Promise<CatalogDiscoveryResult> {
  const catalog = await listEnabledCatalogSources();
  const matches = matchCuratedSources(catalog, {
    topic: input.topic,
    criteria: input.criteria,
    preferences: input.profile.sourcePreferences,
  });
  const limit = pLimit(4);
  const failures: Array<{ title: string; error: string }> = [];
  const fetched = await Promise.all(matches.map((match) => limit(async () => {
    try {
      const result = await rssFetch(match.source.feedUrl, { maxItems: 'all' });
      return { source: match.source, items: result.items };
    } catch (error) {
      failures.push({
        title: match.source.title,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  })));
  const validFeeds = fetched.filter((entry): entry is { source: CuratedSourceCatalogEntry; items: FeedItem[] } => Boolean(entry));

  const entries = validFeeds.flatMap(({ source, items }) => items.map((item, index) => ({
    id: `${source.id}:${index}`,
    item,
  })));
  const classifications = await classifyProfileItems(
    input.profile,
    entries.map(({ id, item }) => ({ id, title: item.title, summary: item.summary })),
    input.userId,
  );

  let qualifiedItemCount = 0;
  const sources = validFeeds.map(({ source, items }) => {
    const initialItems = items.flatMap((item, index) => {
      const id = `${source.id}:${index}`;
      const relevance = classifications.get(id);
      if (!relevance || !acceptsIntoInformationPool(relevance)) return [];
      qualifiedItemCount += 1;
      return [toCollectedItem(item, relevance)];
    });
    return {
      title: source.title,
      url: source.feedUrl,
      description: `预置 ${sourcePreference(source, input.profile)} RSS 来源`,
      recommended: source.trustLevel === 'high',
      discoveryOrigin: 'catalog' as const,
      collectionStrategy: 'generic_rss' as const,
      catalogSourceId: source.id,
      sourcePreference: sourcePreference(source, input.profile),
      trustLevel: source.trustLevel,
      initialItems,
      termProfile: input.profile,
    };
  });

  return {
    sources,
    matchedFeedCount: matches.length,
    validFeedCount: validFeeds.length,
    qualifiedItemCount,
    failures,
  };
}
