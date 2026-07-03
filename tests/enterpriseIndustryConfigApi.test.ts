import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry config write routes require admin access', async () => {
  const listRoute = await readFile('src/app/api/industry-configs/route.ts', 'utf8');
  const itemRoute = await readFile('src/app/api/industry-configs/[id]/route.ts', 'utf8');
  const publishRoute = await readFile(
    'src/app/api/industry-configs/[id]/publish/route.ts',
    'utf8'
  );

  assert.match(listRoute, /requireAdmin/);
  assert.match(itemRoute, /requireAdmin/);
  assert.match(publishRoute, /requireAdmin/);
});

test('industry config service exposes admin and catalog list functions', async () => {
  const source = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(source, /listIndustryConfigsForAdmin/);
  assert.match(source, /listPublishedIndustryConfigsForUser/);
  assert.match(source, /publishIndustryConfig/);
  assert.match(source, /seedDefaultIndustryConfigsForAdmin/);
});

test('ordinary catalog reads only published enabled industry configs', async () => {
  const source = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(source, /eq\(industryConfigs\.visibility, 'published'\)/);
  assert.match(source, /eq\(industryConfigs\.isEnabled, true\)/);
});
