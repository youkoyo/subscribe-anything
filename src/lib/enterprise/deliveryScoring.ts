import {
  parseDeliveryCriteria,
  scoreCardAgainstCriteria,
  type ParsedDeliveryCriteria,
} from './criteriaMatcher';

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
  matchReason?: string;
}

export type DeliverySelectionMode = 'new' | 'previous' | 'empty';

const AUTHORITY_TERMS = ['政府', '总局', '部', '厅', '局', '法院', '协会', '海关', '商务部', '市场监管', '人民日报', '新华社', '央视', '中新网', '证券日报', '经济日报', '行业标准'];

function scoreAuthority(sourceName: string | null, title: string): number {
  const text = `${sourceName ?? ''} ${title}`;
  const matches = AUTHORITY_TERMS.filter((t) => text.includes(t)).length;
  if (matches >= 2) return 90;
  if (matches >= 1) return 65;
  return 30;
}

/**
 * Scoring: relevance from criteriaMatcher, authority from source name.
 * Only relevance determines inclusion; authority is for display only.
 */
export function scoreDeliveryCard(
  card: DeliveryCardLike,
  customCriteria: string,
  now: Date,
  parsedCriteria = parseDeliveryCriteria(customCriteria)
): DeliveryScore {
  const match = scoreCardAgainstCriteria(card, parsedCriteria, now);
  return {
    relevance: match.score,
    authority: scoreAuthority(card.sourceName, card.title),
    matchReason: match.reason,
  };
}

/**
 * Select cards for delivery. Any card where the criteria matcher says "matched"
 * is included. Score is used only for ordering, not for filtering.
 */
export function selectDeliveryCards(input: {
  cards: DeliveryCardLike[];
  customCriteria: string;
  now: Date;
  maxItems: number;
}) {
  const limit = Math.min(500, Math.max(1, input.maxItems));
  const parsedCriteria = parseDeliveryCriteria(input.customCriteria);

  const scored = input.cards.map((card) => {
    const score = scoreDeliveryCard(card, input.customCriteria, input.now, parsedCriteria);
    const match = scoreCardAgainstCriteria(card, parsedCriteria, input.now);
    return { card, score, matched: match.matched, matchedTerms: match.matchedTerms, reason: match.reason };
  });

  // Include everything that matched the criteria
  const matched = scored.filter((item) => item.matched);
  // Sort by relevance score descending, then pick top N
  const sorted = matched.sort((a, b) => b.score.relevance - a.score.relevance);
  const selected = sorted.slice(0, limit);

  return selected;
}

/**
 * Same scoring as selectDeliveryCards but returns per-card disposition for the trace log.
 */
export function scoreCardsForTrace(input: {
  cards: DeliveryCardLike[];
  customCriteria: string;
  now: Date;
  maxItems: number;
}): {
  parsedCriteria: ParsedDeliveryCriteria;
  scored: Array<{
    card: DeliveryCardLike;
    score: ReturnType<typeof scoreDeliveryCard>;
    matched: boolean;
    matchedTerms: string[];
    reason: string;
    disposition: 'selected' | 'ranked_outside_top_n' | 'not_matched';
  }>;
  selected: Array<{ card: DeliveryCardLike; score: ReturnType<typeof scoreDeliveryCard> }>;
} {
  const limit = Math.min(500, Math.max(1, input.maxItems));
  const parsedCriteria = parseDeliveryCriteria(input.customCriteria);

  const allScored = input.cards.map((card) => {
    const score = scoreDeliveryCard(card, input.customCriteria, input.now, parsedCriteria);
    const match = scoreCardAgainstCriteria(card, parsedCriteria, input.now);
    return { card, score, matched: match.matched, matchedTerms: match.matchedTerms, reason: match.reason };
  });

  const matched = allScored.filter((item) => item.matched);
  const sorted = [...matched].sort((a, b) => b.score.relevance - a.score.relevance);
  const topN = sorted.slice(0, limit);
  const topNIds = new Set(topN.map((i) => i.card.id));

  const scored = allScored.map((item) => {
    let disposition: 'selected' | 'ranked_outside_top_n' | 'not_matched';
    if (topNIds.has(item.card.id)) {
      disposition = 'selected';
    } else if (item.matched) {
      disposition = 'ranked_outside_top_n';
    } else {
      disposition = 'not_matched';
    }
    return { ...item, disposition };
  });

  return { parsedCriteria, scored, selected: topN };
}

export function resolveDeliverySelection(input: {
  newCards: DeliveryCardLike[];
  previousCards: DeliveryCardLike[];
  customCriteria: string;
  now: Date;
  maxItems: number;
}): {
  mode: DeliverySelectionMode;
  selected: ReturnType<typeof selectDeliveryCards>;
} {
  const selectedNew = selectDeliveryCards({
    cards: input.newCards,
    customCriteria: input.customCriteria,
    now: input.now,
    maxItems: input.maxItems,
  });
  if (selectedNew.length > 0) {
    return { mode: 'new', selected: selectedNew };
  }

  const selectedPrevious = selectDeliveryCards({
    cards: input.previousCards,
    customCriteria: input.customCriteria,
    now: input.now,
    maxItems: input.maxItems,
  });
  if (selectedPrevious.length > 0) {
    return { mode: 'previous', selected: selectedPrevious };
  }

  return { mode: 'empty', selected: [] };
}

export function scoreToLabel(score: number) {
  if (score >= 75) return '高';
  if (score >= 45) return '中';
  return '低';
}
