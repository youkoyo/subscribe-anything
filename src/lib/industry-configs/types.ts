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

export interface IndustryConfigInput {
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
