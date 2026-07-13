import { webSearch } from '@/lib/ai/tools/webSearch';
import type { ArticleCandidate, ArticleQueryEvidence } from '../articleTypes';
import {
  executeSearchPlan,
  type SearchCandidate,
  type SearchFunction,
} from '@/lib/search/searchCollector';
import type {
  SearchPlan,
  SearchPlanQuery,
  SearchPlanQueryCategory,
} from '@/lib/search/queryPlan';
import type { CollectorSource, SourceCollector } from './types';

const QUERY_CATEGORIES = new Set<SearchPlanQueryCategory>([
  'event',
  'business',
  'entity',
  'region',
  'required_source',
]);

export interface SearchSourceCollectorDependencies {
  searchFn?: SearchFunction;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseQuery(value: unknown, index: number): SearchPlanQuery {
  if (!isRecord(value)) {
    throw new Error(`Search collector query ${index + 1} must be an object`);
  }
  if (
    typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.query !== 'string'
    || !value.query.trim()
    || typeof value.category !== 'string'
    || !QUERY_CATEGORIES.has(value.category as SearchPlanQueryCategory)
    || value.enabled !== true
  ) {
    throw new Error(`Search collector query ${index + 1} is invalid`);
  }

  return {
    id: value.id.trim(),
    query: value.query.trim(),
    category: value.category as SearchPlanQueryCategory,
    enabled: true,
  };
}

export function parseSearchPlanConfig(configJson: string): SearchPlan {
  let value: unknown;
  try {
    value = JSON.parse(configJson);
  } catch {
    throw new Error('Search collector config must be valid JSON');
  }

  if (
    !isRecord(value)
    || value.version !== 1
    || typeof value.freshnessDays !== 'number'
    || !Number.isInteger(value.freshnessDays)
    || value.freshnessDays <= 0
    || value.requirePublishedAt !== true
    || !Array.isArray(value.queries)
  ) {
    throw new Error('Search collector config must contain a valid version 1 SearchPlan');
  }

  const queries = value.queries.map(parseQuery);
  if (queries.length === 0) {
    throw new Error('Search collector requires at least one enabled search query');
  }

  return {
    version: 1,
    freshnessDays: value.freshnessDays,
    requirePublishedAt: true,
    queries,
  };
}

function nonBlank(value: string | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function queryEvidence(candidate: SearchCandidate): ArticleQueryEvidence[] {
  return candidate.evidence.map((evidence) => ({
    queryId: evidence.queryId,
    query: evidence.query,
    title: evidence.title,
    url: evidence.url,
    snippet: evidence.snippet,
    ...(nonBlank(evidence.publishedAt)
      ? { publishedAt: evidence.publishedAt }
      : {}),
    ...(nonBlank(evidence.publisherName)
      ? { publisherName: evidence.publisherName }
      : {}),
  }));
}

function toArticleCandidate(candidate: SearchCandidate): ArticleCandidate {
  const primary = candidate.evidence.find((item) => nonBlank(item.publishedAt))
    ?? candidate.evidence[0];

  return {
    origin: 'search',
    url: candidate.url,
    title: primary?.title ?? '',
    ...(nonBlank(primary?.snippet) ? { summary: primary?.snippet } : {}),
    ...(nonBlank(primary?.publishedAt) ? { publishedAt: primary?.publishedAt } : {}),
    ...(nonBlank(primary?.publisherName)
      ? { publisherName: primary?.publisherName }
      : {}),
    queryEvidence: queryEvidence(candidate),
    raw: { queryIds: [...candidate.queryIds] },
  };
}

export function createSearchSourceCollector(
  dependencies: SearchSourceCollectorDependencies = {},
): SourceCollector {
  const searchFn = dependencies.searchFn ?? webSearch;

  return {
    async collectCandidates(source: CollectorSource) {
      const plan = parseSearchPlanConfig(source.collectorConfigJson);
      const collection = await executeSearchPlan(plan, searchFn);
      if (collection.executions.every((execution) => execution.status === 'error')) {
        const details = collection.executions
          .map((execution) => `${execution.queryId}: ${execution.error ?? 'unknown error'}`)
          .join('; ');
        throw new Error(`All enabled search queries failed${details ? `: ${details}` : ''}`);
      }
      return collection.candidates.map(toArticleCandidate);
    },
  };
}
