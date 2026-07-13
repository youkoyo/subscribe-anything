import type { ArticleRejectionReason } from '@/lib/collection/articleTypes';
import type { CollectorType } from '@/lib/collection/collectors/types';
import type { IntentSource } from './sourceIntentPolicy';

export type SourceValidationOutcome = 'accepted' | 'rejected';

export interface AuditedSource extends IntentSource {
  collectionMode?: CollectorType;
}

export interface SourceEvidence {
  url: string;
  title?: string;
  snippet?: string;
  queryId?: string;
  query?: string;
  publishedAt?: string;
  publisherName?: string;
  evidenceLevel?: 'original' | 'search' | 'feed';
  matchReason?: string;
  validationOutcome?: SourceValidationOutcome;
  rejectionCode?: ArticleRejectionReason;
  exclusionReason?: string;
}

export interface SourceDecisionRecord {
  source: AuditedSource;
  decision: SourceValidationOutcome;
  reason: string;
  evidence: SourceEvidence[];
  collectionMode: CollectorType;
  validationOutcome: SourceValidationOutcome;
  exclusionReason?: string;
  queries?: Array<{ queryId: string; query: string }>;
}

/** Format one live-validation result while preserving the existing audit UI contract. */
export function buildValidatedSourceDecisionRecord(input: {
  source: AuditedSource;
  collectionMode: CollectorType;
  validationOutcome: SourceValidationOutcome;
  evidence: SourceEvidence[];
  acceptedReason?: string;
  exclusionReason?: string;
  queries?: Array<{ queryId: string; query: string }>;
}): SourceDecisionRecord {
  const accepted = input.validationOutcome === 'accepted';
  const reason = accepted
    ? input.acceptedReason ?? '已通过实时样本验证'
    : input.exclusionReason ?? '没有文章通过实时样本验证';

  return {
    source: { ...input.source, collectionMode: input.collectionMode },
    decision: input.validationOutcome,
    reason,
    evidence: input.evidence,
    collectionMode: input.collectionMode,
    validationOutcome: input.validationOutcome,
    ...(input.exclusionReason ? { exclusionReason: input.exclusionReason } : {}),
    ...(input.queries ? { queries: input.queries } : {}),
  };
}

/** Search is mandatory when available; remaining validated collectors keep stable priority. */
export function orderValidatedSources<T extends AuditedSource>(sources: T[]): T[] {
  return sources
    .map((source, index) => ({ source, index }))
    .sort((left, right) => {
      const leftSearch = left.source.collectionMode === 'search' ? 0 : 1;
      const rightSearch = right.source.collectionMode === 'search' ? 0 : 1;
      if (leftSearch !== rightSearch) return leftSearch - rightSearch;

      const leftRecommended = left.source.recommended ? 0 : 1;
      const rightRecommended = right.source.recommended ? 0 : 1;
      if (leftRecommended !== rightRecommended) return leftRecommended - rightRecommended;
      return left.index - right.index;
    })
    .map(({ source }) => source);
}
