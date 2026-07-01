import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry config API routes require auth', async () => {
  const listRoute = await readFile('src/app/api/industry-configs/route.ts', 'utf8');
  const itemRoute = await readFile('src/app/api/industry-configs/[id]/route.ts', 'utf8');

  assert.match(listRoute, /requireAuth/);
  assert.match(itemRoute, /requireAuth/);
});

test('industry config API routes scope operations by user id', async () => {
  const service = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(service, /eq\(industryConfigs\.userId, userId\)/);
  assert.match(service, /buildIndustryConfigSnapshot/);
});

test('industry config create route returns suggestions for UI reuse', async () => {
  const listRoute = await readFile('src/app/api/industry-configs/route.ts', 'utf8');

  assert.match(listRoute, /buildIndustrySubscriptionSuggestion/);
});
