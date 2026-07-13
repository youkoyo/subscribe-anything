import type { SourcePreference } from '@/lib/ai/agents/sourcePreferences';
import {
  buildValidatedSourceDecisionRecord,
  orderValidatedSources,
  type SourceDecisionRecord,
  type SourceEvidence,
} from '@/lib/ai/agents/sourcePortfolioPolicy';
import {
  buildMonitoringIntent,
  buildSearchQueryPlan,
  type MonitoringIntent,
  type SearchPlan,
} from '@/lib/search/queryPlan';
import {
  executeSearchPlan,
  type SearchExecution,
  type SearchFunction,
} from '@/lib/search/searchCollector';
import type {
  CollectionMode,
  DiscoverySourceSample,
  FoundSource,
} from '@/types/wizard';
import type {
  ArticleCandidate,
  ArticleValidationResult,
  ValidatedArticle,
} from './articleTypes';
import { validateArticleCandidate } from './articleValidator';
import { searchCandidateToArticleCandidate } from './collectors/searchSourceCollector';

const SEARCH_SOURCE_URL = 'search://collection-plan/v1';
const STABLE_DISCOVERY_URL = 'discovery://stable-source-candidates/v1';
const MAX_DISCOVERY_SAMPLES = 12;

const SEARCH_PATH_SEGMENTS = new Set([
  'find',
  'query',
  'results',
  'search',
  'search.html',
  'so',
]);
const SEARCH_QUERY_PARAMETERS = new Set([
  'keyword',
  'keywords',
  'q',
  'query',
  'search',
  'wd',
]);
const DISALLOWED_STABLE_SEGMENTS = new Set([
  'about',
  'about-us',
  'catalog',
  'contact',
  'contact-us',
  'product',
  'products',
  'shop',
]);

export interface DiscoveryPlanInput {
  topic: string;
  criteria?: string;
  sourcePreferences?: readonly SourcePreference[];
}

export interface DiscoveryPlanDependencies {
  searchFn: SearchFunction;
  discoverStableCandidates?: () => Promise<readonly FoundSource[]>;
  sampleStableCandidate?: (
    source: FoundSource,
    mode: Exclude<CollectionMode, 'search'>,
  ) => Promise<ArticleCandidate[]>;
  now?: Date | (() => Date);
}

export interface DiscoveryPlanResult {
  intent: MonitoringIntent;
  searchPlan: SearchPlan;
  sources: FoundSource[];
  auditRecords: SourceDecisionRecord[];
  executions: SearchExecution[];
}

function currentTime(value: DiscoveryPlanDependencies['now']) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'function') return value();
  return new Date();
}

function normalizedText(value: string | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function pathSegments(url: URL) {
  return url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment).toLowerCase();
      } catch {
        return segment.toLowerCase();
      }
    });
}

function isDynamicSearchPage(source: Pick<FoundSource, 'title' | 'url' | 'description'>) {
  const parsed = safeUrl(source.url);
  const text = `${source.title} ${source.description}`.toLowerCase();
  if (/站内搜索|搜索结果|动态搜索|site search|search results/.test(text)) return true;
  if (!parsed) return false;

  const segments = pathSegments(parsed);
  if (segments.some((segment) => SEARCH_PATH_SEGMENTS.has(segment))) return true;
  return [...parsed.searchParams.keys()]
    .some((key) => SEARCH_QUERY_PARAMETERS.has(key.toLowerCase()));
}

