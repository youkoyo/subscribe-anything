import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreDeliveryCard, selectDeliveryCards } from '../src/lib/enterprise/deliveryScoring';

const cards = [
  {
    id: 'regulation',
    title: '市场监管总局发布食品安全管理条例修订说明',
    summary: '涉及食品安全管理条例、监管政策和地方执行要求。',
    sourceName: '市场监管总局',
    publishedAt: new Date('2026-07-02T01:00:00Z'),
    createdAt: new Date('2026-07-02T01:00:00Z'),
  },
  {
    id: 'catering',
    title: '食品安全检查影响多家餐饮公司经营成本',
    summary: '多地餐饮企业因食品安全合规要求增加检测和整改成本。',
    sourceName: '行业媒体',
    publishedAt: new Date('2026-07-02T02:00:00Z'),
    createdAt: new Date('2026-07-02T02:00:00Z'),
  },
  {
    id: 'generic',
    title: '今日食品行业资讯汇总',
    summary: '整理近期食品行业资讯。',
    sourceName: '聚合站',
    publishedAt: new Date('2026-07-02T03:00:00Z'),
    createdAt: new Date('2026-07-02T03:00:00Z'),
  },
];

test('scoreDeliveryCard prioritizes relevance to custom criteria', () => {
  const regulationScore = scoreDeliveryCard(
    cards[0],
    '食品安全管理条例相关',
    new Date('2026-07-02T09:00:00Z')
  );
  const genericScore = scoreDeliveryCard(
    cards[2],
    '食品安全管理条例相关',
    new Date('2026-07-02T09:00:00Z')
  );

  assert.ok(regulationScore.total > genericScore.total);
  assert.ok(regulationScore.relevance > genericScore.relevance);
});

test('selectDeliveryCards returns top relevant cards within max count', () => {
  const selected = selectDeliveryCards({
    cards,
    customCriteria: '食品安全对餐饮公司影响',
    now: new Date('2026-07-02T09:00:00Z'),
    maxItems: 2,
  });

  assert.equal(selected.length, 2);
  assert.equal(selected[0].card.id, 'catering');
  assert.ok(selected[0].score.total >= selected[1].score.total);
});
