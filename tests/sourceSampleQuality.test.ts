import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessInitialItemsQuality,
  isReusableGeneratedSample,
} from '../src/lib/ai/agents/sourceSampleQuality';

const now = new Date('2026-07-12T08:00:00Z');
const criteria = '最近的国内鞋业产业相关信息资讯';

test('rejects a successful script when its sample has no recent footwear content', () => {
  const result = assessInitialItemsQuality(
    [
      {
        title: '多地发布房地产市场调控政策',
        url: 'https://example.com/property',
        summary: '各地持续优化住房政策。',
        publishedAt: '2026-07-11T09:00:00Z',
      },
      {
        title: '福建鞋业博览会回顾',
        url: 'https://example.com/old-shoe',
        summary: '行业活动回顾。',
        publishedAt: '2025-07-01T09:00:00Z',
      },
    ],
    criteria,
    now
  );

  assert.equal(result.valid, false);
  assert.match(result.reason, /近14天/);
});

test('accepts a current shoe-factory fire report for a footwear subscription', () => {
  const result = assessInitialItemsQuality(
    [
      {
        title: '福建晋江一鞋厂发生火灾，当地正在处置',
        url: 'https://example.com/jinjiang-fire',
        summary: '事故发生在晋江制鞋产业集聚区，相关部门已开展处置。',
        publishedAt: '2026-07-11T14:00:00Z',
      },
    ],
    criteria,
    now
  );

  assert.equal(result.valid, true);
  assert.equal(result.recentMatchingCount, 1);
});

test('does not reuse a legacy success log whose initial items are irrelevant', () => {
  assert.equal(
    isReusableGeneratedSample(
      [
        {
          title: '国内宏观经济数据发布',
          url: 'https://example.com/economy',
          publishedAt: '2026-07-11T14:00:00Z',
        },
      ],
      criteria,
      now
    ),
    false
  );
});
