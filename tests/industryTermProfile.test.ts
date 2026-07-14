import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  needsIndustryProfileExpansion,
  normalizeIndustryTermProfile,
  profileCandidateTerms,
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
  assert.doesNotMatch(agent, /鞋业|鞋厂|芯片|餐饮/);
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
  assert.equal(needsIndustryProfileExpansion({ ...minimal, entityTerms: ['鞋厂'] }), false);
});
