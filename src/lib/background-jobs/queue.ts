import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

export type BackgroundJobType =
  | 'managed_pipeline'
  | 'managed_step'
  | 'generate_source'
  | 'source_collection'
  | 'source_provisioning';

export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  payload: string;
  attempts: number;
}

interface EnqueueInput {
  type: BackgroundJobType;
  dedupeKey: string;
  payload: unknown;
  priority?: number;
}

export async function enqueueBackgroundJob(input: EnqueueInput): Promise<boolean> {
  const now = new Date();
  const result = await getDb().execute(sql`
    INSERT INTO background_jobs (
      id, type, status, priority, dedupe_key, payload, available_at, attempts, created_at, updated_at
    ) VALUES (
      ${createId()}, ${input.type}, 'queued', ${input.priority ?? 100}, ${input.dedupeKey},
      ${JSON.stringify(input.payload)}, ${now}, 0, ${now}, ${now}
    )
    ON CONFLICT (dedupe_key) WHERE status IN ('queued', 'running') DO NOTHING
    RETURNING id
  `);
  return result.rows.length > 0;
}

export function enqueueManagedPipelineJob(
  subscriptionId: string,
  payload: unknown,
  monitoringProfileId?: string
) {
  return enqueueBackgroundJob({
    type: 'managed_pipeline',
    dedupeKey: `managed-pipeline:${subscriptionId}`,
    payload: { subscriptionId, payload, monitoringProfileId },
    priority: 20,
  });
}

export function enqueueManagedStepJob(
  subscriptionId: string,
  step: 'find_sources' | 'generate_scripts',
  sources?: unknown
) {
  return enqueueBackgroundJob({
    type: 'managed_step',
    dedupeKey: `managed-step:${subscriptionId}:${step}`,
    payload: { subscriptionId, step, sources: sources ?? [] },
    priority: 20,
  });
}

export function enqueueGenerateSourceJob(
  subscriptionId: string,
  source: unknown,
  userPrompt?: string
) {
  const sourceUrl = typeof source === 'object' && source && 'url' in source
    ? String(source.url)
    : 'unknown';
  return enqueueBackgroundJob({
    type: 'generate_source',
    dedupeKey: `generate-source:${subscriptionId}:${sourceUrl}`,
    payload: { subscriptionId, source, userPrompt },
    priority: 20,
  });
}

export function enqueueSourceCollectionJob(sourceId: string, priority = 100) {
  return enqueueBackgroundJob({
    type: 'source_collection',
    dedupeKey: `source-collection:${sourceId}`,
    payload: { sourceId },
    priority,
  });
}

export function enqueueSourceProvisioningJob(
  subscriptionId: string,
  sources: unknown,
  criteria?: string,
  lane = 'default'
) {
  return enqueueBackgroundJob({
    type: 'source_provisioning',
    dedupeKey: `source-provisioning:${subscriptionId}:${lane}`,
    payload: { subscriptionId, sources, criteria },
    priority: lane === 'priority' ? 5 : 100,
  });
}

export async function claimNextBackgroundJob(): Promise<BackgroundJob | null> {
  const now = new Date();
  const result = await getDb().execute(sql<BackgroundJob>`
    WITH next_job AS (
      SELECT id
      FROM background_jobs
      WHERE status = 'queued' AND available_at <= ${now}
      ORDER BY priority ASC, available_at ASC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE background_jobs AS jobs
    SET status = 'running', started_at = ${now}, updated_at = ${now}, attempts = jobs.attempts + 1
    FROM next_job
    WHERE jobs.id = next_job.id
    RETURNING jobs.id, jobs.type, jobs.payload, jobs.attempts
  `);
  return (result.rows[0] as unknown as BackgroundJob | undefined) ?? null;
}

export async function completeBackgroundJob(jobId: string) {
  const now = new Date();
  await getDb().execute(sql`
    UPDATE background_jobs
    SET status = 'completed', finished_at = ${now}, updated_at = ${now}, last_error = NULL
    WHERE id = ${jobId}
  `);
}

export async function failBackgroundJob(jobId: string, error: unknown) {
  const now = new Date();
  const message = error instanceof Error ? error.message : String(error);
  await getDb().execute(sql`
    UPDATE background_jobs
    SET status = 'failed', finished_at = ${now}, updated_at = ${now}, last_error = ${message.slice(0, 4000)}
    WHERE id = ${jobId}
  `);
}
