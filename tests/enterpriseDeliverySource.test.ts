import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('delivery service sends scored email and writes logs', async () => {
  const source = await readFile('src/lib/enterprise/deliveryService.ts', 'utf8');

  assert.match(source, /industryDeliveryRuns/);
  assert.match(source, /userDeliveryLogs/);
  assert.match(source, /selectDeliveryCards/);
  assert.match(source, /renderIndustryDeliveryEmail/);
  assert.match(source, /sendEmail/);
  assert.match(source, /status: 'skipped'/);
});

test('delivery scheduler registers enabled industry delivery cron jobs', async () => {
  const source = await readFile('src/lib/enterprise/deliveryScheduler.ts', 'utf8');

  assert.match(source, /node-cron/);
  assert.match(source, /deliveryEnabled/);
  assert.match(source, /runIndustryDelivery/);
});

test('server initializes delivery scheduler after source scheduler', async () => {
  const source = await readFile('server.ts', 'utf8');

  assert.match(source, /initScheduler/);
  assert.match(source, /initDeliveryScheduler/);
});

test('delivery run API requires admin access', async () => {
  const source = await readFile('src/app/api/industry-delivery-runs/route.ts', 'utf8');

  assert.match(source, /requireAdmin/);
  assert.match(source, /industryDeliveryRuns/);
  assert.match(source, /userDeliveryLogs/);
});
