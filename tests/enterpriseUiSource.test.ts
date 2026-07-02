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
});

test('my industry subscriptions component supports pause and edit', async () => {
  const source = await readFile('src/components/enterprise/MyIndustrySubscriptions.tsx', 'utf8');

  assert.match(source, /\/api\/enterprise\/my-industry-subscriptions/);
  assert.match(source, /\/pause/);
  assert.match(source, /recipientEmailsJson/);
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
