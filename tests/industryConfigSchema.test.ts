import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

async function readPostgresMigration() {
  const files = (await readdir('drizzle-pg')).filter((file) => file.endsWith('.sql')).sort();
  assert.ok(files.length > 0, 'expected a generated PostgreSQL migration');
  return readFile(`drizzle-pg/${files[0]}`, 'utf8');
}

test('schema defines industry configs and subscription linkage fields', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /export const industryConfigs = pgTable\('industry_configs'/);
  assert.match(source, /industryConfigId: text\('industry_config_id'\)/);
  assert.match(source, /industryConfigSnapshot: text\('industry_config_snapshot'\)/);
});

test('postgres migration creates industry config table and subscription columns', async () => {
  const source = await readFile('src/lib/db/migrate.ts', 'utf8');
  const migration = await readPostgresMigration();

  assert.match(source, /drizzle-orm\/node-postgres\/migrator/);
  assert.match(source, /const MIGRATIONS_DIR = 'drizzle-pg'/);
  assert.match(migration, /CREATE TABLE "industry_configs"/);
  assert.match(migration, /"industry_config_id" text/);
  assert.match(migration, /"industry_config_snapshot" text/);
  assert.match(migration, /"auto_profile_expansion" boolean DEFAULT false NOT NULL/);
});

test('db types export industry config models', async () => {
  const source = await readFile('src/types/db.ts', 'utf8');

  assert.match(source, /IndustryConfig = InferSelectModel<typeof industryConfigs>/);
  assert.match(source, /NewIndustryConfig = InferInsertModel<typeof industryConfigs>/);
});
