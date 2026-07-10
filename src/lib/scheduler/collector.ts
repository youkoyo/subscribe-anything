// src/lib/scheduler/collector.ts
// Full collection pipeline:
//   1. Run script in isolated-vm sandbox
//   2. Dedup each item against message_cards (contentHash + sourceId)
//   3. Persist new items as message_cards (readAt=null → unread)
//   4. Check criteria match → meetsCriteriaFlag
//   5. Update source stats + subscription counts
//   6. On script failure: mark source.status='failed', write source_failed notification
//
// Diagnostic outcome of every attempt is written to `collection_logs` via
// writeCollectionLog (see collectionLogStore.ts) so admins can debug script
// failures even after the in-memory retry state has rolled over.

import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sources, subscriptions, messageCards } from '@/lib/db/schema';
import { runScript } from '@/lib/sandbox/runner';
import { hash } from '@/lib/utils/hash';
import { nextCronDate } from '@/lib/utils/cron';
import { createNotification } from '@/lib/notifications';
import { parseIndustryConfigSnapshot } from '@/lib/industry-configs/subscriptionSelection';
import { scheduleRetry, clearRetry, markCollecting, clearCollecting, setLastResult, isCollecting, MAX_RETRIES } from './retryManager';
import { writeCollectionLog } from './collectionLogStore';
import { attemptAutoRepair } from './autoRepair';

export interface CollectResult {
  newItems: number;
  skipped: number;
  error?: string;
}

