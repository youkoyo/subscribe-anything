/**
 * Managed subscription creation pipeline.
 *
 * Runs asynchronously (fire-and-forget) after creating a placeholder subscription.
 * Phases:
 *   1. find_sources  — call findSourcesAgent (only if startStep === 'find_sources')
 *   2. generate_script — materialize built-in collectors and generate only feed scripts
 *   3. complete      — call createSourcesForSubscription, mark subscription active
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { subscriptions, managedBuildLogs } from '@/lib/db/schema';
import { createSourcesForSubscription } from '@/lib/subscriptionCreator';
import { createId } from '@paralleldrive/cuid2';
import pLimit from 'p-limit';
import { upsertLLMCall, clearLLMCalls } from './llmCallStore';
import { articleCandidateFromCollectedItem } from '@/lib/collection/ingestArticles';
import { validateArticleCandidate } from '@/lib/collection/articleValidator';
import {
  generationLogFromOutcome,
  isReusableGeneratedSource,
  latestGenerationLogForSource,
  requiresScriptGeneration,
  restoreGeneratedSourceFromSuccessPayload,
  runHybridGeneration,
  type GenerationSuccessPayload,
  type HybridGenerationOutcome,
} from '@/lib/collection/hybridGeneration';
import { buildMonitoringIntent } from '@/lib/search/queryPlan';
import type { IndustryConfigSnapshot } from '@/lib/industry-configs/types';
import type { FoundSource, GeneratedSource } from '@/types/wizard';

// In-memory set of "subscriptionId:sourceUrl" keys that have been manually aborted.
export const abortedSourceKeys = new Set<string>();

// In-memory map of "subscriptionId:sourceUrl" → AbortController for running source generation tasks.
// Used to truly cancel LLM calls when a source is aborted or managed pipeline takes over.
const sourceAbortControllers = new Map<string, AbortController>();

/**
 * Abort a specific source generation: add to abortedSourceKeys, trigger AbortController,
 * and write an error log. This actually cancels the running LLM call.
 */
export function abortSource(subscriptionId: string, sourceUrl: string): void {
  const key = `${subscriptionId}:${sourceUrl}`;
  abortedSourceKeys.add(key);
  // Trigger the AbortController to cancel the running LLM call
  const controller = sourceAbortControllers.get(key);
  if (controller) {
    controller.abort();
    sourceAbortControllers.delete(key);
  }
  writeLog(subscriptionId, 'generate_script', 'error', '已手动中断', { sourceUrl });
}

/**
 * Abort ALL running source generation tasks for a subscription.
 * Called when managed pipeline takes over from run-step tasks.
 * Does NOT write error logs — the managed pipeline will handle these sources.
 */
export function abortAllSources(subscriptionId: string): void {
  const prefix = `${subscriptionId}:`;
  for (const [key, controller] of sourceAbortControllers) {
    if (key.startsWith(prefix)) {
      abortedSourceKeys.add(key);
      controller.abort();
      sourceAbortControllers.delete(key);
    }
  }
}

/**
 * Register an AbortController for a source generation task.
 * Returns the AbortSignal to pass to generateScriptAgent.
 */
export function registerSourceAbort(subscriptionId: string, sourceUrl: string): AbortSignal {
  const key = `${subscriptionId}:${sourceUrl}`;
  // Abort any existing controller for this source (e.g. from a previous attempt)
  const existing = sourceAbortControllers.get(key);
  if (existing) existing.abort();
  const controller = new AbortController();
  sourceAbortControllers.set(key, controller);
  // Clean up the aborted flag so retries work
  abortedSourceKeys.delete(key);
  return controller.signal;
}

/**
 * Unregister the AbortController for a source (task finished normally).
 */
export function unregisterSourceAbort(subscriptionId: string, sourceUrl: string): void {
  sourceAbortControllers.delete(`${subscriptionId}:${sourceUrl}`);
}

/** Check if an error is an abort-related error (standard AbortError or OpenAI SDK abort). */
function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  // OpenAI SDK wraps abort as APIUserAbortError or includes "aborted" in the message
  if (err.name === 'APIUserAbortError') return true;
  if (err.message.toLowerCase().includes('abort')) return true;
  return false;
}

export type ManagedStartStep = 'find_sources' | 'generate_scripts' | 'complete';

export interface ManagedPayload {
  topic: string;
  criteria?: string;
  startStep: ManagedStartStep;
  userId: string;
  industryConfigId?: string | null;
  industryConfigSnapshot?: IndustryConfigSnapshot | null;
  foundSources?: FoundSource[];
  /** All discovered sources (for display); foundSources is the selected subset for generation */
  allFoundSources?: FoundSource[];
  generatedSources?: GeneratedSource[];
}

