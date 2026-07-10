/**
 * autoRepair.ts
 *
 * When a source exhausts all retries (3 attempts), the collector calls
 * attemptAutoRepair() as a fire-and-forget. This module:
 * 1. Checks whether the error type is structural (suitable for AI repair)
 * 2. Calls repairScriptAgent to regenerate the script
 * 3. Auto-applies the repaired script if validation passes
 * 4. Writes notifications and logs for admin visibility
 *
 * Only one auto-repair attempt is made per failure cycle to prevent loops.
 */

import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { sources, subscriptions, notifications } from '@/lib/db/schema';
import { clearRetry } from './retryManager';
import { jobManager } from './jobManager';
import { writeCollectionLog } from './collectionLogStore';
import { nextCronDate } from '@/lib/utils/cron';

/** In-memory set to prevent concurrent auto-repair on the same source. */
const repairingSet = new Set<string>();

/** Classification of collection failures. */
type FailureCategory = 'structural' | 'transient' | 'unknown';

/**
 * Classify the error to decide whether auto-repair should be attempted.
 *
 * Structural errors suggest the page/API changed and the script needs updating.
 * Transient errors are likely temporary (network, rate-limit) and should NOT
 * trigger repair — the cron will retry naturally.
 */
function classifyError(sourceId: string, errorMsg: string): FailureCategory {
  const lower = errorMsg.toLowerCase();

  // ── Structural: script produced no data (page structure changed) ──
  if (
    lower.includes('未返回任何数据') ||
    lower.includes('zero items') ||
    lower.includes('no items') ||
    lower.includes('items.length === 0') ||
    lower.includes('返回 0 条')
  ) {
    return 'structural';
  }

  // ── Structural: parse / extraction failure ──
  if (
    lower.includes('undefined is not') ||
    lower.includes('cannot read propert') ||
    lower.includes('is not a function') ||
    lower.includes('typeerror') ||
    lower.includes('syntax error') ||
    lower.includes('syntaxerror') ||
    lower.includes('unexpected token') ||
    lower.includes('invalid regex')
  ) {
    return 'structural';
  }

  // ── Structural: sandbox timeout (script got stuck on changed DOM) ──
  if (lower.includes('timed out') || lower.includes('script execution timed out')) {
    return 'structural';
  }

  // ── Transient: network / HTTP errors ──
  if (
    lower.includes('fetch') && (
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('econnreset') ||
      lower.includes('timeout') ||
      lower.includes('status 429') ||
      lower.includes('status 502') ||
      lower.includes('status 503') ||
      lower.includes('status 504') ||
      lower.includes('rate limit')
    )
  ) {
    return 'transient';
  }

  // ── Transient: sandbox unavailable ──
  if (lower.includes('isolated-vm native module')) {
    return 'transient';
  }

  // ── Unknown: default to NOT attempting repair (safety first) ──
  return 'unknown';
}

