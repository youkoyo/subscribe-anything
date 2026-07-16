import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('script generation stops as soon as primary or repaired script passes review', async () => {
  const source = await readFile('src/lib/ai/agents/generateScriptAgent.ts', 'utf8');

  const primarySuccess = source.indexOf('if (llmCheck.valid) {');
  const primaryReturn = source.indexOf('return {', primarySuccess);
  const primaryNextBranch = source.indexOf('} else if (llmCheck.fixedScript)', primarySuccess);
  assert.ok(primarySuccess >= 0 && primaryReturn > primarySuccess && primaryReturn < primaryNextBranch);

  const repairSuccess = source.indexOf('if (fixLlmCheck.valid) {');
  const repairReturn = source.indexOf('return {', repairSuccess);
  const repairNextBranch = source.indexOf('} else {', repairSuccess);
  assert.ok(repairSuccess >= 0 && repairReturn > repairSuccess && repairReturn < repairNextBranch);
});
