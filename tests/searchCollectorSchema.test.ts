import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const schemaSource = readFileSync(path.join(root, 'src/lib/db/schema.ts'), 'utf8');
const wizardSource = readFileSync(path.join(root, 'src/types/wizard.ts'), 'utf8');
const migrationsDir = path.join(root, 'drizzle-pg');
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const allMigrationSql = migrationFiles
  .map((file) => readFileSync(path.join(migrationsDir, file), 'utf8'))
  .join('\n');

function readSearchCollectorMigration() {
  const migrationPath = path.join(migrationsDir, '0002_search_collectors.sql');
  assert.ok(existsSync(migrationPath), 'missing 0002_search_collectors.sql');
  return readFileSync(migrationPath, 'utf8');
}

function sourceSection(source: string, start: RegExp, end: RegExp) {
  const startMatch = start.exec(source);
  assert.ok(startMatch, `missing section matching ${start}`);
  const remainder = source.slice(startMatch.index);
  const endMatch = end.exec(remainder);
  assert.ok(endMatch, `missing section terminator matching ${end}`);
  return remainder.slice(0, endMatch.index);
}

function assertTextEnum(
  source: string,
  property: string,
  column: string,
  values: readonly string[],
) {
  const valuePattern = values.map((value) => `'${value}'`).join('\\s*,\\s*');
  assert.match(
    source,
    new RegExp(
      `${property}\\s*:\\s*text\\(\\s*'${column}'\\s*,\\s*\\{\\s*enum\\s*:\\s*\\[\\s*${valuePattern}\\s*\\]\\s*,?\\s*\\}\\s*\\)`,
      's',
    ),
  );
}

test('source schema stores collector mode and config with legacy-safe defaults', () => {
  const sources = sourceSection(
    schemaSource,
    /export const sources\s*=\s*pgTable\(\s*'sources'/,
    /export const favorites\s*=/,
  );

  assertTextEnum(
    sources,
    'collectorType',
    'collector_type',
    ['search', 'rss', 'json', 'feed_script'],
  );
  assert.match(
    sources,
    /collectorType[\s\S]*?\.notNull\(\)\s*\.default\(\s*'feed_script'\s*\)/,
  );
  assert.match(
    sources,
    /collectorConfigJson\s*:\s*text\(\s*'collector_config_json'\s*\)\s*\.notNull\(\)\s*\.default\(\s*'\{\}'\s*\)/,
  );
});

test('message card schema adds nullable evidence fields and scoped deduplication', () => {
  const cards = sourceSection(
    schemaSource,
    /export const messageCards\s*=\s*pgTable\(\s*'message_cards'/,
    /export const notifications\s*=/,
  );

  for (const [property, column] of [
    ['dedupeKey', 'dedupe_key'],
    ['canonicalUrl', 'canonical_url'],
    ['publisherName', 'publisher_name'],
    ['matchReason', 'match_reason'],
  ] as const) {
    assert.match(cards, new RegExp(`${property}\\s*:\\s*text\\(\\s*'${column}'\\s*\\)\\s*,`));
  }
  assert.doesNotMatch(cards, /dedupeKey\s*:[^,]*\.notNull\s*\(/);
  assertTextEnum(
    cards,
    'collectionMethod',
    'collection_method',
    ['search', 'rss', 'json', 'feed_script'],
  );
  assertTextEnum(cards, 'evidenceLevel', 'evidence_level', ['original', 'search', 'feed']);
  assert.match(cards, /relevanceScore\s*:\s*real\(\s*'relevance_score'\s*\)\s*,/);
  assert.match(cards, /authorityScore\s*:\s*real\(\s*'authority_score'\s*\)\s*,/);
  assert.match(
    cards,
    /uniqueIndex\(\s*'message_cards_subscription_dedupe_key_unique'\s*\)\s*\.on\(\s*table\.subscriptionId\s*,\s*table\.dedupeKey\s*,?\s*\)/,
  );
});

test('search collector migration adds compatible source and transitional card columns', () => {
  const migration = readSearchCollectorMigration();

  assert.match(
    migration,
    /ALTER TABLE\s+"sources"\s+ADD COLUMN\s+"collector_type"\s+text\s+DEFAULT\s+'feed_script'\s+NOT NULL/i,
  );
  assert.match(
    migration,
    /ALTER TABLE\s+"sources"\s+ADD COLUMN\s+"collector_config_json"\s+text\s+DEFAULT\s+'\{\}'\s+NOT NULL/i,
  );

  for (const column of [
    'dedupe_key',
    'canonical_url',
    'publisher_name',
    'collection_method',
    'evidence_level',
    'match_reason',
  ]) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE\\s+"message_cards"\\s+ADD COLUMN\\s+"${column}"\\s+text`, 'i'),
    );
  }
  for (const column of ['relevance_score', 'authority_score']) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE\\s+"message_cards"\\s+ADD COLUMN\\s+"${column}"\\s+real`, 'i'),
    );
  }
  assert.doesNotMatch(migration, /"dedupe_key"\s+text\s+NOT NULL/i);
  assert.doesNotMatch(migration, /ALTER COLUMN\s+"dedupe_key"\s+SET\s+NOT NULL/i);
});