export async function attemptAutoRepair(
  sourceId: string,
  errorMsg: string
): Promise<{ repaired: boolean; message: string }> {
  // ── Guard: only one auto-repair per source at a time ──
  if (repairingSet.has(sourceId)) {
    return { repaired: false, message: 'Auto-repair already in progress for this source' };
  }

  // ── Classify the error ──
  const category = classifyError(sourceId, errorMsg);
  if (category !== 'structural') {
    console.log(
      `[AutoRepair] source=${sourceId} error category=${category} — skipping auto-repair: ${errorMsg.slice(0, 120)}`
    );
    return { repaired: false, message: `Error category is ${category}, not suitable for auto-repair` };
  }

  repairingSet.add(sourceId);

  try {
    const db = getDb();

    // Re-read the source to get the latest state (script may have been updated)
    const source = (await db.select().from(sources).where(eq(sources.id, sourceId)))[0];
    if (!source) {
      return { repaired: false, message: 'Source not found' };
    }

    // Don't repair if source was manually disabled or deleted
    if (source.status === 'disabled' || !source.isEnabled) {
      return { repaired: false, message: 'Source is disabled' };
    }

    // Don't repair if there's no script (never generated)
    if (!source.script || source.script.trim() === '') {
      return { repaired: false, message: 'Source has no script to repair' };
    }

    console.log(`[AutoRepair] source=${sourceId} (${source.title}) — attempting AI repair...`);

    await writeCollectionLog(
      sourceId,
      'warn',
      'auto_repair_started',
      `Auto-repair started for "${source.title}": ${errorMsg.slice(0, 200)}`,
      { errorMessage: errorMsg }
    );

    // ── Run the AI repair agent ──
    const { repairScriptAgent } = await import('@/lib/ai/agents/repairScriptAgent');

    const repairResult = await repairScriptAgent(
      {
        url: source.url,
        script: source.script,
        lastError: errorMsg,
      },
      (msg) => {
        console.log(`[AutoRepair] source=${sourceId} progress: ${msg}`);
      }
    );

    if (!repairResult.success || !repairResult.script) {
      const reason = repairResult.reason ?? 'Unknown';
      console.log(`[AutoRepair] source=${sourceId} repair failed: ${reason}`);

      await writeCollectionLog(
        sourceId,
        'error',
        'auto_repair_failed',
        `Auto-repair failed: ${reason}`,
        { errorMessage: errorMsg, repairAttempted: true }
      );

      // Create a notification so the admin knows manual intervention is needed
      const subscription = (await db
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(eq(subscriptions.id, source.subscriptionId)))[0];

      if (subscription) {
        await db.insert(notifications).values({
          type: 'source_failed',
          title: `自动修复失败：${source.title}`,
          body: `AI 尝试修复脚本但未成功（${reason.slice(0, 200)}），请手动修复。`,
          isRead: false,
          subscriptionId: subscription.id,
          relatedEntityType: 'source',
          relatedEntityId: source.id,
          createdAt: new Date(),
        });
      }

      return { repaired: false, message: `Repair failed: ${reason}` };
    }

    // ── Repair succeeded — auto-apply the new script ──
    console.log(`[AutoRepair] source=${sourceId} repair succeeded — applying new script`);

    const now = new Date();
    const normalNextRun = nextCronDate(source.cronExpression);
    await db.update(sources)
      .set({
        script: repairResult.script,
        status: 'active',
        lastError: null,
        lastRunSuccess: null, // reset — next cron will re-evaluate
        nextRunAt: normalNextRun, // restore normal schedule
        updatedAt: now,
      })
      .where(eq(sources.id, sourceId));

    // Clear in-memory retry state
    clearRetry(sourceId);

    // Re-schedule the source with its original cron
    const updatedSource = (await db.select().from(sources).where(eq(sources.id, sourceId)))[0];
    if (updatedSource) {
      jobManager.scheduleSource(updatedSource);
    }

    await writeCollectionLog(
      sourceId,
      'success',
      'auto_repair_succeeded',
      `Auto-repair succeeded for "${source.title}" — new script applied`,
      { repaired: true }
    );

    // Notify admin
    const subscription = (await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.id, source.subscriptionId)))[0];

    if (subscription) {
      await db.insert(notifications).values({
        type: 'source_fixed',
        title: `自动修复成功：${source.title}`,
        body: 'AI 已自动修复采集脚本，订阅源已恢复正常。',
        isRead: false,
        subscriptionId: subscription.id,
        relatedEntityType: 'source',
        relatedEntityId: source.id,
        createdAt: now,
      });
    }

    return { repaired: true, message: 'Script repaired and applied' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AutoRepair] source=${sourceId} unexpected error:`, err);

    await writeCollectionLog(sourceId, 'error', 'auto_repair_error',
      `Auto-repair threw unexpected error: ${msg}`,
      { errorMessage: errorMsg }
    );

    return { repaired: false, message: `Unexpected error: ${msg}` };
  } finally {
    repairingSet.delete(sourceId);
  }
}
