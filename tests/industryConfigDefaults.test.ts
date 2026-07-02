import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DEFAULT_INDUSTRY_CONFIGS } from '../src/lib/industry-configs/defaults';

test('default industry configs come from the pilot industries in the proposal', () => {
  assert.deepEqual(
    DEFAULT_INDUSTRY_CONFIGS.map((item) => item.name),
    ['化工原料产业', '煤炭产业', '食品加工产业', '水产/海参养殖', '纺织/鞋帽针织']
  );

  const chemical = DEFAULT_INDUSTRY_CONFIGS[0];
  assert.deepEqual(chemical.keywords, ['爆炸', '泄漏', '环保督察', '停产整顿']);
  assert.ok(chemical.riskTerms?.includes('危化品监管'));
});

test('industry config API seeds defaults before listing configs', async () => {
  const route = await readFile('src/app/api/industry-configs/route.ts', 'utf8');
  const service = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(route, /seedDefaultIndustryConfigsForAdmin\(session\.userId\)/);
  assert.match(route, /session\.isAdmin/);
  assert.match(service, /DEFAULT_INDUSTRY_CONFIGS/);
  assert.match(service, /limit\(1\)/);
});
