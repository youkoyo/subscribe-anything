/**
 * Repair a published industry information pool after its initial industry
 * portrait was incomplete. The command refreshes the pool snapshot from its
 * current industry configuration, reactivates only catalog feeds that were
 * never given a script, and recollects enabled preset RSS feeds at a modest
 * concurrency.
 *
 * Usage: npx tsx scripts/repair-industry-pool.ts <subscription-id>
 */

import { loadEnvConfig } from '@next/env';
import { eq, sql } from 'drizzle-orm';

loadEnvConfig(process.cwd());

const subscriptionId = process.argv[2]?.trim();
if (!subscriptionId) {
  throw new Error('Usage: npx tsx scripts/repair-industry-pool.ts <subscription-id>');
}

async function main() {
const [{ getDb }, { discoverySourceCatalog, industryConfigs, messageCards, sources, subscriptions }, { buildIndustryConfigSnapshot }, { needsIndustryProfileExpansion }, { buildStandardFeedScript }, { discoverFromCuratedCatalog }, { hash }] = await Promise.all([
  import('../src/lib/db'),
  import('../src/lib/db/schema'),
  import('../src/lib/industry-configs/utils'),
  import('../src/lib/industry-configs/term-profile'),
  import('../src/lib/discovery-sources/standard-feed-script'),
  import('../src/lib/discovery-sources/discovery'),
  import('../src/lib/utils/hash'),
]);

const db = getDb();
const subscription = (await db
  .select()
  .from(subscriptions)
  .where(eq(subscriptions.id, subscriptionId)))[0];

if (!subscription?.industryConfigId) {
  throw new Error(`Subscription ${subscriptionId} is not an industry information pool.`);
}

const industry = (await db
  .select()
  .from(industryConfigs)
  .where(eq(industryConfigs.id, subscription.industryConfigId)))[0];

if (!industry) {
  throw new Error(`Industry configuration ${subscription.industryConfigId} was not found.`);
}

const snapshot = buildIndustryConfigSnapshot(industry);
if (!snapshot.termProfile || needsIndustryProfileExpansion(snapshot.termProfile)) {
  throw new Error('The industry configuration still has an incomplete profile; regenerate it before repairing this pool.');
}

const now = new Date();
await db.update(subscriptions)
  .set({ industryConfigSnapshot: JSON.stringify(snapshot), updatedAt: now })
  .where(eq(subscriptions.id, subscriptionId));

const poolSources = await db
  .select()
  .from(sources)
  .where(eq(sources.subscriptionId, subscriptionId));

console.log('Source metadata:', JSON.stringify(poolSources.reduce<Record<string, number>>((counts, source) => {
  const key = `${source.discoveryOrigin ?? 'none'}/${source.collectionStrategy ?? 'none'}/${source.catalogSourceId ? 'catalog' : 'no-catalog'}`;
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {})));

const catalogEntries = await db
  .select({ id: discoverySourceCatalog.id, feedUrl: discoverySourceCatalog.feedUrl })
  .from(discoverySourceCatalog);
const catalogSourceIdByUrl = new Map(catalogEntries.map((entry) => [entry.feedUrl, entry.id]));

const presetSource = (source: typeof poolSources[number]) =>
  source.collectionStrategy === 'generic_rss'
  || source.catalogSourceId !== null
  || catalogSourceIdByUrl.has(source.url);

const legacyCatalogSources = poolSources.filter((source) =>
  presetSource(source) && source.collectionStrategy !== 'generic_rss'
);

for (const source of legacyCatalogSources) {
  await db.update(sources)
    .set({
      catalogSourceId: catalogSourceIdByUrl.get(source.url) ?? source.catalogSourceId,
      discoveryOrigin: 'catalog',
      collectionStrategy: 'generic_rss',
      updatedAt: now,
    })
    .where(eq(sources.id, source.id));
}

const neverGenerated = poolSources.filter((source) =>
  presetSource(source) && !source.script.trim()
);

for (const source of neverGenerated) {
  await db.update(sources)
    .set({
      script: buildStandardFeedScript(source.url),
      isEnabled: true,
      status: 'active',
      lastError: null,
      updatedAt: now,
    })
    .where(eq(sources.id, source.id));
}

const enabledSourceIds = new Set(poolSources
  .filter((source) => source.isEnabled || neverGenerated.some((pending) => pending.id === source.id))
  .map((source) => source.id));
const sourceByUrl = new Map(poolSources.map((source) => [source.url, source]));

console.log(`Repairing ${subscription.topic}: refreshed profile, restored metadata for ${legacyCatalogSources.length} preset feeds, reactivated ${neverGenerated.length} ungenerated preset feeds.`);

// Run the same full-feed, batched classifier used by initial discovery. This
// avoids re-running the slower source-by-source scheduler path just to repair
// historical cards.
const discovered = await discoverFromCuratedCatalog({
  topic: subscription.topic,
  criteria: subscription.criteria ?? undefined,
  profile: snapshot.termProfile,
  userId: subscription.userId,
});

let newCards = 0;
for (const discoveredSource of discovered.sources) {
  const source = sourceByUrl.get(discoveredSource.url);
  if (!source || !enabledSourceIds.has(source.id)) continue;

  for (const item of discoveredSource.initialItems ?? []) {
    const inserted = await db.insert(messageCards)
      .values({
        subscriptionId,
        sourceId: source.id,
        contentHash: hash(item.title + item.url),
        title: item.title,
        summary: item.summary ?? null,
        thumbnailUrl: item.thumbnailUrl ?? null,
        sourceUrl: item.url,
        publishedAt: item.publishedAt ? new Date(item.publishedAt) : now,
        meetsCriteriaFlag: true,
        readAt: null,
        rawData: JSON.stringify(item),
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: messageCards.id });
    newCards += inserted.length;
  }
}

if (newCards > 0) {
  await db.update(subscriptions)
    .set({
      unreadCount: sql`${subscriptions.unreadCount} + ${newCards}`,
      totalCount: sql`${subscriptions.totalCount} + ${newCards}`,
      lastUpdatedAt: now,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, subscriptionId));
}

console.log(`Repair complete: ${newCards} new cards from ${discovered.qualifiedItemCount} strong/related items across ${discovered.validFeedCount} valid preset feeds; ${discovered.failures.length} feed fetch failures.`);

}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
