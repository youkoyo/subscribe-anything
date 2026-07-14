/**
 * subscriptionCreator.ts
 *
 * Shared logic for creating sources + message cards for a subscription.
 * Used by:
 *   - POST /api/subscriptions (wizard complete)
 *   - POST /api/subscriptions/[id]/complete-wizard (manual wizard complete)
 *   - src/lib/managed/pipeline.ts (managed pipeline complete phase)
 */

import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions, sources, messageCards, notifications } from '@/lib/db/schema';
import { hash } from '@/lib/utils/hash';
import type { CollectedItem } from '@/lib/sandbox/contract';

export interface SourceInput {
  title: string;
  url: string;
  description?: string;
  script: string;
  cronExpression?: string;
  isEnabled?: boolean;
  initialItems?: CollectedItem[];
  /** If set, the source failed script generation — stored as lastError, status='failed' */
  failedReason?: string;
  catalogSourceId?: string;
  discoveryOrigin?: 'catalog' | 'ai';
  collectionStrategy?: 'generic_rss' | 'ai_script';
}

/** Provision sources that already yielded qualifying news before deferred sources. */
export function prioritizeSourcesForPublish<T extends Pick<SourceInput, 'initialItems'>>(
  sourcesInput: T[]
): { priority: T[]; deferred: T[] } {
  const priority: T[] = [];
  const deferred: T[] = [];
  for (const source of sourcesInput) {
    if ((source.initialItems?.length ?? 0) > 0) priority.push(source);
    else deferred.push(source);
  }
  return { priority, deferred };
}

/**
 * Create sources and initial message cards for an existing subscription.
 * Does not modify managedStatus — caller is responsible for updating that.
 */
export async function createSourcesForSubscription(
  subscriptionId: string,
  sourcesInput: SourceInput[],
  criteria?: string
): Promise<void> {
  const db = getDb();
  const now = new Date();
  let totalNewCards = 0;

  for (const srcInput of sourcesInput) {
    if (!srcInput.title || !srcInput.url) continue;

    const isFailed = !!srcInput.failedReason;

    // Insert source record
    const source = (await db
      .insert(sources)
      .values({
        subscriptionId,
        title: srcInput.title,
        description: srcInput.description || null,
        url: srcInput.url,
        catalogSourceId: srcInput.catalogSourceId ?? null,
        discoveryOrigin: srcInput.discoveryOrigin ?? null,
        collectionStrategy: srcInput.collectionStrategy ?? null,
        script: srcInput.script,
        cronExpression: srcInput.cronExpression ?? '0 * * * *',
        isEnabled: isFailed ? false : srcInput.isEnabled !== false,
        status: isFailed ? 'failed' : 'active',
        lastError: isFailed ? srcInput.failedReason : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning())[0];

    // Skip message cards, stats, and scheduling for failed sources
    if (isFailed) {
      // Only notify for genuinely failed sources, not ones that were never generated
      if (srcInput.failedReason !== '未生成') {
        await db.insert(notifications)
          .values({
            type: 'source_failed',
            title: `订阅源待修复：${source.title}`,
            body: srcInput.failedReason,
            isRead: false,
            subscriptionId,
            relatedEntityType: 'source',
            relatedEntityId: source.id,
            createdAt: now,
          });
      }
      continue;
    }

    // Write initial message cards from validation step
    const items = srcInput.initialItems ?? [];
    let newCards = 0;

    for (const item of items) {
      if (!item.title || !item.url) continue;
      const contentHash = hash(item.title + item.url);

      // Preserve every qualifying item per source. We intentionally do not
      // merge the same event across different sources.
      const criteriaText = criteria?.trim().toLowerCase() ?? '';
      const itemText = `${item.title} ${item.summary ?? ''}`.toLowerCase();
      const meetsCriteria = item.relevanceLabel === 'strong' || item.relevanceLabel === 'related'
        ? true
        : criteriaText
        ? criteriaText.split(/[\s,，、]+/).filter(Boolean).some((kw) => itemText.includes(kw))
        : false;

      try {
        await db.insert(messageCards)
          .values({
            subscriptionId,
            sourceId: source.id,
            contentHash,
            title: item.title,
            summary: item.summary || null,
            thumbnailUrl: item.thumbnailUrl || null,
            sourceUrl: item.url,
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : now,
            meetsCriteriaFlag: meetsCriteria,
            readAt: null,
            rawData: JSON.stringify(item),
            createdAt: now,
          })
          .onConflictDoNothing();

        newCards++;
      } catch {
        // Skip on conflict
      }
    }

    totalNewCards += newCards;

    // Update source stats to reflect the initial validation run
    await db.update(sources)
      .set({
        totalRuns: 1,
        successRuns: 1,
        itemsCollected: newCards,
        lastRunAt: now,
        lastRunSuccess: true,
        updatedAt: now,
      })
      .where(eq(sources.id, source.id));

    // Write source_created notification
    await db.insert(notifications)
      .values({
        type: 'source_created',
        title: `订阅源已创建：${source.title}`,
        body: `已采集到 ${newCards} 条初始内容`,
        isRead: false,
        subscriptionId,
        relatedEntityType: 'source',
        relatedEntityId: source.id,
        createdAt: now,
      });

    // Schedule source
    try {
      const { jobManager } = await import('@/lib/scheduler/jobManager');
      if (source.isEnabled) {
        jobManager.scheduleSource(source);
      }
    } catch {
      // Scheduler may not be initialised in API-only context
    }
  }

  // Update subscription counts
  if (totalNewCards > 0) {
    await db.update(subscriptions)
      .set({
        unreadCount: totalNewCards,
        totalCount: totalNewCards,
        lastUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, subscriptionId));
  }
}
