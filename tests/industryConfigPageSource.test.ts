import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('navigation exposes industry config page', async () => {
  const sidebar = await readFile('src/components/layout/NavSidebar.tsx', 'utf8');
  const bottomNav = await readFile('src/components/layout/BottomNav.tsx', 'utf8');

  assert.match(sidebar, /\/industry-configs/);
  assert.match(sidebar, /产业配置/);
  assert.match(bottomNav, /\/industry-configs/);
  assert.match(bottomNav, /产业配置/);
});

test('industry config page renders admin manager and user subscription variants', async () => {
  const page = await readFile('src/app/industry-configs/page.tsx', 'utf8');

  assert.match(page, /IndustryConfigManager/);
  assert.match(page, /IndustryCatalog/);
  assert.match(page, /产业方向管理/);
  assert.match(page, /产业订阅/);
});

test('industry config manager uses API and exposes core fields', async () => {
  const manager = await readFile('src/components/industry-configs/IndustryConfigManager.tsx', 'utf8');

  assert.match(manager, /\/api\/industry-configs/);
  assert.match(manager, /行业分类/);
  assert.match(manager, /关键词/);
  assert.match(manager, /风险词/);
  assert.match(manager, /启用/);
});
