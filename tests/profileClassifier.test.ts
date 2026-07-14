import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyProfileRelevance,
  type IndustryTermProfile,
} from '../src/lib/industry-configs/term-profile';
import { selectProfileCandidates } from '../src/lib/industry-configs/profile-classifier';

function makeProfile(overrides: Partial<IndustryTermProfile> = {}): IndustryTermProfile {
  return {
    version: 2,
    canonicalIndustry: '甲行业',
    strictTerms: ['甲行业'],
    entityTerms: ['甲工厂'],
    productTerms: ['甲产品'],
    supplyChainTerms: [],
    riskEventTerms: ['火灾'],
    industryContextTerms: ['制造业'],
    exclusionTerms: [],
    sourcePreferences: ['authoritative'],
    ...overrides,
  };
}

test('only semantic candidate slots reach AI classification', () => {
  const candidates = selectProfileCandidates(makeProfile(), [
    { id: 'a', title: '某地火灾通报' },
    { id: 'b', title: '甲工厂火灾通报' },
  ]);

  assert.deepEqual(candidates.map((item) => item.id), ['b']);
});

test('deterministic relevance keeps only strict matches when AI is unavailable', () => {
  const profile = makeProfile();

  assert.equal(classifyProfileRelevance(profile, { title: '甲行业政策发布' }).label, 'strong');
  assert.equal(classifyProfileRelevance(profile, { title: '甲工厂火灾' }).label, 'irrelevant');
});
