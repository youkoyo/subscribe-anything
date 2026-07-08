import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDeliveryCriteria,
  scoreCardAgainstCriteria,
} from '../src/lib/enterprise/criteriaMatcher';

test('parseDeliveryCriteria expands chemical safety accident language into matchable terms', () => {
  const criteria = parseDeliveryCriteria(
    '关注最近三天内化工企业安全事故，以及可能影响供应链稳定的风险事件'
  );

  assert.equal(criteria.timeWindowDays, 3);
  assert.ok(criteria.groups.some((group) => group.name === '行业' && group.terms.includes('化工厂')));
  assert.ok(criteria.groups.some((group) => group.name === '安全事件' && group.terms.includes('泄漏')));
  assert.ok(criteria.groups.some((group) => group.name === '供应链影响' && group.terms.includes('供应中断')));
});

test('scoreCardAgainstCriteria matches semantically related chemical incidents without exact wording', () => {
  const criteria = parseDeliveryCriteria(
    '关注最近三天内化工企业安全事故，以及可能影响供应链稳定的风险事件'
  );

  const result = scoreCardAgainstCriteria(
    {
      id: 'chemical-leak',
      title: '山东一化工厂发生危化品泄漏，部分装置临时停车',
      summary: '事故导致上游原料供应偏紧，多家企业调整采购计划。',
      sourceName: '化工行业观察',
      publishedAt: new Date('2026-07-08T02:00:00Z'),
      createdAt: new Date('2026-07-08T02:10:00Z'),
    },
    criteria,
    new Date('2026-07-08T08:00:00Z')
  );

  assert.ok(result.matched);
  assert.ok(result.score >= 70);
  assert.match(result.reason, /化工厂|危化品/);
  assert.match(result.reason, /泄漏/);
  assert.match(result.reason, /供应/);
});

test('scoreCardAgainstCriteria preserves user-entered professional product terms', () => {
  const criteria = parseDeliveryCriteria('关注丙烯酸、MMA、环氧丙烷价格异常波动');

  const result = scoreCardAgainstCriteria(
    {
      id: 'mma-price',
      title: 'MMA 市场报价上调，丙烯酸供应偏紧',
      summary: '环氧丙烷价格波动加剧，下游企业观望情绪升温。',
      sourceName: '化工价格网',
      publishedAt: new Date('2026-07-08T02:00:00Z'),
      createdAt: new Date('2026-07-08T02:10:00Z'),
    },
    criteria,
    new Date('2026-07-08T08:00:00Z')
  );

  assert.ok(result.matched);
  assert.ok(result.score >= 70);
  assert.match(result.reason, /MMA/);
  assert.match(result.reason, /丙烯酸/);
});

test('scoreCardAgainstCriteria rejects cards outside explicit day window', () => {
  const criteria = parseDeliveryCriteria('关注最近三天内化工企业安全事故');

  const result = scoreCardAgainstCriteria(
    {
      id: 'old-accident',
      title: '某化工企业发生安全事故',
      summary: '监管部门通报整改要求。',
      sourceName: '监管通报',
      publishedAt: new Date('2026-07-01T02:00:00Z'),
      createdAt: new Date('2026-07-01T02:10:00Z'),
    },
    criteria,
    new Date('2026-07-08T08:00:00Z')
  );

  assert.equal(result.matched, false);
  assert.match(result.reason, /超过最近 3 天/);
});
