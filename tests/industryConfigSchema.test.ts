import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('schema defines industry configs and subscription linkage fields', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /export const industryConfigs = sqliteTable\('industry_configs'/);
  assert.match(source, /industryConfigId: text\('industry_config_id'\)/);
  assert.match(source, /industryConfigSnapshot: text\('industry_config_snapshot'\)/);
});

test('runtime migration creates industry config table and subscription columns', async () => {
  const source = await readFile('src/lib/db/migrate.ts', 'utf8');

  assert.match(source, /function migrateIndustryConfigs/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS industry_configs/);
  assert.match(source, /ALTER TABLE subscriptions ADD COLUMN industry_config_id TEXT/);
  assert.match(source, /ALTER TABLE subscriptions ADD COLUMN industry_config_snapshot TEXT/);
});

test('db types export industry config models', async () => {
  const source = await readFile('src/types/db.ts', 'utf8');

  assert.match(source, /IndustryConfig = InferSelectModel<typeof industryConfigs>/);
  assert.match(source, /NewIndustryConfig = InferInsertModel<typeof industryConfigs>/);
});
