export const SOURCE_TYPE_OPTIONS = [
  'authority',
  'news',
  'social',
  'wechat',
  'custom',
] as const;

export type IndustrySourceType = (typeof SOURCE_TYPE_OPTIONS)[number];

export const SOURCE_TYPE_LABELS: Record<IndustrySourceType, string> = {
  authority: '权威事实源',
  news: '新闻发现源',
  social: '社媒线索源',
  wechat: '公众号源',
  custom: '自有补充源',
};

export interface IndustryConfigSnapshot {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  description: string;
  keywords: string[];
  riskTerms: string[];
  regions: string[];
  entities: string[];
  sourceTypes: IndustrySourceType[];
  alertLevel: string;
}

export type IndustryVisibility = 'draft' | 'published';
export type IndustrySubscriptionMode = 'open' | 'approval_required';
export type MonitoringProfileStatus = 'pending' | 'creating' | 'active' | 'failed' | 'disabled';
export type UserIndustrySubscriptionStatus =
  | 'pending_approval'
  | 'pending_profile'
  | 'active'
  | 'rejected'
  | 'paused';
export type IndustryDeliveryRunStatus = 'running' | 'completed' | 'failed';
export type UserDeliveryLogStatus = 'sent' | 'skipped' | 'failed';

export interface EnterpriseIndustryFields {
  visibility?: IndustryVisibility;
  subscriptionMode?: IndustrySubscriptionMode;
  autoProfileExpansion?: boolean;
  deliveryCron?: string | null;
  deliveryTimezone?: string;
  deliveryEnabled?: boolean;
  maxItemsPerEmail?: number;
}

export interface IndustryConfigInput extends EnterpriseIndustryFields {
  name: string;
  category?: string;
  subCategory?: string;
  description?: string;
  keywords?: string[];
  riskTerms?: string[];
  regions?: string[];
  entities?: string[];
  sourceTypes?: string[];
  alertLevel?: string;
  isEnabled?: boolean;
}

export interface IndustrySubscriptionSuggestion {
  topic: string;
  criteria: string;
}
