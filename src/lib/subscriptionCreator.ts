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
import { subscriptions, sources, notifications } from '@/lib/db/schema';
import {
  articleCandidateFromCollectedItem,
  ingestArticles,
} from '@/lib/collection/ingestArticles';
import type { CollectedItem } from '@/lib/sandbox/contract';
import type { SearchPlan } from '@/lib/search/queryPlan';
import type { CollectionMode } from '@/types/wizard';

export interface SourceInput {
  title: string;
  url: string;
  description?: string;
  script: string;
  cronExpression?: string;
  isEnabled?: boolean;
  initialItems?: CollectedItem[];
  collectionMode?: CollectionMode;
  searchPlan?: SearchPlan;
  /** If set, the source failed script generation — stored as lastError, status='failed' */
  failedReason?: string;
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
  return createSourcesForSubscriptionWithDependencies(
    subscriptionId,
    sourcesInput,
    criteria,
    { db: getDb(), ingestArticles },
  );
}

export interface SubscriptionCreatorDependencies {
  db: ReturnType<typeof getDb>;
  ingestArticles: typeof ingestArticles;
}

export async function createSourcesForSubscriptionWithDependencies(
  subscriptionId: string,
  sourcesInput: SourceInput[],
  criteria: string | undefined,
  dependencies: SubscriptionCreatorDependencies,
): Promise<void> {
  const { db } = dependencies;
  const now = new Date();
  const subscription = (await db.select().from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId)))[0];
  if (!subscription) throw new Error(`Subscription ${subscriptionId} not found`);
  const ingestionSubscription = criteria === undefined
    ? subscription
    : { ...subscription, criteria };

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
        script: srcInput.script,
        collectorType: srcInput.collectionMode ?? 'feed_script',
        collectorConfigJson: JSON.stringify(srcInput.searchPlan ?? {}),
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

    const items = srcInput.initialItems ?? [];
    const origin = source.collectorType === 'search' ? 'search' : 'feed';
    let ingestResult: Awaited<ReturnType<typeof ingestArticles>>;
    try {
      ingestResult = await dependencies.ingestArticles({
        db,
        source,
        subscription: ingestionSubscription,
        candidates: items.map((item) => articleCandidateFromCollectedItem(item, origin)),
        now,
      });
    } catch (error) {
      try {
        await db.delete(sources).where(eq(sources.id, source.id));
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Initial article ingestion and cleanup failed for source ${source.id}`,
          { cause: error },
        );
      }
      throw error;
    }
    const newCards = ingestResult.inserted;

    // Update source stats to reflect the initial validation run
    await db.update(sources)
      .set({
        totalRuns: 1,
        successRuns: 1,
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
}
