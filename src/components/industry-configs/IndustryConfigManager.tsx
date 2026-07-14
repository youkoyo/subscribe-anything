'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Database,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Send,
  Activity,
  Trash2,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { parseRecipientEmailsJson } from '@/lib/enterprise/recipientEmails';
import { getIndustrySubscriptionProgress } from '@/lib/enterprise/subscriptionProgress';
import {
  DEFAULT_EMAIL_DELIVERY_CRON,
  EMAIL_DELIVERY_SLOTS,
  findEmailDeliverySlot,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_OPTIONS,
  type IndustryConfigInput,
  type IndustryConfigSnapshot,
  type IndustrySourceType,
  type IndustrySubscriptionSuggestion,
} from '@/lib/industry-configs/types';
import { cn } from '@/lib/utils';

interface IndustryConfigView {
  id: string;
  name: string;
  category: string | null;
  subCategory: string | null;
  alertLevel: string | null;
  isEnabled: boolean;
  visibility?: 'draft' | 'published';
  subscriptionMode?: 'open' | 'approval_required';
  autoProfileExpansion?: boolean;
  deliveryCron?: string | null;
  deliveryTimezone?: string;
  deliveryEnabled?: boolean;
  maxItemsPerEmail?: number;
  updatedAt?: string;
  snapshot: IndustryConfigSnapshot;
  suggestion: IndustrySubscriptionSuggestion;
  poolStats?: {
    profileId: string | null;
    profileStatus: string | null;
    sharedSubscriptionId: string | null;
    profileCount: number;
    sourceCount: number;
    activeSourceCount: number;
    failedSourceCount: number;
    messageCount: number;
    lastCollectedAt: string | Date | null;
    subscriberCount: number;
    activeSubscriberCount: number;
    skippedSubscriberCount: number;
    lastDeliveryStatus: string | null;
    lastDeliveryAt: string | Date | null;
  };
}

interface IndustrySubscriberRow {
  subscription: {
    id: string;
    status: string;
    customCriteria: string;
    recipientEmailsJson: string;
    updatedAt?: string;
  };
  user: {
    id: string;
    email: string | null;
    name: string | null;
  };
  profile: {
    title: string;
    status: string;
    provisioningError?: string | null;
  } | null;
}

interface FormState {
  name: string;
  category: string;
  subCategory: string;
  description: string;
  keywords: string;
  riskTerms: string;
  regions: string;
  entities: string;
  sourceTypes: IndustrySourceType[];
  alertLevel: string;
  isEnabled: boolean;
  visibility: 'draft' | 'published';
  subscriptionMode: 'open' | 'approval_required';
  autoProfileExpansion: boolean;
  deliveryCron: string;
  deliveryTimezone: string;
  deliveryEnabled: boolean;
  maxItemsPerEmail: number;
}

const emptyForm: FormState = {
  name: '',
  category: '',
  subCategory: '',
  description: '',
  keywords: '',
  riskTerms: '',
  regions: '',
  entities: '',
  sourceTypes: ['authority', 'news'],
  alertLevel: '一般关注',
  isEnabled: true,
  visibility: 'draft',
  subscriptionMode: 'open',
  autoProfileExpansion: false,
  deliveryCron: DEFAULT_EMAIL_DELIVERY_CRON,
  deliveryTimezone: 'Asia/Shanghai',
  deliveryEnabled: false,
  maxItemsPerEmail: 10,
};

const alertLevels = ['一般关注', '重点关注', '高风险预警'];

