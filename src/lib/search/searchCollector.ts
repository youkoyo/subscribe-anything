import type { SearchResult } from '../ai/tools/webSearch';
import type { SearchPlan, SearchPlanQuery } from './queryPlan';

const SEARCH_CONCURRENCY = 3;
const TRACKING_PARAMETER = /^(?:utm_.*|gclid|fbclid)$/i;

export type SearchFunction = (query: string) => Promise<SearchResult[]>;

export interface SearchExecution {
  queryId: string;
  query: string;
  status: 'success' | 'error';
  resultCount: number;
  error?: string;
}

export interface SearchEvidence extends SearchResult {
  queryId: string;
  query: string;
}

export interface SearchCandidate {
  url: string;
  queryIds: string[];
  evidence: SearchEvidence[];
}

export interface SearchCollection {
  executions: SearchExecution[];
  candidates: SearchCandidate[];
}

interface QueryOutcome {
  query: SearchPlanQuery;
  execution: SearchExecution;
  results: SearchResult[];
}

function canonicalizeResultUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();

    return url.toString();
  } catch {
    return value.split('#', 1)[0] ?? value;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runQuery(query: SearchPlanQuery, searchFn: SearchFunction): Promise<QueryOutcome> {
  try {
    const results = await searchFn(query.query);
    return {
      query,
      execution: {
        queryId: query.id,
        query: query.query,
        status: 'success',
        resultCount: results.length,
      },
      results,
    };
  } catch (error) {
    return {
      query,
      execution: {
        queryId: query.id,
        query: query.query,
        status: 'error',
        resultCount: 0,
        error: errorMessage(error),
      },
      results: [],
    };
  }
}

export async function executeSearchPlan(
  plan: SearchPlan,
  searchFn: SearchFunction,
): Promise<SearchCollection> {
  const queries = plan.queries.filter((query) => query.enabled);
  const outcomes = new Array<QueryOutcome>(queries.length);
  let nextQueryIndex = 0;

  async function worker() {
    while (nextQueryIndex < queries.length) {
      const index = nextQueryIndex;
      nextQueryIndex += 1;
      outcomes[index] = await runQuery(queries[index], searchFn);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(SEARCH_CONCURRENCY, queries.length) },
      () => worker(),
    ),
  );

  const candidates: SearchCandidate[] = [];
  const candidatesByUrl = new Map<string, SearchCandidate>();

  for (const outcome of outcomes) {
    for (const result of outcome.results) {
      const canonicalUrl = canonicalizeResultUrl(result.url);
      let candidate = candidatesByUrl.get(canonicalUrl);

      if (!candidate) {
        candidate = { url: canonicalUrl, queryIds: [], evidence: [] };
        candidatesByUrl.set(canonicalUrl, candidate);
        candidates.push(candidate);
      }

      if (!candidate.queryIds.includes(outcome.query.id)) {
        candidate.queryIds.push(outcome.query.id);
      }
      candidate.evidence.push({
        ...result,
        queryId: outcome.query.id,
        query: outcome.query.query,
      });
    }
  }

  return {
    executions: outcomes.map((outcome) => outcome.execution),
    candidates,
  };
}
