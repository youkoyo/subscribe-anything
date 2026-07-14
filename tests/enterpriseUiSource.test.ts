import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry page renders admin manager for admins and user catalog for normal users', async () => {
  const source = await readFile('src/app/industry-configs/page.tsx', 'utf8');

  assert.match(source, /useAuth/);
  assert.match(source, /IndustryConfigManager/);
  assert.match(source, /IndustryCatalog/);
  assert.match(source, /MyIndustrySubscriptions/);
});

test('user industry catalog calls enterprise subscription APIs', async () => {
  const source = await readFile('src/components/enterprise/IndustryCatalog.tsx', 'utf8');

  assert.match(source, /\/api\/enterprise\/industry-catalog/);
  assert.match(source, /\/api\/enterprise\/industry-subscriptions/);
  assert.match(source, /customCriteria/);
  assert.match(source, /extraRecipientEmails/);
  assert.match(source, /onSubscriptionCreated/);
});

test('industry subscriptions allow an empty personalized criteria', async () => {
  const [catalogSource, routeSource, serviceSource] = await Promise.all([
    readFile('src/components/enterprise/IndustryCatalog.tsx', 'utf8'),
    readFile('src/app/api/enterprise/industry-subscriptions/route.ts', 'utf8'),
    readFile('src/lib/enterprise/subscriptionService.ts', 'utf8'),
  ]);

  assert.doesNotMatch(catalogSource, /!customCriteria\.trim\(\)/);
  assert.doesNotMatch(routeSource, /customCriteria is required/);
  assert.doesNotMatch(serviceSource, /CUSTOM_CRITERIA_REQUIRED/);
  assert.match(serviceSource, /input\.customCriteria === undefined \? existing\.customCriteria : input\.customCriteria\.trim\(\)/);
  assert.match(serviceSource, /const criteriaForProfile = row\.subscription\.customCriteria \|\| row\.industry\.name/);
});

test('my industry subscriptions component supports pause and edit', async () => {
  const source = await readFile('src/components/enterprise/MyIndustrySubscriptions.tsx', 'utf8');

  assert.match(source, /\/api\/enterprise\/my-industry-subscriptions/);
  assert.match(source, /\/pause/);
  assert.match(source, /recipientEmailsJson/);
  assert.match(source, /getIndustrySubscriptionProgress/);
  assert.match(source, /refreshKey/);
});

test('admin industry manager exposes enterprise delivery and publication fields', async () => {
  const source = await readFile(
    'src/components/industry-configs/IndustryConfigManager.tsx',
    'utf8'
  );

  assert.match(source, /visibility/);
  assert.match(source, /subscriptionMode/);
  assert.match(source, /autoProfileExpansion/);
  assert.match(source, /deliveryCron/);
  assert.match(source, /maxItemsPerEmail/);
});

test('admin industry manager exposes direct publish and unpublish actions', async () => {
  const source = await readFile(
    'src/components/industry-configs/IndustryConfigManager.tsx',
    'utf8'
  );

  assert.match(source, /handlePublish/);
  assert.match(source, /\/api\/industry-configs\/\$\{config\.id\}\/publish/);
  assert.match(source, /published:\s*config\.visibility !== 'published'/);
  assert.match(source, /onClick=\{\(\) => handlePublish\(config\)\}/);
});

test('admin industry manager exposes subscriber details for each industry', async () => {
  const source = await readFile(
    'src/components/industry-configs/IndustryConfigManager.tsx',
    'utf8'
  );

  assert.match(source, /IndustrySubscriberRow/);
  assert.match(source, /openSubscribers/);
  assert.match(source, /\/api\/industry-configs\/\$\{config\.id\}\/subscriptions/);
  assert.match(source, /订阅详情/);
});

test('admin industry manager explains optional subscriber criteria and labels pool-wide subscriptions', async () => {
  const source = await readFile(
    'src/components/industry-configs/IndustryConfigManager.tsx',
    'utf8'
  );

  assert.match(source, /个性化条件为可选/);
  assert.match(source, /接收整个产业信息池/);
});

test('admin industry manager links an established industry pool to its detail page', async () => {
  const source = await readFile(
    'src/components/industry-configs/IndustryConfigManager.tsx',
    'utf8'
  );

  assert.match(source, /pool\?\.sharedSubscriptionId/);
  assert.match(source, /href=\{`\/subscriptions\/\$\{pool\.sharedSubscriptionId\}`\}/);
  assert.match(source, /查看信息池/);
});

test('industry page refreshes my subscriptions after catalog subscription creation', async () => {
  const source = await readFile('src/app/industry-configs/page.tsx', 'utf8');

  assert.match(source, /subscriptionRefreshKey/);
  assert.match(source, /onSubscriptionCreated/);
  assert.match(source, /refreshKey=\{subscriptionRefreshKey\}/);
});
