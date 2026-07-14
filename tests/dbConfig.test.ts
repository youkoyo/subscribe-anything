import assert from 'node:assert/strict';
import test from 'node:test';
import { describeDatabaseUrl, resolveDatabaseUrl } from '../src/lib/db/config';

test('database target selects remote URL even when DATABASE_URL points at local', () => {
  const url = resolveDatabaseUrl({
    DATABASE_TARGET: 'remote',
    DATABASE_URL: 'postgresql://subscribe:subscribe@localhost:5432/subscribe_anything',
    DATABASE_URL_LOCAL: 'postgresql://subscribe:subscribe@localhost:5432/subscribe_anything',
    DATABASE_URL_REMOTE: 'postgresql://postgres:secret@47.97.114.189:5432/nebula_prism_industry_info',
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(
    url,
    'postgresql://postgres:secret@47.97.114.189:5432/nebula_prism_industry_info'
  );
});

test('database config falls back to DATABASE_URL when no target is configured', () => {
  const url = resolveDatabaseUrl({
    DATABASE_URL: 'postgresql://subscribe:subscribe@localhost:5432/subscribe_anything',
  } as unknown as NodeJS.ProcessEnv);

  assert.equal(url, 'postgresql://subscribe:subscribe@localhost:5432/subscribe_anything');
});

test('database URL description hides passwords', () => {
  const description = describeDatabaseUrl(
    'postgresql://postgres:secret@47.97.114.189:5432/nebula_prism_industry_info'
  );

  assert.equal(description, 'postgresql://postgres@47.97.114.189:5432/nebula_prism_industry_info');
  assert.doesNotMatch(description, /secret/);
});
