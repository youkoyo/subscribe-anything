'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, Loader2, Trash2, XCircle } from 'lucide-react';
import { CRON_PRESETS } from '@/lib/utils/cron';
import { ItemPreviewDialog } from '@/components/wizard/ItemPreviewDialog';
import type { GeneratedSource, WizardState } from '@/types/wizard';

interface Step4ConfirmProps {
  state: WizardState;
  onStateChange: (updates: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
  onComplete: (subscriptionId: string) => void;
  onDiscard?: () => void;
}

type PublishStage = 'idle' | 'submitting' | 'activating' | 'redirecting';

const PUBLISH_REQUEST_TIMEOUT_MS = 20_000;

async function requestJsonWithTimeout(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), PUBLISH_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('发布请求超过 20 秒仍未得到服务端响应，请稍后重试。');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function Step4Confirm({
  state,
  onStateChange,
  onBack,
  onComplete,
  onDiscard,
}: Step4ConfirmProps) {
  const [sources, setSources] = useState<GeneratedSource[]>(state.generatedSources);
  const [poolCron, setPoolCron] = useState(
    state.generatedSources[0]?.cronExpression ?? '0 * * * *'
  );
  const [editingTitleIdx, setEditingTitleIdx] = useState<number | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [publishStage, setPublishStage] = useState<PublishStage>('idle');
  const [provisioningSummary, setProvisioningSummary] = useState<{
    prioritySourceCount: number;
    deferredSourceCount: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [previewSource, setPreviewSource] = useState<GeneratedSource | null>(null);
  const isIndustryPool = !!state.industryConfigId;

  const startEditTitle = (idx: number) => {
    setEditingTitleIdx(idx);
    setEditingTitleValue(sources[idx].title);
  };

  const commitEditTitle = () => {
    if (editingTitleIdx !== null) {
      const trimmed = editingTitleValue.trim();
      if (trimmed) updateSource(editingTitleIdx, { title: trimmed });
    }
    setEditingTitleIdx(null);
  };

  const cancelEditTitle = () => setEditingTitleIdx(null);

  const deleteSource = (idx: number) => {
    setSources((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSource = (idx: number, patch: Partial<GeneratedSource>) => {
    setSources((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setErrorMessage('');
    setPublishStage('submitting');
    setProvisioningSummary(null);

    const sourcesPayload = sources.map((s) => ({
      title: s.title,
      url: s.url,
      description: s.description,
      script: s.script,
      cronExpression: poolCron,
      isEnabled: s.isEnabled,
      initialItems: s.failedReason ? [] : s.initialItems,
      failedReason: s.failedReason,
      // Keep catalog provenance all the way through publication. The
      // scheduler uses it to apply the industry profile to preset RSS items.
      catalogSourceId: s.catalogSourceId,
      discoveryOrigin: s.discoveryOrigin,
      collectionStrategy: s.collectionStrategy,
    }));

    try {
      let createdId: string;

      if (state.subscriptionId) {
        // Wizard was persisted: use complete-wizard endpoint
        const res = await requestJsonWithTimeout(`/api/subscriptions/${state.subscriptionId}/complete-wizard`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sources: sourcesPayload,
            criteria: state.criteria,
            industryConfigId: state.industryConfigId ?? null,
            industryConfigSnapshot: state.industryConfigSnapshot ?? null,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(errText || `HTTP ${res.status}`);
        }

        const data = await res.json();
        createdId = data.id;
        setProvisioningSummary({
          prioritySourceCount: data.prioritySourceCount ?? 0,
          deferredSourceCount: data.deferredSourceCount ?? 0,
        });
      } else {
        // No persisted subscription: create from scratch
        const body = {
          topic: state.topic,
          criteria: state.criteria,
          industryConfigId: state.industryConfigId ?? null,
          industryConfigSnapshot: state.industryConfigSnapshot ?? null,
          sources: sourcesPayload,
        };

        const res = await requestJsonWithTimeout('/api/subscriptions', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'Content-Type': 'application/json' },
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(errText || `HTTP ${res.status}`);
        }

        const created = await res.json();
        createdId = created.id;
      }

      if (state.industryConfigId) {
        setPublishStage('activating');
        const bindRes = await requestJsonWithTimeout(`/api/industry-configs/${state.industryConfigId}/pool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscriptionId: createdId }),
        });

        if (!bindRes.ok) {
          const errText = await bindRes.text().catch(() => '');
          throw new Error(errText || '信息池发布失败');
        }
      }

      // Update parent state then trigger completion
      setPublishStage('redirecting');
      onStateChange({
        generatedSources: sources.map((source) => ({ ...source, cronExpression: poolCron })),
      });
      onComplete(createdId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '提交失败，请重试';
      setErrorMessage(msg);
      setPublishStage('idle');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div>
        <h2 className="text-xl font-semibold mb-1">
          {isIndustryPool ? '确认并发布产业信息池' : '确认并创建订阅'}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isIndustryPool
            ? '检查数据源、初始样本和采集频率，发布后普通用户即可订阅这个信息池'
            : '检查以下数据源配置，可调整采集频率和开关后提交'}
        </p>
      </div>

      {/* Topic summary */}
      <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm flex flex-col gap-0.5">
        <span className="text-muted-foreground text-xs">{isIndustryPool ? '信息池主题' : '订阅主题'}</span>
        <span className="font-medium">{state.topic}</span>
        {state.industryConfigSnapshot && (
          <>
            <span className="text-muted-foreground text-xs mt-1">产业配置</span>
            <span className="text-sm">{state.industryConfigSnapshot.name}</span>
          </>
        )}
        {state.criteria && (
          <>
            <span className="text-muted-foreground text-xs mt-1">监控条件</span>
            <span className="text-sm">{state.criteria}</span>
          </>
        )}
      </div>

      <Card className="border-primary/30 bg-primary/[0.04]">
        <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium">信息池采集频率</div>
            <p className="mt-1 text-xs text-muted-foreground">
              所有启用的数据源使用同一频率；已有初始新闻的源会优先发布，其余源在后台继续补齐。
            </p>
          </div>
          <Select value={poolCron} onValueChange={setPoolCron}>
            <SelectTrigger className="h-9 w-full text-sm sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CRON_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <ScrollArea className="h-[48vh] md:h-[45vh]">
        <div className="flex flex-col gap-3 pr-2">
          {sources.map((source, idx) => {
            const isFailed = !!source.failedReason;
            return (
              <Card key={idx} className={isFailed ? 'opacity-60' : undefined}>
                <CardContent className="p-4 flex flex-col gap-3">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {editingTitleIdx === idx && !isFailed ? (
                          <Input
                            autoFocus
                            className="h-7 text-sm font-semibold px-1 py-0 w-auto min-w-0 flex-1"
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onBlur={commitEditTitle}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEditTitle();
                              if (e.key === 'Escape') cancelEditTitle();
                            }}
                          />
                        ) : (
                          <span
                            className={`font-semibold text-sm${isFailed ? '' : ' cursor-pointer hover:underline underline-offset-2'}`}
                            onClick={isFailed ? undefined : () => startEditTitle(idx)}
                            title={isFailed ? undefined : '点击编辑名称'}
                          >
                            {source.title}
                          </span>
                        )}
                        {isFailed ? (
                          <Badge
                            variant="outline"
                            className={source.failedReason === '未生成'
                              ? 'text-muted-foreground border-muted-foreground/50 bg-muted/50 text-xs'
                              : 'text-destructive border-destructive/50 bg-destructive/10 text-xs'}
                          >
                            <XCircle className="h-3 w-3 mr-1" />
                            {source.failedReason === '未生成' ? '未生成' : '生成失败'}
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="text-green-600 border-green-500/50 bg-green-500/10 text-xs"
                          >
                            {source.collectionStrategy === 'firecrawl_scrape' ? 'Firecrawl 已验证' : '已验证'}
                          </Badge>
                        )}
                      </div>
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground truncate mt-0.5 hover:underline underline-offset-2 block"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {source.url}
                      </a>
                      {isFailed && source.failedReason !== '未生成' && (
                        <p className="text-xs text-destructive mt-1 break-words">{source.failedReason}</p>
                      )}
                    </div>
                    {/* Enable/disable switch */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {source.isEnabled ? '启用' : '禁用'}
                      </span>
                      <Switch
                        checked={source.isEnabled}
                        onCheckedChange={isFailed ? undefined : (checked) => updateSource(idx, { isEnabled: checked })}
                        disabled={isFailed}
                      />
                      <button
                        onClick={() => deleteSource(idx)}
                        className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="删除此数据源"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                      {/* Failed sources don't show item details */}
                  {!isFailed && (
                    <>
                      {/* Item count + preview */}
                      {source.initialItems.length > 0 && (
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted-foreground">
                            已采集 {source.initialItems.length} 条初始内容
                          </p>
                          <button
                            onClick={() => setPreviewSource(source)}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2"
                          >
                            <Eye className="h-3 w-3" />
                            预览
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </ScrollArea>

      {errorMessage && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorMessage}
        </div>
      )}

      {isSubmitting && (
        <div className="rounded-lg border border-primary/30 bg-primary/[0.06] px-4 py-3 text-sm" role="status">
          <div className="flex items-center gap-2 font-medium">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            {publishStage === 'submitting' && '正在提交发布请求'}
            {publishStage === 'activating' && '正在启用产业信息池'}
            {publishStage === 'redirecting' && '发布完成，正在跳转'}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {publishStage === 'submitting' && '正在保存配置，并把有初始新闻的源优先交给后台创建。'}
            {publishStage === 'activating' && '正在开放信息池并刷新邮件投递计划；采集任务仍由后台继续执行。'}
            {publishStage === 'redirecting' && (provisioningSummary
              ? `已优先提交 ${provisioningSummary.prioritySourceCount} 个源，其余 ${provisioningSummary.deferredSourceCount} 个源将在后台补齐。`
              : '正在打开信息池。')}
          </p>
        </div>
      )}

      {/* Mobile: fixed bottom; Desktop: inline */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-[calc(4rem+env(safe-area-inset-bottom))] bg-background border-t md:static md:border-t-0 md:bg-transparent md:p-0 md:mt-2">
        <div className="flex gap-3">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || sources.length === 0}
            className="flex-1 md:flex-none"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {isIndustryPool ? '发布中...' : '创建中...'}
              </>
            ) : (
              isIndustryPool ? '发布信息池' : '完成创建'
            )}
          </Button>
          <Button variant="outline" onClick={onBack} disabled={isSubmitting} className="flex-none">
            暂存退出
          </Button>
          {onDiscard && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDiscard}
              disabled={isSubmitting}
              className="hidden md:inline-flex flex-none text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="丢弃此次订阅创建"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Item preview dialog */}
      {previewSource && (
        <ItemPreviewDialog title={previewSource.title} items={previewSource.initialItems} onClose={() => setPreviewSource(null)} />
      )}
    </div>
  );
}
