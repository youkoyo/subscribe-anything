import assert from 'node:assert/strict';
import test from 'node:test';
import { validateScript } from '../src/lib/ai/tools/validateScript';

test('rejects an incomplete top-level await snippet before sandbox execution', async () => {
  const result = await validateScript("const xml = await resp.text();\nif (!xml) return [];\n");

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /完整的 async function collect/);
});

test('rejects HTML accidentally supplied as a script', async () => {
  const result = await validateScript('<div class="pgStyle">1</div>');

  assert.equal(result.success, false);
  assert.match(result.error ?? '', /HTML/);
});
