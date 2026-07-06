'use client';

import Link from 'next/link';
import { BookOpen, Factory, Mail, ShieldCheck, UserRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import MyIndustrySubscriptions from '@/components/enterprise/MyIndustrySubscriptions';
import { useAuth } from '@/contexts/AuthContext';

export default function UserPersonalSettings() {
  const { user } = useAuth();
  const displayName = user?.name || user?.email || '当前用户';
  const defaultEmail = user?.email || '未绑定邮箱';

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md border border-cyan-300/25 bg-secondary/40 p-2 text-cyan-100">
              <UserRound className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-base font-semibold text-cyan-50">{displayName}</h2>
                <Badge variant="outline">{user?.isGuest ? '访客' : '普通用户'}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                你的个人配置只影响自己的订阅条件和邮件接收，不会改变企业信息池的数据源和脚本。
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md border border-cyan-300/25 bg-secondary/40 p-2 text-cyan-100">
              <Mail className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-cyan-50">默认接收邮箱</h2>
              <p className="mt-2 break-all text-sm text-cyan-50/82">{defaultEmail}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                每个订阅还可以单独补充额外收件邮箱，适合抄送同事或团队邮箱。
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-cyan-300/25 bg-card p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-cyan-100/78">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-sm font-medium">权限边界</span>
            </div>
            <h2 className="mt-2 text-base font-semibold text-cyan-50">信息池由管理员维护</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              普通用户只选择已发布的信息池，并维护自己的筛选条件、接收邮箱和暂停状态；找源、脚本生成、运行监控和发布由管理员处理。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/industry-configs">
                <Factory className="h-4 w-4" />
                产业目录
              </Link>
            </Button>
            <Button asChild>
              <Link href="/subscriptions">
                <BookOpen className="h-4 w-4" />
                我的订阅
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-cyan-50">订阅接收配置</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            在这里修改每个产业订阅的个性化监控条件和额外收件邮箱。
          </p>
        </div>
        <MyIndustrySubscriptions className="mt-0" title="可编辑订阅" />
      </section>
    </div>
  );
}
