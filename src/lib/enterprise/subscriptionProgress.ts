export type SubscriptionProgressBadge = 'default' | 'secondary' | 'destructive' | 'outline';

export interface IndustrySubscriptionProgressInput {
  subscriptionStatus: string | null | undefined;
  profileStatus: string | null | undefined;
  provisioningError?: string | null;
}

export interface IndustrySubscriptionProgress {
  label: string;
  detail: string;
  step: number;
  totalSteps: number;
  badgeVariant: SubscriptionProgressBadge;
}

export function getIndustrySubscriptionProgress(
  input: IndustrySubscriptionProgressInput
): IndustrySubscriptionProgress {
  const subscriptionStatus = input.subscriptionStatus ?? 'pending_profile';
  const profileStatus = input.profileStatus ?? null;

  if (subscriptionStatus === 'paused') {
    return {
      label: '已暂停',
      detail: '这条订阅已暂停，不会参与定时邮件报送。',
      step: 1,
      totalSteps: 4,
      badgeVariant: 'secondary',
    };
  }

  if (subscriptionStatus === 'rejected') {
    return {
      label: '审批未通过',
      detail: '管理员未通过这条订阅申请，可以调整监控条件后再提交。',
      step: 1,
      totalSteps: 4,
      badgeVariant: 'destructive',
    };
  }

  if (subscriptionStatus === 'pending_approval') {
    return {
      label: '等待管理员审批',
      detail: '订阅已提交，正在等待管理员确认是否允许订阅该产业方向。',
      step: 1,
      totalSteps: 4,
      badgeVariant: 'outline',
    };
  }

  if (profileStatus === 'failed') {
    return {
      label: '创建失败',
      detail: input.provisioningError
        ? `采集池创建失败：${input.provisioningError}`
        : '采集池创建失败，需要管理员重试或调整数据源。',
      step: 2,
      totalSteps: 4,
      badgeVariant: 'destructive',
    };
  }

  if (subscriptionStatus === 'active') {
    return {
      label: '运行中',
      detail: '订阅已生效，系统会按管理员配置的时间发送个性化邮件。',
      step: 4,
      totalSteps: 4,
      badgeVariant: 'default',
    };
  }

  if (subscriptionStatus === 'pending_profile') {
    if (profileStatus === 'creating') {
      return {
        label: '创建采集池中',
        detail: 'AI 正在为这个监控方向创建或扩展共享采集池。',
        step: 3,
        totalSteps: 4,
        badgeVariant: 'outline',
      };
    }

    if (profileStatus === 'pending') {
      return {
        label: '等待扩展采集池',
        detail: '你的监控条件和已有采集池差异较大，正在等待管理员确认扩展。',
        step: 2,
        totalSteps: 4,
        badgeVariant: 'outline',
      };
    }

    return {
      label: '匹配采集池中',
      detail: '系统正在判断是否复用已有采集池，或为该方向创建新的采集池。',
      step: 2,
      totalSteps: 4,
      badgeVariant: 'outline',
    };
  }

  return {
    label: '处理中',
    detail: '订阅正在处理中，稍后会更新到明确状态。',
    step: 1,
    totalSteps: 4,
    badgeVariant: 'outline',
  };
}
