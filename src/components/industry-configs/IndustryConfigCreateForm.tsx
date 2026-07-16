'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, ChevronLeft, Database, Loader2, Rss, Settings2, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  SOURCE_PREFERENCE_LABELS,
  type IndustryConfigInput,
} from '@/lib/industry-configs/types';
import { SOURCE_PREFERENCES, type SourcePreference } from '@/lib/discovery-sources/types';
import { cn } from '@/lib/utils';

export interface IndustryConfigFormValues {
  name: string;
  description: string;
  sourcePreferences: SourcePreference[];
  category: string;
  subCategory: string;
  subscriptionMode: 'open' | 'approval_required';
  autoProfileExpansion: boolean;
  deliveryEnabled: boolean;
  maxItemsPerEmail: number;
  /** One-off administrator test switch; never persisted to the industry config. */
  skipPresetRss: boolean;
}

const DEFAULT_PREFERENCES: SourcePreference[] = [
  'authoritative', 'mainstream', 'business', 'industry', 'trend',
];

export const DEFAULT_INDUSTRY_CONFIG_FORM_VALUES: IndustryConfigFormValues = {
  name: '',
  description: '',
  sourcePreferences: DEFAULT_PREFERENCES,
  category: '',
  subCategory: '',
  subscriptionMode: 'open',
  autoProfileExpansion: false,
  deliveryEnabled: true,
  maxItemsPerEmail: 10,
  skipPresetRss: false,
};

interface CatalogPreview {
  total: number;
  matches: Array<{ id: string; title: string; category: string; trustLevel: string }>;
}

function toPayload(form: IndustryConfigFormValues): IndustryConfigInput {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    category: form.category.trim(),
    subCategory: form.subCategory.trim(),
    sourcePreferences: form.sourcePreferences,
    allowAiDiscoveryFallback: true,
    isEnabled: true,
    visibility: 'draft',
    subscriptionMode: form.subscriptionMode,
    autoProfileExpansion: form.autoProfileExpansion,
    deliveryEnabled: form.deliveryEnabled,
    maxItemsPerEmail: form.maxItemsPerEmail,
  };
}

export interface IndustryConfigFormProps {
  initialValues?: IndustryConfigFormValues;
  onSave?: (values: IndustryConfigFormValues) => Promise<string | null>;
  embedded?: boolean;
}

