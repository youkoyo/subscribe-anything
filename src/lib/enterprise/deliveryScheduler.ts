import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs } from '@/lib/db/schema';
import { runIndustryDeliveryGroup } from './deliveryService';

const deliveryJobs = new Map<string, ScheduledTask>();
const scheduledIndustries = new Map<string, typeof industryConfigs.$inferSelect>();
const DELIVERY_SCHEDULE_REFRESH_MS = 15 * 1000;
let deliveryRefreshTimer: ReturnType<typeof setInterval> | null = null;
let scheduledIndustryFingerprint: string | null = null;

function deliveryGroupKey(industry: typeof industryConfigs.$inferSelect) {
  return `${industry.deliveryTimezone || 'Asia/Shanghai'}::${industry.deliveryCron}`;
}

function isSchedulableIndustry(industry: typeof industryConfigs.$inferSelect) {
  return industry.deliveryEnabled && industry.deliveryCron && industry.visibility === 'published';
}

function stopDeliveryJobs() {
  for (const task of deliveryJobs.values()) task.stop();
  deliveryJobs.clear();
}

function deliveryScheduleFingerprint(rows: Array<typeof industryConfigs.$inferSelect>) {
  return rows
    .filter(isSchedulableIndustry)
    .map((industry) => [
      industry.id,
      industry.deliveryCron,
      industry.deliveryTimezone,
      industry.deliveryEnabled,
      industry.visibility,
    ].join(':'))
    .sort()
    .join('|');
}

function scheduleDeliveryGroups() {
  stopDeliveryJobs();
  const groups = new Map<string, typeof industryConfigs.$inferSelect[]>();

  for (const industry of scheduledIndustries.values()) {
    if (!isSchedulableIndustry(industry)) continue;
    if (!cron.validate(industry.deliveryCron!)) {
      console.warn(`[DeliveryScheduler] Invalid cron for industry ${industry.id}: ${industry.deliveryCron}`);
      continue;
    }
    const key = deliveryGroupKey(industry);
    const list = groups.get(key) ?? [];
    list.push(industry);
    groups.set(key, list);
  }

  for (const [key, industries] of groups) {
    const first = industries[0];
    const industryIds = industries.map((industry) => industry.id);
    const task = cron.schedule(
      first.deliveryCron!,
      () => {
        runIndustryDeliveryGroup(industryIds).catch((err) =>
          console.error(`[DeliveryScheduler] Delivery failed for group ${key}`, err)
        );
      },
      {
        timezone: first.deliveryTimezone || 'Asia/Shanghai',
      }
    );

    deliveryJobs.set(key, task);
    console.log(
      `[DeliveryScheduler] Scheduled ${industryIds.length} industry delivery job(s) with cron ${first.deliveryCron}`
    );
  }
}

export function scheduleIndustryDelivery(industry: typeof industryConfigs.$inferSelect) {
  scheduledIndustries.delete(industry.id);
  if (isSchedulableIndustry(industry)) scheduledIndustries.set(industry.id, industry);
  scheduleDeliveryGroups();
}

export function unscheduleIndustryDelivery(industryId: string) {
  scheduledIndustries.delete(industryId);
  scheduleDeliveryGroups();
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
  const fingerprint = deliveryScheduleFingerprint(rows);

  if (fingerprint === scheduledIndustryFingerprint) return false;

  stopDeliveryJobs();
  scheduledIndustries.clear();
  for (const row of rows) {
    if (isSchedulableIndustry(row)) scheduledIndustries.set(row.id, row);
  }
  scheduleDeliveryGroups();
  scheduledIndustryFingerprint = fingerprint;
  console.log(`[DeliveryScheduler] Refreshed ${deliveryJobs.size} delivery group job(s)`);
  return true;
}

export async function reloadIndustryDelivery(industryId: string) {
  const db = getDb();
  const industry = (await db.select().from(industryConfigs).where(eq(industryConfigs.id, industryId)))[0];
  if (!industry) {
    unscheduleIndustryDelivery(industryId);
    return;
  }
  scheduleIndustryDelivery(industry);
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
