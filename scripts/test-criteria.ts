// scripts/test-criteria.ts
// Quick smoke test: parse a few user criteria inputs through the same criteria
// parser the delivery pipeline uses, and print the extracted term groups so we
// can verify the single-character / synonym expansion behaves as expected.
//
// Run with:
//   tsx --env-file=.env.local scripts/test-criteria.ts

import {
  parseDeliveryCriteria,
  scoreCardAgainstCriteria,
} from '../src/lib/enterprise/criteriaMatcher';

const testInputs = [
  '鞋',
  '鞋业',
  '鞋类动态',
  '化工事故',
  'AI',
  '关注最近一周的化工安全',
  '新能源汽车',
  '车',
];

// Sample card titles pulled from the actual 鞋业 pool for realism.
const sampleCards = [
  { id: 'a', title: '福建已成立晋江鞋厂火灾事故调查组', summary: '', sourceName: '中国新闻网 国内频道', publishedAt: new Date('2026-07-10'), createdAt: new Date('2026-07-10') },
  { id: 'b', title: '中国皮革协会党支部召开党纪学习教育专题研讨会', summary: '', sourceName: '中国皮革协会官网', publishedAt: new Date('2026-07-01'), createdAt: new Date('2026-07-01') },
  { id: 'c', title: '秘鲁生产部为中小型皮革和鞋类企业举办循环经济研讨会', summary: '涉及鞋类行业循环经济', sourceName: '中国皮革协会官网', publishedAt: new Date('2026-07-03'), createdAt: new Date('2026-07-03') },
  { id: 'd', title: '印度议员呼吁免除皮革行业公司的贷款', summary: '', sourceName: '中国皮革协会官网', publishedAt: new Date('2026-07-10'), createdAt: new Date('2026-07-10') },
  { id: 'e', title: '李宁收购的火柴棍将开启中国市场销售', summary: '火柴棍是运动品牌', sourceName: '中国皮革协会官网', publishedAt: new Date('2026-06-25'), createdAt: new Date('2026-06-25') },
  { id: 'f', title: '第41届国际鞋业大会在越南胡志明市召开', summary: '', sourceName: '中国皮革协会官网', publishedAt: new Date('2026-07-09'), createdAt: new Date('2026-07-09') },
];

for (const input of testInputs) {
  const parsed = parseDeliveryCriteria(input);
  console.log(`\n=== 输入: "${input}" ===`);
  console.log(`  timeWindowDays: ${parsed.timeWindowDays ?? '无'}`);
  console.log(`  groups: ${parsed.groups.length}`);
  for (const g of parsed.groups) {
    const preview = g.terms.length > 8 ? `${g.terms.slice(0, 8).join('、')}... +${g.terms.length - 8}` : g.terms.join('、');
    console.log(`    [${g.name} weight=${g.weight}] ${preview}`);
  }

  // Score each sample card
  const scored = sampleCards
    .map((c) => ({
      card: c,
      result: scoreCardAgainstCriteria(c, parsed, new Date('2026-07-10')),
    }))
    .sort((a, b) => b.result.score - a.result.score);

  console.log(`  命中:`);
  for (const s of scored.filter((s) => s.result.matched)) {
    console.log(`    [${s.result.score}分] ${s.card.title.slice(0, 60)}`);
  }
}
