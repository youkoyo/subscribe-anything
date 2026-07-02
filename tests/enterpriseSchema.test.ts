import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('schema defines enterprise industry fields', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /visibility: text\('visibility'/);
  assert.match(source, /subscriptionMode: text\('subscription_mode'/);
  assert.match(source, /autoProfileExpansion: integer\('auto_profile_expansion'/);
  assert.match(source, /deliveryCron: text\('delivery_cron'\)/);
  assert.match(source, /maxItemsPerEmail: integer\('max_items_per_email'\)/);
});

test('schema defines monitoring profiles and user industry subscriptions', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(
    source,
    /export const industryMonitoringProfiles = sqliteTable\('industry_monitoring_profiles'/
  );
  assert.match(
    source,
    /export const userIndustrySubscriptions = sqliteTable\('user_industry_subscriptions'/
  );
  assert.match(source, /sharedSubscriptionId: text\('shared_subscription_id'\)/);
  assert.match(source, /customCriteria: text\('custom_criteria'\)/);
  assert.match(source, /recipientEmailsJson: text\('recipient_emails_json'\)/);
});

test('schema defines delivery run and user delivery log tables', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /export const industryDeliveryRuns = sqliteTable\('industry_delivery_runs'/);
  assert.match(source, /export const userDeliveryLogs = sqliteTable\('user_delivery_logs'/);
  assert.match(source, /selectedCardIdsJson: text\('selected_card_ids_json'\)/);
});

test('runtime migration creates enterprise industry tables and columns', async () => {
  const source = await readFile('src/lib/db/migrate.ts', 'utf8');

  assert.match(source, /function migrateEnterpriseIndustrySubscriptions/);
  assert.match(source, /ALTER TABLE industry_configs ADD COLUMN visibility TEXT/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS industry_monitoring_profiles/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS user_industry_subscriptions/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS industry_delivery_runs/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS user_delivery_logs/);
});

test('db types export enterprise industry models', async () => {
  const source = await readFile('src/types/db.ts', 'utf8');

  assert.match(
    source,
    /IndustryMonitoringProfile = InferSelectModel<typeof industryMonitoringProfiles>/
  );
  assert.match(
    source,
    /UserIndustrySubscription = InferSelectModel<typeof userIndustrySubscriptions>/
  );
  assert.match(source, /IndustryDeliveryRun = InferSelectModel<typeof industryDeliveryRuns>/);
  assert.match(source, /UserDeliveryLog = InferSelectModel<typeof userDeliveryLogs>/);
});
