import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('background jobs are durable and deduplicated while active', async () => {
  const schema = await readFile('src/lib/db/schema.ts', 'utf8');
  const queue = await readFile('src/lib/background-jobs/queue.ts', 'utf8');

  assert.match(schema, /export const backgroundJobs = pgTable\('background_jobs'/);
  assert.match(schema, /dedupeKey/);
  assert.match(queue, /ON CONFLICT \(dedupe_key\) WHERE status IN \('queued', 'running'\) DO NOTHING/);
  assert.match(queue, /FOR UPDATE SKIP LOCKED/);
});

test('the web process starts a dedicated worker and keeps collection scheduling out of its event loop', async () => {
  const server = await readFile('server.ts', 'utf8');
  const jobManager = await readFile('src/lib/scheduler/jobManager.ts', 'utf8');
  const worker = await readFile('worker.ts', 'utf8');

  assert.match(server, /startBackgroundWorker/);
  assert.doesNotMatch(server, /await initScheduler\(\)/);
  assert.match(worker, /initScheduler\(\)/);
  assert.match(worker, /runBackgroundWorker/);
  assert.match(jobManager, /enqueueSourceCollectionJob/);
  assert.doesNotMatch(jobManager, /await collect\(source\.id\)/);
});

test('long-running generation routes enqueue jobs instead of running agents in the web process', async () => {
  const runStep = await readFile('src/app/api/subscriptions/[id]/run-step/route.ts', 'utf8');
  const managed = await readFile('src/app/api/subscriptions/managed/route.ts', 'utf8');

  assert.match(runStep, /enqueueManagedStepJob/);
  assert.doesNotMatch(runStep, /runGenerateScriptsStep\(/);
  assert.match(managed, /enqueueManagedPipelineJob/);
  assert.doesNotMatch(managed, /runManagedPipeline\(/);
});

test('the worker runs at most one AI or browser-heavy job at a time', async () => {
  const worker = await readFile('src/lib/background-jobs/worker.ts', 'utf8');

  assert.match(worker, /const HEAVY_JOB_CONCURRENCY = 1/);
  assert.match(worker, /pLimit\(HEAVY_JOB_CONCURRENCY\)/);
});

test('the delivery process periodically reloads pools published after server startup', async () => {
  const scheduler = await readFile('src/lib/enterprise/deliveryScheduler.ts', 'utf8');

  assert.match(scheduler, /const DELIVERY_SCHEDULE_REFRESH_MS = 15 \* 1000/);
  assert.match(scheduler, /export async function refreshIndustryDeliverySchedules/);
  assert.match(scheduler, /setInterval\(\(\) => \{\s*void refreshIndustryDeliverySchedules\(\)/);
});

test('LLM call progress is persisted so the web process can read worker-owned calls', async () => {
  const [schema, store, route] = await Promise.all([
    readFile('src/lib/db/schema.ts', 'utf8'),
    readFile('src/lib/managed/llmCallStore.ts', 'utf8'),
    readFile('src/app/api/subscriptions/[id]/llm-calls/route.ts', 'utf8'),
  ]);

  assert.match(schema, /export const managedLlmCalls = pgTable\('managed_llm_calls'/);
  assert.match(store, /getDb\(\)/);
  assert.match(store, /onConflictDoUpdate/);
  assert.match(store, /await db\s*\.select/);
  assert.match(route, /await getLLMCalls\(id\)/);
  assert.doesNotMatch(store, /globalThis\.__llmCallStore/);
});
