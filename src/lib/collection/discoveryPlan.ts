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
import { parseStrictPublicationDate, validateArticleCandidate } from './articleValidator';
import { searchCandidateToArticleCandidate } from './collectors/searchSourceCollector';

const SEARCH_SOURCE_URL = 'search://collection-plan/v1';
const STABLE_DISCOVERY_URL = 'discovery://stable-source-candidates/v1';
const MAX_DISCOVERY_SAMPLES = 12;
const MAX_ORIGINAL_ARTICLE_FETCHES = 12;
const ORIGINAL_FETCH_CONCURRENCY = 4;
const MAX_STABLE_CANDIDATES = 10;
const STABLE_VALIDATION_CONCURRENCY = 3;
const MAX_STABLE_ARTICLE_CANDIDATES = 50;
const DEFAULT_STABLE_DISCOVERY_TIMEOUT_MS = 30_000;

const SEARCH_PATH_SEGMENTS = new Set([
  'find',
  'query',
  'results',
  'search',
  'searchpage',
  'searchresult',
  'searchresults',
  'so',
]);
const SEARCH_QUERY_PARAMETERS = new Set([
  'key',
  'keyword',
  'keywords',
  'kw',
  'q',
  'query',
  'qtext',
  'search',
  'searchtext',
  'searchword',
  'term',
  'text',
  'wd',
  'word',
]);
const DISALLOWED_STABLE_SEGMENTS = new Set([
  'about',
  'aboutus',
  'catalog',
  'contact',
  'contactus',
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
  discoverStableCandidates?: (signal: AbortSignal) => Promise<readonly FoundSource[]>;
  sampleStableCandidate?: (
    source: FoundSource,
    mode: Exclude<CollectionMode, 'search'>,
  ) => Promise<ArticleCandidate[]>;
  /** Best-effort original-page fetch; failures fall back to complete provider evidence. */
  enrichSearchCandidate?: (candidate: ArticleCandidate) => Promise<ArticleCandidate>;
  stableDiscoveryTimeoutMs?: number;
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

async function discoverStableWithDeadline(
  discover: NonNullable<DiscoveryPlanDependencies['discoverStableCandidates']>,
  configuredTimeoutMs: number | undefined,
) {
  const timeoutMs = Number.isFinite(configuredTimeoutMs) && (configuredTimeoutMs ?? 0) > 0
    ? configuredTimeoutMs as number
    : DEFAULT_STABLE_DISCOVERY_TIMEOUT_MS;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const task = Promise.resolve().then(() => discover(controller.signal));
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(`可选稳定源发现超时（${timeoutMs} ms）`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([task, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function normalizedText(value: string | undefined) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isStableSourceCandidate(value: unknown): value is FoundSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<FoundSource>;
  return !!normalizedText(source.title)
    && !!normalizedText(source.url)
    && typeof source.description === 'string';
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

function pageToken(segment: string) {
  return segment
    .replace(/\.(?:s?html?|aspx?|jspx?|php\d?|cgi|do|action)$/i, '')
    .replace(/[-_]/g, '')
    .toLowerCase();
}

function isDynamicSearchPage(source: Pick<FoundSource, 'title' | 'url' | 'description'>) {
  const parsed = safeUrl(source.url);
  const text = `${source.title} ${source.description}`.toLowerCase();
  if (/站内搜索|搜索结果|动态搜索|site search|search results/.test(text)) return true;
  if (!parsed) return false;
  if (/^(?:search|so)\./i.test(parsed.hostname)) return true;

  const segments = pathSegments(parsed);
  if (segments.some((segment) => SEARCH_PATH_SEGMENTS.has(pageToken(segment)))) return true;
  return [...parsed.searchParams.keys()]
    .some((key) => SEARCH_QUERY_PARAMETERS.has(pageToken(key)));
}

export function classifyDiscoveryCollectionMode(source: FoundSource): CollectionMode {
  // Explicit built-in collectors prove their content type by parsing. Apply
  // browser-page heuristics only to untyped or script candidates.
  if (source.collectionMode === 'rss' || source.collectionMode === 'json') {
    return source.collectionMode;
  }
  // A model-supplied script label can never turn a dynamic search page into a script source.
  if (isDynamicSearchPage(source)) return 'search';
  if (source.collectionMode === 'search') return 'search';
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

  if (segments.some((segment) => DISALLOWED_STABLE_SEGMENTS.has(pageToken(segment)))) {
    return '页面类型不允许：商品页或关于页面不能作为稳定采集源';
  }
  if (mode === 'feed_script' && segments.length === 0) {
    return '页面类型不允许：网站首页不能作为已验证的稳定采集源';
  }
  return undefined;
}

function hasCompleteProviderEvidence(candidate: ArticleCandidate) {
  const title = normalizedText(candidate.title);
  const summary = normalizedText(candidate.summary);
  const publisherName = normalizedText(candidate.publisherName);
  const publishedAt = normalizedText(candidate.publishedAt);
  if (!title || !summary || !publisherName || !publishedAt) return false;
  if (!parseStrictPublicationDate(publishedAt)) return false;

  return candidate.queryEvidence?.some((evidence) => (
    normalizedText(evidence.title) === title
    && normalizedText(evidence.snippet) === summary
    && normalizedText(evidence.publisherName) === publisherName
    && normalizedText(evidence.publishedAt) === publishedAt
  )) ?? false;
}

function validateSearchCandidate(
  candidate: ArticleCandidate,
  intent: MonitoringIntent,
  now: Date,
): ArticleValidationResult {
  const validation = validateArticleCandidate(candidate, intent, now);
  if (
    validation.accepted
    && validation.evidenceLevel === 'search'
    && !hasCompleteProviderEvidence(candidate)
  ) {
    return {
      accepted: false,
      reason: 'incomplete_search_evidence',
      message: '原文不可读取时，搜索证据必须同时包含明确标题、摘要、发布者和发布时间',
    };
  }
  return validation;
}

async function enrichSearchCandidates(
  candidates: ArticleCandidate[],
  enrich: DiscoveryPlanDependencies['enrichSearchCandidate'],
) {
  if (!enrich || candidates.length === 0) return candidates;
  const enrichCandidate = enrich;
  const enriched = [...candidates];
  const fetchCount = Math.min(candidates.length, MAX_ORIGINAL_ARTICLE_FETCHES);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < fetchCount) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        const result = await enrichCandidate(candidates[index]);
        if (result && typeof result === 'object') enriched[index] = result;
      } catch {
        // A blocked original page is an expected fallback. The strict provider
        // evidence check below decides whether the search result is sufficient.
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(ORIGINAL_FETCH_CONCURRENCY, fetchCount) },
    () => worker(),
  ));
  return enriched;
}

async function settleMapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<PromiseSettledResult<R>>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = { status: 'fulfilled', value: await mapper(values[index]) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  ));
  return results;
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
): SourceEvidence[] {
  const queryRows: SourceEvidence[] = (candidate.queryEvidence ?? []).map((query) => ({
    url: query.url,
    title: query.title,
    ...(normalizedText(query.snippet) ? { snippet: query.snippet.trim() } : {}),
    queryId: query.queryId,
    query: query.query,
    ...(normalizedText(query.publishedAt) ? { publishedAt: query.publishedAt?.trim() } : {}),
    ...(normalizedText(query.publisherName) ? { publisherName: query.publisherName?.trim() } : {}),
    evidenceLevel: 'search',
  }));

  const finalValidation: SourceEvidence = validation.accepted
    ? {
        url: validation.canonicalUrl,
        title: validation.title,
        ...(validation.summary ? { snippet: validation.summary } : {}),
        publishedAt: validation.publishedAt,
        ...(validation.publisherName ? { publisherName: validation.publisherName } : {}),
        evidenceLevel: validation.evidenceLevel,
        matchReason: validation.matchReason,
        validationOutcome: 'accepted',
      }
    : {
        url: candidate.url,
        ...(normalizedText(candidate.title) ? { title: candidate.title.trim() } : {}),
        ...(normalizedText(candidate.summary) ? { snippet: candidate.summary?.trim() } : {}),
        ...(normalizedText(candidate.publishedAt) ? { publishedAt: candidate.publishedAt?.trim() } : {}),
        ...(normalizedText(candidate.publisherName) ? { publisherName: candidate.publisherName?.trim() } : {}),
        validationOutcome: 'rejected',
        rejectionCode: validation.reason,
        exclusionReason: validation.message,
      };

  return [...queryRows, finalValidation];
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
  let sampledCandidateCount = 0;
  try {
    const sampled = await dependencies.sampleStableCandidate(source, mode);
    if (!Array.isArray(sampled)) throw new Error('现场采样器返回值必须是文章候选数组');
    sampledCandidateCount = sampled.length;
    candidates = sampled.slice(0, MAX_STABLE_ARTICLE_CANDIDATES);
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
  const evidence = candidates.flatMap((candidate, index) => toAuditEvidence(candidate, validations[index]));
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
        evidenceCount: sampledCandidateCount,
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
      evidenceCount: sampledCandidateCount,
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
  const searchCandidates = await enrichSearchCandidates(
    collection.candidates.map(searchCandidateToArticleCandidate),
    dependencies.enrichSearchCandidate,
  );
  const searchValidations = searchCandidates.map((candidate) => (
    validateSearchCandidate(candidate, intent, now)
  ));
  const acceptedSearch = dedupeValidatedArticles(searchValidations)
    .slice(0, MAX_DISCOVERY_SAMPLES);
  const searchCollector = searchSource(input, plan, acceptedSearch.map(toDiscoverySample));
  const searchEvidence = searchCandidates.flatMap((candidate, index) => (
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
    executions: collection.executions,
  })];

  let stableCandidates: FoundSource[] = [];
  if (dependencies.discoverStableCandidates) {
    try {
      const discovered: unknown = await discoverStableWithDeadline(
        dependencies.discoverStableCandidates,
        dependencies.stableDiscoveryTimeoutMs,
      );
      if (!Array.isArray(discovered)) throw new Error('稳定源发现器返回值必须是候选数组');
      stableCandidates = discovered.filter((candidate, index) => {
        if (isStableSourceCandidate(candidate)) return true;
        auditRecords.push(stableDiscoveryFailure(
          new Error(`第 ${index + 1} 个稳定源候选格式无效`),
        ));
        return false;
      });
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
  const candidatesToValidate = distinctStableCandidates.slice(0, MAX_STABLE_CANDIDATES);
  for (const source of distinctStableCandidates.slice(MAX_STABLE_CANDIDATES)) {
    const mode = classifyDiscoveryCollectionMode(source);
    auditRecords.push(buildValidatedSourceDecisionRecord({
      source,
      collectionMode: mode,
      validationOutcome: 'rejected',
      evidence: [],
      exclusionReason: `超过稳定源候选上限（${MAX_STABLE_CANDIDATES}）`,
    }));
  }
  const settledStableResults = await settleMapWithConcurrency(
    candidatesToValidate,
    STABLE_VALIDATION_CONCURRENCY,
    (candidate) => validateStableSource(candidate, intent, dependencies, now),
  );
  const stableResults = settledStableResults.flatMap((result, index) => {
    if (result.status === 'fulfilled') return [result.value];
    const source = candidatesToValidate[index];
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    const mode = classifyDiscoveryCollectionMode(source);
    return [{
      audit: buildValidatedSourceDecisionRecord({
        source,
        collectionMode: mode,
        validationOutcome: 'rejected',
        evidence: [],
        exclusionReason: `稳定源验证异常：${message}`,
      }),
    }];
  });
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
