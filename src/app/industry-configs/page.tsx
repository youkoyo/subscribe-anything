'use client';

import { useState } from 'react';
import IndustryCatalog from '@/components/enterprise/IndustryCatalog';
import MyIndustrySubscriptions from '@/components/enterprise/MyIndustrySubscriptions';
import IndustryConfigManager from '@/components/industry-configs/IndustryConfigManager';
import { useAuth } from '@/contexts/AuthContext';

export default function IndustryConfigsPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;
  const [subscriptionRefreshKey, setSubscriptionRefreshKey] = useState(0);

  if (isAdmin) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">产业方向管理</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            维护企业级产业方向、订阅权限、需求扩展策略和邮件报送规则。
          </p>
        </div>
        <IndustryConfigManager />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">产业订阅</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          选择管理员发布的产业方向，补充你的监控条件，系统会按企业统一节奏发送个性化邮件。
        </p>
      </div>
      <IndustryCatalog onSubscriptionCreated={() => setSubscriptionRefreshKey((key) => key + 1)} />
      <MyIndustrySubscriptions refreshKey={subscriptionRefreshKey} />
    </div>
  );
}
