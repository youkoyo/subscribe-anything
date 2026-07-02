import { summarizeCriteriaTokens } from './profileMatcher';

export interface DeliveryCardLike {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string | null;
  publishedAt: Date | string | null;
  createdAt: Date | string;
}

export interface DeliveryScore {
  relevance: number;
  authority: number;
  importance: number;
  freshness: number;
  contentQuality: number;
  total: number;
}

const IMPORTANT_TERMS = ['事故', '处罚', '召回', '监管', '政策', '条例', '检查', '整改', '风险'];
const AUTHORITY_TERMS = ['监管', '市场监管', '政府', '总局', '部', '厅', '局', '法院', '协会'];

function tokenize(text: string): string[] {
  const domainTokens = summarizeCriteriaTokens(text);
  if (domainTokens.length > 0) return domainTokens;
  return text
    .split(/[\s,，、;；。！？!?.：:（）()《》"“”]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function scoreRelevance(text: string, criteria: string) {
  const criteriaTokens = tokenize(criteria);
  if (criteriaTokens.length === 0) return 0;
  const matched = criteriaTokens.filter((token) => text.includes(token)).length;
  return Math.min(100, Math.round((matched / criteriaTokens.length) * 100));
}

function scoreFreshness(value: Date | string | null, now: Date) {
  const date = value ? new Date(value) : now;
  const ageHours = Math.max(0, (now.getTime() - date.getTime()) / 3_600_000);
  if (ageHours <= 24) return 100;
  if (ageHours <= 72) return 70;
  if (ageHours <= 168) return 40;
  return 15;
}

export function scoreDeliveryCard(
  card: DeliveryCardLike,
  customCriteria: string,
  now: Date
): DeliveryScore {
  const text = `${card.title} ${card.summary ?? ''}`;
  const relevance = scoreRelevance(text, customCriteria);
  const authority = includesAny(card.sourceName ?? '', AUTHORITY_TERMS) ? 90 : 55;
  const importance = includesAny(text, IMPORTANT_TERMS) ? 85 : 45;
  const freshness = scoreFreshness(card.publishedAt ?? card.createdAt, now);
  const contentQuality = (card.summary?.length ?? 0) >= 30 ? 80 : 45;
  const total = Math.round(
    relevance * 0.45 +
      authority * 0.20 +
      importance * 0.15 +
      freshness * 0.10 +
      contentQuality * 0.10
  );

  return { relevance, authority, importance, freshness, contentQuality, total };
}

export function selectDeliveryCards(input: {
  cards: DeliveryCardLike[];
  customCriteria: string;
  now: Date;
  maxItems: number;
}) {
  const limit = Math.min(10, Math.max(1, input.maxItems));
  return input.cards
    .map((card) => ({
      card,
      score: scoreDeliveryCard(card, input.customCriteria, input.now),
    }))
    .filter((item) => item.score.relevance >= 20 || item.score.total >= 55)
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit);
}

export function scoreToLabel(score: number) {
  if (score >= 75) return '高';
  if (score >= 45) return '中';
  return '低';
}