type LogLevel = 'info' | 'progress' | 'success' | 'error';
type LogStep = 'find_sources' | 'generate_script' | 'complete';

export async function writeLog(
  subscriptionId: string,
  step: LogStep,
  level: LogLevel,
  message: string,
  payload?: unknown
): Promise<void> {
  try {
    const db = getDb();
    await db.insert(managedBuildLogs)
      .values({
        id: createId(),
        subscriptionId,
        step,
        level,
        message,
        payload: payload !== undefined ? JSON.stringify(payload) : null,
        createdAt: new Date(),
      });
  } catch (err) {
    // Silently ignore foreign key constraint errors — subscription was deleted
    if (err && typeof err === 'object' && 'code' in err && err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return;
    }
    console.error('[managed pipeline] Failed to write log:', err);
  }
}

async function isCancelled(subscriptionId: string): Promise<boolean> {
  try {
    const db = getDb();
    const row = (await db
      .select({ managedStatus: subscriptions.managedStatus })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId)))[0];
    // Allow both 'managed_creating' and 'manual_creating' to continue.
    // Only cancel when: null (complete), 'failed', or subscription deleted.
    return !row || row.managedStatus === null || row.managedStatus === 'failed';
  } catch {
    return true;
  }
}

/**
 * Check if the pipeline should automatically advance to the next phase.
 * Only auto-advance in managed mode ('managed_creating').
 * In manual mode ('manual_creating'), tasks run to completion but pipeline stops between phases.
 */
async function shouldAutoAdvance(subscriptionId: string): Promise<boolean> {
  try {
    const db = getDb();
    const row = (await db
      .select({ managedStatus: subscriptions.managedStatus })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId)))[0];
    return row?.managedStatus === 'managed_creating';
  } catch {
    return false;
  }
}

// ── Exported step functions (no isCancelled checks — run to completion) ──────

async function discoverSourcesForSubscription(
  subscriptionId: string,
  topic: string,
  criteria: string | undefined,
  userId: string,
) {
  const { findSourcesAgent } = await import('@/lib/ai/agents/findSourcesAgent');
  const pendingProgressLogs: Promise<void>[] = [];
  let sourceAudit: unknown[] | undefined;

  try {
    return await findSourcesAgent(
      { topic, criteria },
      (event: unknown) => {
        const e = event as Record<string, unknown>;
        if (e.type === 'tool_call' && e.name === 'webSearch') {
          const args = e.args as { query: string };
          pendingProgressLogs.push(
            writeLog(subscriptionId, 'find_sources', 'progress', `搜索：${args.query}`),
          );
        }
        if (e.type === 'source_audit' && Array.isArray(e.records)) {
          sourceAudit = e.records;
        }
      },
      (info) => upsertLLMCall(subscriptionId, info),
      userId,
    );
  } finally {
    await Promise.allSettled(pendingProgressLogs);
    if (sourceAudit) {
      await writeLog(subscriptionId, 'find_sources', 'info', 'AI_SOURCE_AUDIT', sourceAudit);
    }
  }
}

async function writeGenerationOutcome(
  subscriptionId: string,
  outcome: HybridGenerationOutcome,
) {
  const log = generationLogFromOutcome(outcome);
  const { source, generatedSource } = outcome;
  const message = outcome.status === 'failed'
    ? `"${source.title}" 生成失败：${outcome.error ?? '未知错误'}`
    : outcome.generatedBy === 'collector'
      ? `"${source.title}" 采集方案验证通过，已有 ${generatedSource.initialItems.length} 条样本`
      : outcome.status === 'unverified'
        ? `"${source.title}" 脚本已生成（未验证）`
        : `"${source.title}" 脚本生成成功，采集到 ${generatedSource.initialItems.length} 条数据`;
  await writeLog(subscriptionId, 'generate_script', log.level, message, log.payload);
}

/**
 * Run the find_sources step for a subscription.
 * Writes logs to DB; runs to completion unless subscription is deleted.
 */
export async function runFindSourcesStep(
  subscriptionId: string,
  topic: string,
  criteria: string | undefined,
  userId: string
): Promise<void> {
  await writeLog(subscriptionId, 'find_sources', 'info', '开始发现数据源...');

  try {
    const discovered = await discoverSourcesForSubscription(
      subscriptionId,
      topic,
      criteria,
      userId,
    );
    // Write success log with all discovered sources (for reference)
    await writeLog(subscriptionId, 'find_sources', 'success', `发现 ${discovered.length} 个数据源`, discovered);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await writeLog(subscriptionId, 'find_sources', 'error', `发现数据源失败：${msg}`);
  }
}

