import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('large subscription views defer LLM log UI and do not keep idle source polling alive', async () => {
  const [detailPage, sourcesPage] = await Promise.all([
    readFile('src/app/subscriptions/[id]/page.tsx', 'utf8'),
    readFile('src/app/subscriptions/[id]/sources/page.tsx', 'utf8'),
  ]);

  assert.match(detailPage, /import dynamic from 'next\/dynamic'/);
  assert.match(detailPage, /dynamic\(\(\) => import\('\@\/components\/debug\/LLMLogDialog'\)/);
  assert.doesNotMatch(detailPage, /import LLMLogDialog from/);
  assert.match(sourcesPage, /const hasBackgroundWork =/);
  assert.match(sourcesPage, /if \(!hasBackgroundWork\) \{/);
  assert.match(sourcesPage, /setHasBackendWork\(Object\.keys\(body\.states\)\.length > 0\)/);
});
