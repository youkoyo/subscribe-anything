// src/lib/scheduler/collector.ts
// Full collection pipeline:
//   1. Dispatch to the persisted search/RSS/JSON/feed-script collector
//   2. Strictly validate and subscription-deduplicate every candidate article
//   3. Atomically persist accepted cards and their source/subscription counts
//   4. Update source run stats
//   5. On collector failure: mark source.status='failed', write source_failed notification

import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sources, subscriptions } from '@/lib/db/schema';
import { ingestArticles } from '@/lib/collection/ingestArticles';
import {
  collectCandidatesForSource,
  type CollectCandidates,
  type CollectorSource,
} from '@/lib/collection/collectors';
import { nextCronDate } from '@/lib/utils/cron';
import { createNotification } from '@/lib/notifications';
import { scheduleRetry, clearRetry, markCollecting, clearCollecting, setLastResult } from './retryManager';

export interface CollectResult {
  newItems: number;
  skipped: number;
  error?: string;
}

export async function collect(sourceId: string): Promise<CollectResult> {
  return collectWithDependencies(sourceId, {
    db: getDb(),
    collectCandidates: collectCandidatesForSource,
    ingestArticles,
    setLastResult,
  });
}

export interface CollectorDependencies {
  db: ReturnType<typeof getDb>;
  collectCandidates: CollectCandidates;
  ingestArticles: typeof ingestArticles;
  setLastResult: typeof setLastResult;
}

export async function collectWithDependencies(
  sourceId: string,
  dependencies: CollectorDependencies,
): Promise<CollectResult> {
  const { db } = dependencies;

  // Load source + subscription
  const source = (await db.select().from(sources).where(eq(sources.id, sourceId)))[0];
  if (!source) {
    return { newItems: 0, skipped: 0, error: `Source ${sourceId} not found` };
  }

  markCollecting(sourceId);

  let result: CollectResult;
  try {
    result = await _doCollect(db, source, sourceId, dependencies);
  } finally {
    clearCollecting(sourceId);
  }

  // Store result for frontend to pick up via polling
  dependencies.setLastResult(sourceId, {
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
  dependencies: Pick<CollectorDependencies, 'collectCandidates' | 'ingestArticles'>,
): Promise<CollectResult> {
  const subscription = (await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, source.subscriptionId)))[0];

  const now = new Date();
  if (!subscription) {
    const errorMsg = `Subscription ${source.subscriptionId} not found`;
    await _handleFailure(db, source, undefined, errorMsg, now);
    return { newItems: 0, skipped: 0, error: errorMsg };
  }

  // ── Dispatch persisted collector ─────────────────────────────────────────────
  let candidates: Awaited<ReturnType<CollectCandidates>>;
  try {
    candidates = await dependencies.collectCandidates(source as CollectorSource);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await _handleFailure(db, source, subscription, errorMsg, now);
    return { newItems: 0, skipped: 0, error: errorMsg };
  }
  let ingestResult: Awaited<ReturnType<typeof ingestArticles>>;
  try {
    ingestResult = await dependencies.ingestArticles({
      db,
      source,
      subscription,
      candidates,
      now,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await _handleFailure(db, source, subscription, errorMsg, now);
    return { newItems: 0, skipped: 0, error: errorMsg };
  }
  const newItems = ingestResult.inserted;
  const skipped = ingestResult.rejected + ingestResult.duplicates;

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
      status: 'active', // reset from 'failed' if it was previously broken
      updatedAt: now,
    })
    .where(eq(sources.id, sourceId));

  if (newItems > 0) {
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