/**
 * Run the generate_scripts step for a subscription.
 * Skips sources that already have a success log.
 * Materializes validated built-in collectors and runs feed scripts in parallel (up to 5 concurrent).
 * Writes logs to DB; runs to completion unless subscription is deleted or source is aborted.
 */
export async function runGenerateScriptsStep(
  subscriptionId: string,
  sources: FoundSource[],
  criteria: string | undefined,
  userId: string
): Promise<void> {
  if (sources.length === 0) {
    writeLog(subscriptionId, 'generate_script', 'error', '没有可用的数据源，跳过脚本生成');
    return;
  }

  writeLog(subscriptionId, 'generate_script', 'info', `开始为 ${sources.length} 个数据源生成脚本...`);

  // Reuse only successful logs whose saved sample still meets the current
  // freshness and relevance gate. Old "non-empty" successes must be rerun.
  const completedUrls = await getCompletedSourceUrls(subscriptionId, sources, criteria);
  const limit = pLimit(5);

  const tasks = sources
    .filter((source) => !completedUrls.has(source.url))
    .map((source) =>
      limit(async () => {
        if (!requiresScriptGeneration(source)) {
          const [outcome] = await runHybridGeneration(
            [source],
            criteria,
            async () => {
              throw new Error('Built-in collectors must not invoke script generation');
            },
          );
          await writeGenerationOutcome(subscriptionId, outcome);
          return;
        }

        const abortKey = `${subscriptionId}:${source.url}`;
        if (abortedSourceKeys.has(abortKey)) return;

        const signal = registerSourceAbort(subscriptionId, source.url);

        writeLog(subscriptionId, 'generate_script', 'info', `正在为 "${source.title}" 生成脚本...`, { sourceUrl: source.url });

        try {
          const { generateScriptAgent } = await import('@/lib/ai/agents/generateScriptAgent');
          const result = await generateScriptAgent(
            {
              title: source.title,
              url: source.url,
              description: source.description,
              criteria,
            },
            (msg: string) => {
              if (abortedSourceKeys.has(abortKey)) return;
              writeLog(subscriptionId, 'generate_script', 'progress', `[${source.title}] ${msg}`, { sourceUrl: source.url });
            },
            (info) => upsertLLMCall(subscriptionId, { ...info, sourceUrl: source.url }),
            userId,
            signal
          );

          unregisterSourceAbort(subscriptionId, source.url);

          // If aborted while agent was running, don't overwrite the abort error log
          if (abortedSourceKeys.has(abortKey)) return;

          if (result.success && result.script) {
            writeLog(
              subscriptionId,
              'generate_script',
              'success',
              `"${source.title}" 脚本生成成功，采集到 ${result.initialItems?.length ?? 0} 条数据`,
              {
                sourceUrl: source.url,
                script: result.script,
                cronExpression: result.cronExpression,
                initialItems: result.initialItems ?? [],
              }
            );
          } else if (result.sandboxUnavailable && result.script) {
            writeLog(
              subscriptionId,
              'generate_script',
              'success',
              `"${source.title}" 脚本已生成（未验证）`,
              {
                sourceUrl: source.url,
                script: result.script,
                cronExpression: result.cronExpression,
                initialItems: [],
                unverified: true,
              }
            );
          } else {
            writeLog(subscriptionId, 'generate_script', 'error', `"${source.title}" 脚本生成失败：${result.error ?? '未知错误'}`, { sourceUrl: source.url, script: result.script });
          }
        } catch (err) {
          unregisterSourceAbort(subscriptionId, source.url);
          if (abortedSourceKeys.has(abortKey)) return;
          // AbortError from signal — already handled by abortSource writing the error log
          if (isAbortError(err)) return;
          const msg = err instanceof Error ? err.message : String(err);
          writeLog(subscriptionId, 'generate_script', 'error', `"${source.title}" 脚本生成出错：${msg}`, { sourceUrl: source.url });
        }
      })
    );

  await Promise.all(tasks);
}

/**
 * Retry generating a single source script.
 * Clears old logs for this sourceUrl before starting.
 */
