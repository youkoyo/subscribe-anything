import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs } from '@/lib/db/schema';
import { runIndustryDeliveryGroup } from './deliveryService';

const deliveryJobs = new Map<string, ScheduledTask>();
const scheduledIndustries = new Map<string, typeof industryConfigs.$inferSelect>();
/** Industry ids that the in-memory map still references but the DB no longer has.
 *  Tracked separately so the next re-init can drop them cleanly. */
const missingIndustryIds = new Set<string>();

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
        runIndustryDeliveryGroup(industryIds)
          .then((result) => {
            // Prune stale in-memory entries so we don't keep retrying ids
            // that no longer exist in the DB.
            for (const missingId of result.missing) {
              missingIndustryIds.add(missingId);
              scheduledIndustries.delete(missingId);
            }
            if (result.missing.length > 0) {
              console.warn(
                `[DeliveryScheduler] Pruned ${result.missing.length} stale industry config(s) ` +
                  `from in-memory map: ${result.missing.join(', ')}`
              );
            }
          })
          .catch((err) =>
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
  const db = getDb();
  stopDeliveryJobs();
  scheduledIndustries.clear();
  const rows = (await db
    .select()
    .from(industryConfigs)
    .where(eq(industryConfigs.deliveryEnabled, true)));
  for (const row of rows) {
    if (isSchedulableIndustry(row)) scheduledIndustries.set(row.id, row);
  }
  scheduleDeliveryGroups();
  console.log(`[DeliveryScheduler] Loaded ${deliveryJobs.size} delivery group job(s)`);
}
