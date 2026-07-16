import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('wizard can distinguish a busy worker from an offline worker', async () => {
  const routePath = 'src/app/api/subscriptions/[id]/job-status/route.ts';
  await access(routePath);

  const [route, worker, wizard] = await Promise.all([
    readFile(routePath, 'utf8'),
    readFile('src/lib/background-jobs/worker.ts', 'utf8'),
    readFile('src/components/wizard/Step3ScriptGen.tsx', 'utf8'),
  ]);

  assert.match(route, /workerHeartbeats/);
  assert.match(route, /queuedAhead/);
  assert.match(worker, /publishWorkerHeartbeat/);
  assert.match(wizard, /job-status/);
  assert.match(wizard, /Worker 未在线/);
});
