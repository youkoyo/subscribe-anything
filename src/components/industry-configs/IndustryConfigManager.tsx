'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Save,
  Trash2,
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
import {
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
  deliveryCron: '0 9 * * *',
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
    deliveryCron: config.deliveryCron ?? '0 9 * * *',
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

  const enabledCount = useMemo(() => configs.filter((item) => item.isEnabled).length, [configs]);

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
      <div className="mb-4 flex flex-col gap-3 rounded-lg border border-cyan-400/20 bg-card p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-sm text-muted-foreground">已配置产业</div>
          <div className="mt-1 text-2xl font-semibold text-cyan-50">
            {configs.length}
            <span className="ml-2 text-sm font-normal text-muted-foreground">个产业，{enabledCount} 个启用</span>
          </div>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4" />
          新建产业配置
        </Button>
      </div>

      {configs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-cyan-300/35 bg-card/70 px-6 py-14 text-center">
          <p className="text-lg font-medium">暂无产业配置</p>
          <p className="mt-2 text-sm text-muted-foreground">
            先沉淀一个产业画像，后续新建订阅时就能直接套用。
          </p>
          <Button className="mt-6" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            新建产业配置
          </Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {configs.map((config) => {
            const snapshot = config.snapshot;
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
                    <div className="mt-3 text-xs text-muted-foreground">
                      订阅建议：{config.suggestion.topic} · 报送：{config.deliveryCron || '未配置'} · 每封最多{' '}
                      {config.maxItemsPerEmail ?? 10} 条
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
                    <Button variant="outline" size="sm" onClick={() => handleToggleEnabled(config)}>
                      <Power className="h-4 w-4" />
                      {config.isEnabled ? '停用' : '启用'}
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
              配置产业画像后，新建订阅时可以一键带入主题、关注标准和产业快照。
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

            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-2 text-sm font-medium">
                报送 cron
                <Input
                  value={form.deliveryCron}
                  onChange={(event) => updateField('deliveryCron', event.target.value)}
                />
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
                <div className="text-sm font-medium">允许自动扩展采集池</div>
                <div className="text-xs text-muted-foreground">
                  用户条件不匹配已有需求簇时，自动创建新采集池。
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
    </>
  );
}
