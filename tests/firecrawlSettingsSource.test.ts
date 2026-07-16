import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Firecrawl has an admin-managed configuration with a masked key and a connection test', async () => {
  const [schema, collector, settingsPage, form, route, testRoute] = await Promise.all([
    readFile('src/lib/db/schema.ts', 'utf8'),
    readFile('src/lib/firecrawl/collector.ts', 'utf8'),
    readFile('src/app/settings/page.tsx', 'utf8'),
    readFile('src/components/settings/FirecrawlConfigForm.tsx', 'utf8'),
    readFile('src/app/api/settings/firecrawl/route.ts', 'utf8'),
    readFile('src/app/api/settings/firecrawl/test/route.ts', 'utf8'),
  ]);

  assert.match(schema, /export const firecrawlConfig = pgTable\('firecrawl_config'/);
  assert.match(collector, /firecrawlConfig/);
  assert.match(collector, /await getFirecrawlApiKey\(\)/);
  assert.match(settingsPage, /FirecrawlConfigForm/);
  assert.match(form, /hasExistingKey/);
  assert.match(form, /测试连接/);
  assert.match(route, /requireAdmin/);
  assert.match(route, /apiKey: ''/);
  assert.match(testRoute, /api\.firecrawl\.dev\/v2\/scrape/);
});

test('industry creation shows an explicit animated build state while submission is pending', async () => {
  const form = await readFile('src/components/industry-configs/IndustryConfigCreateForm.tsx', 'utf8');

  assert.match(form, /Loader2/);
  assert.match(form, /正在建立产业画像/);
  assert.match(form, /aria-live="polite"/);
  assert.match(form, /animate-pulse/);
  assert.match(form, /aria-busy=\{submitting\}/);
});
