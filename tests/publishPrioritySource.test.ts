import assert from 'node:assert/strict';
import test from 'node:test';

test('publishing provisions sources with validated news before deferred sources', async () => {
  const module = await import('../src/lib/subscriptionCreator') as unknown as {
    prioritizeSourcesForPublish?: (sources: Array<{ title: string; initialItems?: unknown[] }>) => {
      priority: Array<{ title: string }>;
      deferred: Array<{ title: string }>;
    };
  };

  assert.equal(typeof module.prioritizeSourcesForPublish, 'function');
  const result = module.prioritizeSourcesForPublish!([
    { title: '待补齐源', initialItems: [] },
    { title: '已有新闻源', initialItems: [{ title: '新闻' }] },
    { title: '另一个已有新闻源', initialItems: [{ title: '新闻' }] },
  ]);

  assert.deepEqual(result.priority.map((source) => source.title), ['已有新闻源', '另一个已有新闻源']);
  assert.deepEqual(result.deferred.map((source) => source.title), ['待补齐源']);
});
