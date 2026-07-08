'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronLeft, Database, Save } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
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
  DEFAULT_EMAIL_DELIVERY_CRON,
  EMAIL_DELIVERY_SLOTS,
  SOURCE_TYPE_LABELS,
  SOURCE_TYPE_OPTIONS,
  type IndustryConfigInput,
  type IndustrySourceType,
} from '@/lib/industry-configs/types';
import { cn } from '@/lib/utils';

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
  subscriptionMode: 'open' | 'approval_required';
  autoProfileExpansion: boolean;
  deliveryCron: string;
  deliveryTimezone: string;
  deliveryEnabled: boolean;
  maxItemsPerEmail: number;
}

const initialForm: FormState = {
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
  subscriptionMode: 'open',
  autoProfileExpansion: false,
  deliveryCron: DEFAULT_EMAIL_DELIVERY_CRON,
  deliveryTimezone: 'Asia/Shanghai',
  deliveryEnabled: true,
  maxItemsPerEmail: 10,
};

const alertLevels = ['一般关注', '重点关注', '高风险预警'];

function splitList(value: string) {
  return value
    .split(/[\n,，;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
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
    isEnabled: true,
    visibility: 'draft',
    subscriptionMode: form.subscriptionMode,
    autoProfileExpansion: form.autoProfileExpansion,
    deliveryCron: form.deliveryCron,
    deliveryTimezone: form.deliveryTimezone,
    deliveryEnabled: form.deliveryEnabled,
    maxItemsPerEmail: form.maxItemsPerEmail,
  };
}

export default function IndustryConfigCreateForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitting, setSubmitting] = useState(false);

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

  async function submit() {
    if (!form.name.trim()) {
      toast({ title: '请填写产业名称', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    const res = await fetch('/api/industry-configs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toPayload(form)),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: data.error ?? '创建产业配置失败', variant: 'destructive' });
      return;
    }

    const created = (await res.json()) as { id?: string };
    toast({ title: '产业配置已创建' });

    if (created.id) {
      sessionStorage.setItem('wizard-new', '1');
      router.push(`/subscriptions/new?industryConfigId=${created.id}`);
      return;
    }

    router.push('/industry-configs');
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-medium text-cyan-100/78">管理员</div>
          <h1 className="mt-2 text-2xl font-semibold text-cyan-50">新建产业配置</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            先沉淀产业画像和发布规则，再进入现有构建向导完成找源、脚本生成、初始验证和信息池发布。
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/industry-configs">
            <ChevronLeft className="h-4 w-4" />
            返回信息池
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 shadow-[0_14px_34px_rgba(2,10,31,0.18)]">
        <div className="grid gap-5">
          <section className="grid gap-3">
            <div>
              <h2 className="text-base font-semibold text-cyan-50">产业画像</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                这些字段会成为信息池的边界，也会带入后续找源和脚本生成。
              </p>
            </div>
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
          </section>

          <section className="grid gap-3">
            <div>
              <h2 className="text-base font-semibold text-cyan-50">关注范围</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                普通用户后续只填写个人过滤条件，不直接改源和脚本。
              </p>
            </div>
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
          </section>

          <section className="grid gap-3">
            <div>
              <h2 className="text-base font-semibold text-cyan-50">信息源偏好</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                后续向导会基于这些类型推荐权威源、行业源、新闻源或自有补充源。
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {SOURCE_TYPE_OPTIONS.map((sourceType) => {
                const active = form.sourceTypes.includes(sourceType);
                return (
                  <button
                    key={sourceType}
                    type="button"
                    className={cn(
                      'flex min-h-10 items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
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
          </section>

          <section className="grid gap-3">
            <div>
              <h2 className="text-base font-semibold text-cyan-50">发布与报送</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                信息池发布后才会出现在普通用户的产业目录中。
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
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
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">允许用户提交扩展需求</div>
                  <div className="text-xs text-muted-foreground">超出当前信息池覆盖时进入管理员待处理。</div>
                </div>
                <Switch
                  checked={form.autoProfileExpansion}
                  onCheckedChange={(value) => updateField('autoProfileExpansion', value)}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
                <div>
                  <div className="text-sm font-medium">启用邮件报送</div>
                  <div className="text-xs text-muted-foreground">发布后按 cron 为活跃订阅者发送邮件。</div>
                </div>
                <Switch
                  checked={form.deliveryEnabled}
                  onCheckedChange={(value) => updateField('deliveryEnabled', value)}
                />
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-2 border-t border-cyan-300/15 pt-4 md:flex-row md:justify-end">
            <Button asChild variant="outline">
              <Link href="/industry-configs">
                <Save className="h-4 w-4" />
                返回列表
              </Link>
            </Button>
            <Button onClick={submit} disabled={submitting}>
              <Database className="h-4 w-4" />
              {submitting ? '创建中...' : '创建并进入构建'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
