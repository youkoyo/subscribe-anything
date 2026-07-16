/**
 * Durable LLM call state shared by the Web process and background worker.
 * A process-local map cannot serve the wizard once heavy work moves to worker.ts.
 */

import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { managedLlmCalls } from '@/lib/db/schema';
import type { LLMCallInfo } from '@/lib/ai/client';

export async function getLLMCalls(subscriptionId: string): Promise<LLMCallInfo[]> {
  const db = getDb();
  const rows = await db
    .select({ payload: managedLlmCalls.payload })
    .from(managedLlmCalls)
    .where(eq(managedLlmCalls.subscriptionId, subscriptionId))
    .orderBy(asc(managedLlmCalls.createdAt), asc(managedLlmCalls.callIndex));

  return rows.flatMap((row) => {
    try {
      return [JSON.parse(row.payload) as LLMCallInfo];
    } catch {
      return [];
    }
  });
}

/** Insert or refresh a call by its source URL and call index. */
export async function upsertLLMCall(subscriptionId: string, info: LLMCallInfo): Promise<void> {
  try {
    const db = getDb();
    const now = new Date();
    const sourceUrl = info.sourceUrl ?? '';

    await db.insert(managedLlmCalls)
      .values({
        subscriptionId,
        sourceUrl,
        callIndex: info.callIndex,
        payload: JSON.stringify(info),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [managedLlmCalls.subscriptionId, managedLlmCalls.sourceUrl, managedLlmCalls.callIndex],
        set: { payload: JSON.stringify(info), updatedAt: now },
      });
  } catch (error) {
    console.error('[LLM call store] Failed to persist call:', error);
  }
}

export async function clearLLMCalls(subscriptionId: string): Promise<void> {
  await getDb().delete(managedLlmCalls)
    .where(eq(managedLlmCalls.subscriptionId, subscriptionId));
}

/** Remove all LLM calls for one source while retaining the others. */
export async function clearSourceLLMCalls(subscriptionId: string, sourceUrl: string): Promise<void> {
  await getDb().delete(managedLlmCalls)
    .where(and(
      eq(managedLlmCalls.subscriptionId, subscriptionId),
      eq(managedLlmCalls.sourceUrl, sourceUrl),
    ));
}
