import type { getDb } from '@/lib/db';
import type { CollectedItem } from '@/lib/sandbox/contract';
import { buildMonitoringIntent } from '@/lib/search/queryPlan';
import { hash } from '@/lib/utils/hash';
import {
  createArticleStore,
  type ArticleCollectionMethod,
  type ArticleRecord,
  type ArticleStore,
} from './articleStore';
import type {
  ArticleCandidate,
  ArticleOrigin,
  ArticleQueryEvidence,
  JsonValue,
  ValidatedArticle,
} from './articleTypes';
import { validateArticleCandidate } from './articleValidator';

interface IngestSource {
  id: string;
  collectorType: ArticleCollectionMethod;
}

interface IngestSubscription {
  id: string;
  topic: string;
  criteria: string | null;
}

export interface IngestArticlesInput {
  db: ReturnType<typeof getDb>;
  source: IngestSource;
  subscription: IngestSubscription;
  candidates: readonly ArticleCandidate[];
  now: Date;
  store?: ArticleStore;
}

export interface IngestArticlesResult {
  inserted: number;
  rejected: number;
  duplicates: number;
}

type RuntimeCollectedItem = Partial<CollectedItem> & {
  publisherName?: unknown;
  queryEvidence?: unknown;
  rawHtml?: unknown;
};

function jsonSafe(value: unknown): JsonValue {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : JSON.parse(serialized) as JsonValue;
  } catch {
    return null;
  }
}

export function articleCandidateFromCollectedItem(
  item: CollectedItem,
  origin: ArticleOrigin,
): ArticleCandidate {
  const runtimeItem = item as RuntimeCollectedItem;
  return {
    origin,
    url: typeof runtimeItem.url === 'string' ? runtimeItem.url : '',
    title: typeof runtimeItem.title === 'string' ? runtimeItem.title : '',
    ...(typeof runtimeItem.summary === 'string' ? { summary: runtimeItem.summary } : {}),
    ...(typeof runtimeItem.publishedAt === 'string'
      ? { publishedAt: runtimeItem.publishedAt }
      : {}),
    ...(typeof runtimeItem.publisherName === 'string'
      ? { publisherName: runtimeItem.publisherName }
      : {}),
    ...(Array.isArray(runtimeItem.queryEvidence)
      ? { queryEvidence: runtimeItem.queryEvidence as ArticleQueryEvidence[] }
      : {}),
    ...(typeof runtimeItem.rawHtml === 'string' ? { rawHtml: runtimeItem.rawHtml } : {}),
    raw: jsonSafe(item),
  };
}

export function buildArticleDedupeKey(subscriptionId: string, canonicalUrl: string) {
  return hash(JSON.stringify([subscriptionId, canonicalUrl]));
}

function buildArticleRecord(
  source: IngestSource,
  subscriptionId: string,
  candidate: ArticleCandidate,
  article: ValidatedArticle,
): ArticleRecord {
  return {
    subscriptionId,
    sourceId: source.id,
    contentHash: hash(article.title + candidate.url),
    dedupeKey: buildArticleDedupeKey(subscriptionId, article.canonicalUrl),
    title: article.title,
    summary: article.summary ?? null,
    sourceUrl: candidate.url,
    canonicalUrl: article.canonicalUrl,
    publisherName: article.publisherName ?? null,
    publishedAt: new Date(article.publishedAt),
    collectionMethod: source.collectorType,
    evidenceLevel: article.evidenceLevel,
    relevanceScore: article.relevanceScore,
    authorityScore: null,
    matchReason: article.matchReason,
    meetsCriteriaFlag: true,
    criteriaResult: 'matched',
    rawData: JSON.stringify({
      queryEvidence: article.queryEvidence,
      ...(article.raw !== undefined ? { raw: article.raw } : {}),
    }),
  };
}

export async function ingestArticles(
  input: IngestArticlesInput,
): Promise<IngestArticlesResult> {
  const intent = buildMonitoringIntent(
    input.subscription.topic,
    input.subscription.criteria ?? '',
  );
  const articles: ArticleRecord[] = [];
  let rejected = 0;

  for (const candidate of input.candidates) {
    const result = validateArticleCandidate(candidate, intent, input.now);
    if (!result.accepted) {
      rejected += 1;
      continue;
    }
    articles.push(buildArticleRecord(
      input.source,
      input.subscription.id,
      candidate,
      result,
    ));
  }

  if (articles.length === 0) {
    return { inserted: 0, rejected, duplicates: 0 };
  }

  const store = input.store ?? createArticleStore(input.db);
  const inserted = await store.persistArticles({
    sourceId: input.source.id,
    subscriptionId: input.subscription.id,
    articles,
    now: input.now,
  });

  return {
    inserted,
    rejected,
    duplicates: articles.length - inserted,
  };
}
