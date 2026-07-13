import {
  parseDeliveryCriteria,
  scoreCardAgainstCriteria,
} from '../enterprise/criteriaMatcher';
import type { MonitoringIntent } from '../search/queryPlan';
import { extractArticleMetadata } from './articleMetadata';
import type {
  ArticleCandidate,
  ArticleRejectionReason,
  ArticleValidationResult,
} from './articleTypes';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRACKING_PARAMETER = /^(?:utm_.*|gclid|fbclid)$/i;
const NON_ARTICLE_SEGMENTS = new Set([
  'about', 'about-us', 'archive', 'archives', 'catalog', 'categories', 'category',
  'contact', 'contact-us', 'default.aspx', 'default.html', 'find', 'home', 'homepage',
  'index', 'index.htm', 'index.html', 'list', 'listing', 'product', 'products',
  'search', 'shop', 'tag', 'tags',
]);

function rejection(reason: ArticleRejectionReason, message: string): ArticleValidationResult {
  return { accepted: false, reason, message };
}

function nonBlankString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function canonicalizeArticleUrl(value: unknown) {
  const input = nonBlankString(value);
  if (!input) return undefined;

  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMETER.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return undefined;
  }
}

function safePathSegments(canonicalUrl: string) {
  return new URL(canonicalUrl).pathname
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

function isNonArticlePage(canonicalUrl: string) {
  const segments = safePathSegments(canonicalUrl);
  return segments.length === 0 || segments.some((segment) => NON_ARTICLE_SEGMENTS.has(segment));
}

function parsePublishedAt(value: string) {
  if (!/\b\d{4}\b/.test(value)) return undefined;
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    const calendarDate = new Date(Date.UTC(year, month - 1, day));
    if (
      calendarDate.getUTCFullYear() !== year
      || calendarDate.getUTCMonth() !== month - 1
      || calendarDate.getUTCDate() !== day
    ) {
      return undefined;
    }
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function validate(candidate: ArticleCandidate, intent: MonitoringIntent, now: Date): ArticleValidationResult {
  const metadata = candidate.rawHtml
    ? extractArticleMetadata(candidate.rawHtml, candidate.url)
    : {};
  const candidateUrl = canonicalizeArticleUrl(candidate.url);
  const canonicalUrl = canonicalizeArticleUrl(metadata.canonicalUrl) ?? candidateUrl;
  if (!canonicalUrl) return rejection('invalid_url', '文章 URL 必须是有效的 HTTP(S) 地址');
  if (isNonArticlePage(canonicalUrl)) {
    return rejection('page_type', 'URL 指向首页、搜索页、产品页或列表页，而不是文章页');
  }

  const title = nonBlankString(metadata.title) ?? nonBlankString(candidate.title);
  if (!title) return rejection('missing_title', '文章缺少可用标题');
  const summary = nonBlankString(metadata.description) ?? nonBlankString(candidate.summary);
  const publisherName = nonBlankString(metadata.publisherName)
    ?? nonBlankString(candidate.publisherName);

  const metadataDate = nonBlankString(metadata.publishedAt);
  const candidateDate = nonBlankString(candidate.publishedAt);
  const publishedAt = metadataDate ?? candidateDate;
  if (!publishedAt) return rejection('missing_date', '文章缺少真实发布时间');

  const publishedDate = parsePublishedAt(publishedAt);
  if (!publishedDate) return rejection('invalid_date', '文章发布时间无法解析为绝对日期');

  const ageMs = now.getTime() - publishedDate.getTime();
  if (ageMs < -DAY_MS) return rejection('future_date', '文章发布时间超过允许的 24 小时时钟偏差');
  if (ageMs > intent.freshnessDays * DAY_MS) {
    return rejection('stale', `文章发布时间超过最近 ${intent.freshnessDays} 天`);
  }

  const criteriaText = nonBlankString(intent.criteria) ?? nonBlankString(intent.topic) ?? '';
  const parsedCriteria = {
    ...parseDeliveryCriteria(criteriaText),
    timeWindowDays: intent.freshnessDays,
  };
  const match = scoreCardAgainstCriteria(
    {
      id: canonicalUrl,
      title,
      summary: summary ?? null,
      sourceName: null,
      publishedAt,
      createdAt: publishedAt,
    },
    parsedCriteria,
    now,
  );
  if (!match.matched) return rejection('irrelevant', match.reason);

  return {
    accepted: true,
    canonicalUrl,
    title,
    ...(summary ? { summary } : {}),
    publishedAt,
    ...(publisherName ? { publisherName } : {}),
    origin: candidate.origin,
    evidenceLevel: metadataDate ? 'original' : candidate.origin,
    queryEvidence: Array.isArray(candidate.queryEvidence) ? [...candidate.queryEvidence] : [],
    ...(candidate.raw !== undefined ? { raw: candidate.raw } : {}),
    relevanceScore: match.score,
    matchReason: match.reason,
  };
}

export function validateArticleCandidate(
  candidate: ArticleCandidate,
  intent: MonitoringIntent,
  now = new Date(),
): ArticleValidationResult {
  try {
    return validate(candidate, intent, now);
  } catch {
    return rejection('invalid_candidate', '文章候选数据无效');
  }
}
