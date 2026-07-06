'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Database,
  Mail,
  Plus,
  RefreshCw,
  Settings,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';

interface PoolStats {
  sharedSubscriptionId: string | null;
  sourceCount: number;
  activeSourceCount: number;
  failedSourceCount: number;
  messageCount: number;
  lastCollectedAt: string | null;
  subscriberCount: number;
  activeSubscriberCount: number;
  skippedSubscriberCount: number;
  lastDeliveryStatus: string | null;
  lastDeliveryAt: string | null;
}

interface IndustryPoolRow {
  id: string;
  name: string;
  category: string | null;
  isEnabled: boolean;
  visibility?: 'draft' | 'published';
  deliveryEnabled?: boolean;
  deliveryCron?: string | null;
  updatedAt?: string;
  poolStats?: PoolStats;
}

interface DeliveryRun {
  id: string;
  industryConfigId: string;
  status: 'running' | 'completed' | 'failed';
  error: string | null;
  createdAt: string;
}

interface DeliveryLog {
  id: string;
  runId: string;
  subject: string;
  status: 'sent' | 'skipped' | 'failed';
  error: string | null;
  createdAt: string;
}

function formatDate(value?: string | null) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

function runLabel(status?: string | null) {
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  return '暂无';
}

function badgeVariant(status?: string | null) {
  if (status === 'failed') return 'destructive' as const;
  if (status === 'running') return 'secondary' as const;
  if (status === 'completed') return 'default' as const;
  return 'outline' as const;
}

