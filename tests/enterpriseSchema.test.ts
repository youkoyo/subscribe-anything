import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

async function readPostgresMigration() {
  const files = (await readdir('drizzle-pg')).filter((file) => file.endsWith('.sql')).sort();
  assert.ok(files.length > 0, 'expected a generated PostgreSQL migration');
  return readFile(`drizzle-pg/${files[0]}`, 'utf8');
}

test('schema defines enterprise industry fields', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /visibility: text\('visibility'/);
  assert.match(source, /subscriptionMode: text\('subscription_mode'/);
  assert.match(source, /autoProfileExpansion: boolean\('auto_profile_expansion'/);
  assert.match(source, /deliveryCron: text\('delivery_cron'\)/);
  assert.match(source, /maxItemsPerEmail: integer\('max_items_per_email'\)/);
});

test('schema defines monitoring profiles and user industry subscriptions', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(
    source,
    /export const industryMonitoringProfiles = pgTable\('industry_monitoring_profiles'/
  );
  assert.match(
    source,
    /export const userIndustrySubscriptions = pgTable\('user_industry_subscriptions'/
  );
  assert.match(source, /sharedSubscriptionId: text\('shared_subscription_id'\)/);
  assert.match(source, /customCriteria: text\('custom_criteria'\)/);
  assert.match(source, /recipientEmailsJson: text\('recipient_emails_json'\)/);
});

test('schema defines delivery run and user delivery log tables', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /export const industryDeliveryRuns = pgTable\('industry_delivery_runs'/);
  assert.match(source, /export const userDeliveryLogs = pgTable\('user_delivery_logs'/);
  assert.match(source, /selectedCardIdsJson: text\('selected_card_ids_json'\)/);
});

test('postgres migration creates enterprise industry tables and columns', async () => {
  const source = await readFile('src/lib/db/migrate.ts', 'utf8');
  const migration = await readPostgresMigration();

  assert.match(source, /drizzle-orm\/node-postgres\/migrator/);
  assert.match(source, /const MIGRATIONS_DIR = 'drizzle-pg'/);
  assert.match(migration, /CREATE TABLE "industry_monitoring_profiles"/);
  assert.match(migration, /CREATE TABLE "user_industry_subscriptions"/);
  assert.match(migration, /CREATE TABLE "industry_delivery_runs"/);
  assert.match(migration, /CREATE TABLE "user_delivery_logs"/);
  assert.match(migration, /"requires_admin_approval" boolean DEFAULT false NOT NULL/);
  assert.match(migration, /"scheduled_for" timestamp NOT NULL/);
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