function splitList(value: string) {
  return value
    .split(/[\n,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value: string[]) {
  return value.join('\n');
}

function toForm(config: IndustryConfigView): FormState {
  const { snapshot } = config;

  return {
    name: snapshot.name,
    category: snapshot.category,
    subCategory: snapshot.subCategory,
    description: snapshot.description,
    keywords: joinList(snapshot.keywords),
    riskTerms: joinList(snapshot.riskTerms),
    regions: joinList(snapshot.regions),
    entities: joinList(snapshot.entities),
    sourceTypes: snapshot.sourceTypes.length > 0 ? snapshot.sourceTypes : ['authority', 'news'],
    alertLevel: snapshot.alertLevel || '一般关注',
    isEnabled: config.isEnabled,
    visibility: config.visibility ?? 'draft',
    subscriptionMode: config.subscriptionMode ?? 'open',
    autoProfileExpansion: config.autoProfileExpansion === true,
    deliveryCron: findEmailDeliverySlot(config.deliveryCron)?.cron
      ?? config.deliveryCron
      ?? DEFAULT_EMAIL_DELIVERY_CRON,
    deliveryTimezone: config.deliveryTimezone ?? 'Asia/Shanghai',
    deliveryEnabled: config.deliveryEnabled === true,
    maxItemsPerEmail: config.maxItemsPerEmail ?? 10,
  };
}

function toPayload(form: FormState): IndustryConfigInput {
  return {
    name: form.name,
    category: form.category,
    subCategory: form.subCategory,
    description: form.description,
    keywords: splitList(form.keywords),
    riskTerms: splitList(form.riskTerms),
    regions: splitList(form.regions),
    entities: splitList(form.entities),
    sourceTypes: form.sourceTypes,
    alertLevel: form.alertLevel,
    isEnabled: form.isEnabled,
    visibility: form.visibility,
    subscriptionMode: form.subscriptionMode,
    autoProfileExpansion: form.autoProfileExpansion,
    deliveryCron: form.deliveryCron,
    deliveryTimezone: form.deliveryTimezone,
    deliveryEnabled: form.deliveryEnabled,
    maxItemsPerEmail: form.maxItemsPerEmail,
  };
}

function formatUpdatedAt(value?: string) {
  if (!value) return '刚刚更新';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚更新';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

export default function IndustryConfigManager() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<IndustryConfigView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IndustryConfigView | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [subscriberConfig, setSubscriberConfig] = useState<IndustryConfigView | null>(null);
  const [subscriberRows, setSubscriberRows] = useState<IndustrySubscriberRow[]>([]);
  const [subscriberLoading, setSubscriberLoading] = useState(false);

  const enabledCount = useMemo(() => configs.filter((item) => item.isEnabled).length, [configs]);
  const publishedCount = useMemo(
    () => configs.filter((item) => item.visibility === 'published').length,
    [configs]
  );
  const activePoolCount = useMemo(
    () => configs.filter((item) => !!item.poolStats?.sharedSubscriptionId).length,
    [configs]
  );
  const subscriberCount = useMemo(
    () => configs.reduce((total, item) => total + (item.poolStats?.subscriberCount ?? 0), 0),
    [configs]
  );

  const fetchConfigs = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/industry-configs');
      if (!res.ok) throw new Error('Failed to load industry configs');
      const data = (await res.json()) as IndustryConfigView[];
      setConfigs(data);
    } catch {
      setError('加载产业配置失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((config: IndustryConfigView) => {
    setEditing(config);
    setForm(toForm(config));
    setDialogOpen(true);
  }, []);

  const updateField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleSourceType = useCallback((sourceType: IndustrySourceType) => {
    setForm((prev) => {
      const selected = prev.sourceTypes.includes(sourceType);
      const next = selected
        ? prev.sourceTypes.filter((item) => item !== sourceType)
        : [...prev.sourceTypes, sourceType];

      return { ...prev, sourceTypes: next.length > 0 ? next : prev.sourceTypes };
    });
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!form.name.trim()) {
      toast({ title: '请填写产业名称', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const url = editing ? `/api/industry-configs/${editing.id}` : '/api/industry-configs';
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(form)),
      });

      if (!res.ok) throw new Error('Failed to save industry config');

      await fetchConfigs();
      setDialogOpen(false);
      toast({ title: editing ? '产业配置已更新' : '产业配置已创建' });
    } catch {
      toast({ title: '保存失败', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  }, [editing, fetchConfigs, form, toast]);

  const handleDelete = useCallback(
    async (config: IndustryConfigView) => {
      if (!confirm(`确认删除「${config.name}」？已创建的订阅会保留当时的快照。`)) return;

      const snapshot = configs;
      setConfigs((prev) => prev.filter((item) => item.id !== config.id));

      try {
        const res = await fetch(`/api/industry-configs/${config.id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to delete industry config');
        toast({ title: '产业配置已删除' });
      } catch {
        setConfigs(snapshot);
        toast({ title: '删除失败', variant: 'destructive' });
      }
    },
    [configs, toast]
  );

  const handleToggleEnabled = useCallback(
    async (config: IndustryConfigView) => {
      const nextEnabled = !config.isEnabled;
      setConfigs((prev) =>
        prev.map((item) => (item.id === config.id ? { ...item, isEnabled: nextEnabled } : item))
      );

      try {
        const res = await fetch(`/api/industry-configs/${config.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...toPayload(toForm(config)), isEnabled: nextEnabled }),
        });

        if (!res.ok) throw new Error('Failed to update industry config');
        await fetchConfigs();
      } catch {
        await fetchConfigs();
        toast({ title: '状态更新失败', variant: 'destructive' });
      }
    },
    [fetchConfigs, toast]
  );

  const handlePublish = useCallback(
    async (config: IndustryConfigView) => {
      const shouldPublish = config.visibility !== 'published';

      try {
        const res = await fetch(`/api/industry-configs/${config.id}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ published: config.visibility !== 'published' }),
        });

        if (!res.ok) throw new Error('Failed to update industry config visibility');
        await fetchConfigs();
        toast({ title: shouldPublish ? '产业方向已发布' : '产业方向已下架' });
      } catch {
        toast({ title: shouldPublish ? '发布失败' : '下架失败', variant: 'destructive' });
      }
    },
    [fetchConfigs, toast]
  );

  const openSubscribers = useCallback(
    async (config: IndustryConfigView) => {
      setSubscriberConfig(config);
      setSubscriberRows([]);
      setSubscriberLoading(true);

      try {
        const res = await fetch(`/api/industry-configs/${config.id}/subscriptions`);
        if (!res.ok) throw new Error('Failed to load industry subscribers');
        const data = (await res.json()) as IndustrySubscriberRow[];
        setSubscriberRows(Array.isArray(data) ? data : []);
      } catch {
        toast({ title: '加载订阅详情失败', variant: 'destructive' });
      } finally {
        setSubscriberLoading(false);
      }
    },
    [toast]
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-32 rounded-lg border border-border bg-card p-4 animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-card p-8 text-center">
        <p className="text-destructive">{error}</p>
        <Button variant="outline" className="mt-4" onClick={fetchConfigs}>
          <RefreshCw className="h-4 w-4" />
          重试
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="text-sm text-muted-foreground">产业信息池</div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{configs.length}</div>
          <div className="mt-1 text-xs text-muted-foreground">{publishedCount} 个已发布</div>
        </div>
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="text-sm text-muted-foreground">已构建信息池</div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{activePoolCount}</div>
          <div className="mt-1 text-xs text-muted-foreground">{enabledCount} 个启用中</div>
        </div>
        <div className="rounded-lg border border-cyan-300/25 bg-card p-4">
          <div className="text-sm text-muted-foreground">企业订阅者</div>
          <div className="mt-2 text-2xl font-semibold text-cyan-50">{subscriberCount}</div>
          <div className="mt-1 text-xs text-muted-foreground">按用户条件个性化筛选</div>
        </div>
        <div className="flex rounded-lg border border-cyan-300/25 bg-card p-4 md:items-center md:justify-end">
          <Button asChild className="w-full md:w-auto">
            <Link href="/industry-configs/new">
              <Plus className="h-4 w-4" />
              新建产业配置
            </Link>
          </Button>
        </div>
      </div>

      {configs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-cyan-300/35 bg-card/70 px-6 py-14 text-center">
          <p className="text-lg font-medium">暂无产业配置</p>
          <p className="mt-2 text-sm text-muted-foreground">
            先沉淀一个产业画像，再进入向导完成找源、脚本生成和信息池发布。
          </p>
          <Button asChild className="mt-6">
            <Link href="/industry-configs/new">
              <Plus className="h-4 w-4" />
              新建产业配置
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {configs.map((config) => {
            const snapshot = config.snapshot;
            const pool = config.poolStats;
            const hasPool = !!pool?.sharedSubscriptionId;
            const tags = [
              ...snapshot.keywords.slice(0, 4),
              ...snapshot.riskTerms.slice(0, 2),
              ...snapshot.regions.slice(0, 2),
            ];

            return (
              <article
                key={config.id}
                className="rounded-lg border border-border bg-card p-4 shadow-[0_14px_34px_rgba(2,10,31,0.18)]"
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-cyan-50">{config.name}</h2>
                      <Badge variant={config.isEnabled ? 'default' : 'secondary'}>
                        {config.isEnabled ? '启用' : '停用'}
                      </Badge>
                      <Badge variant={config.visibility === 'published' ? 'default' : 'secondary'}>
                        {config.visibility === 'published' ? '已发布' : '草稿'}
                      </Badge>
                      <Badge variant={config.deliveryEnabled ? 'default' : 'outline'}>
                        {config.deliveryEnabled ? '报送启用' : '报送关闭'}
                      </Badge>
                      <Badge variant={hasPool ? 'default' : 'outline'}>
                        {hasPool ? '信息池就绪' : '待构建信息池'}
                      </Badge>
                      <Badge variant="outline">{snapshot.alertLevel}</Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {snapshot.category ? <span>{snapshot.category}</span> : null}
                      {snapshot.subCategory ? <span>{snapshot.subCategory}</span> : null}
                      <span>{formatUpdatedAt(config.updatedAt)}</span>
                    </div>
                    {snapshot.description ? (
                      <p className="mt-3 line-clamp-2 text-sm text-cyan-50/78">{snapshot.description}</p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {tags.length > 0 ? (
                        tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-md border border-cyan-300/20 bg-secondary/45 px-2 py-1 text-xs text-cyan-50/82"
                          >
                            {tag}
                          </span>
                        ))
                      ) : (
                        <span className="text-sm text-muted-foreground">尚未填写关键词或区域</span>
                      )}
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-4">
                      <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                        <div className="flex items-center gap-1 text-cyan-50/80">
                          <Database className="h-3.5 w-3.5" />
                          数据源
                        </div>
                        <div className="mt-1 text-cyan-50">
                          {pool?.sourceCount ?? 0} 个，{pool?.activeSourceCount ?? 0} 个启用
                        </div>
                      </div>
                      <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                        <div className="flex items-center gap-1 text-cyan-50/80">
                          <Activity className="h-3.5 w-3.5" />
                          入池消息
                        </div>
                        <div className="mt-1 text-cyan-50">{pool?.messageCount ?? 0} 条</div>
                      </div>
                      <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                        <div className="flex items-center gap-1 text-cyan-50/80">
                          <Users className="h-3.5 w-3.5" />
                          订阅者
                        </div>
                        <div className="mt-1 text-cyan-50">
                          {pool?.subscriberCount ?? 0} 人，{pool?.activeSubscriberCount ?? 0} 人运行中
                        </div>
                      </div>
                      <div className="rounded-md border border-cyan-300/15 bg-secondary/30 px-3 py-2">
                        <div className="text-cyan-50/80">报送</div>
                        <div className="mt-1 text-cyan-50">
                          {config.deliveryCron
                            ? findEmailDeliverySlot(config.deliveryCron)?.label ?? config.deliveryCron
                            : '未配置'}{' '}
                          · 最多 {config.maxItemsPerEmail ?? 10} 条
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-muted-foreground">
                      订阅主题建议：{config.suggestion.topic}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                    <Button asChild size="sm">
                      <Link
                        href={`/subscriptions/new?industryConfigId=${config.id}`}
                        onClick={() => {
                          sessionStorage.setItem('wizard-new', '1');
                        }}
                      >
                        <Database className="h-4 w-4" />
                        {hasPool ? '重建信息池' : '构建信息池'}
                      </Link>
                    </Button>
                    {pool?.sharedSubscriptionId ? (
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/subscriptions/${pool.sharedSubscriptionId}`}>
                          <Activity className="h-4 w-4" />
                          查看信息池
                        </Link>
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" onClick={() => handleToggleEnabled(config)}>
                      <Power className="h-4 w-4" />
                      {config.isEnabled ? '停用' : '启用'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handlePublish(config)}>
                      {config.visibility === 'published' ? (
                        <Archive className="h-4 w-4" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      {config.visibility === 'published' ? '下架' : '发布'}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openSubscribers(config)}>
                      <Users className="h-4 w-4" />
                      订阅详情
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(config)}>
                      <Pencil className="h-4 w-4" />
                      编辑
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(config)}>
                      <Trash2 className="h-4 w-4" />
                      删除
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑产业配置' : '新建产业配置'}</DialogTitle>
            <DialogDescription>
              管理员在此维护产业画像、信息源和报送规则；普通用户订阅时可直接关注整个信息池。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                产业名称
                <Input value={form.name} onChange={(event) => updateField('name', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                行业分类
                <Input value={form.category} onChange={(event) => updateField('category', event.target.value)} />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                细分领域
                <Input
                  value={form.subCategory}
                  onChange={(event) => updateField('subCategory', event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                关注级别
                <Select value={form.alertLevel} onValueChange={(value) => updateField('alertLevel', value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {alertLevels.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            <label className="grid gap-2 text-sm font-medium">
              产业说明
              <Textarea
                value={form.description}
                onChange={(event) => updateField('description', event.target.value)}
                placeholder="说明监测边界、核心产业链或需要特别关注的变化"
              />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                关键词
                <Textarea
                  value={form.keywords}
                  onChange={(event) => updateField('keywords', event.target.value)}
                  placeholder="每行一个，也可用逗号分隔"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                风险词
                <Textarea
                  value={form.riskTerms}
                  onChange={(event) => updateField('riskTerms', event.target.value)}
                  placeholder="监管、处罚、召回、事故..."
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                区域
                <Textarea
                  value={form.regions}
                  onChange={(event) => updateField('regions', event.target.value)}
                  placeholder="全国、广东、深圳..."
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                关注对象
                <Textarea
                  value={form.entities}
                  onChange={(event) => updateField('entities', event.target.value)}
                  placeholder="企业、机构、协会或监管部门"
                />
              </label>
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">信息源类型</legend>
              <div className="grid gap-2 md:grid-cols-2">
                {SOURCE_TYPE_OPTIONS.map((sourceType) => {
                  const active = form.sourceTypes.includes(sourceType);
                  return (
                    <button
                      key={sourceType}
                      type="button"
                      className={cn(
                        'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
                        active
                          ? 'border-cyan-300/60 bg-primary/75 text-primary-foreground'
                          : 'border-border bg-secondary/35 text-cyan-50/72 hover:border-cyan-300/45'
                      )}
                      onClick={() => toggleSourceType(sourceType)}
                    >
                      {SOURCE_TYPE_LABELS[sourceType]}
                      {active ? <Check className="h-4 w-4" /> : null}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-medium">
                发布状态
                <Select
                  value={form.visibility}
                  onValueChange={(value) =>
                    updateField('visibility', value as FormState['visibility'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">草稿</SelectItem>
                    <SelectItem value="published">已发布</SelectItem>
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                订阅模式
                <Select
                  value={form.subscriptionMode}
                  onValueChange={(value) =>
                    updateField('subscriptionMode', value as FormState['subscriptionMode'])
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">开放订阅</SelectItem>
                    <SelectItem value="approval_required">需要审批</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-4 py-3">
              <div className="text-sm font-medium text-cyan-50">普通用户订阅规则</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                默认接收整个产业信息池；个性化条件为可选，仅在用户填写时作为二次筛选，不会改变本产业的采集源或产业画像。
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-2 text-sm font-medium">
                邮件发送时间
                <Select
                  value={form.deliveryCron}
                  onValueChange={(value) => updateField('deliveryCron', value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMAIL_DELIVERY_SLOTS.map((slot) => (
                      <SelectItem key={slot.cron} value={slot.cron}>
                        <span className="font-medium">{slot.label}</span>
                        {slot.description ? (
                          <span className="ml-2 text-xs text-muted-foreground">{slot.description}</span>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-2 text-sm font-medium">
                报送时区
                <Input
                  value={form.deliveryTimezone}
                  onChange={(event) => updateField('deliveryTimezone', event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                每封最多条数
                <Input
                  type="number"
                  min={5}
                  max={10}
                  value={form.maxItemsPerEmail}
                  onChange={(event) => updateField('maxItemsPerEmail', Number(event.target.value))}
                />
              </label>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
              <div>
                <div className="text-sm font-medium">允许用户提交扩展需求</div>
                <div className="text-xs text-muted-foreground">
                  用户条件超出当前信息池覆盖时，进入管理员待确认，不由普通用户直接生成脚本。
                </div>
              </div>
              <Switch
                checked={form.autoProfileExpansion}
                onCheckedChange={(value) => updateField('autoProfileExpansion', value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
              <div>
                <div className="text-sm font-medium">启用邮件报送</div>
                <div className="text-xs text-muted-foreground">
                  按 cron 为活跃用户发送个性化邮件。
                </div>
              </div>
              <Switch
                checked={form.deliveryEnabled}
                onCheckedChange={(value) => updateField('deliveryEnabled', value)}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
              <div>
                <div className="text-sm font-medium">启用</div>
                <div className="text-xs text-muted-foreground">停用后不会出现在新建订阅的可选列表中。</div>
              </div>
              <Switch checked={form.isEnabled} onCheckedChange={(value) => updateField('isEnabled', value)} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              <Save className="h-4 w-4" />
              {submitting ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!subscriberConfig}
        onOpenChange={(open) => {
          if (!open) {
            setSubscriberConfig(null);
            setSubscriberRows([]);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>订阅详情{subscriberConfig ? `：${subscriberConfig.name}` : ''}</DialogTitle>
            <DialogDescription>
              查看普通用户的可选个性化条件、绑定的信息池、收件邮箱和当前处理进度；未填写条件即订阅整个产业信息池。
            </DialogDescription>
          </DialogHeader>

          {subscriberLoading ? (
            <div className="grid gap-3">
              {[1, 2].map((item) => (
                <div key={item} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
              ))}
            </div>
          ) : subscriberRows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-cyan-300/35 bg-secondary/30 px-6 py-10 text-center text-sm text-muted-foreground">
              暂时还没有普通用户订阅这个产业方向。
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-2 rounded-lg border border-border bg-secondary/25 p-3 text-sm md:grid-cols-4">
                <div>
                  <div className="text-muted-foreground">订阅人数</div>
                  <div className="mt-1 text-lg font-semibold text-cyan-50">{subscriberRows.length}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">运行中</div>
                  <div className="mt-1 text-lg font-semibold text-cyan-50">
                    {subscriberRows.filter((row) => row.subscription.status === 'active').length}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">待处理</div>
                  <div className="mt-1 text-lg font-semibold text-cyan-50">
                    {
                      subscriberRows.filter((row) =>
                        ['pending_approval', 'pending_profile'].includes(row.subscription.status)
                      ).length
                    }
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">已暂停</div>
                  <div className="mt-1 text-lg font-semibold text-cyan-50">
                    {subscriberRows.filter((row) => row.subscription.status === 'paused').length}
                  </div>
                </div>
              </div>

              {subscriberRows.map((row) => {
                const recipients = parseRecipientEmailsJson(row.subscription.recipientEmailsJson);
                const progress = getIndustrySubscriptionProgress({
                  subscriptionStatus: row.subscription.status,
                  profileStatus: row.profile?.status ?? null,
                  provisioningError: row.profile?.provisioningError ?? null,
                });

                return (
                  <article key={row.subscription.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-cyan-50">
                            {row.user.name || row.user.email || '未命名用户'}
                          </div>
                          {row.user.email ? (
                            <span className="text-xs text-muted-foreground">{row.user.email}</span>
                          ) : null}
                          <Badge variant={progress.badgeVariant}>{progress.label}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-cyan-50/80">
                          {row.subscription.customCriteria || '未设置个性化条件（接收整个产业信息池）'}
                        </p>
                        <div className="mt-2 text-xs text-muted-foreground">
                          信息池：{row.profile?.title ?? '等待管理员发布'} · 收件邮箱：
                          {recipients.join('、') || '未配置'} · 更新：{formatUpdatedAt(row.subscription.updatedAt)}
                        </div>
                        <div className="mt-2 text-xs text-muted-foreground">{progress.detail}</div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
