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
const PAGE_EXTENSION = /\.(?:html?|aspx|php)$/i;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2}))?$/i;
const RFC_2822_DATE = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(GMT|UT|[+-]\d{4})$/i;
const RFC_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RFC_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
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
  return segments.length === 0 || segments.some((segment) => (
    NON_ARTICLE_SEGMENTS.has(segment)
    || NON_ARTICLE_SEGMENTS.has(segment.replace(PAGE_EXTENSION, ''))
  ));
}

function hasValidCalendarDate(year: number, month: number, day: number) {
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day;
}

function hasValidClock(hour: number, minute: number, second: number) {
  return hour >= 0 && hour <= 23
    && minute >= 0 && minute <= 59
    && second >= 0 && second <= 59;
}

function hasMatchingWeekday(value: string | undefined, year: number, month: number, day: number) {
  if (!value) return true;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return RFC_WEEKDAYS[weekday] === value.toLowerCase();
}

function hasValidOffset(value: string) {
  if (value === 'Z' || value.toUpperCase() === 'GMT' || value.toUpperCase() === 'UT') return true;
  const compact = value.includes(':') ? value.slice(1).split(':') : [value.slice(1, 3), value.slice(3, 5)];
  return Number(compact[0]) <= 23 && Number(compact[1]) <= 59;
}

function parsePublishedAt(value: string) {
  const iso = value.match(ISO_DATE_TIME);
  if (iso) {
    const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = iso;
    const calendarIsValid = hasValidCalendarDate(
      Number(yearText),
      Number(monthText),
      Number(dayText),
    );
    const clockIsValid = hourText === undefined || hasValidClock(
      Number(hourText),
      Number(minuteText),
      Number(secondText ?? 0),
    );
    if (!calendarIsValid || !clockIsValid || (offset && !hasValidOffset(offset))) return undefined;

    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : undefined;
  }

  const rfc = value.match(RFC_2822_DATE);
  if (!rfc) return undefined;
  const [, weekday, dayText, monthText, yearText, hourText, minuteText, secondText, offset] = rfc;
  const month = RFC_MONTHS.indexOf(monthText.toLowerCase()) + 1;
  if (
    !hasValidCalendarDate(Number(yearText), month, Number(dayText))
    || !hasMatchingWeekday(weekday, Number(yearText), month, Number(dayText))
    || !hasValidClock(Number(hourText), Number(minuteText), Number(secondText ?? 0))
    || !hasValidOffset(offset)
  ) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : undefined;
}

function validate(candidate: ArticleCandidate, intent: MonitoringIntent, now: Date): ArticleValidationResult {
  const candidateUrl = canonicalizeArticleUrl(candidate.url);
  if (!candidateUrl) return rejection('invalid_url', '文章 URL 必须是有效的 HTTP(S) 地址');
  if (isNonArticlePage(candidateUrl)) {
    return rejection('page_type', 'URL 指向首页、搜索页、产品页或列表页，而不是文章页');
  }

  const metadata = candidate.rawHtml
    ? extractArticleMetadata(candidate.rawHtml, candidate.url)
    : {};
  const canonicalUrl = metadata.canonicalUrl
    ? canonicalizeArticleUrl(metadata.canonicalUrl)
    : candidateUrl;
  if (!canonicalUrl) return rejection('invalid_url', '文章 canonical URL 必须是有效的 HTTP(S) 地址');
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
