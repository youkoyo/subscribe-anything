// src/lib/scheduler/collectionLogStore.ts
// Persists collection attempt outcomes to the `collection_logs` table.
// The sandbox runner currently only returns success/items/error (no console capture),
// so payloads are limited to whatever the runner reports plus collector-side metrics.
// When sandbox console capture is added, drop the full script output in here too.

import { createId } from '@paralleldrive/cuid2';
import { getDb, type Db } from '@/lib/db';
import { collectionLogs } from '@/lib/db/schema';

export type CollectionLogEvent =
  | 'start'
  | 'success'
  | 'failure'
  | 'zero_items'
  | 'retry_scheduled'
  | 'retry_exhausted'
  | 'concurrent_skip'
  | 'auto_repair_started'
  | 'auto_repair_failed'
  | 'auto_repair_succeeded'
  | 'auto_repair_error';

export type CollectionLogLevel = 'info' | 'success' | 'warn' | 'error';

export interface CollectionLogPayload {
  scriptReturnedItems?: number;
  newItems?: number;
  skipped?: number;
  skippedMissingFields?: number;
  skippedDuplicates?: number;
  skippedInsertError?: number;
  durationMs?: number;
  errorMessage?: string;
  attempt?: number;
  maxRetries?: number;
  [key: string]: unknown;
}

/**
 * Write a single collection log entry. Errors are swallowed but logged to console —
 * logging must never crash a collection in progress.
 */
export async function writeCollectionLog(
  sourceId: string,
  level: CollectionLogLevel,
  event: CollectionLogEvent,
  message: string,
  payload?: CollectionLogPayload
): Promise<void> {
  try {
    const db: Db = getDb();
    await db.insert(collectionLogs).values({
      id: createId(),
      sourceId,
      level,
      event,
      message,
      payload: payload ? JSON.stringify(payload) : null,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error(`[CollectionLog] failed to write log for source=${sourceId}:`, err);
  }
}
