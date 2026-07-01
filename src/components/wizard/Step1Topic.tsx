'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type {
  IndustryConfigSnapshot,
  IndustrySubscriptionSuggestion,
} from '@/lib/industry-configs/types';
import type { WizardState } from '@/types/wizard';

interface Step1TopicProps {
  state: WizardState;
  onStateChange: (updates: Partial<WizardState>) => void;
  onNext: () => void;
  onBack: () => void;
  onStep1Next?: (
    topic: string,
    criteria: string,
    industryConfigId: string | null,
    industryConfigSnapshot: IndustryConfigSnapshot | null
  ) => Promise<void>;
  onManagedCreate?: (
    topic: string,
    criteria: string,
    industryConfigId: string | null,
    industryConfigSnapshot: IndustryConfigSnapshot | null
  ) => void | Promise<void>;
}

interface IndustryConfigOption {
  id: string;
  name: string;
  category: string | null;
  subCategory: string | null;
  snapshot: IndustryConfigSnapshot;
  suggestion: IndustrySubscriptionSuggestion;
}

const NO_INDUSTRY_CONFIG = '__none__';

export default function Step1Topic({ state, onStateChange, onNext, onStep1Next, onManagedCreate }: Step1TopicProps) {
  const [topic, setTopic] = useState(state.topic);
  const [criteria, setCriteria] = useState(state.criteria);
  const [industryConfigs, setIndustryConfigs] = useState<IndustryConfigOption[]>([]);
  const [selectedIndustryConfigId, setSelectedIndustryConfigId] = useState(
    state.industryConfigId ?? NO_INDUSTRY_CONFIG
  );
  const [industryConfigError, setIndustryConfigError] = useState('');
  const [topicError, setTopicError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/industry-configs?enabledOnly=true')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load industry configs');
        return res.json() as Promise<IndustryConfigOption[]>;
      })
      .then((data) => {
        if (!cancelled) {
          setIndustryConfigs(data);
          setIndustryConfigError('');
        }
      })
      .catch(() => {
        if (!cancelled) setIndustryConfigError('产业配置加载失败，可继续手动创建订阅');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedIndustryConfig = useMemo(
    () => industryConfigs.find((item) => item.id === selectedIndustryConfigId) ?? null,
    [industryConfigs, selectedIndustryConfigId]
  );

  const getIndustrySelection = () => {
    if (selectedIndustryConfig) {
      return {
        industryConfigId: selectedIndustryConfig.id,
        industryConfigSnapshot: selectedIndustryConfig.snapshot,
      };
    }

    if (
      selectedIndustryConfigId !== NO_INDUSTRY_CONFIG &&
      state.industryConfigId === selectedIndustryConfigId
    ) {
      return {
        industryConfigId: state.industryConfigId ?? null,
        industryConfigSnapshot: state.industryConfigSnapshot ?? null,
      };
    }

    return { industryConfigId: null, industryConfigSnapshot: null };
  };

  const handleIndustryChange = (value: string) => {
    setSelectedIndustryConfigId(value);

    if (value === NO_INDUSTRY_CONFIG) {
      onStateChange({ industryConfigId: null, industryConfigSnapshot: null });
      return;
    }

    const config = industryConfigs.find((item) => item.id === value);
    if (!config) return;

    setTopic(config.suggestion.topic);
    setCriteria(config.suggestion.criteria);
    setTopicError('');
    onStateChange({
      topic: config.suggestion.topic,
      criteria: config.suggestion.criteria,
      industryConfigId: config.id,
      industryConfigSnapshot: config.snapshot,
    });
  };

  const validate = (): string | null => {
    const trimmed = topic.trim();
    if (!trimmed) {
      setTopicError('请输入订阅主题');
      return null;
    }
    setTopicError('');
    return trimmed;
  };

  const handleSubmit = async () => {
    const trimmed = validate();
    if (!trimmed) return;
    const industrySelection = getIndustrySelection();

    if (onStep1Next) {
      setIsLoading(true);
      try {
        await onStep1Next(
          trimmed,
          criteria.trim(),
          industrySelection.industryConfigId,
          industrySelection.industryConfigSnapshot
        );
      } finally {
        setIsLoading(false);
      }
    } else {
      onStateChange({
        topic: trimmed,
        criteria: criteria.trim(),
        industryConfigId: industrySelection.industryConfigId,
        industryConfigSnapshot: industrySelection.industryConfigSnapshot,
      });
      onNext();
    }
  };

  const handleManaged = async () => {
    const trimmed = validate();
    if (!trimmed) return;
    const industrySelection = getIndustrySelection();
    setIsLoading(true);
    try {
      await onManagedCreate?.(
        trimmed,
        criteria.trim(),
        industrySelection.industryConfigId,
        industrySelection.industryConfigSnapshot
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pt-4">
      <div>
        <h2 className="text-xl font-semibold mb-1">设置订阅主题</h2>
        <p className="text-sm text-muted-foreground">
          告诉我们你想订阅什么内容，AI 将自动为你发现相关数据源
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="industry-config" className="text-sm font-medium">
            产业配置 <span className="text-muted-foreground font-normal">（可选）</span>
          </label>
          <Select value={selectedIndustryConfigId} onValueChange={handleIndustryChange}>
            <SelectTrigger id="industry-config">
              <SelectValue placeholder="选择产业配置" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_INDUSTRY_CONFIG}>不使用产业配置</SelectItem>
              {industryConfigs.map((config) => (
                <SelectItem key={config.id} value={config.id}>
                  {config.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {industryConfigError ? (
            <p className="text-xs text-amber-400">{industryConfigError}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              选择后会带入建议主题和监控条件，并在订阅中保存产业快照。
            </p>
          )}
          {selectedIndustryConfig ? (
            <div className="rounded-lg border border-cyan-300/25 bg-secondary/35 px-3 py-2 text-xs text-cyan-50/78">
              <div className="font-medium text-cyan-50">{selectedIndustryConfig.name}</div>
              <div className="mt-1 text-muted-foreground">
                {[selectedIndustryConfig.category, selectedIndustryConfig.subCategory]
                  .filter(Boolean)
                  .join(' / ') || '未设置分类'}
              </div>
              {selectedIndustryConfig.snapshot.keywords.length > 0 ? (
                <div className="mt-2 line-clamp-2">
                  关键词：{selectedIndustryConfig.snapshot.keywords.slice(0, 6).join('、')}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="topic" className="text-sm font-medium">
            订阅主题 <span className="text-destructive">*</span>
          </label>
          <Input
            id="topic"
            placeholder="例如：GitHub 热门开源项目"
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              if (e.target.value.trim()) setTopicError('');
            }}
            className={topicError ? 'border-destructive focus-visible:ring-destructive' : ''}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
          {topicError && (
            <p className="text-xs text-destructive">{topicError}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="criteria" className="text-sm font-medium">
            监控条件{' '}
            <span className="text-muted-foreground font-normal">（可选）</span>
          </label>
          <Textarea
            id="criteria"
            placeholder="例如：Star 数超过 1000，最近一周更新"
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={3}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground">
            描述你感兴趣的内容筛选条件，让 AI 更精准地帮你筛选
          </p>
        </div>
      </div>

      {/* Mobile: fixed bottom; Desktop: inline */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-[calc(4rem+env(safe-area-inset-bottom))] bg-background border-t md:static md:border-t-0 md:bg-transparent md:p-0 md:mt-6">
        <div className="flex gap-3">
          <Button onClick={handleSubmit} className="flex-1 md:flex-none" disabled={isLoading}>
            {isLoading ? '创建中...' : '下一步'}
          </Button>
          {onManagedCreate && (
            <Button
              variant="outline"
              onClick={handleManaged}
              disabled={isLoading}
              className="flex-none text-amber-600 border-amber-400/50 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/50"
              title="AI 自动完成所有步骤，在后台创建订阅"
            >
              <Bot className="h-4 w-4 mr-1.5" />
              帮我完成
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
