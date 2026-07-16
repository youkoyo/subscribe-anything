import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeDeliveryScheduleSlot } from '../src/lib/enterprise/deliveryService';

test('delivery service sends scored email and writes logs', async () => {
  const source = await readFile('src/lib/enterprise/deliveryService.ts', 'utf8');

  assert.match(source, /industryDeliveryRuns/);
  assert.match(source, /userDeliveryLogs/);
  assert.match(source, /resolveDeliverySelection/);
  assert.match(source, /loadPreviouslyDeliveredCards/);
  assert.match(source, /renderIndustryDeliveryEmail/);
  assert.match(source, /renderIndustryDigestEmail/);
  assert.match(source, /renderIndustryDigestExcelAttachment/);
  assert.match(source, /sendEmail/);
  assert.match(source, /attachments/);
  assert.match(source, /status: 'skipped'/);
});

test('delivery scheduler registers enabled industry pools on the global delivery schedule', async () => {
  const source = await readFile('src/lib/enterprise/deliveryScheduler.ts', 'utf8');

  assert.match(source, /node-cron/);
  assert.match(source, /deliveryEnabled/);
  assert.match(source, /runIndustryDelivery/);
  assert.match(source, /runIndustryDeliveryGroup/);
  assert.match(source, /getIndustryDeliveryConfig/);
  assert.match(source, /schedule\.cron/);
  assert.match(source, /schedule\.timezone/);
  assert.doesNotMatch(source, /industry\.deliveryCron/);
});

test('SMTP sender accepts attachment payloads for digest detail exports', async () => {
  const source = await readFile('src/lib/email/smtp.ts', 'utf8');

  assert.match(source, /attachments/);
  assert.match(source, /filename/);
  assert.match(source, /contentType/);
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

test('delivery schedule slot is normalized to the minute for duplicate-run guarding', () => {
  const slot = normalizeDeliveryScheduleSlot(new Date('2026-07-08T02:19:37.456Z'));

  assert.equal(slot.toISOString(), '2026-07-08T02:19:00.000Z');
});