export async function retryGenerateSourceStep(
  subscriptionId: string,
  source: FoundSource,
  criteria: string | undefined,
  userId: string,
  userPrompt?: string
): Promise<void> {
  if (!requiresScriptGeneration(source)) {
    throw new Error('Built-in collectors do not generate or retry JavaScript');
  }
  const signal = registerSourceAbort(subscriptionId, source.url);

  writeLog(subscriptionId, 'generate_script', 'info', `正在为 "${source.title}" 重新生成脚本...`, { sourceUrl: source.url });

  try {
    const { generateScriptAgent } = await import('@/lib/ai/agents/generateScriptAgent');

    const result = await generateScriptAgent(
      {
        title: source.title,
        url: source.url,
        description: source.description,
        criteria,
        userPrompt: userPrompt?.trim() || undefined,
      },
      (msg: string) => {
        writeLog(subscriptionId, 'generate_script', 'progress', `[${source.title}] ${msg}`, { sourceUrl: source.url });
      },
      (info) => upsertLLMCall(subscriptionId, { ...info, sourceUrl: source.url }),
      userId,
      signal
    );

    unregisterSourceAbort(subscriptionId, source.url);

    if (result.success && result.script) {
      writeLog(
        subscriptionId,
        'generate_script',
        'success',
        `"${source.title}" 脚本生成成功，采集到 ${result.initialItems?.length ?? 0} 条数据`,
        {
          sourceUrl: source.url,
          script: result.script,
          cronExpression: result.cronExpression,
          initialItems: result.initialItems ?? [],
        }
      );
    } else if (result.sandboxUnavailable && result.script) {
      writeLog(
        subscriptionId,
        'generate_script',
        'success',
        `"${source.title}" 脚本已生成（未验证）`,
        {
          sourceUrl: source.url,
          script: result.script,
          cronExpression: result.cronExpression,
          initialItems: [],
          unverified: true,
        }
      );
    } else {
      writeLog(subscriptionId, 'generate_script', 'error', `"${source.title}" 脚本生成失败：${result.error ?? '未知错误'}`, { sourceUrl: source.url });
    }
  } catch (err) {
    unregisterSourceAbort(subscriptionId, source.url);
    const abortKey = `${subscriptionId}:${source.url}`;
    if (abortedSourceKeys.has(abortKey)) return;
    if (isAbortError(err)) return;
    const msg = err instanceof Error ? err.message : String(err);
    writeLog(subscriptionId, 'generate_script', 'error', `"${source.title}" 脚本生成出错：${msg}`, { sourceUrl: source.url });
  }
}

/** Delete all generate_script logs for a specific sourceUrl */
export async function deleteSourceLogs(subscriptionId: string, sourceUrl: string): Promise<void> {
  try {
    const db = getDb();
    const allLogs = (await db
      .select({ id: managedBuildLogs.id, payload: managedBuildLogs.payload })
      .from(managedBuildLogs)
      .where(
        and(
          eq(managedBuildLogs.subscriptionId, subscriptionId),
          eq(managedBuildLogs.step, 'generate_script')
        )
      ));

    const idsToDelete = allLogs
      .filter((l) => {
        if (!l.payload) return false;
        try {
          const p = JSON.parse(l.payload) as { sourceUrl?: string };
          return p.sourceUrl === sourceUrl;
        } catch {
          return false;
        }
      })
      .map((l) => l.id);

    if (idsToDelete.length > 0) {
      await db.delete(managedBuildLogs)
        .where(inArray(managedBuildLogs.id, idsToDelete));
    }
  } catch (err) {
    console.error('[managed pipeline] Failed to delete source logs:', err);
  }
}

async function getCompletedSourceUrls(
  subscriptionId: string,
  sourcesToCheck: FoundSource[],
  criteria: string | undefined,
): Promise<Set<string>> {
  try {
    const db = getDb();
    const logs = (await db
      .select({ level: managedBuildLogs.level, payload: managedBuildLogs.payload })
      .from(managedBuildLogs)
      .where(
        and(
          eq(managedBuildLogs.subscriptionId, subscriptionId),
          eq(managedBuildLogs.step, 'generate_script')
        )
      )
      .orderBy(desc(managedBuildLogs.createdAt)));

    const completedUrls = new Set<string>();
    for (const source of sourcesToCheck) {
      const latest = latestGenerationLogForSource(logs, source.url);
      if (
        latest?.level === 'success'
        && restoreGeneratedSourceFromSuccessPayload(source, latest.payload, criteria)
      ) {
        completedUrls.add(source.url);
      }
    }
    return completedUrls;
  } catch {
    return new Set();
  }
}

// ── wizardStateJson persistence helper ───────────────────────────────────────

/**
 * Update the wizardStateJson column for a subscription so that managed-takeover
 * can read the latest pipeline progress directly without parsing logs.
 */
async function updateWizardState(
  subscriptionId: string,
  patch: Record<string, unknown>
) {
  try {
    const db = getDb();
    const row = (await db
      .select({ wizardStateJson: subscriptions.wizardStateJson })
      .from(subscriptions)
      .where(eq(subscriptions.id, subscriptionId)))[0];
    const current = row?.wizardStateJson ? JSON.parse(row.wizardStateJson) : {};
    const merged = { ...current, ...patch };
    await db.update(subscriptions)
      .set({ wizardStateJson: JSON.stringify(merged), updatedAt: new Date() })
      .where(eq(subscriptions.id, subscriptionId));
  } catch (err) {
    console.error('[managed pipeline] Failed to update wizardState:', err);
  }
}

