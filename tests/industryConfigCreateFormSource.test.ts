import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry creation UI is natural-language first and explains the curated RSS policy', async () => {
  const source = await readFile('src/components/industry-configs/IndustryConfigCreateForm.tsx', 'utf8');

  assert.match(source, /产业名称/);
  assert.match(source, /关注方向/);
  assert.match(source, /SOURCE_PREFERENCES/);
  assert.match(source, /aria-pressed/);
  assert.match(source, /预置 RSS/);
  assert.match(source, /全部可用 RSS/);
  assert.match(source, /强相关和有关/);
  assert.match(source, /motion-reduce/);
  assert.doesNotMatch(source, /每分钟/);
});

test('industry config form is shared by creation and editing surfaces', async () => {
  const form = await readFile('src/components/industry-configs/IndustryConfigForm.tsx', 'utf8');
  const create = await readFile('src/components/industry-configs/IndustryConfigCreateForm.tsx', 'utf8');

  assert.match(form, /IndustryConfigForm/);
  assert.match(form, /IndustryConfigCreateForm/);
  assert.match(create, /export interface IndustryConfigFormValues/);
  assert.match(create, /SOURCE_PREFERENCES/);
  assert.match(create, /aria-pressed/);
  assert.match(create, /高级资料/);
  assert.match(create, /发布与投递/);
  assert.match(create, /IndustryConfigForm/);
});
