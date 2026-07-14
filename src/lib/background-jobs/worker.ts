import pLimit from 'p-limit';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  industryMonitoringProfiles,
  subscriptions,
  userIndustrySubscriptions,
} from '@/lib/db/schema';
import type { IndustryConfigSnapshot } from '@/lib/industry-configs/types';
import type { FoundSource } from '@/types/wizard';
import type { SourceInput } from '@/lib/subscriptionCreator';
import {
  claimNextBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  type BackgroundJob,
} from './queue';

// This process is deliberately single-file for AI/browser work. On 2C2G,
// a second concurrent browser or script-validation task is more harmful than helpful.
const HEAVY_JOB_CONCURRENCY = 1;
const heavyLimit = pLimit(HEAVY_JOB_CONCURRENCY);
const POLL_INTERVAL_MS = 750;
let isPolling = false;

function parsePayload<T>(job: BackgroundJob): T {
  return JSON.parse(job.payload) as T;
}

async function completeMonitoringProfile(profileId: string, subscriptionId: string) {
  const db = getDb();
  const latest = (await db
    .select({ managedStatus: subscriptions.managedStatus, managedError: subscriptions.managedError })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId)))[0];

  if (latest?.managedStatus === null) {
    await db.update(industryMonitoringProfiles)
      .set({ status: 'active', lastProvisionedAt: new Date(), provisioningError: null, updatedAt: new Date() })
      .where(eq(industryMonitoringProfiles.id, profileId));
    await db.update(userIndustrySubscriptions)
      .set({ status: 'active', updatedAt: new Date() })
      .where(and(
        eq(userIndustrySubscriptions.monitoringProfileId, profileId),
        eq(userIndustrySubscriptions.status, 'pending_profile')
      ));
    return;
  }

  await db.update(industryMonitoringProfiles)
    .set({ status: 'failed', provisioningError: latest?.managedError ?? '共享信息池创建失败', updatedAt: new Date() })
    .where(eq(industryMonitoringProfiles.id, profileId));
}

async function runJob(job: BackgroundJob): Promise<void> {
  switch (job.type) {
    case 'managed_pipeline': {
      const { subscriptionId, payload, monitoringProfileId } = parsePayload<{
        subscriptionId: string;
        payload: Parameters<typeof import('@/lib/managed/pipeline').runManagedPipeline>[1];
        monitoringProfileId?: string;
      }>(job);
      const { runManagedPipeline } = await import('@/lib/managed/pipeline');
      await runManagedPipeline(subscriptionId, payload);
      const sub = (await getDb().select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0];
      if (sub?.managedStatus === null && payload.industryConfigId) {
        const { bindSubscriptionAsIndustryPool } = await import('@/lib/enterprise/industryPoolService');
        await bindSubscriptionAsIndustryPool({
          industryConfigId: payload.industryConfigId,
          subscriptionId,
          adminUserId: payload.userId,
        });
      }
      if (monitoringProfileId) await completeMonitoringProfile(monitoringProfileId, subscriptionId);
      return;
    }
    case 'managed_step': {
      const { subscriptionId, step, sources } = parsePayload<{
        subscriptionId: string;
        step: 'find_sources' | 'generate_scripts';
        sources: FoundSource[];
      }>(job);
      const sub = (await getDb().select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0];
      if (!sub) return;
      if (step === 'find_sources') {
        let snapshot: IndustryConfigSnapshot | null = null;
        try { snapshot = sub.industryConfigSnapshot ? JSON.parse(sub.industryConfigSnapshot) as IndustryConfigSnapshot : null; } catch { /* ignore legacy snapshot */ }
        const { runFindSourcesStep } = await import('@/lib/managed/pipeline');
        await runFindSourcesStep(subscriptionId, sub.topic, sub.criteria ?? undefined, sub.userId, snapshot);
      } else {
        const { runGenerateScriptsStep } = await import('@/lib/managed/pipeline');
        await runGenerateScriptsStep(subscriptionId, sources, sub.criteria ?? undefined, sub.userId);
      }
      return;
    }
    case 'generate_source': {
      const { subscriptionId, source, userPrompt } = parsePayload<{
        subscriptionId: string;
        source: FoundSource;
        userPrompt?: string;
      }>(job);
      const sub = (await getDb().select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)))[0];
      if (!sub) return;
      const { retryGenerateSourceStep } = await import('@/lib/managed/pipeline');
      await retryGenerateSourceStep(subscriptionId, source, sub.criteria ?? undefined, sub.userId, userPrompt);
      return;
    }
    case 'source_collection': {
      const { sourceId } = parsePayload<{ sourceId: string }>(job);
      const { collect } = await import('@/lib/scheduler/collector');
      await collect(sourceId);
      return;
    }
    case 'source_provisioning': {
      const { subscriptionId, sources, criteria } = parsePayload<{
        subscriptionId: string;
        sources: SourceInput[];
        criteria?: string;
      }>(job);
      const { createSourcesForSubscription } = await import('@/lib/subscriptionCreator');
      await createSourcesForSubscription(subscriptionId, sources, criteria);
      return;
    }
  }
}

async function processOneJob() {
  if (heavyLimit.activeCount >= HEAVY_JOB_CONCURRENCY) return false;
  const job = await claimNextBackgroundJob();
  if (!job) return false;

  void heavyLimit(async () => {
    try {
      await runJob(job);
      await completeBackgroundJob(job.id);
    } catch (error) {
      console.error(`[Worker] Job ${job.id} (${job.type}) failed:`, error);
      await failBackgroundJob(job.id, error);
    }
  }).catch((error) => console.error('[Worker] Unhandled task error:', error));
  return true;
}

async function tick() {
  if (isPolling) return;
  isPolling = true;
  try {
    await processOneJob();
  } finally {
    isPolling = false;
  }
}

export async function runBackgroundWorker() {
  console.log(`[Worker] Started with heavy concurrency ${HEAVY_JOB_CONCURRENCY}`);
  await tick();
  const timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);
  const stop = () => {
    clearInterval(timer);
    console.log('[Worker] Stopped');
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
