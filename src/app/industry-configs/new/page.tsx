'use client';

import { AlertTriangle } from 'lucide-react';
import IndustryConfigCreateForm from '@/components/industry-configs/IndustryConfigCreateForm';
import { useAuth } from '@/contexts/AuthContext';

export default function NewIndustryConfigPage() {
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
          <p className="mt-2 text-sm text-muted-foreground">只有管理员可以新建产业配置。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <IndustryConfigCreateForm />
    </div>
  );
}
