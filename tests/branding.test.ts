import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('app branding uses the Nebula Prism platform name', async () => {
  const { APP_NAME } = await import('../src/lib/branding');

  assert.equal(APP_NAME, '星云棱镜产业信息订阅平台');
});

test('public app chrome does not expose the GitHub repository button', async () => {
  const appBar = await readFile('src/components/layout/AppBar.tsx', 'utf8');
  const navSidebar = await readFile('src/components/layout/NavSidebar.tsx', 'utf8');

  assert.doesNotMatch(appBar, /github/i);
  assert.doesNotMatch(navSidebar, /github/i);
});

test('public app chrome does not expose theme switching controls', async () => {
  const appBar = await readFile('src/components/layout/AppBar.tsx', 'utf8');
  const navSidebar = await readFile('src/components/layout/NavSidebar.tsx', 'utf8');

  assert.doesNotMatch(appBar, /ThemeToggle/);
  assert.doesNotMatch(navSidebar, /ThemeToggle/);
});
