import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('manual pool publishing queues priority sources before deferred sources in the worker', async () => {
  const route = await readFile('src/app/api/subscriptions/[id]/complete-wizard/route.ts', 'utf8');

  assert.match(route, /prioritizeSourcesForPublish/);
  assert.match(route, /enqueueSourceProvisioningJob\(id, priority/);
  assert.match(route, /enqueueSourceProvisioningJob\(id, deferred/);
  assert.match(route, /prioritySourceCount/);
  assert.match(route, /deferredSourceCount/);
});

test('direct subscription creation uses the same non-blocking source provisioning policy', async () => {
  const route = await readFile('src/app/api/subscriptions/route.ts', 'utf8');

  assert.match(route, /prioritizeSourcesForPublish/);
  assert.match(route, /enqueueSourceProvisioningJob\(subscription\.id, priority/);
  assert.match(route, /enqueueSourceProvisioningJob\(subscription\.id, deferred/);
});

test('binding a published information pool immediately reloads its email delivery job', async () => {
  const service = await readFile('src/lib/enterprise/industryPoolService.ts', 'utf8');

  assert.match(service, /reloadIndustryDelivery/);
  assert.match(service, /await reloadIndustryDelivery\(industry\.id\)/);
});

test('pool publishing waits until the pool binding has completed', async () => {
  const route = await readFile('src/app/api/industry-configs/[id]/pool/route.ts', 'utf8');

  assert.match(route, /const profile = await bindSubscriptionAsIndustryPool\(/);
});

test('rebuilding an industry pool retires the previous shared subscription after replacement', async () => {
  const service = await readFile('src/lib/enterprise/industryPoolService.ts', 'utf8');

  assert.match(service, /previousSubscriptionId/);
  assert.match(service, /db\.delete\(subscriptions\)/);
  assert.match(service, /previousSubscriptionId !== subscription\.id/);
  assert.match(service, /ne\(subscriptions\.id, subscription\.id\)/);
});
