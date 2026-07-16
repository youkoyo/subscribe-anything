'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Database, Mail, RefreshCw, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface PoolStats {
  profileId: string | null;
  profileStatus: string | null;
  sharedSubscriptionId: string | null;
  profileCount: number;
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
  maxItemsPerEmail?: number;
  updatedAt?: string;
  poolStats?: PoolStats;
}

interface DeliveryRun {
  id: string;
  industryConfigId: string;
  scheduledFor: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  createdAt: string;
}

interface DeliveryLog {
  id: string;
  runId: string;
  userIndustrySubscriptionId: string;
  recipientEmailsJson: string;
  selectedCardIdsJson: string;
  subject: string;
  status: 'sent' | 'skipped' | 'failed';
  error: string | null;
  sentAt: string | null;
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

function statusLabel(status?: string | null) {
  if (status === 'sent') return '已发送';
  if (status === 'skipped') return '已跳过';
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'active') return '已启用';
  if (status === 'creating') return '创建中';
  if (status === 'pending') return '待处理';
  if (status === 'disabled') return '已停用';
  return '暂无';
}

function statusVariant(status?: string | null) {
  if (status === 'failed') return 'destructive' as const;
  if (status === 'skipped') return 'secondary' as const;
  if (status === 'running' || status === 'creating' || status === 'pending') return 'secondary' as const;
  if (status === 'completed' || status === 'active' || status === 'sent') return 'default' as const;
  return 'outline' as const;
}

