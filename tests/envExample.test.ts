import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('env example documents local and remote PostgreSQL targets without secrets', async () => {
  const source = await readFile('.env.example', 'utf8');

  assert.match(source, /DATABASE_TARGET=local/);
  assert.match(source, /DATABASE_URL_LOCAL=postgresql:\/\/subscribe:subscribe@localhost:5432\/subscribe_anything/);
  assert.match(source, /DATABASE_URL_REMOTE=postgresql:\/\/postgres:<password>@47\.97\.114\.189:5432\/nebula_prism_industry_info/);
  assert.match(source, /47\.97\.114\.189/);
  assert.match(source, /nebula_prism_industry_info/);
  assert.match(source, /<password>/);
  assert.doesNotMatch(source, /new_postgres_password/);
});
