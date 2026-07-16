import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs } from '@/lib/db/schema';
import { runIndustryDeliveryGroup } from './deliveryService';
import { getIndustryDeliveryConfig, type IndustryDeliverySettings } from './deliverySettings';

const deliveryJobs = new Map<string, ScheduledTask>();
const scheduledIndustries = new Map<string, typeof industryConfigs.$inferSelect>();
const DELIVERY_SCHEDULE_REFRESH_MS = 15 * 1000;
let deliveryRefreshTimer: ReturnType<typeof setInterval> | null = null;
let scheduledIndustryFingerprint: string | null = null;

function isSchedulableIndustry(industry: typeof industryConfigs.$inferSelect) {
  return industry.deliveryEnabled && industry.visibility === 'published';
}

function stopDeliveryJobs() {
  for (const task of deliveryJobs.values()) task.stop();
  deliveryJobs.clear();
}

function deliveryScheduleFingerprint(
  rows: Array<typeof industryConfigs.$inferSelect>,
  schedule: IndustryDeliverySettings
) {
  return rows
    .filter(isSchedulableIndustry)
    .map((industry) => [industry.id, industry.deliveryEnabled, industry.visibility].join(':'))
    .sort()
    .concat(`${schedule.timezone}::${schedule.cron}`)
    .join('|');
}

function scheduleDeliveryGroups(schedule: IndustryDeliverySettings) {
  stopDeliveryJobs();
  const industryIds = [...scheduledIndustries.values()]
    .filter(isSchedulableIndustry)
    .map((industry) => industry.id);
  if (industryIds.length === 0) return;
  if (!cron.validate(schedule.cron)) {
    console.warn(`[DeliveryScheduler] Invalid global industry delivery cron: ${schedule.cron}`);
    return;
  }

  const task = cron.schedule(
    schedule.cron,
    () => {
      runIndustryDeliveryGroup(industryIds).catch((err) =>
        console.error('[DeliveryScheduler] Global industry delivery failed', err)
      );
    },
    { timezone: schedule.timezone }
  );
  deliveryJobs.set('global', task);
  console.log(`[DeliveryScheduler] Scheduled ${industryIds.length} industry delivery job(s) with global cron ${schedule.cron}`);
}

export function scheduleIndustryDelivery(industry: typeof industryConfigs.$inferSelect) {
  scheduledIndustries.delete(industry.id);
  if (isSchedulableIndustry(industry)) scheduledIndustries.set(industry.id, industry);
  void refreshIndustryDeliverySchedules();
}

export function unscheduleIndustryDelivery(industryId: string) {
  scheduledIndustries.delete(industryId);
  void refreshIndustryDeliverySchedules();
}

// Pool publication can finish in the background-worker process, while email
// cron jobs deliberately live in the web process. Reconcile from Postgres so
// a pool created after server startup is never missed by that process.
export async function refreshIndustryDeliverySchedules() {
  const db = getDb();
  const rows = await db
    .select()
    .from(industryConfigs)
    .where(eq(industryConfigs.deliveryEnabled, true));
  const schedule = await getIndustryDeliveryConfig();
  const fingerprint = deliveryScheduleFingerprint(rows, schedule);

  if (fingerprint === scheduledIndustryFingerprint) return false;

  stopDeliveryJobs();
  scheduledIndustries.clear();
  for (const row of rows) {
    if (isSchedulableIndustry(row)) scheduledIndustries.set(row.id, row);
  }
  scheduleDeliveryGroups(schedule);
  scheduledIndustryFingerprint = fingerprint;
  console.log(`[DeliveryScheduler] Refreshed ${deliveryJobs.size} delivery group job(s)`);
  return true;
}

export async function reloadIndustryDelivery(_industryId?: string) {
  await refreshIndustryDeliverySchedules();
}

export async function initDeliveryScheduler() {
  stopDeliveryJobs();
  scheduledIndustries.clear();
  scheduledIndustryFingerprint = null;
  await refreshIndustryDeliverySchedules();
  if (deliveryRefreshTimer) clearInterval(deliveryRefreshTimer);
  deliveryRefreshTimer = setInterval(() => {
    void refreshIndustryDeliverySchedules().catch((error) =>
      console.error('[DeliveryScheduler] Failed to refresh delivery schedules', error)
    );
  }, DELIVERY_SCHEDULE_REFRESH_MS);
  console.log(`[DeliveryScheduler] Loaded ${deliveryJobs.size} delivery group job(s)`);
}
