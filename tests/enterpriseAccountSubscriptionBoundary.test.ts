import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('ordinary users are guided away from the legacy custom subscription wizard', async () => {
  const page = await readFile('src/app/subscriptions/new/page.tsx', 'utf8');
  const subscriptionsPage = await readFile('src/app/subscriptions/page.tsx', 'utf8');

  assert.match(page, /!isAdmin/);
  assert.match(page, /\/industry-configs/);
  assert.match(page, /普通用户请在产业订阅中选择管理员发布的产业方向/);
  assert.match(subscriptionsPage, /user\?\.isAdmin/);
  assert.match(subscriptionsPage, /选择产业订阅/);
});

test('legacy subscription creation APIs reject ordinary users', async () => {
  const route = await readFile('src/app/api/subscriptions/route.ts', 'utf8');
  const managedRoute = await readFile('src/app/api/subscriptions/managed/route.ts', 'utf8');

  assert.match(route, /if \(!session\.isAdmin\)/);
  assert.match(route, /普通用户请从产业订阅目录发起订阅/);
  assert.match(managedRoute, /if \(!session\.isAdmin\)/);
  assert.match(managedRoute, /普通用户请从产业订阅目录发起订阅/);
});

test('enterprise industry subscription dialog exposes recipient email configuration', async () => {
  const catalog = await readFile('src/components/enterprise/IndustryCatalog.tsx', 'utf8');

  assert.match(catalog, /useAuth/);
  assert.match(catalog, /收件邮箱配置/);
  assert.match(catalog, /默认发送到账户邮箱/);
  assert.match(catalog, /额外收件邮箱/);
  assert.match(catalog, /extraRecipientEmails/);
});