// ── Full managed pipeline (used by "后台托管创建" button) ─────────────────────

/**
 * Wait for an already-running find_sources step to complete.
 * Returns discovered sources (from success log payload) or null on error/timeout/cancel.
 */
async function waitForFindSourcesResult(
  subscriptionId: string,
  topic: string,
  criteria: string | undefined,
  isCancelledFn: () => boolean | Promise<boolean>,
  maxWaitMs = 5 * 60 * 1000
): Promise<FoundSource[] | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await isCancelledFn()) return null;
    const db = getDb();
    const successLog = (await db
      .select({ payload: managedBuildLogs.payload })
      .from(managedBuildLogs)
      .where(
        and(
          eq(managedBuildLogs.subscriptionId, subscriptionId),
          eq(managedBuildLogs.step, 'find_sources'),
          eq(managedBuildLogs.level, 'success')
        )
      )
      .orderBy(desc(managedBuildLogs.createdAt))
      .limit(1))[0];
    const discovered = parseValidatedDiscoveryPayload(successLog?.payload, topic, criteria);
    if (discovered) return discovered;
    const errorLog = (await db
      .select({ id: managedBuildLogs.id })
      .from(managedBuildLogs)
      .where(
        and(
          eq(managedBuildLogs.subscriptionId, subscriptionId),
          eq(managedBuildLogs.step, 'find_sources'),
          eq(managedBuildLogs.level, 'error')
        )
      ))[0];
    if (errorLog) return null;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

export function isValidatedDiscoverySource(source: unknown): source is FoundSource {
  if (!source || typeof source !== 'object') return false;
  const candidate = source as FoundSource;
  if (candidate.discoveryVersion !== 1) return false;
  if (!candidate.collectionMode || !Array.isArray(candidate.initialItems) || candidate.initialItems.length === 0) {
    return false;
  }
  return candidate.collectionMode !== 'search'
    || !!candidate.searchPlan?.queries?.length;
}

export function isReusableDiscoverySource(
  source: unknown,
  topic: string,
  criteria: string | undefined,
  now = new Date(),
): source is FoundSource {
  if (!isValidatedDiscoverySource(source)) return false;
  const normalizedCriteria = criteria?.trim() === '全部' ? '' : criteria ?? '';
  const intent = buildMonitoringIntent(topic, normalizedCriteria);
  const origin = source.collectionMode === 'search' ? 'search' : 'feed';
  return source.initialItems!.some((item) => (
    validateArticleCandidate(
      articleCandidateFromCollectedItem(item, origin),
      intent,
      now,
    ).accepted
  ));
}

function parseValidatedDiscoveryPayload(
  payload: string | null | undefined,
  topic: string,
  criteria: string | undefined,
  now = new Date(),
) {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as unknown;
    return Array.isArray(parsed)
      && parsed.length > 0
      && parsed.every((source) => isReusableDiscoverySource(source, topic, criteria, now))
      ? parsed as FoundSource[]
      : null;
  } catch {
    return null;
  }
}

/** Auto-select up to five sources while reserving the first slot for search. */
export function autoSelectSources(discovered: FoundSource[]): FoundSource[] {
  const search = discovered.find((source) => source.collectionMode === 'search');
  const stable = discovered.filter((source) => source !== search);
  const recommended = stable.filter((source) => source.recommended);
  const notRecommended = stable.filter((source) => !source.recommended);
  return [
    ...(search ? [search] : []),
    ...recommended,
    ...notRecommended,
  ].slice(0, 5);
}

/** Map client-selected URLs back to the server-validated discovery objects. */
export function selectRequestedDiscoverySources(
  discovered: FoundSource[],
  requested: FoundSource[] | undefined,
) {
  if (!requested?.length) return autoSelectSources(discovered);
  const requestedUrls = new Set(requested.map((source) => source.url));
  const canonicalSelection = discovered.filter((source) => requestedUrls.has(source.url));
  return canonicalSelection.length > 0
    ? canonicalSelection.slice(0, 5)
    : autoSelectSources(discovered);
}

/**
 * Read the latest generate_script result for a specific source from build logs.
 * Returns the GeneratedSource if found, null otherwise.
 */
