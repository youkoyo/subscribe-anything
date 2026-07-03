import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const firstAccountHint = '当前是首个账号，注册后将成为管理员';
const normalAccountHint = '注册后将成为普通用户也可以向首个账号申请成为管理员';

test('login UI no longer exposes guest login', async () => {
  const page = await readFile('src/app/login/page.tsx', 'utf8');
  const auth = await readFile('src/contexts/AuthContext.tsx', 'utf8');
  const oauthButtons = await readFile('src/app/login/components/OAuthButtons.tsx', 'utf8');

  assert.doesNotMatch(page, /loginAsGuest|handleGuestLogin|onGuestLogin/);
  assert.doesNotMatch(auth, /loginAsGuest|\/api\/auth\/guest/);
  assert.doesNotMatch(oauthButtons, /onGuestLogin|游客|Guest/);
});

test('guest login API is disabled for account-only enterprise access', async () => {
  const route = await readFile('src/app/api/auth/guest/route.ts', 'utf8');

  assert.match(route, /Guest login is disabled/);
  assert.match(route, /status:\s*410/);
  assert.doesNotMatch(route, /GUEST_USER_ID|getSession|session\.userId|db\.insert/);
});

test('registration form explains first account and later account roles', async () => {
  const form = await readFile('src/app/login/components/LoginForm.tsx', 'utf8');

  assert.match(form, /isFirstUser/);
  assert.match(form, new RegExp(firstAccountHint));
  assert.match(form, new RegExp(normalAccountHint));
});

test('user menu shows explicit account role labels instead of guest mode', async () => {
  const menu = await readFile('src/components/layout/UserMenu.tsx', 'utf8');

  assert.match(menu, /管理员/);
  assert.match(menu, /普通用户/);
  assert.doesNotMatch(menu, /游客模式|user\.isGuest\s*\?/);
});
