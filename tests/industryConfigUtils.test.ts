import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIndustryConfigSnapshot,
  buildIndustrySubscriptionSuggestion,
  decodeStringList,
  encodeStringList,
  normalizeStringList,
} from '../src/lib/industry-configs/utils';

test('normalizeStringList trims, deduplicates, and drops empty values', () => {
  assert.deepEqual(
    normalizeStringList([' 化工 ', '', '危化品', '化工', '  ']),
    ['化工', '危化品']
  );
});

test('encodeStringList and decodeStringList round-trip clean arrays', () => {
  const encoded = encodeStringList(['爆炸', '泄漏', '爆炸']);
  assert.equal(encoded, '["爆炸","泄漏"]');
  assert.deepEqual(decodeStringList(encoded), ['爆炸', '泄漏']);
});

test('decodeStringList tolerates invalid JSON', () => {
  assert.deepEqual(decodeStringList('{not json'), []);
});

test('buildIndustryConfigSnapshot converts DB JSON strings to arrays', () => {
  const snapshot = buildIndustryConfigSnapshot({
    id: 'cfg_1',
    name: '化工原料产业',
    category: '化工产业',
    subCategory: '化工原料',
    description: '关注危化品生产和园区监管',
    keywordsJson: '["危化品","化工园区"]',
    riskTermsJson: '["爆炸","环保处罚"]',
    regionsJson: '["山东","江苏"]',
    entitiesJson: '["重点园区"]',
    sourceTypesJson: '["authority","news"]',
    alertLevel: '需跟踪',
  });

  assert.deepEqual(snapshot.keywords, ['危化品', '化工园区']);
  assert.deepEqual(snapshot.riskTerms, ['爆炸', '环保处罚']);
  assert.equal(snapshot.alertLevel, '需跟踪');
});

test('buildIndustrySubscriptionSuggestion creates topic and criteria text', () => {
  const suggestion = buildIndustrySubscriptionSuggestion({
    id: 'cfg_1',
    name: '化工原料产业',
    category: '化工产业',
    subCategory: '化工原料',
    description: '',
    keywords: ['危化品', '化工园区'],
    riskTerms: ['爆炸', '环保处罚'],
    regions: ['山东'],
    entities: [],
    sourceTypes: ['authority'],
    alertLevel: '重点关注',
  });

  assert.equal(suggestion.topic, '化工原料产业动态监测');
  assert.match(suggestion.criteria, /危化品/);
  assert.match(suggestion.criteria, /环保处罚/);
  assert.match(suggestion.criteria, /山东/);
});
