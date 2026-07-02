import assert from 'node:assert/strict';
import test from 'node:test';
import { matchMonitoringProfile, summarizeCriteriaTokens } from '../src/lib/enterprise/profileMatcher';

const profiles = [
  {
    id: 'profile_policy',
    title: '食品安全法规政策',
    seedCriteria: '食品安全管理条例相关',
    criteriaSummary: '关注食品安全法规、条例、监管政策和地方执行动态',
    keywordsJson: '["食品安全","法规","条例","政策","监管"]',
    targetEntitiesJson: '["市场监管部门"]',
    status: 'active',
  },
  {
    id: 'profile_catering',
    title: '餐饮企业经营影响',
    seedCriteria: '食品安全对餐饮公司影响',
    criteriaSummary: '关注食品安全监管对餐饮企业经营、成本、处罚和合规动作的影响',
    keywordsJson: '["食品安全","餐饮","公司","处罚","合规"]',
    targetEntitiesJson: '["餐饮企业"]',
    status: 'active',
  },
];

test('summarizeCriteriaTokens extracts stable Chinese intent tokens', () => {
  assert.deepEqual(
    summarizeCriteriaTokens('食品安全管理条例和监管政策相关'),
    ['食品安全', '管理条例', '监管', '政策']
  );
});

test('matchMonitoringProfile reuses a similar policy profile', () => {
  const result = matchMonitoringProfile({
    customCriteria: '食品安全条例政策解读',
    profiles,
    autoProfileExpansion: false,
  });

  assert.equal(result.action, 'reuse');
  assert.equal(result.profileId, 'profile_policy');
  assert.ok(result.score >= 0.35);
});

test('matchMonitoringProfile creates pending profile for different criteria when auto expansion is off', () => {
  const result = matchMonitoringProfile({
    customCriteria: '预制菜食品安全对连锁餐饮公司的影响',
    profiles: [profiles[0]],
    autoProfileExpansion: false,
  });

  assert.equal(result.action, 'pending');
  assert.equal(result.profileId, undefined);
  assert.match(result.suggestedTitle, /餐饮|食品安全/);
});

test('matchMonitoringProfile creates profile automatically when auto expansion is on', () => {
  const result = matchMonitoringProfile({
    customCriteria: '食品安全对餐饮公司成本和处罚影响',
    profiles: [profiles[0]],
    autoProfileExpansion: true,
  });

  assert.equal(result.action, 'create');
  assert.equal(result.profileId, undefined);
  assert.match(result.suggestedTitle, /餐饮|食品安全/);
});