async function getSourceResultFromLogs(
  subscriptionId: string,
  source: FoundSource,
  criteria: string | undefined
): Promise<GeneratedSource | null> {
  try {
    const db = getDb();
    const logs = (await db
      .select({ level: managedBuildLogs.level, payload: managedBuildLogs.payload })
      .from(managedBuildLogs)
      .where(
        and(
          eq(managedBuildLogs.subscriptionId, subscriptionId),
          eq(managedBuildLogs.step, 'generate_script'),
        )
      )
      .orderBy(desc(managedBuildLogs.createdAt)));

    const latest = latestGenerationLogForSource(logs, source.url);
    if (latest?.level === 'success') {
      return restoreGeneratedSourceFromSuccessPayload(source, latest.payload, criteria);
    }
    if (latest?.level !== 'error') return null;
    return {
      title: source.title,
      url: source.url,
      description: source.description,
      script: latest.payload.script ?? '',
      cronExpression: '0 * * * *',
      initialItems: [],
      isEnabled: false,
      failedReason: '生成失败',
      collectionMode: source.collectionMode,
      searchPlan: source.searchPlan,
      collectorConfigJson: source.collectorConfigJson,
      discoveryVersion: source.discoveryVersion,
    };
  } catch {
    return null;
  }
}

/**
 * Wait for an already-running source generation task to complete.
 * Polls DB logs until a success or error log appears for the source.
 */
async function waitForSourceResult(
  subscriptionId: string,
  source: FoundSource,
  criteria: string | undefined,
  maxWaitMs = 10 * 60 * 1000
): Promise<GeneratedSource | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await getSourceResultFromLogs(subscriptionId, source, criteria);
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return null;
}

