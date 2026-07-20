import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const compose = readFileSync('docker-compose.prod.yml', 'utf8');

test('production compose provides a persistent local PostgreSQL service', () => {
  assert.match(compose, /^\s{2}db:\s*$/m);
  assert.match(compose, /image:\s*postgres:16-alpine/);
  assert.match(compose, /postgres-data:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /DATABASE_TARGET:\s*local/);
});
