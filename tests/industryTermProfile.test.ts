import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  needsIndustryProfileExpansion,
  normalizeIndustryTermProfile,
  profileCandidateTerms,
  buildProfileCollectionHint,
} from '../src/lib/industry-configs/term-profile';

test('v2 profile exposes semantic candidate slots without industry-specific expansion', () => {
  const profile = normalizeIndustryTermProfile({
    version: 2,
    canonicalIndustry: '产业甲',
    strictTerms: ['产业甲'],
    entityTerms: ['产业甲工厂'],
    productTerms: ['甲产品'],
    supplyChainTerms: ['甲供应链'],
    riskEventTerms: ['火灾'],
    industryContextTerms: ['制造业'],
    exclusionTerms: [],
  }, {
    topic: '产业甲',
    sourcePreferences: ['authoritative'],
  });

  assert.equal(profile.version, 2);
  assert.deepEqual(profileCandidateTerms(profile), ['产业甲', '产业甲工厂', '甲产品', '甲供应链']);
  assert.equal(profileCandidateTerms(profile).includes('火灾'), false);
});

test('profile agent requests every v2 semantic slot and has no industry examples', async () => {
  const agent = await readFile('src/lib/ai/agents/industryProfileAgent.ts', 'utf8');

  for (const field of ['entityTerms', 'productTerms', 'supplyChainTerms', 'riskEventTerms']) {
    assert.match(agent, new RegExp(field));
  }
  assert.match(agent, /coverageRequirements/);
  assert.match(agent, /repairPrompt/);
  assert.match(agent, /reviewPrompt/);
  assert.match(agent, /operatingContextTerms/);
  assert.match(agent, /独立出现于地方新闻标题/);
  assert.match(agent, /不应以城市、公司或事件限定词代替/);
  assert.doesNotMatch(agent, /鞋业|鞋厂|芯片|餐饮/);
});

test('industry-specific operating contexts are candidates while generic risk words remain insufficient', () => {
  const profile = normalizeIndustryTermProfile({
    canonicalIndustry: '产业甲',
    strictTerms: ['产业甲', '甲业'],
    entityTerms: ['甲制造商', '甲企业', '甲工厂', '甲园区'],
    productTerms: ['甲产品', '甲材料', '甲工艺'],
    supplyChainTerms: ['甲生产', '甲订单', '甲出口'],
    operatingContextTerms: ['甲生产车间', '甲产业园', '甲生产线', '甲代工厂'],
    riskEventTerms: ['火灾', '召回', '停产'],
    industryContextTerms: [],
    exclusionTerms: [],
  }, { topic: '产业甲' });

  assert.equal(profileCandidateTerms(profile).includes('甲生产车间'), true);
  assert.equal(profileCandidateTerms(profile).includes('火灾'), false);
  assert.equal(needsIndustryProfileExpansion(profile), false);
});

test('a profile with only the canonical industry name must be expanded before collection', () => {
  const minimal = normalizeIndustryTermProfile({
    version: 2,
    canonicalIndustry: '鞋业',
    strictTerms: ['鞋业'],
    entityTerms: [],
    productTerms: [],
    supplyChainTerms: [],
    riskEventTerms: [],
    industryContextTerms: [],
    exclusionTerms: [],
  }, {
    topic: '鞋业',
    sourcePreferences: ['authoritative'],
  });

  assert.equal(needsIndustryProfileExpansion(minimal), true);
  assert.equal(needsIndustryProfileExpansion({ ...minimal, entityTerms: ['鞋厂'] }), true);
  assert.equal(needsIndustryProfileExpansion({
    ...minimal,
    strictTerms: ['鞋业', '制鞋'],
    entityTerms: ['鞋厂', '制鞋企业', '鞋类制造商', '鞋类品牌商'],
    operatingContextTerms: ['制鞋车间', '鞋类生产线', '鞋业园区', '鞋类代工'],
    productTerms: ['运动鞋', '皮鞋', '鞋材'],
    supplyChainTerms: ['制鞋生产', '出口订单', '代工'],
    riskEventTerms: ['安全事故', '产品召回', '贸易摩擦'],
  }), false);
});

test('collection hint carries the complete industry portrait, not only the raw user criteria', () => {
  const profile = normalizeIndustryTermProfile({
    canonicalIndustry: '鞋业',
    strictTerms: ['鞋业', '制鞋'],
    entityTerms: ['鞋厂', '鞋企'],
    operatingContextTerms: ['制鞋车间'],
    productTerms: ['运动鞋'],
    supplyChainTerms: ['鞋类代工'],
  }, { topic: '鞋业' });

  const hint = buildProfileCollectionHint(profile, '国内鞋业相关');
  assert.match(hint, /鞋厂/);
  assert.match(hint, /制鞋车间/);
  assert.match(hint, /鞋类代工/);
  assert.match(hint, /国内鞋业相关/);
});