export async function runManagedPipeline(
  subscriptionId: string,
  payload: ManagedPayload
): Promise<void> {
  const { topic, criteria, startStep, userId, foundSources: initialFoundSources, allFoundSources: initialAllFoundSources, generatedSources: initialGeneratedSources } = payload;

  try {
    // A find_sources run must re-establish server-side validation. Client data
    // is used only as a requested URL selection after canonical discovery.
    let foundSources: FoundSource[] = startStep === 'find_sources'
      ? []
      : initialFoundSources ?? [];
    // allFoundSources: full discovered list for display (superset of foundSources)
    let allFoundSources: FoundSource[] = startStep === 'find_sources'
      ? []
      : initialAllFoundSources ?? initialFoundSources ?? [];
    const reusableInitialGeneratedSources = (initialGeneratedSources ?? []).filter((source) =>
      isReusableGeneratedSource(source, criteria)
    );
    let generatedSources: GeneratedSource[] = reusableInitialGeneratedSources;

    // ── Phase 1: find_sources ─────────────────────────────────────────────────
    if (startStep === 'find_sources') {
      if (await isCancelled(subscriptionId)) return;

      // Check if find_sources already has results in DB (another task may be running or done)
      const db = getDb();
      const existingSuccess = (await db
        .select({ payload: managedBuildLogs.payload })
        .from(managedBuildLogs)
        .where(
          and(
            eq(managedBuildLogs.subscriptionId, subscriptionId),
            eq(managedBuildLogs.step, 'find_sources'),
            eq(managedBuildLogs.level, 'success')
          )
        )
        .orderBy(desc(managedBuildLogs.createdAt))
        .limit(1))[0];
      const existingDiscovered = parseValidatedDiscoveryPayload(
        existingSuccess?.payload,
        topic,
        criteria,
      );

      if (existingDiscovered) {
        // Already completed — reuse results
        allFoundSources = existingDiscovered;
        foundSources = selectRequestedDiscoverySources(existingDiscovered, initialFoundSources);
        if (initialFoundSources?.length) {
          await writeLog(
            subscriptionId,
            'find_sources',
            'info',
            `使用已验证的 ${foundSources.length} 个已选择数据源`,
            foundSources,
          );
        }
        // Persist Phase 1 result into wizardStateJson
        const selectedUrls1 = new Set(foundSources.map((s) => s.url));
        await updateWizardState(subscriptionId, {
          step: 3,
          foundSources: allFoundSources,
          selectedIndices: allFoundSources
            .map((s: FoundSource, i: number) => selectedUrls1.has(s.url) ? i : -1)
            .filter((i: number) => i >= 0),
          generatedSources: [],
        });
      } else {
        // Check if a find_sources task is already in progress
        const existingInfo = existingSuccess?.payload ? undefined : (await db
          .select({ id: managedBuildLogs.id })
          .from(managedBuildLogs)
          .where(
            and(
              eq(managedBuildLogs.subscriptionId, subscriptionId),
              eq(managedBuildLogs.step, 'find_sources'),
              eq(managedBuildLogs.level, 'info')
            )
          ))[0];

        if (existingInfo) {
          // Task is in progress — wait for it to finish
          writeLog(subscriptionId, 'find_sources', 'info', '等待数据源发现任务完成...');
          const discovered = await waitForFindSourcesResult(
            subscriptionId,
            topic,
            criteria,
            () => isCancelled(subscriptionId),
          );
          if (await isCancelled(subscriptionId)) return;
          if (discovered) {
            allFoundSources = discovered;
            foundSources = selectRequestedDiscoverySources(discovered, initialFoundSources);
            if (initialFoundSources?.length) {
              await writeLog(
                subscriptionId,
                'find_sources',
                'info',
                `使用已验证的 ${foundSources.length} 个已选择数据源`,
                foundSources,
              );
            }
            // Persist Phase 1 result into wizardStateJson
            const selectedUrls2 = new Set(foundSources.map((s) => s.url));
            await updateWizardState(subscriptionId, {
              step: 3,
              foundSources: allFoundSources,
              selectedIndices: allFoundSources
                .map((s: FoundSource, i: number) => selectedUrls2.has(s.url) ? i : -1)
                .filter((i: number) => i >= 0),
              generatedSources: [],
            });
          }
          // If wait failed/timed out, fall through to run from scratch below
        }

        if (foundSources.length === 0 && !(await isCancelled(subscriptionId))) {
          // No existing results or previous attempt failed — run from scratch
          await writeLog(subscriptionId, 'find_sources', 'info', '开始发现数据源...');

          try {
            const discovered = await discoverSourcesForSubscription(
              subscriptionId,
              topic,
              criteria,
              userId,
            );

            const selected = selectRequestedDiscoverySources(discovered, initialFoundSources);
            foundSources = selected;
            allFoundSources = discovered;

            // Always write sources log — even if cancelled (watch mode needs to see results)
            await writeLog(subscriptionId, 'find_sources', 'success', `发现 ${discovered.length} 个数据源`, discovered);
            // Persist Phase 1 result into wizardStateJson
            const selectedUrls3 = new Set(selected.map((s) => s.url));
            await updateWizardState(subscriptionId, {
              step: 3,
              foundSources: discovered,
              selectedIndices: discovered
                .map((s: FoundSource, i: number) => selectedUrls3.has(s.url) ? i : -1)
                .filter((i: number) => i >= 0),
              generatedSources: [],
            });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await writeLog(subscriptionId, 'find_sources', 'error', `发现数据源失败：${msg}`);
            markFailed(subscriptionId, `发现数据源失败：${msg}`);
            return;
          }
        }
      }
    }

    // ── Phase 2: generate_scripts ─────────────────────────────────────────────
    if (startStep !== 'complete') {
      // Between phases: check if we should auto-advance (only in managed mode)
      if (startStep === 'find_sources' && !(await shouldAutoAdvance(subscriptionId))) return;
      if (await isCancelled(subscriptionId)) return;

      // Clear old LLM calls from Phase 1 (find_sources has no sourceUrl, would clutter the store)
      clearLLMCalls(subscriptionId);

      // Phase 1 has already mapped client-selected URLs back to canonical,
      // server-validated objects. Never reintroduce the raw client payload here.
      const sourcesToProcess = foundSources;

      // Skip sources already provided in initialGeneratedSources (wizard handoff)
      const alreadyDoneUrls = new Set(reusableInitialGeneratedSources.map((s) => s.url));
      // Seed generatedSources with already-completed ones so phase 3 can create them
      for (const done of reusableInitialGeneratedSources) {
        if (!generatedSources.some((gs) => gs.url === done.url)) {
          generatedSources.push(done);
        }
      }

      if (sourcesToProcess.length === 0) {
        writeLog(subscriptionId, 'generate_script', 'error', '没有可用的数据源，跳过脚本生成');
      } else {
        const pendingSources = sourcesToProcess.filter((s) => !alreadyDoneUrls.has(s.url));
        if (pendingSources.length > 0) {
          writeLog(subscriptionId, 'generate_script', 'info', `开始为 ${pendingSources.length} 个数据源生成脚本...`);
        }

        const limit = pLimit(5);

        const pipelineTasks = sourcesToProcess
          .filter((source) => !alreadyDoneUrls.has(source.url))
          .map((source) =>
            limit(async () => {
              if (await isCancelled(subscriptionId)) return;

              const key = `${subscriptionId}:${source.url}`;
              const needsScript = requiresScriptGeneration(source);

              // Check if a task is already running for this source (from manual step)
              if (needsScript && sourceAbortControllers.has(key)) {
                await writeLog(subscriptionId, 'generate_script', 'info', `等待 "${source.title}" 已有任务完成...`, { sourceUrl: source.url });
                const result = await waitForSourceResult(subscriptionId, source, criteria);
                if (result) {
                  generatedSources.push(result);
                }
                return;
              }

              // Check if already completed in DB logs (from a previous run)
              const existingResult = await getSourceResultFromLogs(subscriptionId, source, criteria);
              if (existingResult) {
                generatedSources.push(existingResult);
                return;
              }

              const signal = needsScript
                ? registerSourceAbort(subscriptionId, source.url)
                : undefined;
              await writeLog(
                subscriptionId,
                'generate_script',
                'info',
                needsScript
                  ? `正在为 "${source.title}" 生成脚本...`
                  : `正在确认 "${source.title}" 的内置采集方案...`,
                { sourceUrl: source.url },
              );

              const [outcome] = await runHybridGeneration(
                [source],
                criteria,
                async () => {
                  const { generateScriptAgent } = await import('@/lib/ai/agents/generateScriptAgent');
                  return generateScriptAgent(
                    {
                      title: source.title,
                      url: source.url,
                      description: source.description,
                      criteria,
                    },
                    (msg: string) => {
                      if (abortedSourceKeys.has(key)) return;
                      writeLog(subscriptionId, 'generate_script', 'progress', `[${source.title}] ${msg}`, { sourceUrl: source.url });
                    },
                    (info) => upsertLLMCall(subscriptionId, { ...info, sourceUrl: source.url }),
                    userId,
                    signal,
                  );
                },
              );

              if (signal) unregisterSourceAbort(subscriptionId, source.url);
              if (await isCancelled(subscriptionId)) return;
              if (abortedSourceKeys.has(key) || isAbortError(outcome.cause)) return;

              generatedSources.push(outcome.generatedSource);
              await writeGenerationOutcome(subscriptionId, outcome);
            })
          );

        await Promise.all(pipelineTasks);
        const sourceOrder = new Map(sourcesToProcess.map((source, index) => [source.url, index]));
        generatedSources.sort((left, right) => (
          (sourceOrder.get(left.url) ?? Number.MAX_SAFE_INTEGER)
          - (sourceOrder.get(right.url) ?? Number.MAX_SAFE_INTEGER)
        ));
        await updateWizardState(subscriptionId, { generatedSources: [...generatedSources] });
      }

      // Add skipped (unselected) sources from allFoundSources
      const processedUrls = new Set(generatedSources.map((s) => s.url));
      for (const src of allFoundSources) {
        if (!processedUrls.has(src.url)) {
          generatedSources.push({
            title: src.title,
            url: src.url,
            description: src.description,
            script: '',
            cronExpression: '0 * * * *',
            initialItems: [],
            isEnabled: false,
            failedReason: '未生成',
            collectionMode: src.collectionMode,
            searchPlan: src.searchPlan,
            collectorConfigJson: src.collectorConfigJson,
            discoveryVersion: src.discoveryVersion,
          });
        }
      }
    }

    // ── Phase 3: complete ─────────────────────────────────────────────────────
    // Between phases: check if we should auto-advance (only in managed mode)
    if (startStep !== 'complete' && !(await shouldAutoAdvance(subscriptionId))) return;
    if (await isCancelled(subscriptionId)) return;

    const sourcesToCreate = generatedSources.length > 0 ? generatedSources : reusableInitialGeneratedSources;

    if (sourcesToCreate.length === 0) {
      writeLog(subscriptionId, 'complete', 'error', '没有成功生成的脚本，创建失败');
      markFailed(subscriptionId, '没有成功生成的脚本');
      return;
    }

    // Persist final state before creating sources
    await updateWizardState(subscriptionId, {
      step: 4,
      generatedSources: sourcesToCreate,
    });

    writeLog(subscriptionId, 'complete', 'info', `正在创建 ${sourcesToCreate.length} 个订阅源...`);

    await createSourcesForSubscription(subscriptionId, sourcesToCreate, criteria);

    // Mark subscription as active
    const db = getDb();
    await db.update(subscriptions)
      .set({
        managedStatus: null,
        managedError: null,
        wizardStateJson: null,
        isEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscriptionId));

    const successCount = sourcesToCreate.filter((s) => !s.failedReason).length;
    const failedCount = sourcesToCreate.length - successCount;
    const parts = [];
    if (successCount > 0) parts.push(`${successCount} 个成功`);
    if (failedCount > 0) parts.push(`${failedCount} 个待修复`);
    writeLog(subscriptionId, 'complete', 'success', `订阅创建完成，共 ${sourcesToCreate.length} 个数据源（${parts.join('，')}）`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[managed pipeline] Unexpected error:', err);
    markFailed(subscriptionId, msg);
  }
}

async function markFailed(subscriptionId: string, error: string) {
  try {
    const db = getDb();
    await db.update(subscriptions)
      .set({
        managedStatus: 'failed',
        managedError: error,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscriptionId));
  } catch (err) {
    console.error('[managed pipeline] Failed to mark as failed:', err);
  }
}