export function classifyDiscoveryCollectionMode(source: FoundSource): CollectionMode {
  // A model-supplied label can never turn a dynamic search page into a script source.
  if (isDynamicSearchPage(source)) return 'search';
  if (source.collectionMode === 'search') return 'search';
  if (source.collectionMode === 'rss' || source.collectionMode === 'json') {
    return source.collectionMode;
  }
  if (source.collectionMode === 'feed_script') return 'feed_script';

  const url = source.url.toLowerCase();
  const text = `${source.title} ${source.description}`.toLowerCase();
  if (
    /(?:^|[/._-])(?:rss|atom|feed)(?:[/._?&=-]|$)/i.test(url)
    || /\.xml(?:$|[?#])/i.test(url)
    || /rss|atom|订阅源/.test(text)
  ) {
    return 'rss';
  }
  if (
    /\.json(?:$|[?#])/i.test(url)
    || /(?:^|\/)api(?:\/|$)/i.test(safeUrl(source.url)?.pathname ?? '')
    || /json|数据接口|\bapi\b/.test(text)
  ) {
    return 'json';
  }
  return 'feed_script';
}

function stablePageExclusion(source: FoundSource, mode: CollectionMode) {
  const parsed = safeUrl(source.url);
  if (!parsed) return '来源 URL 不是有效的 HTTP(S) 地址';
  const segments = pathSegments(parsed);

  if (segments.some((segment) => DISALLOWED_STABLE_SEGMENTS.has(segment))) {
    return '页面类型不允许：商品页或关于页面不能作为稳定采集源';
  }
  if (mode === 'feed_script' && segments.length === 0) {
    return '页面类型不允许：网站首页不能作为已验证的稳定采集源';
  }
  return undefined;
}

function toDiscoverySample(article: ValidatedArticle): DiscoverySourceSample {
  return {
    title: article.title,
    url: article.canonicalUrl,
    ...(article.summary ? { summary: article.summary } : {}),
    publishedAt: article.publishedAt,
    ...(article.publisherName ? { publisherName: article.publisherName } : {}),
    evidenceLevel: article.evidenceLevel,
    relevanceScore: article.relevanceScore,
    matchReason: article.matchReason,
    queryEvidence: article.queryEvidence,
  };
}

function toAuditEvidence(
  candidate: ArticleCandidate,
  validation: ArticleValidationResult,
): SourceEvidence {
  const queryEvidence = candidate.queryEvidence?.[0];
  if (validation.accepted) {
    return {
      url: validation.canonicalUrl,
      title: validation.title,
      ...(validation.summary ? { snippet: validation.summary } : {}),
      ...(queryEvidence ? { queryId: queryEvidence.queryId, query: queryEvidence.query } : {}),
      publishedAt: validation.publishedAt,
      ...(validation.publisherName ? { publisherName: validation.publisherName } : {}),
      evidenceLevel: validation.evidenceLevel,
      matchReason: validation.matchReason,
      validationOutcome: 'accepted',
    };
  }

  return {
    url: candidate.url,
    ...(normalizedText(candidate.title) ? { title: candidate.title.trim() } : {}),
    ...(normalizedText(candidate.summary) ? { snippet: candidate.summary?.trim() } : {}),
    ...(queryEvidence ? { queryId: queryEvidence.queryId, query: queryEvidence.query } : {}),
    ...(normalizedText(candidate.publishedAt) ? { publishedAt: candidate.publishedAt?.trim() } : {}),
    ...(normalizedText(candidate.publisherName) ? { publisherName: candidate.publisherName?.trim() } : {}),
    validationOutcome: 'rejected',
    rejectionCode: validation.reason,
    exclusionReason: validation.message,
  };
}

function uniqueReasons(validations: ArticleValidationResult[]) {
  return Array.from(new Set(validations
    .filter((validation) => !validation.accepted)
    .map((validation) => validation.message)));
}

function dedupeValidatedArticles(validations: ArticleValidationResult[]) {
  const accepted: ValidatedArticle[] = [];
  const indexByUrl = new Map<string, number>();

  for (const validation of validations) {
    if (!validation.accepted) continue;
    const existingIndex = indexByUrl.get(validation.canonicalUrl);
    if (existingIndex === undefined) {
      indexByUrl.set(validation.canonicalUrl, accepted.length);
      accepted.push(validation);
      continue;
    }

    const existing = accepted[existingIndex];
    const evidenceRank = (article: ValidatedArticle) => article.evidenceLevel === 'original' ? 1 : 0;
    if (
      evidenceRank(validation) > evidenceRank(existing)
      || (
        evidenceRank(validation) === evidenceRank(existing)
        && validation.relevanceScore > existing.relevanceScore
      )
    ) {
      accepted[existingIndex] = validation;
    }
  }

  return accepted;
}

function searchSource(input: DiscoveryPlanInput, plan: SearchPlan, samples: DiscoverySourceSample[]): FoundSource {
  return {
    title: `${input.topic.trim()} 检索方案`,
    url: SEARCH_SOURCE_URL,
    description: `按监测画像定时执行 ${plan.queries.length} 条短查询，并统一验证文章时效与相关性`,
    recommended: true,
    sourceType: 'general_news',
    collectionMode: 'search',
    searchPlan: plan,
    collectorConfigJson: JSON.stringify(plan),
    initialItems: samples,
    discoveryVersion: 1,
  };
}

function searchFailureReason(
  executions: SearchExecution[],
  validations: ArticleValidationResult[],
) {
  if (executions.length > 0 && executions.every((execution) => execution.status === 'error')) {
    const details = executions.map((execution) => execution.error).filter(Boolean).join('；');
    return `所有检索查询均失败${details ? `：${details}` : ''}`;
  }
  if (validations.length === 0) return '检索未返回候选文章，无法验证搜索采集方案';
  const reasons = uniqueReasons(validations);
  return `没有搜索文章通过近期、相关性和页面类型验证${reasons.length ? `：${reasons.join('；')}` : ''}`;
}

function stableDiscoveryFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const source: FoundSource = {
    title: '可选稳定源发现',
    url: STABLE_DISCOVERY_URL,
    description: 'LLM 只用于补充发现 RSS、JSON 或静态列表候选',
    collectionMode: 'feed_script',
    sourceType: 'other',
  };
  return buildValidatedSourceDecisionRecord({
    source,
    collectionMode: 'feed_script',
    validationOutcome: 'rejected',
    evidence: [],
    exclusionReason: `可选稳定源发现失败：${message}`,
  });
}

async function validateStableSource(
  source: FoundSource,
  intent: MonitoringIntent,
  dependencies: DiscoveryPlanDependencies,
  now: Date,
): Promise<{ source?: FoundSource; audit: SourceDecisionRecord }> {
  const mode = classifyDiscoveryCollectionMode(source);
  if (mode === 'search') {
    const exclusionReason = '动态搜索页由统一搜索采集器覆盖，不能作为 feed_script 稳定源';
    return {
      audit: buildValidatedSourceDecisionRecord({
        source,
        collectionMode: 'search',
        validationOutcome: 'rejected',
        evidence: [],
        exclusionReason,
      }),
    };
  }

  const pageExclusion = stablePageExclusion(source, mode);
  if (pageExclusion) {
    return {
      audit: buildValidatedSourceDecisionRecord({
        source,
        collectionMode: mode,
        validationOutcome: 'rejected',
        evidence: [],
        exclusionReason: pageExclusion,
      }),
    };
  }

  if (!dependencies.sampleStableCandidate) {
    const exclusionReason = '没有可用的现场采样器，稳定源尚未通过实时样本验证';
    return {
      audit: buildValidatedSourceDecisionRecord({
        source,
        collectionMode: mode,
        validationOutcome: 'rejected',
        evidence: [],
        exclusionReason,
      }),
    };
  }

  let candidates: ArticleCandidate[];
  try {
    candidates = await dependencies.sampleStableCandidate(source, mode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const exclusionReason = `稳定源现场采样失败：${message}`;
    return {
      audit: buildValidatedSourceDecisionRecord({
        source,
        collectionMode: mode,
        validationOutcome: 'rejected',
        evidence: [],
        exclusionReason,
      }),
    };
  }

  const validations = candidates.map((candidate) => validateArticleCandidate(candidate, intent, now));
  const accepted = dedupeValidatedArticles(validations);
  const evidence = candidates.map((candidate, index) => toAuditEvidence(candidate, validations[index]));
  if (accepted.length === 0) {
    const reasons = uniqueReasons(validations);
    const exclusionReason = candidates.length === 0
      ? '稳定源没有产出近期匹配样本'
      : `稳定源没有近期匹配样本：${reasons.join('；')}`;
    return {
      audit: buildValidatedSourceDecisionRecord({
        source,
        collectionMode: mode,
        validationOutcome: 'rejected',
        evidence,
        exclusionReason,
      }),
    };
  }

  const validatedSource: FoundSource = {
    ...source,
    collectionMode: mode,
    initialItems: accepted.slice(0, MAX_DISCOVERY_SAMPLES).map(toDiscoverySample),
    discoveryVersion: 1,
  };
  return {
    source: validatedSource,
    audit: buildValidatedSourceDecisionRecord({
      source: validatedSource,
      collectionMode: mode,
      validationOutcome: 'accepted',
      evidence,
      acceptedReason: `现场采样中有 ${accepted.length} 篇近期匹配文章通过验证`,
    }),
  };
}

/** Build one search-first collection plan and admit only live-validated stable sources. */
export async function discoverCollectionPlan(
  input: DiscoveryPlanInput,
  dependencies: DiscoveryPlanDependencies,
): Promise<DiscoveryPlanResult> {
  const now = currentTime(dependencies.now);
  const criteria = input.criteria?.trim() === '全部' ? '' : input.criteria ?? '';
  const intent = buildMonitoringIntent(input.topic, criteria);
  const plan = buildSearchQueryPlan(intent, [...(input.sourcePreferences ?? [])]);
  const collection = await executeSearchPlan(plan, dependencies.searchFn);
  const searchCandidates = collection.candidates.map(searchCandidateToArticleCandidate);
  const searchValidations = searchCandidates.map((candidate) => (
    validateArticleCandidate(candidate, intent, now)
  ));
  const acceptedSearch = dedupeValidatedArticles(searchValidations)
    .slice(0, MAX_DISCOVERY_SAMPLES);
  const searchCollector = searchSource(input, plan, acceptedSearch.map(toDiscoverySample));
  const searchEvidence = searchCandidates.map((candidate, index) => (
    toAuditEvidence(candidate, searchValidations[index])
  ));
  const searchAccepted = acceptedSearch.length > 0;
  const auditRecords: SourceDecisionRecord[] = [buildValidatedSourceDecisionRecord({
    source: searchCollector,
    collectionMode: 'search',
    validationOutcome: searchAccepted ? 'accepted' : 'rejected',
    evidence: searchEvidence,
    ...(searchAccepted
      ? { acceptedReason: `${acceptedSearch.length} 篇当前搜索文章通过验证` }
      : { exclusionReason: searchFailureReason(collection.executions, searchValidations) }),
    queries: plan.queries.map((query) => ({ queryId: query.id, query: query.query })),
  })];

  let stableCandidates: readonly FoundSource[] = [];
  if (dependencies.discoverStableCandidates) {
    try {
      stableCandidates = await dependencies.discoverStableCandidates();
    } catch (error) {
      auditRecords.push(stableDiscoveryFailure(error));
    }
  }

  const seenStableUrls = new Set<string>();
  const distinctStableCandidates = stableCandidates.filter((candidate) => {
    const key = candidate.url.trim().toLowerCase();
    if (!key || seenStableUrls.has(key)) return false;
    seenStableUrls.add(key);
    return true;
  });
  const stableResults = await Promise.all(distinctStableCandidates.map((candidate) => (
    validateStableSource(candidate, intent, dependencies, now)
  )));
  auditRecords.push(...stableResults.map((result) => result.audit));

  const sources = orderValidatedSources([
    ...(searchAccepted ? [searchCollector] : []),
    ...stableResults.flatMap((result) => result.source ? [result.source] : []),
  ]);

  return {
    intent,
    searchPlan: plan,
    sources,
    auditRecords,
    executions: collection.executions,
  };
}
