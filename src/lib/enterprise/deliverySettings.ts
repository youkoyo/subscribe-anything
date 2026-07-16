import cron from 'node-cron';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryDeliveryConfig } from '@/lib/db/schema';
import { DEFAULT_EMAIL_DELIVERY_CRON } from '@/lib/industry-configs/types';

export interface IndustryDeliverySettings {
  cron: string;
  timezone: string;
}

const DEFAULT_INDUSTRY_DELIVERY_SETTINGS: IndustryDeliverySettings = {
  cron: DEFAULT_EMAIL_DELIVERY_CRON,
  timezone: 'Asia/Shanghai',
};

export async function getIndustryDeliveryConfig(): Promise<IndustryDeliverySettings> {
  const db = getDb();
  const stored = (await db
    .select({ cron: industryDeliveryConfig.cron, timezone: industryDeliveryConfig.timezone })
    .from(industryDeliveryConfig)
    .where(eq(industryDeliveryConfig.id, 'default')))[0];

  return {
    cron: stored?.cron?.trim() || DEFAULT_INDUSTRY_DELIVERY_SETTINGS.cron,
    timezone: stored?.timezone?.trim() || DEFAULT_INDUSTRY_DELIVERY_SETTINGS.timezone,
  };
}

export async function updateIndustryDeliveryConfig(
  input: IndustryDeliverySettings,
  updatedBy: string
): Promise<IndustryDeliverySettings> {
  const normalized: IndustryDeliverySettings = {
    cron: input.cron?.trim() || DEFAULT_INDUSTRY_DELIVERY_SETTINGS.cron,
    timezone: input.timezone?.trim() || DEFAULT_INDUSTRY_DELIVERY_SETTINGS.timezone,
  };
  if (!cron.validate(normalized.cron)) throw new Error('INVALID_DELIVERY_CRON');

  const db = getDb();
  await db.insert(industryDeliveryConfig).values({
    id: 'default',
    ...normalized,
    updatedBy,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: industryDeliveryConfig.id,
    set: { ...normalized, updatedBy, updatedAt: new Date() },
  });

  return normalized;
}
