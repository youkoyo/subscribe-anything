'use client';

import IndustryConfigManager from '@/components/industry-configs/IndustryConfigManager';

export default function IndustryConfigsPage() {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">产业配置</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          维护常用产业画像，新建订阅时可直接套用关键词、风险词、区域和关注对象。
        </p>
      </div>

      <IndustryConfigManager />
    </div>
  );
}