test('migration backfills stable legacy keys before creating the subscription-scoped index', () => {
  const migration = readSearchCollectorMigration();
  const backfill = migration.match(
    /UPDATE\s+"message_cards"\s+SET\s+"dedupe_key"\s*=\s*'legacy:'\s*\|\|\s*"id"\s+WHERE\s+"dedupe_key"\s+IS\s+NULL/gi,
  );
  const index = migration.match(
    /CREATE UNIQUE INDEX\s+"message_cards_subscription_dedupe_key_unique"\s+ON\s+"message_cards"(?:\s+USING\s+btree)?\s*\(\s*"subscription_id"\s*,\s*"dedupe_key"\s*\)/gi,
  );

  assert.equal(backfill?.length, 1);
  assert.equal(index?.length, 1);
  assert.ok(migration.indexOf(backfill![0]) < migration.indexOf(index![0]));
});

test('migration journal registers only the expected next search collector migration', () => {
  assert.ok(migrationFiles.includes('0002_search_collectors.sql'));
  assert.equal(
    (allMigrationSql.match(/message_cards_subscription_dedupe_key_unique/g) ?? []).length,
    1,
  );

  const journal = JSON.parse(
    readFileSync(path.join(migrationsDir, 'meta/_journal.json'), 'utf8'),
  ) as {
    version: string;
    dialect: string;
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  const entry = journal.entries.find((item) => item.idx === 2);

  assert.equal(journal.version, '7');
  assert.equal(journal.dialect, 'postgresql');
  assert.deepEqual(entry && {
    idx: entry.idx,
    version: entry.version,
    tag: entry.tag,
    breakpoints: entry.breakpoints,
  }, {
    idx: 2,
    version: '7',
    tag: '0002_search_collectors',
    breakpoints: true,
  });
  assert.ok(entry && entry.when > journal.entries[1].when);
});

test('wizard source types carry optional typed collection plans without breaking callers', () => {
  assert.match(
    wizardSource,
    /import type\s*\{\s*SearchPlan\s*\}\s*from\s*['"]@\/lib\/search\/queryPlan['"]/,
  );
  assert.match(
    wizardSource,
    /export type CollectionMode\s*=\s*'search'\s*\|\s*'rss'\s*\|\s*'json'\s*\|\s*'feed_script'\s*;/,
  );

  for (const [name, end] of [
    ['FoundSource', /export interface GeneratedSource/],
    ['GeneratedSource', /export interface WizardState/],
  ] as const) {
    const section = sourceSection(
      wizardSource,
      new RegExp(`export interface ${name}\\s*\\{`),
      end,
    );
    assert.match(section, /collectionMode\?\s*:\s*CollectionMode\s*;/);
    assert.match(section, /searchPlan\?\s*:\s*SearchPlan\s*;/);
  }
});
