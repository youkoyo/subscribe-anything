import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SOURCE_PREFERENCES, buildPreferredSourceQueries } from '../src/lib/ai/agents/sourcePreferences';

test('ships national mainstream fact sources by default without regional assumptions', () => {
  const names = DEFAULT_SOURCE_PREFERENCES.map((source) => source.name);
  assert.ok(names.includes('新华网'));
  assert.ok(names.includes('人民网'));
  assert.ok(names.includes('中国新闻网'));
  assert.ok(names.includes('央视新闻'));
  assert.equal(names.some((name) => /福建|泉州|晋江/.test(name)), false);
  assert.equal(DEFAULT_SOURCE_PREFERENCES.filter((source) => source.priority === 'required').length >= 4, true);
});

test('builds site-restricted searches for required administrator sources first', () => {
  const queries = buildPreferredSourceQueries('鞋厂火灾 最新通报', DEFAULT_SOURCE_PREFERENCES, 4);
  assert.equal(queries.length, 4);
  assert.match(queries[0], /site:news\.cn/);
  assert.match(queries[1], /site:people\.com\.cn/);
});
