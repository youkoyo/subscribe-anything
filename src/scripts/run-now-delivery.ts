/**
 * One-shot: trigger an immediate delivery run for a given user's active industry
 * subscription, bypassing the cron scheduler.
 *
 * Usage:
 *   npx tsx src/scripts/run-now-delivery.ts                # pick the first active user sub
 *   npx tsx src/scripts/run-now-delivery.ts <user_email>   # pick that user's first active sub
 *   npx tsx src/scripts/run-now-delivery.ts <email> <industry_config_id>  # explicit
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryDeliveryRuns,
  userDeliveryLogs,
  userIndustrySubscriptions,
  users,
} from '@/lib/db/schema';
import { runIndustryDelivery } from '@/lib/enterprise/deliveryService';

async function resolveTarget(): Promise<{ userId: string; industryConfigId: string }> {
  const db = getDb();
  const [, , emailArg, configArg] = process.argv;

  if (emailArg && configArg) {
    const user = db.select().from(users).where(eq(users.email, emailArg)).get();
    if (!user) throw new Error(`No user with email ${emailArg}`);
    return { userId: user.id, industryConfigId: configArg };
  }

  if (emailArg) {
    const user = db.select().from(users).where(eq(users.email, emailArg)).get();
    if (!user) throw new Error(`No user with email ${emailArg}`);
    const sub = db
      .select()
      .from(userIndustrySubscriptions)
      .where(
        and(
          eq(userIndustrySubscriptions.userId, user.id),
          eq(userIndustrySubscriptions.status, 'active')
        )
      )
      .get();
    if (!sub) throw new Error(`No active subscription for ${emailArg}`);
    return { userId: user.id, industryConfigId: sub.industryConfigId };
  }

  // Default: first active user sub
  const sub = db
    .select()
    .from(userIndustrySubscriptions)
    .where(eq(userIndustrySubscriptions.status, 'active'))
    .get();
  if (!sub) throw new Error('No active user_industry_subscriptions in DB');
  return { userId: sub.userId, industryConfigId: sub.industryConfigId };
}

async function main() {
  const { userId, industryConfigId } = await resolveTarget();
  const db = getDb();

  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const industry = db
    .select()
    .from(industryConfigs)
    .where(eq(industryConfigs.id, industryConfigId))
    .get();

  console.log('[target] user:', user?.email, '(', userId, ')');
  console.log('[target] industry:', industry?.name, '(', industryConfigId, ')');

  console.log('[run] calling runIndustryDelivery()...');
  const startedAt = Date.now();
  const run = await runIndustryDelivery(industryConfigId, new Date());
  console.log(`[run] run_id=${run.id} status=${run.status} took=${Date.now() - startedAt}ms`);

  // Inspect resulting logs for this run + user
  const logs = db
    .select()
    .from(userDeliveryLogs)
    .where(eq(userDeliveryLogs.runId, run.id))
    .all();
  console.log(`[logs] ${logs.length} log row(s):`);
  for (const log of logs) {
    console.log('  -', {
      userId: log.userId,
      subject: log.subject,
      status: log.status,
      recipients: log.recipientEmailsJson,
      sentAt: log.sentAt,
      error: log.error,
    });
  }

  // Final run state
  const finalRun = db
    .select()
    .from(industryDeliveryRuns)
    .where(eq(industryDeliveryRuns.id, run.id))
    .get();
  console.log('[final] run:', {
    status: finalRun?.status,
    startedAt: finalRun?.startedAt,
    finishedAt: finalRun?.finishedAt,
    error: finalRun?.error,
  });

  if (run.status === 'failed' || logs.some((l) => l.status === 'failed')) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[fatal]', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});