export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ArticleOrigin = 'search' | 'feed';
export type ArticleEvidenceLevel = 'original' | ArticleOrigin;

/** Query evidence intentionally mirrors Task 2 SearchEvidence structurally. */
export interface ArticleQueryEvidence {
  queryId: string;
  query: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  publisherName?: string;
}

export interface ArticleCandidate {
  origin: ArticleOrigin;
  url: string;
  title: string;
  summary?: string;
  publishedAt?: string;
  publisherName?: string;
  queryEvidence?: ArticleQueryEvidence[];
  rawHtml?: string;
  raw?: JsonValue;
}

export interface ValidatedArticle {
  accepted: true;
  canonicalUrl: string;
  title: string;
  summary?: string;
  publishedAt: string;
  publisherName?: string;
  origin: ArticleOrigin;
  evidenceLevel: ArticleEvidenceLevel;
  queryEvidence: ArticleQueryEvidence[];
  raw?: JsonValue;
  relevanceScore: number;
  matchReason: string;
}

export type ArticleRejectionReason =
  | 'invalid_candidate'
  | 'invalid_url'
  | 'page_type'
  | 'missing_title'
  | 'missing_date'
  | 'invalid_date'
  | 'stale'
  | 'future_date'
  | 'irrelevant';

export interface RejectedArticle {
  accepted: false;
  reason: ArticleRejectionReason;
  message: string;
}

export type ArticleValidationResult = ValidatedArticle | RejectedArticle;
