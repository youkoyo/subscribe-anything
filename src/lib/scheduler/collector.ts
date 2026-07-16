// src/lib/scheduler/collector.ts
// Full collection pipeline:
//   1. Run script in isolated-vm sandbox
//   2. Dedup each item against message_cards (contentHash + sourceId)
//   3. Persist new items as message_cards (readAt=null → unread)
//   4. Check criteria match → meetsCriteriaFlag
//   5. Update source stats + subscription counts
//   6. On script failure: mark source.status='failed', write source_failed notification

import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sources, subscriptions, messageCards } from '@/lib/db/schema';
import { runScript } from '@/lib/sandbox/runner';
import { rssFetch } from '@/lib/ai/tools/rssFetch';
import { collectWithFirecrawl } from '@/lib/firecrawl/collector';
import { hash } from '@/lib/utils/hash';
import { nextCronDate } from '@/lib/utils/cron';
import { createNotification } from '@/lib/notifications';
import { scheduleRetry, clearRetry, markCollecting, clearCollecting, setLastResult } from './retryManager';
import { classifyProfileItems } from '@/lib/industry-configs/profile-classifier';
import { buildProfileCollectionHint, type IndustryTermProfile } from '@/lib/industry-configs/term-profile';
import type { IndustryConfigSnapshot } from '@/lib/industry-configs/types';
import type { CollectedItem } from '@/lib/sandbox/contract';

export interface CollectResult {
  newItems: number;
  skipped: number;
  error?: string;
}

export async function collect(sourceId: string): Promise<CollectResult> {
  const db = getDb();

  // Load source + subscription
  const source = (await db.select().from(sources).where(eq(sources.id, sourceId)))[0];
  if (!source) {
    return { newItems: 0, skipped: 0, error: `Source ${sourceId} not found` };
  }

  markCollecting(sourceId);

  let result: CollectResult;
  try {
    result = await _doCollect(db, source, sourceId);
  } finally {
    clearCollecting(sourceId);
  }

  // Store result for frontend to pick up via polling
  setLastResult(sourceId, {
    newItems: result.newItems,
    skipped: result.skipped,
    error: result.error,
    success: !result.error,
    finishedAt: Date.now(),
  });

  return result;
}

