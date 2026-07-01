import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('wizard state carries selected industry config snapshot', async () => {
  const source = await readFile('src/types/wizard.ts', 'utf8');

  assert.match(source, /industryConfigId\?: string \| null/);
  assert.match(source, /industryConfigSnapshot\?: IndustryConfigSnapshot \| null/);
});

test('step one can load and select enabled industry configs', async () => {
  const source = await readFile('src/components/wizard/Step1Topic.tsx', 'utf8');

  assert.match(source, /\/api\/industry-configs\?enabledOnly=true/);
  assert.match(source, /产业配置/);
  assert.match(source, /industryConfigSnapshot/);
});

test('wizard shell sends industry config selection when creating subscriptions', async () => {
  const source = await readFile('src/components/wizard/WizardShell.tsx', 'utf8');

  assert.match(source, /industryConfigId/);
  assert.match(source, /industryConfigSnapshot/);
  assert.match(source, /\/api\/subscriptions\/managed/);
});

test('subscription creation endpoints persist industry config selection', async () => {
  const listRoute = await readFile('src/app/api/subscriptions/route.ts', 'utf8');
  const managedRoute = await readFile('src/app/api/subscriptions/managed/route.ts', 'utf8');
  const completeRoute = await readFile('src/app/api/subscriptions/[id]/complete-wizard/route.ts', 'utf8');

  assert.match(listRoute, /industryConfigId: industrySelection\.industryConfigId/);
  assert.match(listRoute, /industryConfigSnapshot: industrySelection\.industryConfigSnapshot/);
  assert.match(managedRoute, /industryConfigId/);
  assert.match(managedRoute, /industryConfigSnapshot/);
  assert.match(completeRoute, /industryConfigId/);
  assert.match(completeRoute, /industryConfigSnapshot/);
});
