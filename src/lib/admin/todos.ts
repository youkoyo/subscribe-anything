import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryMonitoringProfiles,
  userIndustrySubscriptions,
  users,
} from '@/lib/db/schema';

export type AdminTodoType =
  | 'approve_subscription'
  | 'confirm_profile_expansion'
  | 'retry_profile_provisioning';

export interface AdminTodoItem {
  id: string;
  type: AdminTodoType;
  title: string;
  industryName: string;
  userLabel: string;
  customCriteria: string;
  reason: string;
  actionLabel: string;
  actionEndpoint: string;
  updatedAt: Date;
}

export interface AdminTodoSummary {
  total: number;
  approveSubscription: number;
  confirmProfileExpansion: number;
  retryProfileProvisioning: number;
}

function userLabel(user: { email: string | null; name: string | null } | null | undefined) {
  return user?.name || user?.email || '未知用户';
}

function sortTodos(items: AdminTodoItem[]) {
  return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}

export function listAdminTodos(): AdminTodoItem[] {
  const db = getDb();

  const approvalTodos = db
    .select({
      subscription: userIndustrySubscriptions,
      industry: industryConfigs,
      user: {
        email: users.email,
        name: users.name,
      },
    })
    .from(userIndustrySubscriptions)
    .innerJoin(industryConfigs, eq(userIndustrySubscriptions.industryConfigId, industryConfigs.id))
    .leftJoin(users, eq(userIndustrySubscriptions.userId, users.id))
    .where(eq(userIndustrySubscriptions.status, 'pending_approval'))
    .orderBy(desc(userIndustrySubscriptions.updatedAt))
    .all()
    .map(({ subscription, industry, user }) => ({
      id: `subscription:${subscription.id}`,
      type: 'approve_subscription' as const,
      title: '订阅审批',
      industryName: industry.name,
      userLabel: userLabel(user),
      customCriteria: subscription.customCriteria,
      reason: '该产业方向需要管理员审批后才能进入采集池匹配流程。',
      actionLabel: '通过',
      actionEndpoint: `/api/admin/todos/subscriptions/${subscription.id}/approve`,
      updatedAt: subscription.updatedAt,
    }));

  const expansionTodos = db
    .select({
      profile: industryMonitoringProfiles,
      industry: industryConfigs,
      user: {
        email: users.email,
        name: users.name,
      },
    })
    .from(industryMonitoringProfiles)
    .innerJoin(industryConfigs, eq(industryMonitoringProfiles.industryConfigId, industryConfigs.id))
    .leftJoin(users, eq(industryMonitoringProfiles.triggeredByUserId, users.id))
    .where(eq(industryMonitoringProfiles.requiresAdminApproval, true))
    .orderBy(desc(industryMonitoringProfiles.updatedAt))
    .all()
    .map(({ profile, industry, user }) => ({
      id: `profile-approval:${profile.id}`,
      type: 'confirm_profile_expansion' as const,
      title: '确认扩展采集池',
      industryName: industry.name,
      userLabel: userLabel(user),
      customCriteria: profile.seedCriteria,
      reason: '用户监控条件和已有采集池差异较大，需要确认是否扩展新的共享采集池。',
      actionLabel: '确认扩展',
      actionEndpoint: `/api/industry-profiles/${profile.id}/approve`,
      updatedAt: profile.updatedAt,
    }));

  const retryTodos = db
    .select({
      profile: industryMonitoringProfiles,
      industry: industryConfigs,
      user: {
        email: users.email,
        name: users.name,
      },
    })
    .from(industryMonitoringProfiles)
    .innerJoin(industryConfigs, eq(industryMonitoringProfiles.industryConfigId, industryConfigs.id))
    .leftJoin(users, eq(industryMonitoringProfiles.triggeredByUserId, users.id))
    .where(eq(industryMonitoringProfiles.status, 'failed'))
    .orderBy(desc(industryMonitoringProfiles.updatedAt))
    .all()
    .map(({ profile, industry, user }) => ({
      id: `profile-retry:${profile.id}`,
      type: 'retry_profile_provisioning' as const,
      title: '重试采集池创建',
      industryName: industry.name,
      userLabel: userLabel(user),
      customCriteria: profile.seedCriteria,
      reason: profile.provisioningError
        ? `采集池创建失败：${profile.provisioningError}`
        : '采集池创建失败，需要重新触发创建流程。',
      actionLabel: '重试创建',
      actionEndpoint: `/api/industry-profiles/${profile.id}/retry`,
      updatedAt: profile.updatedAt,
    }));

  return sortTodos([...approvalTodos, ...expansionTodos, ...retryTodos]);
}

export function getAdminTodoSummary(): AdminTodoSummary {
  const todos = listAdminTodos();
  return {
    total: todos.length,
    approveSubscription: todos.filter((todo) => todo.type === 'approve_subscription').length,
    confirmProfileExpansion: todos.filter((todo) => todo.type === 'confirm_profile_expansion')
      .length,
    retryProfileProvisioning: todos.filter((todo) => todo.type === 'retry_profile_provisioning')
      .length,
  };
}