function parseJsonList(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function IndustryMonitoring() {
  const { toast } = useToast();
  const [pools, setPools] = useState<IndustryPoolRow[]>([]);
  const [runs, setRuns] = useState<DeliveryRun[]>([]);
  const [logs, setLogs] = useState<DeliveryLog[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [poolRes, runRes] = await Promise.all([
      fetch('/api/industry-configs'),
      fetch('/api/industry-delivery-runs'),
    ]);
    setLoading(false);

    if (!poolRes.ok || !runRes.ok) {
      toast({ title: '加载实时监控失败', variant: 'destructive' });
      return;
    }

    const poolData = (await poolRes.json()) as IndustryPoolRow[];
    const runData = (await runRes.json()) as { runs?: DeliveryRun[]; logs?: DeliveryLog[] };
    setPools(Array.isArray(poolData) ? poolData : []);
    setRuns(Array.isArray(runData.runs) ? runData.runs : []);
    setLogs(Array.isArray(runData.logs) ? runData.logs : []);
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const activePools = pools.filter((item) => !!item.poolStats?.sharedSubscriptionId);
    return {
      activePools: activePools.length,
      activeSources: pools.reduce((total, item) => total + (item.poolStats?.activeSourceCount ?? 0), 0),
      activeSubscribers: pools.reduce(
        (total, item) => total + (item.poolStats?.activeSubscriberCount ?? 0),
        0
      ),
      failedSignals:
        pools.reduce((total, item) => total + (item.poolStats?.failedSourceCount ?? 0), 0) +
        runs.filter((run) => run.status === 'failed').length,
    };
  }, [pools, runs]);

  const warnings = useMemo(
    () =>
      pools.flatMap((pool) => {
        const items: string[] = [];
        const stats = pool.poolStats;
        if (!stats?.sharedSubscriptionId) items.push('信息池尚未构建');
        if ((stats?.failedSourceCount ?? 0) > 0) items.push(`${stats?.failedSourceCount} 个数据源失败`);
        if ((stats?.subscriberCount ?? 0) > 0 && !pool.deliveryEnabled) items.push('已有订阅者但报送未启用');
        if ((stats?.skippedSubscriberCount ?? 0) > 0) items.push(`${stats?.skippedSubscriberCount} 个订阅待绑定`);
        return items.map((message) => ({ id: `${pool.id}-${message}`, poolName: pool.name, message }));
      }),
    [pools]
  );

  if (loading) {
    return (
      <div className="grid gap-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-28 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="h-4 w-4" />
            运行信息池
          </div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.activePools}</div>
        </div>
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4" />
            启用数据源
          </div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.activeSources}</div>
        </div>
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Users className="h-4 w-4" />
            活跃订阅者
          </div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.activeSubscribers}</div>
        </div>
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            待关注信号
          </div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{stats.failedSignals + warnings.length}</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-cyan-50">信息池运行状态</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            汇总每个产业信息池的源、消息、订阅者和最近报送状态。
          </p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="h-4 w-4" />
          刷新
        </Button>
      </div>

      <div className="grid gap-3">
        {pools.map((pool) => {
          const stats = pool.poolStats;
          const hasPool = !!stats?.sharedSubscriptionId;
          return (
            <article key={pool.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-cyan-50">{pool.name}</h3>
                    <Badge variant={hasPool ? 'default' : 'outline'}>
                      {hasPool ? '信息池就绪' : '待构建'}
                    </Badge>
                    <Badge variant={pool.deliveryEnabled ? 'default' : 'secondary'}>
                      {pool.deliveryEnabled ? '报送启用' : '报送关闭'}
                    </Badge>
                    <Badge variant={statusVariant(stats?.lastDeliveryStatus)}>
                      最近报送：{statusLabel(stats?.lastDeliveryStatus)}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {pool.category || '未分类'} ·{' '}
                    {pool.deliveryEnabled ? '按统一投递设置' : '未启用投递'}{' '}
                    · 最近采集：
                    {formatDate(stats?.lastCollectedAt)}
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 text-xs md:grid-cols-4">
                  <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                    <div className="text-muted-foreground">数据源</div>
                    <div className="mt-1 font-semibold text-cyan-50">
                      {stats?.activeSourceCount ?? 0}/{stats?.sourceCount ?? 0}
                    </div>
                  </div>
                  <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                    <div className="text-muted-foreground">入池消息</div>
                    <div className="mt-1 font-semibold text-cyan-50">{stats?.messageCount ?? 0}</div>
                  </div>
                  <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                    <div className="text-muted-foreground">订阅者</div>
                    <div className="mt-1 font-semibold text-cyan-50">
                      {stats?.activeSubscriberCount ?? 0}/{stats?.subscriberCount ?? 0}
                    </div>
                  </div>
                  <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                    <div className="text-muted-foreground">最近报送</div>
                    <div className="mt-1 font-semibold text-cyan-50">{formatDate(stats?.lastDeliveryAt)}</div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        {pools.length === 0 ? (
          <div className="rounded-lg border border-dashed border-cyan-300/35 bg-card/70 px-6 py-10 text-center text-sm text-muted-foreground">
            暂无产业信息池。
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-cyan-50">覆盖提醒</h2>
            <Badge variant="outline">{warnings.length} 条</Badge>
          </div>
          <div className="grid gap-2">
            {warnings.map((warning) => (
              <div
                key={warning.id}
                className="rounded-md border border-amber-300/25 bg-amber-400/10 px-3 py-2 text-sm"
              >
                <div className="font-medium text-amber-100">{warning.poolName}</div>
                <div className="mt-1 text-amber-100/78">{warning.message}</div>
              </div>
            ))}
            {warnings.length === 0 ? (
              <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-8 text-center text-sm text-muted-foreground">
                当前没有需要处理的覆盖提醒。
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-cyan-50">报送日志</h2>
            <Badge variant="outline">{runs.length} 次运行</Badge>
          </div>
          <div className="grid gap-2">
            {runs.slice(0, 8).map((run) => {
              const runLogs = logs.filter((log) => log.runId === run.id);
              const sent = runLogs.filter((log) => log.status === 'sent').length;
              const skipped = runLogs.filter((log) => log.status === 'skipped').length;
              const failed = runLogs.filter((log) => log.status === 'failed').length;
              return (
                <div key={run.id} className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-cyan-100/72" />
                      <span className="text-sm font-medium text-cyan-50">{formatDate(run.createdAt)}</span>
                    </div>
                    <Badge variant={statusVariant(run.status)}>{statusLabel(run.status)}</Badge>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    发送 {sent} · 跳过 {skipped} · 失败 {failed}
                    {run.error ? ` · ${run.error}` : ''}
                  </div>
                </div>
              );
            })}

            {runs.length === 0 ? (
              <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-8 text-center text-sm text-muted-foreground">
                暂无报送日志。
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-cyan-50">用户接收记录</h2>
          <Badge variant="outline">{logs.length} 条</Badge>
        </div>
        <div className="grid gap-2">
          {logs.slice(0, 10).map((log) => {
            const recipients = parseJsonList(log.recipientEmailsJson);
            const selectedCards = parseJsonList(log.selectedCardIdsJson);
            return (
              <div key={log.id} className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-cyan-50">{log.subject}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {recipients.join('、') || '未配置邮箱'} · {selectedCards.length} 条候选 ·{' '}
                      {formatDate(log.createdAt)}
                    </div>
                  </div>
                  <Badge variant={statusVariant(log.status)}>{statusLabel(log.status)}</Badge>
                </div>
              </div>
            );
          })}
          {logs.length === 0 ? (
            <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-8 text-center text-sm text-muted-foreground">
              暂无用户接收记录。
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
