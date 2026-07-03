import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('admin todo APIs require admin access and expose summary plus list', async () => {
  const listRoute = await readFile('src/app/api/admin/todos/route.ts', 'utf8');
  const summaryRoute = await readFile('src/app/api/admin/todos/summary/route.ts', 'utf8');
  const approveRoute = await readFile(
    'src/app/api/admin/todos/subscriptions/[id]/approve/route.ts',
    'utf8'
  );

  assert.match(listRoute, /requireAdmin/);
  assert.match(listRoute, /listAdminTodos/);
  assert.match(summaryRoute, /requireAdmin/);
  assert.match(summaryRoute, /getAdminTodoSummary/);
  assert.match(approveRoute, /requireAdmin/);
  assert.match(approveRoute, /approveUserIndustrySubscription/);
});

test('admin todo service aggregates subscription approvals and profile actions', async () => {
  const source = await readFile('src/lib/admin/todos.ts', 'utf8');

  assert.match(source, /pending_approval/);
  assert.match(source, /requiresAdminApproval/);
  assert.match(source, /status,\s*'failed'/);
  assert.match(source, /approveSubscription/);
  assert.match(source, /confirm_profile_expansion/);
  assert.match(source, /retry_profile_provisioning/);
});

test('admin todo page renders global workflow actions', async () => {
  const source = await readFile('src/app/admin/todos/page.tsx', 'utf8');

  assert.match(source, /\/api\/admin\/todos/);
  assert.match(source, /待办事项/);
  assert.match(source, /订阅审批/);
  assert.match(source, /确认扩展/);
  assert.match(source, /重试创建/);
});

test('navigation shows admin-only todo badge from summary API', async () => {
  const badge = await readFile('src/components/layout/AdminTodoBadge.tsx', 'utf8');
  const sidebar = await readFile('src/components/layout/NavSidebar.tsx', 'utf8');
  const bottomNav = await readFile('src/components/layout/BottomNav.tsx', 'utf8');

  assert.match(badge, /\/api\/admin\/todos\/summary/);
  assert.match(badge, /99\+/);
  assert.match(badge, /user\?\.isAdmin/);
  assert.match(sidebar, /AdminTodoBadge/);
  assert.match(bottomNav, /AdminTodoBadge/);
});