export async function collect(sourceId: string): Promise<CollectResult> {
  const db = getDb();
  const startedAt = Date.now();

  // Load source + subscription
  const source = (await db.select().from(sources).where(eq(sources.id, sourceId)))[0];
  if (!source) {
    return { newItems: 0, skipped: 0, error: `Source ${sourceId} not found` };
  }

  // Concurrency guard: cron + retry chain could overlap; bail out cleanly.
  if (isCollecting(sourceId)) {
    console.log(`[Collector] Skipping concurrent collect for source=${sourceId} (${source.title})`);
    await writeCollectionLog(
      sourceId,
      'warn',
      'concurrent_skip',
      `Concurrent collect skipped for "${source.title}"`
    );
    return { newItems: 0, skipped: 0, error: 'concurrent_collect' };
  }
  markCollecting(sourceId);

  await writeCollectionLog(
    sourceId,
    'info',
    'start',
    `Collection started for "${source.title}"`,
    { cronExpression: source.cronExpression }
  );

  let result: CollectResult;
  try {
    result = await _doCollect(db, source, sourceId, startedAt);
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
  startedAt: number,
): Promise<CollectResult> {
  const subscription = (await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, source.subscriptionId)))[0];

  const now = new Date();

  // ── Run script ───────────────────────────────────────────────────────────────
  let runResult: Awaited<ReturnType<typeof runScript>>;
  try {
    runResult = await runScript(source.script);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await _handleFailure(db, source, subscription, errorMsg, now);
    return { newItems: 0, skipped: 0, error: errorMsg };
  }

  if (!runResult.success) {
    const rawError = runResult.error ?? 'Script error';
    const errorMsg = humanizeScriptError(rawError);
    await _handleFailure(db, source, subscription, errorMsg, now);
    return { newItems: 0, skipped: 0, error: errorMsg };
  }

  const items = runResult.items ?? [];

  // ── Zero items = script broken (returns nothing useful) ─────────────────────
  if (items.length === 0) {
    // Distinguish "source is dead" from "script is broken". The script logs
    // `STALE_SOURCE_DETECTED latest=...` when it found dated items but they're
    // all beyond the 180-day staleness window. In that case the script behavior
    // is correct — the source itself is no longer maintained. Surface this
    // clearly so the admin can decide to retire the source.
    const errorMsg =
      '脚本执行成功但未返回任何数据，请检查脚本逻辑或目标页面是否变更';
    await writeCollectionLog(sourceId, 'error', 'zero_items', errorMsg, {
      scriptReturnedItems: 0,
      durationMs: Date.now() - startedAt,
    });
    await _handleFailure(db, source, subscription, errorMsg, now);
    return { newItems: 0, skipped: 0, error: errorMsg };
  }

  // ── Dedup + persist ───────────────────────────────────────────────────────────
  let newItems = 0;
  let skippedDuplicates = 0;
  let skippedMissingFields = 0;
  let skippedInsertError = 0;
  let skippedNotRelevant = 0;
  // Build topic keyword list from industry config snapshot for enhanced relevance filtering
  const topicKeywords: string[] = [];
  if (subscription?.industryConfigSnapshot) {
    const snapshot = parseIndustryConfigSnapshot(subscription.industryConfigSnapshot);
    if (snapshot) {
      topicKeywords.push(
        snapshot.name,
        snapshot.category,
        snapshot.subCategory,
        ...(snapshot.keywords ?? []),
        ...(snapshot.entities ?? []),
      );
    }
  }
  const allKeywords = topicKeywords.filter(Boolean).map((kw) => kw.toLowerCase());

  const criteriaText = subscription?.criteria?.trim().toLowerCase() ?? '';

  for (const item of items) {
    if (!item.title || !item.url) {
      skippedMissingFields++;
      continue;
    }

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
      skippedDuplicates++;
      continue;
    }

    // Criteria judgment — script-provided result takes priority; otherwise fall back
    // to a keyword check against the subscription's criteria. Three outcomes:
    //   • meetsCriteria=true            → insert with flag=true
    //   • meetsCriteria=false + criteria was provided AND result was deterministic
    //                                   → DROP (don't pollute message_cards)
    //   • meetsCriteria=false + no criteria (or 'invalid')
    //                                   → insert with flag=false (preserve for review)
    let meetsCriteria: boolean;
    let dropAsIrrelevant = false;
    if (item.criteriaResult === 'matched') {
      meetsCriteria = true;
    } else if (item.criteriaResult === 'not_matched') {
      meetsCriteria = false;
      dropAsIrrelevant = true;
    } else if (item.criteriaResult === 'invalid') {
      // Script tried to judge but couldn't — keep with flag=false so admin can review
      meetsCriteria = false;
    } else if (criteriaText || allKeywords.length > 0) {
      const itemText = `${item.title} ${item.summary ?? ''}`.toLowerCase();
      // Check both the subscription criteria and industry config keywords
      const criteriaMatches = criteriaText
        ? criteriaText.split(/[\s,，、]+/).filter(Boolean).some((kw) => itemText.includes(kw))
        : false;
      const keywordMatches = allKeywords.some((kw) => itemText.includes(kw));
      meetsCriteria = criteriaMatches || keywordMatches;
      if (!meetsCriteria) dropAsIrrelevant = true;
    } else {
      meetsCriteria = false;
    }

    if (dropAsIrrelevant) {
      skippedNotRelevant++;
      continue;
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
    } catch (err) {
      // Log the actual error instead of swallowing it — admins need this to debug
      // constraint violations, oversized payloads, connection drops, etc.
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[Collector] insert failed source=${sourceId} title="${item.title}" url="${item.url}": ${errorMsg}`
      );
      skippedInsertError++;
    }
  }

  const totalSkipped = skippedDuplicates + skippedMissingFields + skippedInsertError + skippedNotRelevant;
  const durationMs = Date.now() - startedAt;

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

  await writeCollectionLog(sourceId, 'success', 'success',
    `Collected ${newItems} new, ${totalSkipped} skipped (${skippedDuplicates} dup, ${skippedMissingFields} missing fields, ${skippedInsertError} insert error, ${skippedNotRelevant} not relevant)`,
    {
      scriptReturnedItems: items.length,
      newItems,
      skipped: totalSkipped,
      skippedDuplicates,
      skippedMissingFields,
      skippedInsertError,
      skippedNotRelevant,
      durationMs,
    }
  );

  console.log(`[Collector] source=${sourceId} new=${newItems} skipped=${totalSkipped} (${skippedNotRelevant} irrelevant) duration=${durationMs}ms`);
  return { newItems, skipped: totalSkipped };
}

/**
 * Translate raw sandbox error messages into a user-friendly form.
 *
 * The script is instructed to log `STALE_SOURCE_DETECTED latest=YYYY-MM-DDTHH:mm:ss.sssZ`
 * when it found dated items but they're all beyond the 180-day staleness window.
 * In that case the source itself has gone quiet — the script did its job correctly.
 * Surface this to the admin so they can decide to retire the source instead of
 * seeing a generic "script generated 0 items" error.
 */
function humanizeScriptError(rawError: string): string {
  const match = rawError.match(/STALE_SOURCE_DETECTED\s+latest=([0-9TZ:.\-]+)/);
  if (match) {
    const latest = match[1];
    return `源已停更：最新数据时间 ${latest}（超过 180 天），建议在管理后台废弃该源`;
  }
  return rawError;
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
    // Fire-and-forget: attempt AI auto-repair after all retries are exhausted.
    // Do NOT await — let it run in background so the collector returns promptly.
    attemptAutoRepair(source.id, errorMsg).then((result) => {
      if (result.repaired) {
        console.log(`[Collector] source=${source.id} auto-repaired successfully`);
      }
    }).catch((err) => {
      console.error(`[Collector] source=${source.id} auto-repair threw:`, err);
    });
  }
}

async function _markRetrying(
  db: ReturnType<typeof getDb>,
  source: { id: string; cronExpression: string },
  errorMsg: string,
  now: Date
) {
  // Push nextRunAt past the retry chain (5s + 30s + 60s = 95s) so the regular
  // cron and the retry timers don't pile up while we're still trying to recover.
  const retryWindowMs = 120_000;
  const nextRun = new Date(now.getTime() + retryWindowMs);

  await db.update(sources)
    .set({
      lastRunAt: now,
      lastRunSuccess: false,
      lastError: errorMsg,
      nextRunAt: nextRun,
      updatedAt: now,
    })
    .where(eq(sources.id, source.id));

  await writeCollectionLog(source.id, 'warn', 'retry_scheduled',
    `Retry scheduled: ${errorMsg}`,
    { errorMessage: errorMsg, maxRetries: MAX_RETRIES }
  );

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
  // Reduce retry frequency for failed sources: push next run 6 hours out
  // instead of following the normal cron schedule. This prevents wasted
  // CPU cycles on sources that are structurally broken. If auto-repair
  // succeeds, the source will be reset to 'active' and rescheduled normally.
  const failedNextRun = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  const nextRun = failedNextRun;

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

  await writeCollectionLog(source.id, 'error', 'retry_exhausted',
    `Retries exhausted (${MAX_RETRIES}): ${errorMsg}`,
    { errorMessage: errorMsg, maxRetries: MAX_RETRIES }
  );

  console.error(`[Collector] source=${source.id} FAILED: ${errorMsg}`);
}
