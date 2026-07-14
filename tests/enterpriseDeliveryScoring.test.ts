import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveDeliverySelection,
  scoreDeliveryCard,
  selectDeliveryCards,
} from '../src/lib/enterprise/deliveryScoring';

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

test('selectDeliveryCards keeps industry pool cards when custom criteria is empty', () => {
  const selected = selectDeliveryCards({
    cards: [
      {
        id: 'industry-update',
        title: '行业协会发布本周产业运行简报',
        summary: null,
        sourceName: null,
        publishedAt: new Date('2026-07-02T03:00:00Z'),
        createdAt: new Date('2026-07-02T03:00:00Z'),
      },
    ],
    customCriteria: '',
    now: new Date('2026-07-02T09:00:00Z'),
    maxItems: 5,
  });

  assert.equal(selected.length, 1);
  assert.equal(selected[0].card.id, 'industry-update');
  assert.equal(selected[0].score.relevance, 100);
  assert.equal(selected[0].score.matchReason, '产业信息池匹配');
});

test('resolveDeliverySelection falls back to previously delivered cards when there are no new cards', () => {
  const selection = resolveDeliverySelection({
    newCards: [],
    previousCards: cards,
    customCriteria: '食品安全管理条例相关',
    now: new Date('2026-07-02T09:00:00Z'),
    maxItems: 3,
  });

  assert.equal(selection.mode, 'previous');
  assert.ok(selection.selected.length > 0);
  assert.equal(selection.selected[0].card.id, 'regulation');
});

test('resolveDeliverySelection returns an empty status when neither new nor previous cards exist', () => {
  const selection = resolveDeliverySelection({
    newCards: [],
    previousCards: [],
    customCriteria: '食品安全管理条例相关',
    now: new Date('2026-07-02T09:00:00Z'),
    maxItems: 3,
  });

  assert.equal(selection.mode, 'empty');
  assert.equal(selection.selected.length, 0);
});

test('selectDeliveryCards matches natural-language chemical risk criteria', () => {
  const selected = selectDeliveryCards({
    cards: [
      {
        id: 'chemical-leak',
        title: '山东一化工厂发生危化品泄漏，部分装置临时停车',
        summary: '事故导致上游原料供应偏紧，多家企业调整采购计划。',
        sourceName: '化工行业观察',
        publishedAt: new Date('2026-07-08T02:00:00Z'),
        createdAt: new Date('2026-07-08T02:10:00Z'),
      },
      {
        id: 'generic',
        title: '今日化工行业会议召开',
        summary: '多家企业交流数字化管理经验。',
        sourceName: '行业媒体',
        publishedAt: new Date('2026-07-08T03:00:00Z'),
        createdAt: new Date('2026-07-08T03:10:00Z'),
      },
    ],
    customCriteria: '关注最近三天内化工企业安全事故，以及可能影响供应链稳定的风险事件',
    now: new Date('2026-07-08T08:00:00Z'),
    maxItems: 5,
  });

  assert.equal(selected[0].card.id, 'chemical-leak');
  assert.ok(selected[0].score.relevance >= 70);
  assert.match(selected[0].score.matchReason ?? '', /泄漏/);
});
