import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry config API routes require auth and admin for writes', async () => {
  const listRoute = await readFile('src/app/api/industry-configs/route.ts', 'utf8');
  const itemRoute = await readFile('src/app/api/industry-configs/[id]/route.ts', 'utf8');

  assert.match(listRoute, /requireAuth/);
  assert.match(itemRoute, /requireAuth/);
  assert.match(listRoute, /requireAdmin/);
  assert.match(itemRoute, /requireAdmin/);
});

test('industry config service exposes enterprise catalog semantics', async () => {
  const service = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(service, /listIndustryConfigsForAdmin/);
  assert.match(service, /listPublishedIndustryConfigsForUser/);
  assert.match(service, /eq\(industryConfigs\.visibility, 'published'\)/);
  assert.match(service, /buildIndustryConfigSnapshot/);
});

test('industry config create route returns suggestions for UI reuse', async () => {
  const listRoute = await readFile('src/app/api/industry-configs/route.ts', 'utf8');

  assert.match(listRoute, /buildIndustrySubscriptionSuggestion/);
});

test('industry config updates preserve fields omitted by the unified form', async () => {
  const service = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(service, /const mergedInput: IndustryConfigInput = \{/);
  assert.match(service, /keywords: input\.keywords \?\? existing\.snapshot\.keywords/);
  assert.match(service, /riskTerms: input\.riskTerms \?\? existing\.snapshot\.riskTerms/);
  assert.match(service, /deliveryCron: input\.deliveryCron \?\? existing\.deliveryCron/);
  assert.match(service, /toDbValues\(mergedInput, termProfile\)/);
});