async function _doCollect(
  db: ReturnType<typeof getDb>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: any,
  sourceId: string,
): Promise<CollectResult> {
  const subscription = (await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, source.subscriptionId)))[0];

  const now = new Date();
  const industryProfile = readV2IndustryProfile(subscription?.industryConfigSnapshot);

  // Preset feeds use the same host-side parser as initial discovery. Running
  // them through the sandbox produced an avoidable split-brain behaviour:
  // a feed could validate during discovery but appear empty after publishing.
  let rawItems: CollectedItem[];
  if (source.collectionStrategy === 'generic_rss') {
    try {
      rawItems = (await rssFetch(source.url, { maxItems: 'all' })).items;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await _handleFailure(db, source, subscription, errorMsg, now);
      return { newItems: 0, skipped: 0, error: errorMsg };
    }
  } else if (source.collectionStrategy === 'firecrawl_scrape') {
    try {
      rawItems = await collectWithFirecrawl({
        title: source.title,
        url: source.url,
        description: source.description ?? undefined,
        criteria: buildProfileCollectionHint(industryProfile, subscription?.criteria ?? undefined),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await _handleFailure(db, source, subscription, errorMsg, now);
      return { newItems: 0, skipped: 0, error: errorMsg };
    }
  } else {
    let runResult: Awaited<ReturnType<typeof runScript>>;
    try {
      runResult = await runScript(source.script);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await _handleFailure(db, source, subscription, errorMsg, now);
      return { newItems: 0, skipped: 0, error: errorMsg };
    }

    if (!runResult.success) {
      const errorMsg = runResult.error ?? 'Script error';
      await _handleFailure(db, source, subscription, errorMsg, now);
      return { newItems: 0, skipped: 0, error: runResult.error };
    }
    rawItems = runResult.items ?? [];
  }

  // An empty RSS feed is a successful poll with no new content. Firecrawl
  // deliberately throws for an empty extraction so its source can fall back
  // to the normal retry lifecycle rather than silently appearing healthy.
  if (rawItems.length === 0 && source.collectionStrategy !== 'generic_rss') {
    const errorMsg = '脚本执行成功但未返回任何数据，请检查脚本逻辑或目标页面是否变更';
    await _handleFailure(db, source, subscription, errorMsg, now);
    return { newItems: 0, skipped: 0, error: errorMsg };
  }

  // RSS and Firecrawl sources return raw page/feed entries. Relevance stays
  // host-owned so every scheduled collection uses the same industry profile.
  const items = await classifyIndustryProfileItems(source, subscription, rawItems);

  // ── Dedup + persist ───────────────────────────────────────────────────────────
  let newItems = 0;
  let skipped = 0;
  const criteriaText = subscription?.criteria?.trim().toLowerCase() ?? '';

  for (const item of items) {
    if (!item.title || !item.url) continue;

    const contentHash = hash(item.title + item.url);

    // Check existence (UNIQUE index will also protect, but pre-check avoids noise)
    const existing = (await db
      .select({ id: messageCards.id })
      .from(messageCards)
      .where(
        and(
          eq(messageCards.contentHash, contentHash),
          eq(messageCards.sourceId, sourceId)
        )
      ))[0];

    if (existing) {
      skipped++;
      continue;
    }

    // Criteria match — prefer script-provided criteriaResult; fall back to keyword matching
    let meetsCriteria: boolean;
    if (item.criteriaResult !== undefined) {
      meetsCriteria = item.criteriaResult === 'matched';
    } else if (criteriaText) {
      const itemText = `${item.title} ${item.summary ?? ''}`.toLowerCase();
      meetsCriteria = criteriaText.split(/[\s,，、]+/).filter(Boolean).some((kw) => itemText.includes(kw));
    } else {
      meetsCriteria = false;
    }

    try {
      await db.insert(messageCards)
        .values({
          subscriptionId: source.subscriptionId,
          sourceId,
          contentHash,
          title: item.title,
          summary: item.summary ?? null,
          thumbnailUrl: item.thumbnailUrl ?? null,
          sourceUrl: item.url,
          publishedAt: item.publishedAt ? new Date(item.publishedAt) : now,
          meetsCriteriaFlag: meetsCriteria,
          criteriaResult: item.criteriaResult ?? null,
          metricValue: item.metricValue ?? null,
          readAt: null,
          rawData: JSON.stringify(item),
          createdAt: now,
        })
        .onConflictDoNothing();

      newItems++;
    } catch {
      skipped++;
    }
  }

  // ── Update source stats ───────────────────────────────────────────────────────
  clearRetry(sourceId);
  const nextRun = nextCronDate(source.cronExpression);
  await db.update(sources)
    .set({
      lastRunAt: now,
      lastRunSuccess: true,
      lastError: null,
      nextRunAt: nextRun,
      totalRuns: sql`${sources.totalRuns} + 1`,
      successRuns: sql`${sources.successRuns} + 1`,
      itemsCollected: sql`${sources.itemsCollected} + ${newItems}`,
      status: 'active', // reset from 'failed' if it was previously broken
      updatedAt: now,
    })
    .where(eq(sources.id, sourceId));

  // ── Update subscription counts ────────────────────────────────────────────────
  if (newItems > 0 && subscription) {
    await db.update(subscriptions)
      .set({
        unreadCount: sql`${subscriptions.unreadCount} + ${newItems}`,
        totalCount: sql`${subscriptions.totalCount} + ${newItems}`,
        lastUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, source.subscriptionId));

    await createNotification(db, {
      type: 'cards_collected',
      title: `新增 ${newItems} 条消息卡片`,
      body: source.title,
      subscriptionId: subscription.id,
      relatedEntityType: 'source',
      relatedEntityId: source.id,
    });
  }

  console.log(`[Collector] source=${sourceId} new=${newItems} skipped=${skipped}`);
  return { newItems, skipped };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readV2IndustryProfile(snapshotJson: string | null | undefined): IndustryTermProfile | null {
  if (!snapshotJson) return null;
  try {
    const snapshot = JSON.parse(snapshotJson) as Partial<IndustryConfigSnapshot>;
    return snapshot.termProfile?.version === 2 ? snapshot.termProfile : null;
  } catch {
    return null;
  }
}

async function classifyIndustryProfileItems(
  source: { id: string; collectionStrategy?: string | null },
  subscription: { userId?: string | null; industryConfigSnapshot?: string | null } | undefined,
  rawItems: CollectedItem[],
): Promise<CollectedItem[]> {
  if (source.collectionStrategy !== 'generic_rss' && source.collectionStrategy !== 'firecrawl_scrape') {
    return rawItems;
  }

  const profile = readV2IndustryProfile(subscription?.industryConfigSnapshot);
  if (!profile) {
    console.warn(`[Collector] source=${source.id} skipped industry-source items because its v2 industry profile is missing`);
    return [];
  }

  const candidates = rawItems.map((item, index) => ({
    id: `${source.id}:${index}`,
    title: item.title,
    summary: item.summary,
  }));
  const relevanceById = await classifyProfileItems(profile, candidates, subscription?.userId);

  return rawItems.flatMap((item, index) => {
    const relevance = relevanceById.get(`${source.id}:${index}`);
    if (!relevance || relevance.label === 'irrelevant') return [];
    return [{
      ...item,
      relevanceLabel: relevance.label,
      relevanceReason: relevance.reason,
      matchedTerms: relevance.matchedTerms,
    }];
  });
}

async function _handleFailure(
  db: ReturnType<typeof getDb>,
  source: { id: string; subscriptionId: string; title: string; cronExpression: string },
  subscription: { id: string } | undefined,
  errorMsg: string,
  now: Date
) {
  const retried = scheduleRetry(source.id, errorMsg);
  if (retried) {
    await _markRetrying(db, source, errorMsg, now);
  } else {
    await _markFailed(db, source, subscription, errorMsg, now);
  }
}

async function _markRetrying(
  db: ReturnType<typeof getDb>,
  source: { id: string; cronExpression: string },
  errorMsg: string,
  now: Date
) {
  await db.update(sources)
    .set({
      lastRunAt: now,
      lastRunSuccess: false,
      lastError: errorMsg,
      updatedAt: now,
    })
    .where(eq(sources.id, source.id));

  console.log(`[Collector] source=${source.id} FAILED (retrying): ${errorMsg}`);
}

async function _markFailed(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: ReturnType<typeof getDb>,
  source: { id: string; subscriptionId: string; title: string; cronExpression: string },
  subscription: { id: string } | undefined,
  errorMsg: string,
  now: Date
) {
  const nextRun = nextCronDate(source.cronExpression);

  await db.update(sources)
    .set({
      lastRunAt: now,
      lastRunSuccess: false,
      lastError: errorMsg,
      nextRunAt: nextRun,
      totalRuns: sql`${sources.totalRuns} + 1`,
      status: 'failed',
      updatedAt: now,
    })
    .where(eq(sources.id, source.id));

  if (subscription) {
    await createNotification(db, {
      type: 'source_failed',
      title: `订阅源采集失败：${source.title}`,
      body: errorMsg.slice(0, 500),
      subscriptionId: subscription.id,
      relatedEntityType: 'source',
      relatedEntityId: source.id,
    });
  }

  console.error(`[Collector] source=${source.id} FAILED: ${errorMsg}`);
}
