import type { CollectedItem } from '@/lib/sandbox/contract';
import type { LLMCallInfo } from '@/lib/ai/client';
import type { IndustryConfigSnapshot } from '@/lib/industry-configs/types';
import type { SourceType } from '@/lib/ai/agents/sourceIntentPolicy';
import type { SourceDecisionRecord } from '@/lib/ai/agents/sourcePortfolioPolicy';
import type { SearchPlan } from '@/lib/search/queryPlan';
import type {
  ArticleEvidenceLevel,
  ArticleQueryEvidence,
} from '@/lib/collection/articleTypes';

export type CollectionMode = 'search' | 'rss' | 'json' | 'feed_script';

/** A discovery-time sample that has already passed the strict article gate. */
export interface DiscoverySourceSample extends CollectedItem {
  publishedAt: string;
  publisherName?: string;
  evidenceLevel: ArticleEvidenceLevel;
  relevanceScore: number;
  matchReason: string;
  queryEvidence: ArticleQueryEvidence[];
}

export interface FoundSource {
  title: string;
  url: string;
  description: string;
  recommended?: boolean;
  /** true = source can provide metric data for the monitoring criteria */
  canProvideCriteria?: boolean;
  /** Category used to explain and prioritize real-time coverage. */
  sourceType?: SourceType;
  collectionMode?: CollectionMode;
  searchPlan?: SearchPlan;
  /** Live samples that passed freshness, relevance, and page-type validation. */
  initialItems?: DiscoverySourceSample[];
  /** Validated runtime configuration for non-search built-in collectors. */
  collectorConfigJson?: string;
  /** Prevents legacy, same-domain-only discovery logs from being reused. */
  discoveryVersion?: 1;
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
  collectionMode?: CollectionMode;
  searchPlan?: SearchPlan;
  collectorConfigJson?: string;
  discoveryVersion?: 1;
}

export interface WizardState {
  step: 1 | 2 | 3 | 4;
  topic: string;
  criteria: string;
  foundSources: FoundSource[];
  selectedIndices: number[];
  generatedSources: GeneratedSource[];
  industryConfigId?: string | null;
  industryConfigSnapshot?: IndustryConfigSnapshot | null;
  subscriptionId?: string; // Step1 完成后写入，用于后续步骤的 DB 持久化
  /** Step2 LLM 调用记录，持久化到 DB 以便重入向导时恢复 */
  step2LlmCalls?: LLMCallInfo[];
  /** Full audit trail for source candidates, including rejected alternatives. */
  sourceAudit?: SourceDecisionRecord[];
  /** 托管管道的错误消息，用于在向导中显示失败原因 */
  managedError?: string | null;
}
