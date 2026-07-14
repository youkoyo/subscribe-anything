import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

test('postgres schema keeps the discovery catalog separate from subscription sources', async () => {
  const schema = await readFile('src/lib/db/schema.ts', 'utf8');
  const dbTypes = await readFile('src/types/db.ts', 'utf8');

  assert.match(schema, /discoverySourceCatalog\s*=\s*pgTable\('discovery_source_catalog'/);
  assert.match(schema, /feedUrl:\s*text\('feed_url'\)[\s\S]*\.unique\(\)/);
  assert.match(schema, /feedProvider:\s*text\('feed_provider'/);
  assert.match(schema, /preferencesJson:\s*text\('preferences_json'/);
  assert.match(schema, /trustLevel:\s*text\('trust_level'/);
  assert.match(schema, /defaultUsage:\s*text\('default_usage'/);
  assert.match(schema, /healthStatus:\s*text\('health_status'/);
  assert.match(schema, /lastValidatedAt:\s*timestamp\('last_validated_at'/);
  assert.match(schema, /catalogSourceId:\s*text\('catalog_source_id'\)/);
  assert.match(schema, /collectionStrategy:\s*text\('collection_strategy'/);

  assert.match(dbTypes, /DiscoverySourceCatalogEntry/);
  assert.match(dbTypes, /NewDiscoverySourceCatalogEntry/);
});

test('industry configs persist rich source preferences and AI fallback policy', async () => {
  const schema = await readFile('src/lib/db/schema.ts', 'utf8');
  const industryTypes = await readFile('src/lib/industry-configs/types.ts', 'utf8');
  const industryUtils = await readFile('src/lib/industry-configs/utils.ts', 'utf8');

  assert.match(schema, /sourcePreferencesJson:\s*text\('source_preferences_json'\)/);
  assert.match(schema, /allowAiDiscoveryFallback:\s*boolean\('allow_ai_discovery_fallback'\)/);
  assert.match(industryTypes, /sourcePreferences/);
  assert.match(industryTypes, /allowAiDiscoveryFallback/);
  assert.match(industryUtils, /sourcePreferencesJson/);
});

test('startup migration seeds the versioned catalog idempotently', async () => {
  const migrateSource = await readFile('src/lib/db/migrate.ts', 'utf8');
  const repositorySource = await readFile('src/lib/discovery-sources/repository.ts', 'utf8');

  assert.match(migrateSource, /seedDiscoverySourceCatalog/);
  assert.match(migrateSource, /catalogSeedValues/);
  assert.match(migrateSource, /onConflictDoNothing/);
  assert.match(repositorySource, /CURATED_SOURCE_SEEDS/);

  const files = await readdir('drizzle-pg');
  const migrationFiles = files.filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  assert.ok(migrationFiles.length >= 2, 'a new migration must be generated instead of editing 0000');

  const combinedSql = (
    await Promise.all(migrationFiles.map((file) => readFile(`drizzle-pg/${file}`, 'utf8')))
  ).join('\n');
  assert.match(combinedSql, /CREATE TABLE "discovery_source_catalog"/);
  assert.match(combinedSql, /source_preferences_json/);
  assert.match(combinedSql, /catalog_source_id/);
});

test('admin match endpoint exposes catalog preview without online feed validation', async () => {
  const route = await readFile('src/app/api/discovery-sources/match/route.ts', 'utf8');

  assert.match(route, /requireAdmin/);
  assert.match(route, /matchCuratedSources/);
  assert.doesNotMatch(route, /rssFetch|validateScript|checkFeed/);
});
