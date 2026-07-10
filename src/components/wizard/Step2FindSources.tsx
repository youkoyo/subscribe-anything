'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Search, BrainCircuit, Trash2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot as BotIcon } from 'lucide-react';
import LLMLogDialog from '@/components/debug/LLMLogDialog';
import type { LLMCallInfo } from '@/lib/ai/client';
import type { FoundSource, WizardState } from '@/types/wizard';

interface Step2FindSourcesProps {
  state: WizardState;
  onStateChange: (updates: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
  onStep2Next?: (selectedSources: FoundSource[]) => void;
  onManagedCreate?: (foundSources: FoundSource[]) => void;
  onDiscard?: () => void;
}

interface LogEntry {
  type: 'log';
  id: string;
  step: string;
  level: string;
  message: string;
  payload: unknown;
}

function defaultSelection(sources: FoundSource[]): Set<number> {
  if (sources.length === 0) return new Set();
  const recommended = sources.reduce<number[]>((acc, s, i) => {
    if (s.recommended) acc.push(i);
    return acc;
  }, []);
  return new Set(recommended.length > 0 ? recommended : sources.map((_, i) => i));
}

export default function Step2FindSources({
  state,
  onStateChange,
  onBack,
  onStep2Next,
  onManagedCreate,
  onDiscard,
}: Step2FindSourcesProps) {
  const [searchQueries, setSearchQueries] = useState<string[]>([]);
  const [sources, setSources] = useState<FoundSource[]>(
    state.foundSources.length > 0 ? state.foundSources : []
  );
  const [checkedIndices, setCheckedIndices] = useState<Set<number>>(() => {
    if (state.selectedIndices.length > 0) return new Set(state.selectedIndices);
    if (state.foundSources.length > 0) return defaultSelection(state.foundSources);
    return new Set();
  });
  const [isStreaming, setIsStreaming] = useState(false);
  const [isDone, setIsDone] = useState(state.foundSources.length > 0);
  const [errorMessage, setErrorMessage] = useState('');
  const [isSearchProviderError, setIsSearchProviderError] = useState(false);
  const [llmCalls, setLLMCalls] = useState<LLMCallInfo[]>(state.step2LlmCalls ?? []);
  const [showLLMLog, setShowLLMLog] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const seenQueriesRef = useRef(new Set<string>());

  // ── Manual add source state ──
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [manualDesc, setManualDesc] = useState('');

  // ── Continue searching state ──
  const [continueError, setContinueError] = useState('');
  const isContinueSearchRef = useRef(false);

  // Poll for LLM calls while subscriptionId is available
  useEffect(() => {
    if (!state.subscriptionId) return;
    const subId = state.subscriptionId;
    const poll = () => {
      fetch(`/api/subscriptions/${subId}/llm-calls`)
        .then((r) => r.json())
        .then((data: { calls?: LLMCallInfo[] }) => {
          if (data.calls && data.calls.length > 0) {
            setLLMCalls(data.calls);
            onStateChange({ step2LlmCalls: data.calls });
          }
        })
        .catch(() => {});
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.subscriptionId]);

  const connectSSE = () => {
    const subscriptionId = state.subscriptionId;
    if (!subscriptionId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsStreaming(true);
    setErrorMessage('');
    setIsSearchProviderError(false);

    (async () => {
      try {
        const res = await fetch(`/api/subscriptions/${subscriptionId}/stream-progress`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(text || `HTTP ${res.status}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6)) as LogEntry | { type: 'done'; reason?: string };

              if (event.type === 'done') {
                setIsStreaming(false);
                return;
              }

              if (event.type !== 'log' || event.step !== 'find_sources') continue;

              if (event.level === 'progress' && event.message.startsWith('搜索：')) {
                const q = event.message.slice(3);
                if (!seenQueriesRef.current.has(q)) {
                  seenQueriesRef.current.add(q);
                  setSearchQueries((prev) => [...prev, q]);
                }
              }

              if (event.level === 'success' && Array.isArray(event.payload)) {
                const resultSources = event.payload as FoundSource[];
                if (isContinueSearchRef.current) {
                  // Append new sources, skip duplicates by URL
                  const existingUrls = new Set(sources.map((s) => s.url));
                  const newOnes = resultSources.filter((s) => !existingUrls.has(s.url));
                  if (newOnes.length > 0) {
                    const merged = [...sources, ...newOnes];
                    const sel = new Set([...checkedIndices]);
                    for (let i = sources.length; i < merged.length; i++) sel.add(i);
                    setSources(merged);
                    setCheckedIndices(sel);
                    onStateChange({
                      foundSources: merged,
                      selectedIndices: Array.from(sel).sort((a, b) => a - b),
                    });
                  }
                  isContinueSearchRef.current = false;
                } else {
                  const sel = defaultSelection(resultSources);
                  setSources(resultSources);
                  setCheckedIndices(sel);
                  onStateChange({
                    foundSources: resultSources,
                    selectedIndices: Array.from(sel).sort((a, b) => a - b),
                  });
                }
                setIsDone(true);
                setIsStreaming(false);
                return;
              }

              if (event.level === 'error') {
                setErrorMessage(event.message);
                if (
                  event.message.toLowerCase().includes('search provider') ||
                  event.message.toLowerCase().includes('no search') ||
                  event.message.toLowerCase().includes('搜索供应商')
                ) {
                  setIsSearchProviderError(true);
                }
                setIsStreaming(false);
                return;
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : '连接失败';
        setErrorMessage(msg);
        if (
          msg.toLowerCase().includes('search provider') ||
          msg.toLowerCase().includes('搜索供应商')
        ) {
          setIsSearchProviderError(true);
        }
        setIsStreaming(false);
      }
    })();
  };

  // Connect to SSE on mount
  useEffect(() => {
    if (state.managedError && state.foundSources.length === 0) {
      setErrorMessage(state.managedError);
      if (
        state.managedError.toLowerCase().includes('search provider') ||
        state.managedError.toLowerCase().includes('no search') ||
        state.managedError.toLowerCase().includes('搜索供应商')
      ) {
        setIsSearchProviderError(true);
      }
    } else if (state.foundSources.length === 0 && state.subscriptionId) {
      connectSSE();
    }
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRetry = async () => {
    if (!state.subscriptionId) return;
    setIsDone(false);
    setSources([]);
    setCheckedIndices(new Set());
    setSearchQueries([]);
    seenQueriesRef.current.clear();
    setErrorMessage('');
    setIsSearchProviderError(false);
    setLLMCalls([]);
    onStateChange({ step2LlmCalls: [], managedError: null });

    await fetch(`/api/subscriptions/${state.subscriptionId}/run-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step: 'find_sources' }),
    }).catch(() => {});

    connectSSE();
  };

  // ── Continue searching: ask AI to find more sources excluding already-found ones ──
  const handleContinueSearch = async () => {
    if (!state.subscriptionId) return;

    const existingUrls = sources.map((s) => s.url);
    const userPrompt = `请继续搜索更多数据源，要求：
1. 排除以下已找到的 URL（不要重复）：\n${existingUrls.map((u) => `   - ${u}`).join('\n')}
2. 寻找与上述来源不同的新数据源，优先搜索：
   - 行业垂直媒体和专业网站
   - 行业协会/官方机构的公告/数据发布频道
   - 有活跃 RSS 或定期更新的高质量源
3. 如果搜索了两轮仍无新源，就如实告知并结束。`;

    setContinueError('');
    isContinueSearchRef.current = true;

    try {
      await fetch(`/api/subscriptions/${state.subscriptionId}/run-step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'find_sources', userPrompt }),
      }).catch(() => {});

      setTimeout(() => connectSSE(), 500);
    } catch {
      setContinueError('继续搜索请求失败');
      isContinueSearchRef.current = false;
    }
  };

  const handleManualAdd = () => {
    const title = manualTitle.trim();
    const url = manualUrl.trim();
    if (!title || !url) return;

    try {
      new URL(url);
    } catch {
      return; // invalid URL
    }

    const newSource: FoundSource = {
      title,
      url,
      description: manualDesc.trim() || '手动添加',
    };

    const newSources = [...sources, newSource];
    const newIndex = newSources.length - 1;
    setSources(newSources);
    setCheckedIndices((prev) => new Set([...prev, newIndex]));
    onStateChange({
      foundSources: newSources,
      selectedIndices: [...checkedIndices, newIndex].sort((a, b) => a - b),
    });

    // Reset form
    setManualTitle('');
    setManualUrl('');
    setManualDesc('');
    setShowManualAdd(false);
  };

  const toggleIndex = (idx: number) => {
    setCheckedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (checkedIndices.size === sources.length) {
      setCheckedIndices(new Set());
    } else {
      setCheckedIndices(new Set(sources.map((_, i) => i)));
    }
  };

  const handleNext = () => {
    const selectedSources = Array.from(checkedIndices)
      .sort((a, b) => a - b)
      .map((i) => sources[i])
      .filter(Boolean);
    onStateChange({
      foundSources: sources,
      selectedIndices: Array.from(checkedIndices).sort((a, b) => a - b),
    });
    if (onStep2Next) {
      onStep2Next(selectedSources);
    }
  };

  const selectedCount = checkedIndices.size;
  const recommendedCount = sources.filter((s) => s.recommended).length;

  return (
    <div className="flex flex-col gap-4 pt-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold mb-1">发现数据源</h2>
        <p className="text-sm text-muted-foreground">
          信息池：<span className="text-foreground font-medium">{state.topic}</span>
          {state.criteria && (
            <>
              {' '}· 边界：<span className="text-foreground">{state.criteria}</span>
            </>
          )}
        </p>
        {llmCalls.length > 0 && (
          <button
            onClick={() => setShowLLMLog(true)}
            className="mt-1.5 inline-flex items-center gap-1 text-xs h-6 px-2 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            title="查看 LLM 调用日志"
          >
            <BrainCircuit className="h-3 w-3" />
            LLM调用日志
          </button>
        )}
      </div>

      {/* Search progress pills */}
      {!isDone && (isStreaming || searchQueries.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchQueries.map((q, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 bg-muted text-muted-foreground rounded-full px-3 py-1 text-xs"
            >
              <Search className="h-3 w-3 flex-shrink-0" />
              <span className="font-medium text-foreground">{q}</span>
            </span>
          ))}
          {isStreaming && (
            <div className="basis-full flex gap-1 items-center px-1 mt-1">
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {errorMessage && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive mb-1">发生错误</p>
          <p className="text-muted-foreground text-xs">{errorMessage}</p>
          {isSearchProviderError && (
            <p className="mt-2 text-xs">
              需要配置搜索供应商，请前往{' '}
              <Link href="/settings" className="text-primary underline">
                设置页面
              </Link>{' '}
              配置后重试
            </p>
          )}
          <Button variant="outline" size="sm" className="mt-3" onClick={handleRetry}>
            重试
          </Button>
        </div>
      )}

      {/* Source list */}
      {sources.length > 0 && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-muted-foreground">
              共发现 {sources.length} 个数据源
              {recommendedCount > 0 && (
                <>
                  ，已默认勾选{' '}
                  <span className="font-medium text-foreground">{recommendedCount}</span> 个推荐源
                </>
              )}
              {isDone && (
                <>
                  {' '}· 已选{' '}
                  <span className="font-semibold text-foreground">{selectedCount}</span> 个
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {isDone && (
                <Button variant="ghost" size="sm" onClick={toggleAll} className="text-xs h-7 px-2">
                  {checkedIndices.size === sources.length ? '取消全选' : '全选'}
                </Button>
              )}
            </div>
          </div>

          <ScrollArea className="h-[38vh] md:h-[36vh] rounded-lg border">
            <div className="divide-y">
              {sources.map((source, idx) => {
                const isChecked = checkedIndices.has(idx);
                const isManual = source.description === '手动添加';
                return (
                  <label
                    key={idx}
                    className="flex gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleIndex(idx)}
                      disabled={!isDone}
                      className="mt-1 h-4 w-4 rounded border-border accent-primary flex-shrink-0 cursor-pointer disabled:cursor-default"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span className="font-semibold text-sm leading-snug">{source.title}</span>
                        {isManual && (
                          <Badge className="h-4 px-1.5 text-[10px] bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 font-medium">
                            手动
                          </Badge>
                        )}
                        {source.recommended && (
                          <Badge className="h-4 px-1.5 text-[10px] bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30 font-medium">
                            推荐
                          </Badge>
                        )}
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0 text-muted-foreground hover:text-primary transition-colors"
                          aria-label="在新标签页打开"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mb-1">{source.url}</p>
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {source.description}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          </ScrollArea>

          {/* ── After sources list: manual add + continue search ── */}
          {isDone && (
            <div className="flex items-center gap-2 flex-wrap">
              {/* Manual add button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowManualAdd(!showManualAdd)}
                className="text-xs h-7"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                手动添加源
              </Button>

              {/* Continue search button */}
              {state.subscriptionId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleContinueSearch}
                  disabled={isStreaming}
                  className="text-xs h-7"
                >
                  {isStreaming ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      搜索中...
                    </>
                  ) : (
                    <>
                      <Search className="h-3.5 w-3.5 mr-1" />
                      继续搜索更多源
                    </>
                  )}
                </Button>
              )}

              {continueError && (
                <span className="text-xs text-destructive">{continueError}</span>
              )}
            </div>
          )}

          {/* ── Manual add form ── */}
          {showManualAdd && (
            <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">手动添加数据源</span>
                <button onClick={() => setShowManualAdd(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <input
                type="text"
                placeholder="数据源名称（如：中国茶叶流通协会）"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                type="url"
                placeholder="URL（如：https://example.com/feed.xml）"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                type="text"
                placeholder="描述（可选）"
                value={manualDesc}
                onChange={(e) => setManualDesc(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button size="sm" onClick={handleManualAdd} disabled={!manualTitle.trim() || !manualUrl.trim()}>
                确认添加
              </Button>
            </div>
          )}
        </>
      )}

      {/* Empty state after done */}
      {!isStreaming && isDone && sources.length === 0 && !errorMessage && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-3">
          <p>没有找到数据源</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleRetry}>
              重试
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowManualAdd(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              手动添加
            </Button>
          </div>
        </div>
      )}

      {/* Initial loading state */}
      {isStreaming && sources.length === 0 && searchQueries.length === 0 && !errorMessage && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p>AI 正在搜索合适的数据源...</p>
        </div>
      )}

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-[calc(4rem+env(safe-area-inset-bottom))] bg-background border-t md:static md:border-t-0 md:bg-transparent md:p-0 md:mt-2">
        <div className="flex gap-3">
          <Button
            onClick={handleNext}
            disabled={!isDone || selectedCount === 0}
            className="flex-1 md:flex-none"
          >
            {isStreaming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                分析中
              </>
            ) : selectedCount > 0 ? (
              `下一步（${selectedCount} 个源）`
            ) : (
              '下一步'
            )}
          </Button>
          {onManagedCreate && (
            <Button
              variant="outline"
              onClick={() => {
                abortRef.current?.abort();
                const selected = Array.from(checkedIndices).map((i) => sources[i]).filter(Boolean);
                onManagedCreate(selected);
              }}
              disabled={isDone && selectedCount === 0}
              className="flex-none text-amber-600 border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50"
              title="AI 自动完成脚本生成，在后台创建信息池"
            >
              <BotIcon className="h-4 w-4 mr-1.5" />
              帮我完成
            </Button>
          )}
          <Button variant="outline" onClick={onBack} className="flex-none">
            暂存退出
          </Button>
          {onDiscard && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDiscard}
              className="hidden md:inline-flex flex-none text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              title="丢弃此次订阅创建"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* LLM Log Dialog */}
      {showLLMLog && (
        <LLMLogDialog
          sourceTitle={`发现数据源 — ${state.topic}`}
          calls={llmCalls}
          totalTokens={llmCalls.reduce((sum, c) => sum + (c.usage?.total ?? 0), 0)}
          model={llmCalls[0]?.model}
          onClose={() => setShowLLMLog(false)}
        />
      )}
    </div>
  );
}