export default function IndustryConfigCreateForm({
  initialValues = DEFAULT_INDUSTRY_CONFIG_FORM_VALUES,
  onSave,
  embedded = false,
}: IndustryConfigFormProps = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const [form, setForm] = useState<IndustryConfigFormValues>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [preview, setPreview] = useState<CatalogPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    setForm(initialValues);
    setSubmitError('');
  }, [initialValues]);

  const updateField = useCallback(<K extends keyof IndustryConfigFormValues>(key: K, value: IndustryConfigFormValues[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
  }, []);

  const previewKey = useMemo(
    () => `${form.name.trim()}|${form.description.trim()}|${form.sourcePreferences.join(',')}`,
    [form.name, form.description, form.sourcePreferences]
  );

  useEffect(() => {
    if (form.skipPresetRss || !form.name.trim() || form.sourcePreferences.length === 0) {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const params = new URLSearchParams({
          topic: form.name.trim(),
          criteria: form.description.trim(),
          preferences: form.sourcePreferences.join(','),
        });
        const response = await fetch(`/api/discovery-sources/match?${params}`);
        if (!response.ok) return;
        setPreview(await response.json() as CatalogPreview);
      } catch {
        // Preview is an aid only. Creation remains available when it is unavailable.
      } finally {
        setPreviewLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [previewKey, form.name, form.description, form.sourcePreferences, form.skipPresetRss]);

  function togglePreference(preference: SourcePreference) {
    setForm((previous) => {
      const selected = previous.sourcePreferences.includes(preference);
      const sourcePreferences = selected
        ? previous.sourcePreferences.filter((item) => item !== preference)
        : [...previous.sourcePreferences, preference];
      return { ...previous, sourcePreferences: sourcePreferences.length ? sourcePreferences : previous.sourcePreferences };
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) {
      setSubmitError('请先填写产业名称。');
      return;
    }
    setSubmitError('');
    setSubmitting(true);
    try {
      if (onSave) {
        const error = await onSave(form);
        if (error) setSubmitError(error);
        return;
      }
      const response = await fetch('/api/industry-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(form)),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSubmitError(data.error ?? '创建产业配置失败，请稍后重试。');
        return;
      }
      toast({ title: '产业配置已创建，正在进入构建流程' });
      if (data.id) {
        sessionStorage.setItem('wizard-new', '1');
        const testFlag = form.skipPresetRss ? '&skipPresetRss=1' : '';
        router.push(`/subscriptions/new?industryConfigId=${data.id}${testFlag}`);
      } else {
        router.push('/industry-configs');
      }
    } catch {
      setSubmitError('网络连接异常，尚未创建配置。');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto grid w-full max-w-6xl gap-5 pb-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        {!embedded ? <div className="flex flex-col gap-3 border-b border-cyan-300/15 pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none">
            <div className="text-sm font-medium text-cyan-100/75">管理端 · 信息池</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-cyan-50">新建产业信息</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">填写产业和关注方向即可。系统会自动生成产业画像、执行所选偏好下的全部预置 RSS，并只让强相关和有关内容进入信息池。</p>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/industry-configs"><ChevronLeft className="h-4 w-4" />返回列表</Link>
          </Button>
        </div> : null}

        <section className="animate-in fade-in slide-in-from-top-1 rounded-xl border border-cyan-300/15 bg-card/90 p-5 shadow-[0_16px_42px_rgba(2,10,31,.2)] duration-300 motion-reduce:animate-none">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-cyan-300/10 text-cyan-200">1</span>
            <div><h2 className="font-semibold text-cyan-50">先描述你要看什么</h2><p className="mt-1 text-sm text-muted-foreground">不需要写关键词或同义词，AI 会把自然语言转成产业画像。</p></div>
          </div>
          <div className="mt-5 grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-cyan-50" htmlFor="industry-name">产业名称 <span className="text-destructive">*</span>
              <Input id="industry-name" autoFocus value={form.name} aria-invalid={Boolean(submitError)} onChange={(event) => updateField('name', event.target.value)} placeholder="例如：鞋业、低空经济、人工智能" className="h-11" />
            </label>
            <label className="grid gap-2 text-sm font-medium text-cyan-50" htmlFor="industry-focus">关注方向 <span className="font-normal text-muted-foreground">（可选）</span>
              <Textarea id="industry-focus" value={form.description} onChange={(event) => updateField('description', event.target.value)} placeholder="用一句话说明你关心的范围，例如：国内制造、出口订单、供应链、监管与市场变化。" className="min-h-24 resize-y" />
            </label>
          </div>
          {submitError ? <p role="alert" className="mt-3 text-sm text-destructive">{submitError}</p> : null}
        </section>

        <section className="animate-in fade-in slide-in-from-top-1 rounded-xl border border-cyan-300/15 bg-card/90 p-5 shadow-[0_16px_42px_rgba(2,10,31,.2)] duration-300 motion-reduce:animate-none">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-cyan-300/10 text-cyan-200">2</span>
            <div><h2 className="font-semibold text-cyan-50">选择信息源偏好</h2><p className="mt-1 text-sm text-muted-foreground">选中的每个偏好会执行其下全部可用 RSS；系统限制并发，不限制来源数量。</p></div>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {SOURCE_PREFERENCES.map((preference) => {
              const active = form.sourcePreferences.includes(preference);
              return <button key={preference} type="button" aria-pressed={active} onClick={() => togglePreference(preference)} className={cn('group flex min-h-14 items-center justify-between rounded-lg border px-3.5 text-left text-sm transition-[border-color,background-color,transform] duration-200 motion-reduce:transition-none', active ? 'border-cyan-300/60 bg-primary/25 text-cyan-50 shadow-[inset_0_0_0_1px_rgba(103,232,249,.08)]' : 'border-border/80 bg-secondary/20 text-cyan-50/75 hover:-translate-y-0.5 hover:border-cyan-300/40 hover:bg-secondary/40 motion-reduce:hover:transform-none')}>
                <span>{SOURCE_PREFERENCE_LABELS[preference]}</span>{active ? <Check className="h-4 w-4 shrink-0 text-cyan-200" /> : <span className="h-4 w-4 rounded-full border border-cyan-100/20" />}
              </button>;
            })}
          </div>
          {!embedded ? <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border border-amber-300/30 bg-amber-300/[0.06] px-3.5 py-3">
            <div>
              <p className="text-sm font-medium text-amber-100">测试：跳过预置 RSS 查询</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">开启后，本次创建直接进入旧版 AI 发现源与脚本生成链路；不会执行预置源匹配、RSS 验证或预览。</p>
            </div>
            <Switch
              id="skip-preset-rss"
              checked={form.skipPresetRss}
              onCheckedChange={(value) => updateField('skipPresetRss', value)}
              aria-label="跳过预置 RSS 查询"
            />
          </div> : null}
        </section>

        <section className="rounded-xl border border-cyan-300/10 bg-card/65">
          <button type="button" aria-expanded={advancedOpen} aria-controls="advanced-profile" onClick={() => setAdvancedOpen((value) => !value)} className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors duration-200 hover:bg-cyan-300/5 motion-reduce:transition-none"><span className="flex items-center gap-2 text-sm font-medium text-cyan-50"><Settings2 className="h-4 w-4 text-cyan-200" />高级资料 <span className="font-normal text-muted-foreground">可选</span></span><ChevronDown className={cn('h-4 w-4 transition-transform duration-200', advancedOpen && 'rotate-180')} /></button>
          {advancedOpen ? <div id="advanced-profile" className="grid gap-4 border-t border-cyan-300/10 px-5 py-4 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none sm:grid-cols-2"><label className="grid gap-2 text-sm">行业分类<Input value={form.category} onChange={(event) => updateField('category', event.target.value)} placeholder="例如：消费制造" /></label><label className="grid gap-2 text-sm">细分领域<Input value={form.subCategory} onChange={(event) => updateField('subCategory', event.target.value)} placeholder="例如：运动鞋、皮鞋" /></label><div className="sm:col-span-2 rounded-md bg-cyan-300/5 px-3 py-2 text-xs leading-5 text-muted-foreground">这里仅补充展示与管理信息；产业关联词、同义词和排除词仍由 AI 自动生成。</div></div> : null}
        </section>

        <section className="rounded-xl border border-cyan-300/10 bg-card/65">
          <button type="button" aria-expanded={deliveryOpen} aria-controls="delivery-options" onClick={() => setDeliveryOpen((value) => !value)} className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors duration-200 hover:bg-cyan-300/5 motion-reduce:transition-none"><span className="flex items-center gap-2 text-sm font-medium text-cyan-50"><Database className="h-4 w-4 text-cyan-200" />发布与投递 <span className="font-normal text-muted-foreground">可选</span></span><ChevronDown className={cn('h-4 w-4 transition-transform duration-200', deliveryOpen && 'rotate-180')} /></button>
          {deliveryOpen ? <div id="delivery-options" className="grid gap-4 border-t border-cyan-300/10 px-5 py-4 animate-in fade-in slide-in-from-top-1 duration-200 motion-reduce:animate-none"><div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-secondary/15 px-3 py-3"><div><p className="text-sm font-medium">启用邮件投递</p><p className="mt-1 text-xs text-muted-foreground">先按默认节奏投递，可在创建后调整。</p></div><Switch id="delivery-enabled" checked={form.deliveryEnabled} onCheckedChange={(value) => updateField('deliveryEnabled', value)} /></div><div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-secondary/15 px-3 py-3"><div><p className="text-sm font-medium">允许用户补充需求</p><p className="mt-1 text-xs text-muted-foreground">新增范围会进入管理员处理流程。</p></div><Switch id="profile-expansion" checked={form.autoProfileExpansion} onCheckedChange={(value) => updateField('autoProfileExpansion', value)} /></div></div> : null}
        </section>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="animate-in fade-in slide-in-from-top-1 rounded-xl border border-cyan-300/20 bg-gradient-to-b from-[#103a69]/85 to-card p-5 shadow-[0_20px_55px_rgba(0,0,0,.24)] duration-300 motion-reduce:animate-none">
          <div className="flex items-center gap-2 text-cyan-100"><Sparkles className="h-4 w-4 text-cyan-200" /><h2 className="font-semibold">构建预览</h2></div>
          <div className="mt-5 space-y-4 text-sm"><div><p className="text-xs text-muted-foreground">产业</p><p className="mt-1 font-medium text-cyan-50">{form.name.trim() || '等待填写'}</p></div><div><p className="text-xs text-muted-foreground">画像生成</p><p className="mt-1 leading-5 text-cyan-50/85">AI 自动生成核心词、关联词与排除语境</p></div><div className="rounded-lg border border-cyan-300/15 bg-slate-950/15 p-3"><div className="flex items-center gap-2"><Rss className="h-4 w-4 text-cyan-200" /><span className="font-medium text-cyan-50">预置 RSS</span></div><p className="mt-2 leading-5 text-muted-foreground">{previewLoading ? '正在计算可执行来源…' : preview ? `将执行 ${preview.total} 个匹配来源（展示前 ${preview.matches.length} 个）` : '填写产业名称后显示预计来源数'}</p>{preview?.matches.length ? <ul className="mt-3 space-y-1.5 text-xs text-cyan-100/75">{preview.matches.slice(0, 3).map((match) => <li key={match.id} className="truncate">{match.title}</li>)}</ul> : null}</div><div className="border-l-2 border-cyan-300/50 pl-3 text-xs leading-5 text-muted-foreground">全部来源执行后，强相关与有关内容逐条进入信息池；若没有合格内容，才启动旧的 AI 找源与脚本流程。</div></div>
          <Button type="submit" className="mt-6 w-full" disabled={submitting} aria-busy={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            {submitting ? '正在建立产业画像…' : '创建并进入构建'}
          </Button>
          {submitting ? <div aria-live="polite" className="mt-3 overflow-hidden rounded-lg border border-cyan-300/25 bg-cyan-300/[0.07] px-3.5 py-3 text-left shadow-[inset_0_0_22px_rgba(34,211,238,.05)]">
            <div className="flex items-center gap-2 text-sm font-medium text-cyan-50"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300/70 motion-reduce:animate-none" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-200" /></span>正在建立产业画像</div>
            <p className="mt-1.5 text-xs leading-5 text-cyan-100/70">正在理解产业边界、经营语境与信息源偏好。完成后将自动进入构建流程。</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-cyan-950/70"><div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-cyan-500/30 via-cyan-200 to-cyan-500/30 motion-reduce:animate-none" /></div>
          </div> : <p className="mt-3 text-center text-xs text-muted-foreground">创建后可继续查看来源执行与采集结果。</p>}
        </div>
      </aside>
    </form>
  );
}
