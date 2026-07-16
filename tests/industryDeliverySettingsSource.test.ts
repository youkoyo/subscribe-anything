import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry email delivery uses one admin-managed global schedule instead of per-pool crons', async () => {
  const [schema, scheduler, settingsPage, api] = await Promise.all([
    readFile('src/lib/db/schema.ts', 'utf8'),
    readFile('src/lib/enterprise/deliveryScheduler.ts', 'utf8'),
    readFile('src/app/settings/page.tsx', 'utf8'),
    readFile('src/app/api/settings/industry-delivery/route.ts', 'utf8'),
  ]);

  assert.match(schema, /export const industryDeliveryConfig = pgTable\('industry_delivery_config'/);
  assert.match(scheduler, /getIndustryDeliveryConfig/);
  assert.match(scheduler, /schedule\.cron/);
  assert.doesNotMatch(scheduler, /industry\.deliveryCron/);
  assert.match(settingsPage, /IndustryDeliveryConfigForm/);
  assert.match(api, /requireAdmin/);
  assert.match(api, /reloadIndustryDelivery/);
});
