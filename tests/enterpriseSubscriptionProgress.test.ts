import assert from 'node:assert/strict';
import test from 'node:test';
import { getIndustrySubscriptionProgress } from '../src/lib/enterprise/subscriptionProgress';

test('subscription progress explains approval state', () => {
  const progress = getIndustrySubscriptionProgress({
    subscriptionStatus: 'pending_approval',
    profileStatus: null,
  });

  assert.equal(progress.label, '等待管理员审批');
  assert.equal(progress.step, 1);
});

test('subscription progress explains matching and provisioning states', () => {
  assert.equal(
    getIndustrySubscriptionProgress({
      subscriptionStatus: 'pending_profile',
      profileStatus: null,
    }).label,
    '匹配采集池中'
  );

  assert.equal(
    getIndustrySubscriptionProgress({
      subscriptionStatus: 'pending_profile',
      profileStatus: 'pending',
    }).label,
    '等待扩展采集池'
  );

  assert.equal(
    getIndustrySubscriptionProgress({
      subscriptionStatus: 'pending_profile',
      profileStatus: 'creating',
    }).label,
    '创建采集池中'
  );
});

test('subscription progress explains active, paused and failed states', () => {
  assert.equal(
    getIndustrySubscriptionProgress({
      subscriptionStatus: 'active',
      profileStatus: 'active',
    }).label,
    '运行中'
  );

  assert.equal(
    getIndustrySubscriptionProgress({
      subscriptionStatus: 'paused',
      profileStatus: 'active',
    }).label,
    '已暂停'
  );

  const failed = getIndustrySubscriptionProgress({
    subscriptionStatus: 'pending_profile',
    profileStatus: 'failed',
    provisioningError: '脚本生成失败',
  });

  assert.equal(failed.label, '创建失败');
  assert.match(failed.detail, /脚本生成失败/);
});
