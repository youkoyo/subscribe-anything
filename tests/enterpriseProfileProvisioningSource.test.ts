import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('profile provisioner queues the managed pipeline for shared collection pools', async () => {
  const source = await readFile('src/lib/enterprise/profileProvisioner.ts', 'utf8');

  assert.match(source, /enqueueManagedPipelineJob/);
  assert.match(source, /sharedSubscriptionId/);
  assert.match(source, /status: 'creating'/);
  assert.match(source, /provisioningError/);
});

test('admin profile routes require admin access', async () => {
  const profilesRoute = await readFile(
    'src/app/api/industry-configs/[id]/profiles/route.ts',
    'utf8'
  );
  const approveRoute = await readFile(
    'src/app/api/industry-profiles/[id]/approve/route.ts',
    'utf8'
  );
  const retryRoute = await readFile('src/app/api/industry-profiles/[id]/retry/route.ts', 'utf8');

  assert.match(profilesRoute, /requireAdmin/);
  assert.match(profilesRoute, /Response\.json\(await listMonitoringProfilesForIndustry\(id\)/);
  assert.match(approveRoute, /requireAdmin/);
  assert.match(retryRoute, /requireAdmin/);
});

test('profile approval can trigger provisioning', async () => {
  const source = await readFile('src/app/api/industry-profiles/[id]/approve/route.ts', 'utf8');

  assert.match(source, /approveMonitoringProfile/);
  assert.match(source, /startProfileProvisioning/);
});
