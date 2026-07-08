export const SOURCE_TYPE_OPTIONS = [
  'authority',
  'news',
  'social',
  'wechat',
  'custom',
] as const;

export type IndustrySourceType = (typeof SOURCE_TYPE_OPTIONS)[number];

export const SOURCE_TYPE_LABELS: Record<IndustrySourceType, string> = {
  authority: '权威事实源',
  news: '新闻发现源',
  social: '社媒线索源',
  wechat: '公众号源',
  custom: '自有补充源',
};

export interface IndustryConfigSnapshot {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  description: string;
  keywords: string[];
  riskTerms: string[];
  regions: string[];
  entities: string[];
  sourceTypes: IndustrySourceType[];
  alertLevel: string;
}

export type IndustryVisibility = 'draft' | 'published';
export type IndustrySubscriptionMode = 'open' | 'approval_required';
export type MonitoringProfileStatus = 'pending' | 'creating' | 'active' | 'failed' | 'disabled';
export type UserIndustrySubscriptionStatus =
  | 'pending_approval'
  | 'pending_profile'
  | 'active'
  | 'rejected'
  | 'paused';
export type IndustryDeliveryRunStatus = 'running' | 'completed' | 'failed';
export type UserDeliveryLogStatus = 'sent' | 'skipped' | 'failed';

export interface EnterpriseIndustryFields {
  visibility?: IndustryVisibility;
  subscriptionMode?: IndustrySubscriptionMode;
  autoProfileExpansion?: boolean;
  deliveryCron?: string | null;
  deliveryTimezone?: string;
  deliveryEnabled?: boolean;
  maxItemsPerEmail?: number;
}

/**
 * Curated delivery-time slots surfaced in the admin UI for industry email reports.
 * Stored in the DB as standard 5-field cron expressions so node-cron can schedule them
 * directly, but presented to admins as plain-language options.
 */
export interface EmailDeliverySlot {
  /** Cron expression (5-field) — the value persisted to `delivery_cron`. */
  cron: string;
  /** Human-readable option shown in the select (e.g. "每天 09:00"). */
  label: string;
  /** Optional secondary hint shown alongside the label. */
  description?: string;
}

export const DEFAULT_EMAIL_DELIVERY_CRON = '0 9 * * *';

export const EMAIL_DELIVERY_SLOTS: EmailDeliverySlot[] = [
  { cron: '*/1 * * * *', label: '每分钟', description: '仅供调试' },
  { cron: '0 8 * * *', label: '每天 08:00', description: '每日早间简报' },
  { cron: '0 9 * * *', label: '每天 09:00', description: '默认 · 每日上班时' },
  { cron: '0 12 * * *', label: '每天 12:00', description: '午间综合' },
  { cron: '0 18 * * *', label: '每天 18:00', description: '下班前日报' },
  { cron: '0 20 * * *', label: '每天 20:00', description: '晚间综合' },
  { cron: '0 9 * * 1-5', label: '工作日 09:00', description: '仅周一至周五' },
  { cron: '0 9 * * 1', label: '每周一 09:00', description: '每周一早报' },
];

export function findEmailDeliverySlot(cron: string | null | undefined): EmailDeliverySlot | undefined {
  if (!cron) return undefined;
  return EMAIL_DELIVERY_SLOTS.find((slot) => slot.cron === cron);
}

/** Returns the label for a known slot, or the raw cron expression as a fallback. */
export function formatEmailDeliveryCron(cron: string | null | undefined): string {
  if (!cron) return '未配置';
  return findEmailDeliverySlot(cron)?.label ?? cron;
}

export interface IndustryConfigInput extends EnterpriseIndustryFields {
  name: string;
  category?: string;
  subCategory?: string;
  description?: string;
  keywords?: string[];
  riskTerms?: string[];
  regions?: string[];
  entities?: string[];
  sourceTypes?: string[];
  alertLevel?: string;
  isEnabled?: boolean;
}

export interface IndustrySubscriptionSuggestion {
  topic: string;
  criteria: string;
}
