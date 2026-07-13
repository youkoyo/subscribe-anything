import {
  DEFAULT_DELIVERY_TIME_WINDOW_DAYS,
  parseDeliveryCriteria,
  scoreCardAgainstCriteria,
} from '@/lib/enterprise/criteriaMatcher';
import type { CollectedItem } from '@/lib/sandbox/contract';

export interface SourceSampleQualityResult {
  valid: boolean;
  reason: string;
  recentMatchingCount: number;
}

function isRecentPublication(value: string | undefined, now: Date, timeWindowDays: number) {
  if (!value) return false;
  const publishedAt = new Date(value);
  if (!Number.isFinite(publishedAt.getTime())) return false;

  const ageMs = now.getTime() - publishedAt.getTime();
  const maxAgeMs = timeWindowDays * 24 * 60 * 60 * 1000;
  return ageMs >= -24 * 60 * 60 * 1000 && ageMs <= maxAgeMs;
}

/**
 * A generated source may enter the information pool only when its validation
 * sample proves it can provide current content for the requested topic.
 */
export function assessInitialItemsQuality(
  items: CollectedItem[],
  criteria: string | undefined,
  now = new Date()
): SourceSampleQualityResult {
  const normalizedCriteria = criteria?.trim() ?? '';
  const parsedCriteria = normalizedCriteria ? parseDeliveryCriteria(normalizedCriteria) : null;
  const timeWindowDays = parsedCriteria?.timeWindowDays ?? DEFAULT_DELIVERY_TIME_WINDOW_DAYS;
  const recentItems = items.filter((item) =>
    isRecentPublication(item.publishedAt, now, timeWindowDays)
  );

  if (!normalizedCriteria) {
    return recentItems.length > 0
      ? {
          valid: true,
          reason: `样本中包含近${timeWindowDays}天内容`,
          recentMatchingCount: recentItems.length,
        }
      : {
          valid: false,
          reason: `样本中没有可证明为近${timeWindowDays}天发布的内容`,
          recentMatchingCount: 0,
        };
  }

  const recentMatchingCount = recentItems.filter((item) => {
    if (!item.publishedAt || !parsedCriteria) return false;
    return scoreCardAgainstCriteria(
      {
        id: item.url,
        title: item.title,
        summary: item.summary ?? null,
        sourceName: null,
        publishedAt: item.publishedAt ?? null,
        createdAt: item.publishedAt,
      },
      parsedCriteria,
      now
    ).matched;
  }).length;

  if (recentMatchingCount > 0) {
    return {
      valid: true,
      reason: `样本中包含近${timeWindowDays}天且匹配订阅条件的内容`,
      recentMatchingCount,
    };
  }

  return {
    valid: false,
    reason: `样本中没有近${timeWindowDays}天且匹配「${normalizedCriteria}」的内容`,
    recentMatchingCount: 0,
  };
}

/** Whether a previously successful generation may be safely reused on resume. */
export function isReusableGeneratedSample(
  items: CollectedItem[] | undefined,
  criteria: string | undefined,
  now = new Date()
) {
  return assessInitialItemsQuality(items ?? [], criteria, now).valid;
}
