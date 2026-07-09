import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('database runtime uses PostgreSQL instead of SQLite', async () => {
  const indexSource = await readFile('src/lib/db/index.ts', 'utf8');
  const schemaSource = await readFile('src/lib/db/schema.ts', 'utf8');
  const migrateSource = await readFile('src/lib/db/migrate.ts', 'utf8');
  const dbConfigSource = await readFile('src/lib/db/config.ts', 'utf8');
  const drizzleConfig = await readFile('drizzle.config.ts', 'utf8');
  const serverSource = await readFile('server.ts', 'utf8');
  const nextConfig = await readFile('next.config.mjs', 'utf8');
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.match(indexSource, /drizzle-orm\/node-postgres/);
  assert.match(indexSource, /from 'pg'/);
  assert.doesNotMatch(indexSource, /better-sqlite3|DB_URL|DB_PATH|subscribe-anything\.db/);

  assert.match(schemaSource, /from 'drizzle-orm\/pg-core'/);
  assert.match(schemaSource, /pgTable/);
  assert.doesNotMatch(schemaSource, /sqlite-core|sqliteTable|timestamp_ms/);

  assert.match(migrateSource, /drizzle-orm\/node-postgres\/migrator/);
  assert.doesNotMatch(migrateSource, /better-sqlite3|PRAGMA|sqlite_master|ALTER TABLE .* ADD COLUMN .* INTEGER/);

  assert.match(dbConfigSource, /DATABASE_URL/);
  assert.match(dbConfigSource, /DATABASE_TARGET/);
  assert.match(dbConfigSource, /postgres\(\?:ql\)\?/);

  assert.match(drizzleConfig, /dialect:\s*'postgresql'/);
  assert.match(drizzleConfig, /resolveDatabaseUrl/);
  assert.doesNotMatch(drizzleConfig, /DB_URL|dialect:\s*'sqlite'|subscribe-anything\.db/);

  assert.match(serverSource, /resolveDatabaseUrl/);
  assert.doesNotMatch(serverSource, /DB_URL|subscribe-anything\.db/);
  assert.doesNotMatch(nextConfig, /better-sqlite3/);

  assert.ok(packageJson.dependencies?.pg, 'package.json should depend on pg');
  assert.ok(packageJson.devDependencies?.['@types/pg'], 'package.json should include pg types');
  assert.equal(packageJson.dependencies?.['better-sqlite3'], undefined);
  assert.equal(packageJson.devDependencies?.['@types/better-sqlite3'], undefined);
});
