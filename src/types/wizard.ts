import type { CollectedItem } from '@/lib/sandbox/contract';
import type { LLMCallInfo } from '@/lib/ai/client';
import type { IndustryConfigSnapshot } from '@/lib/industry-configs/types';

export type DiscoverySourceTier = 'primary' | 'mainstream' | 'local_official' | 'company_disclosure' | 'vertical';
export type MainstreamSourceChannel = 'general_news' | 'finance' | 'consumer_industry' | 'politics_society' | 'other';

export interface FoundSource {
  title: string;
  url: string;
  description: string;
  recommended?: boolean;
  /** Source provenance declared during AI discovery so coverage is balanced, not industry-site-only. */
  sourceTier?: DiscoverySourceTier;
  /** Required for mainstream discovery sources to keep finance from crowding out general reporting. */
  sourceChannel?: MainstreamSourceChannel;
  /** true = source can provide metric data for the monitoring criteria */
  canProvideCriteria?: boolean;
  /** Catalog sources bypass AI script generation and use the standard RSS collector. */
  discoveryOrigin?: 'catalog' | 'ai';
  collectionStrategy?: 'generic_rss' | 'firecrawl_scrape' | 'ai_script';
  catalogSourceId?: string;
  sourcePreference?: import('@/lib/discovery-sources/types').SourcePreference;
  trustLevel?: import('@/lib/discovery-sources/types').TrustLevel;
  initialItems?: CollectedItem[];
  termProfile?: import('@/lib/industry-configs/term-profile').IndustryTermProfile;
}

export interface GeneratedSource {
  title: string;
  url: string;
  description: string;
  script: string;
  cronExpression: string;
  initialItems: CollectedItem[];
  isEnabled: boolean;
  /** If set, this source failed script generation and cannot be enabled */
  failedReason?: string;
  catalogSourceId?: string;
  discoveryOrigin?: 'catalog' | 'ai';
  collectionStrategy?: 'generic_rss' | 'firecrawl_scrape' | 'ai_script';
}

export interface WizardState {
  step: 1 | 2 | 3 | 4;
  topic: string;
  criteria: string;
  foundSources: FoundSource[];
  selectedIndices: number[];
  generatedSources: GeneratedSource[];
  /** Administrator-only one-off test mode: bypass preset RSS and use legacy AI discovery. */
  skipPresetRss?: boolean;
  industryConfigId?: string | null;
  industryConfigSnapshot?: IndustryConfigSnapshot | null;
  subscriptionId?: string; // Step1 完成后写入，用于后续步骤的 DB 持久化
  /** Step2 LLM 调用记录，持久化到 DB 以便重入向导时恢复 */
  step2LlmCalls?: LLMCallInfo[];
  /** 托管管道的错误消息，用于在向导中显示失败原因 */
  managedError?: string | null;
}
