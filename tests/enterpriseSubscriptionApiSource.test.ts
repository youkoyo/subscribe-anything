import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('enterprise catalog route exposes published industry configs', async () => {
  const source = await readFile('src/app/api/enterprise/industry-catalog/route.ts', 'utf8');

  assert.match(source, /requireAuth/);
  assert.match(source, /listPublishedIndustryConfigsForUser/);
  assert.match(source, /Response\.json\(await listPublishedIndustryConfigsForUser/);
});

test('enterprise subscription route creates user industry subscriptions', async () => {
  const source = await readFile('src/app/api/enterprise/industry-subscriptions/route.ts', 'utf8');

  assert.match(source, /createUserIndustrySubscription/);
  assert.match(source, /normalizeRecipientEmails/);
});

test('subscription service binds users to monitoring profiles', async () => {
  const source = await readFile('src/lib/enterprise/subscriptionService.ts', 'utf8');

  assert.match(source, /matchMonitoringProfile/);
  assert.match(source, /userIndustrySubscriptions/);
  assert.match(source, /industryMonitoringProfiles/);
  assert.match(source, /pending_approval/);
  assert.match(source, /pending_profile/);
});

test('my subscription routes are scoped to the current user', async () => {
  const listRoute = await readFile(
    'src/app/api/enterprise/my-industry-subscriptions/route.ts',
    'utf8'
  );
  const itemRoute = await readFile(
    'src/app/api/enterprise/my-industry-subscriptions/[id]/route.ts',
    'utf8'
  );
  const pauseRoute = await readFile(
    'src/app/api/enterprise/my-industry-subscriptions/[id]/pause/route.ts',
    'utf8'
  );

  assert.match(listRoute, /session\.userId/);
  assert.match(listRoute, /Response\.json\(await listMyIndustrySubscriptions\(session\.userId\)/);
  assert.match(itemRoute, /session\.userId/);
  assert.match(pauseRoute, /session\.userId/);
});

test('a user can permanently cancel only their own industry subscription', async () => {
  const [itemRoute, service, ui] = await Promise.all([
    readFile('src/app/api/enterprise/my-industry-subscriptions/[id]/route.ts', 'utf8'),
    readFile('src/lib/enterprise/subscriptionService.ts', 'utf8'),
    readFile('src/components/enterprise/MyIndustrySubscriptions.tsx', 'utf8'),
  ]);

  assert.match(itemRoute, /export async function DELETE/);
  assert.match(itemRoute, /deleteMyIndustrySubscription\(id, session\.userId\)/);
  assert.match(service, /export async function deleteMyIndustrySubscription/);
  assert.match(service, /db\.delete\(userIndustrySubscriptions\)/);
  assert.match(service, /eq\(userIndustrySubscriptions\.userId, userId\)/);
  assert.match(ui, /method: 'DELETE'/);
  assert.match(ui, /取消订阅/);
});

test('admin industry subscriber route lists users and monitoring progress', async () => {
  const route = await readFile(
    'src/app/api/industry-configs/[id]/subscriptions/route.ts',
    'utf8'
  );
  const service = await readFile('src/lib/enterprise/subscriptionService.ts', 'utf8');

  assert.match(route, /requireAdmin/);
  assert.match(route, /listIndustrySubscribersForAdmin/);
  assert.match(route, /Response\.json\(await listIndustrySubscribersForAdmin\(id\)/);
  assert.match(service, /export async function listIndustrySubscribersForAdmin/);
  assert.match(service, /users/);
  assert.match(service, /userIndustrySubscriptions\.industryConfigId/);
  assert.match(service, /industryMonitoringProfiles/);
});
