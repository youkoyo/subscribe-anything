'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MyIndustrySubscriptions from '@/components/enterprise/MyIndustrySubscriptions';
import SubscriptionList from '@/components/subscriptions/SubscriptionList';
import { useAuth } from '@/contexts/AuthContext';

function markNewWizard() {
  sessionStorage.setItem('wizard-new', '1');
}

export default function SubscriptionsPage() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">我的订阅</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              查看已订阅的信息池，维护你的个性化监控条件和收件邮箱配置。
            </p>
          </div>
          <Link href="/industry-configs">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              打开产业目录
            </Button>
          </Link>
        </div>
        <MyIndustrySubscriptions />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <div className="hidden md:flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">我的订阅</h1>
        <Link href="/subscriptions/new" onClick={markNewWizard}>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            新建订阅
          </Button>
        </Link>
      </div>

      <h1 className="text-2xl font-semibold mb-4 md:hidden">我的订阅</h1>

      <SubscriptionList />

      <Link href="/subscriptions/new" className="md:hidden" onClick={markNewWizard}>
        <button
          aria-label="新建订阅"
          className="fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center touch-manipulation active:scale-95 transition-transform"
        >
          <Plus className="h-6 w-6" />
        </button>
      </Link>
    </div>
  );
}
