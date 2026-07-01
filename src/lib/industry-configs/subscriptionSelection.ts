import { getIndustryConfigForUser } from './service';
import type { IndustryConfigSnapshot } from './types';

export interface IndustrySelectionInput {
  industryConfigId?: string | null;
  industryConfigSnapshot?: IndustryConfigSnapshot | null;
}

export interface SubscriptionIndustrySelection {
  industryConfigId: string | null;
  industryConfigSnapshot: string | null;
  snapshot: IndustryConfigSnapshot | null;
}

export const INDUSTRY_CONFIG_NOT_FOUND = 'INDUSTRY_CONFIG_NOT_FOUND';

export function parseIndustryConfigSnapshot(value: string | null | undefined) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as IndustryConfigSnapshot;
    return parsed && typeof parsed === 'object' && typeof parsed.name === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveSubscriptionIndustrySelection(
  userId: string,
  input: IndustrySelectionInput
): SubscriptionIndustrySelection {
  const industryConfigId =
    typeof input.industryConfigId === 'string' ? input.industryConfigId.trim() : '';

  if (industryConfigId) {
    const config = getIndustryConfigForUser(industryConfigId, userId);
    if (!config) throw new Error(INDUSTRY_CONFIG_NOT_FOUND);

    return {
      industryConfigId: config.id,
      industryConfigSnapshot: JSON.stringify(config.snapshot),
      snapshot: config.snapshot,
    };
  }

  const snapshot = input.industryConfigSnapshot ?? null;
  return {
    industryConfigId: null,
    industryConfigSnapshot: snapshot ? JSON.stringify(snapshot) : null,
    snapshot,
  };
}

export function industrySelectionErrorResponse(err: unknown): Response | null {
  if (err instanceof Error && err.message === INDUSTRY_CONFIG_NOT_FOUND) {
    return Response.json({ error: 'Industry config not found' }, { status: 400 });
  }
  return null;
}