export default function AdminWorkbenchPage() {
  const { user, loading } = useAuth();
  const { toast } = useToast();
  const [pools, setPools] = useState<IndustryPoolRow[]>([]);
  const [runs, setRuns] = useState<DeliveryRun[]>([]);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const loadData = useCallback(async () => {
    if (!user?.isAdmin) {
      setLoadingData(false);
      return;
    }

    setLoadingData(true);
    const [poolRes, runRes] = await Promise.all([
      fetch('/api/industry-configs'),
      fetch('/api/industry-delivery-runs'),
    ]);
    setLoadingData(false);

    if (!poolRes.ok || !runRes.ok) {
      toast({ title: '加载工作台失败', variant: 'destructive' });
      return;
    }

    const poolData = (await poolRes.json()) as IndustryPoolRow[];
    const runData = (await runRes.json()) as { runs?: DeliveryRun[]; logs?: DeliveryLog[] };
    setPools(Array.isArray(poolData) ? poolData : []);
    setRuns(Array.isArray(runData.runs) ? runData.runs : []);
    setLogs(Array.isArray(runData.logs) ? runData.logs : []);
  }, [toast, user?.isAdmin]);

  useEffect(() => {
    if (!loading) void loadData();
  }, [loadData, loading]);

  const stats = useMemo(() => {
    const published = pools.filter((pool) => pool.visibility === 'published');
    const ready = pools.filter((pool) => !!pool.poolStats?.sharedSubscriptionId);
    const failedSources = pools.reduce(
      (total, pool) => total + (pool.poolStats?.failedSourceCount ?? 0),
      0
    );
    const subscribers = pools.reduce(
      (total, pool) => total + (pool.poolStats?.subscriberCount ?? 0),
      0
    );
    const activeSubscribers = pools.reduce(
      (total, pool) => total + (pool.poolStats?.activeSubscriberCount ?? 0),
      0
    );
    const sentLogs = logs.filter((log) => log.status === 'sent').length;
    const skippedLogs = logs.filter((log) => log.status === 'skipped').length;
    const failedRuns = runs.filter((run) => run.status === 'failed').length;

    return {
      totalPools: pools.length,
      publishedPools: published.length,
      readyPools: ready.length,
      draftPools: pools.length - published.length,
      notReadyPools: pools.length - ready.length,
      failedSources,
      subscribers,
      activeSubscribers,
      sentLogs,
      skippedLogs,
      failedRuns,
    };
  }, [logs, pools, runs]);

  const signals = useMemo(() => {
    const items: Array<{ tone: 'warn' | 'danger' | 'ok'; title: string; detail: string; href: string }> = [];

    if (stats.totalPools === 0) {
      items.push({
        tone: 'warn',
        title: '还没有产业信息池',
        detail: '先新建产业配置，再进入构建向导发布给普通用户订阅。',
        href: '/industry-configs/new',
      });
    }
    if (stats.draftPools > 0) {
      items.push({
        tone: 'warn',
        title: `${stats.draftPools} 个产业方向仍是草稿`,
        detail: '草稿不会出现在普通用户产业目录中。',
        href: '/industry-configs',
      });
    }
    if (stats.notReadyPools > 0) {
      items.push({
        tone: 'warn',
        title: `${stats.notReadyPools} 个信息池尚未构建`,
        detail: '需要管理员完成找源、脚本生成和发布。',
        href: '/industry-configs',
      });
    }
    if (stats.failedSources > 0 || stats.failedRuns > 0) {
      items.push({
        tone: 'danger',
        title: '存在运行异常',
        detail: `${stats.failedSources} 个数据源失败，${stats.failedRuns} 次报送失败。`,
        href: '/industry-configs/monitoring',
      });
    }

    if (items.length === 0) {
      items.push({
        tone: 'ok',
        title: '当前运行状态稳定',
        detail: '没有发现未构建信息池、失败数据源或失败报送。',
        href: '/industry-configs/monitoring',
      });
    }

    return items;
  }, [stats]);

  const recentPools = useMemo(
    () =>
      [...pools]
        .sort((a, b) => new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime())
        .slice(0, 5),
    [pools]
  );

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">加载中...</div>;
  }

  if (!user?.isAdmin) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-lg border border-destructive/40 bg-card p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h1 className="text-lg font-semibold">无权访问</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">只有管理员可以查看工作台。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-cyan-100/78">
            <Database className="h-5 w-5" />
            <span className="text-sm font-medium">管理员工作台</span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-cyan-50">信息池运营总览</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            看清当前产业信息池的发布、构建、订阅和报送状态；需要处理异常时进入实时监控。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/industry-configs/new">
              <Plus className="h-4 w-4" />
              新建产业配置
            </Link>
          </Button>
          <Button variant="outline" onClick={loadData} disabled={loadingData}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>
      </div>

      {loadingData ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Database className="h-4 w-4" />
                产业信息池
              </div>
              <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.totalPools}</div>
              <div className="mt-1 text-xs text-muted-foreground">{stats.publishedPools} 个已发布</div>
            </div>
            <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Activity className="h-4 w-4" />
                构建就绪
              </div>
              <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.readyPools}</div>
              <div className="mt-1 text-xs text-muted-foreground">{stats.notReadyPools} 个待构建</div>
            </div>
            <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                订阅者
              </div>
              <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.subscribers}</div>
              <div className="mt-1 text-xs text-muted-foreground">{stats.activeSubscribers} 人运行中</div>
            </div>
            <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4" />
                最近接收记录
              </div>
              <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.sentLogs}</div>
              <div className="mt-1 text-xs text-muted-foreground">{stats.skippedLogs} 次跳过</div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-cyan-50">今日关注</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    从发布、构建和运行状态里提炼出的管理员动作。
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/industry-configs/monitoring">实时监控</Link>
                </Button>
              </div>
              <div className="grid gap-2">
                {signals.map((signal) => (
                  <Link
                    key={`${signal.title}-${signal.href}`}
                    href={signal.href}
                    className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2 transition-colors hover:border-cyan-300/35 hover:bg-secondary/45"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-cyan-50">{signal.title}</div>
                      <Badge
                        variant={
                          signal.tone === 'danger'
                            ? 'destructive'
                            : signal.tone === 'ok'
                              ? 'default'
                              : 'secondary'
                        }
                      >
                        {signal.tone === 'ok' ? '正常' : '关注'}
                      </Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{signal.detail}</div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-cyan-50">快捷入口</h2>
                  <p className="mt-1 text-sm text-muted-foreground">围绕信息池生命周期的常用动作。</p>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/industry-configs/new">
                    <Plus className="h-4 w-4" />
                    新建产业配置
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/industry-configs">
                    <Database className="h-4 w-4" />
                    产业信息池
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/industry-configs/monitoring">
                    <Activity className="h-4 w-4" />
                    实时监控
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/settings">
                    <Settings className="h-4 w-4" />
                    平台配置
                  </Link>
                </Button>
              </div>
            </section>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-cyan-50">最近信息池</h2>
                  <p className="mt-1 text-sm text-muted-foreground">优先查看最近更新的产业方向。</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/industry-configs">全部信息池</Link>
                </Button>
              </div>
              <div className="grid gap-2">
                {recentPools.map((pool) => {
                  const ready = !!pool.poolStats?.sharedSubscriptionId;
                  return (
                    <Link
                      key={pool.id}
                      href="/industry-configs"
                      className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2 transition-colors hover:border-cyan-300/35 hover:bg-secondary/45"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-cyan-50">{pool.name}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {pool.category || '未分类'} · 更新：{formatDate(pool.updatedAt)}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={pool.visibility === 'published' ? 'default' : 'secondary'}>
                            {pool.visibility === 'published' ? '已发布' : '草稿'}
                          </Badge>
                          <Badge variant={ready ? 'default' : 'outline'}>
                            {ready ? '已构建' : '待构建'}
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  );
                })}
                {recentPools.length === 0 ? (
                  <div className="rounded-md border border-dashed border-cyan-300/30 px-3 py-10 text-center text-sm text-muted-foreground">
                    暂无信息池，先新建一个产业配置。
                  </div>
                ) : null}
              </div>
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-cyan-50">最近报送</h2>
                  <p className="mt-1 text-sm text-muted-foreground">最近的产业邮件报送运行。</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/industry-configs/monitoring">日志</Link>
                </Button>
              </div>
              <div className="grid gap-2">
                {runs.slice(0, 5).map((run) => (
                  <div key={run.id} className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-cyan-50">{formatDate(run.createdAt)}</div>
                      <Badge variant={badgeVariant(run.status)}>{runLabel(run.status)}</Badge>
                    </div>
                    {run.error ? <div className="mt-1 text-xs text-destructive">{run.error}</div> : null}
                  </div>
                ))}
                {runs.length === 0 ? (
                  <div className="rounded-md border border-dashed border-cyan-300/30 px-3 py-10 text-center text-sm text-muted-foreground">
                    暂无报送记录。
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
