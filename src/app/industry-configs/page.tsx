'use client';

import IndustryCatalog from '@/components/enterprise/IndustryCatalog';
import IndustryConfigManager from '@/components/industry-configs/IndustryConfigManager';
import { useAuth } from '@/contexts/AuthContext';

export default function IndustryConfigsPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;

  if (isAdmin) {
    return (
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <div className="mb-6">
          <div className="text-sm font-medium text-cyan-100/78">管理员</div>
          <h1 className="mt-2 text-2xl font-semibold text-cyan-50">产业信息池</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            管理员维护企业级产业信息池，完成找源、脚本生成和验证后发布给普通用户订阅。
          </p>
        </div>
        <IndustryConfigManager />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <div className="mb-6">
        <div className="text-sm font-medium text-cyan-100/78">普通用户</div>
        <h1 className="mt-2 text-2xl font-semibold text-cyan-50">产业目录</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          选择管理员发布的产业信息池，补充你的监控条件和收件邮箱；采集源与脚本由管理员统一维护。
        </p>
      </div>
      <IndustryCatalog />
    </div>
  );
}
