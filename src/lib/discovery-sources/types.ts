export const OPML_SOURCE_CATEGORIES = [
  '新闻',
  '科技',
  '知识',
  '娱乐',
  '财经',
  '生活',
  '编程',
  '外国媒体',
  '公众号',
] as const;

export type OpmlSourceCategory = (typeof OPML_SOURCE_CATEGORIES)[number];

export const SOURCE_PREFERENCES = [
  'authoritative',
  'mainstream',
  'business',
  'industry',
  'developer',
  'research',
  'trend',
  'creator',
] as const;

export type SourcePreference = (typeof SOURCE_PREFERENCES)[number];
export type TrustLevel = 'high' | 'medium' | 'low';
export type UsageRole = 'primary' | 'supplementary' | 'discovery';
export type FeedProvider = 'anyfeeder' | 'direct';

export interface CuratedSourceSeed {
  title: string;
  feedUrl: string;
  originalCategory: OpmlSourceCategory;
}

export interface CuratedSourceCatalogEntry extends CuratedSourceSeed {
  id: string;
  feedProvider: FeedProvider;
  preferences: SourcePreference[];
  trustLevel: TrustLevel;
  defaultUsage: UsageRole;
  topicTags: string[];
  keywords: string[];
}

export interface CuratedSourceMatch {
  source: CuratedSourceCatalogEntry;
  score: number;
  reasons: string[];
  directMatch: boolean;
}

export interface CuratedSourceMatchInput {
  topic: string;
  criteria?: string;
  preferences?: SourcePreference[];
  sourceTypes?: string[];
  limit?: number;
}

export interface CatalogSummary {
  total: number;
  anyfeederCount: number;
  categoryCounts: Record<OpmlSourceCategory, number>;
}
