'use client';

import { AlertTriangle } from 'lucide-react';
import IndustryMonitoring from '@/components/industry-configs/IndustryMonitoring';
import { useAuth } from '@/contexts/AuthContext';

export default function IndustryMonitoringPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-lg border border-destructive/40 bg-card p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">无权访问</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">只有管理员可以查看实时监控。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm font-medium text-cyan-100/78">管理员</div>
          <h1 className="mt-2 text-2xl font-semibold text-cyan-50">实时监控</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            关注产业信息池的采集源、入池消息、订阅者、覆盖提醒和邮件报送结果。
          </p>
        </div>
      </div>
      <IndustryMonitoring />
    </div>
  );
}
