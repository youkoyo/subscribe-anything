import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('pool confirmation configures one shared collection frequency instead of one selector per source', async () => {
  const step4 = await readFile('src/components/wizard/Step4Confirm.tsx', 'utf8');

  assert.match(step4, /const \[poolCron, setPoolCron\]/);
  assert.match(step4, /cronExpression: poolCron/);
  assert.match(step4, /信息池采集频率/);
  assert.doesNotMatch(step4, /handleCronSelectChange\(idx/);
});
