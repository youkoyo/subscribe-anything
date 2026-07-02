import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs } from '@/lib/db/schema';
import { runIndustryDelivery } from './deliveryService';

const deliveryJobs = new Map<string, ScheduledTask>();

export function scheduleIndustryDelivery(industry: typeof industryConfigs.$inferSelect) {
  unscheduleIndustryDelivery(industry.id);
  if (!industry.deliveryEnabled || !industry.deliveryCron || industry.visibility !== 'published') {
    return;
  }
  if (!cron.validate(industry.deliveryCron)) {
    console.warn(`[DeliveryScheduler] Invalid cron for industry ${industry.id}: ${industry.deliveryCron}`);
    return;
  }

  const task = cron.schedule(
    industry.deliveryCron,
    () => {
      runIndustryDelivery(industry.id).catch((err) =>
        console.error(`[DeliveryScheduler] Delivery failed for industry ${industry.id}`, err)
      );
    },
    {
      timezone: industry.deliveryTimezone || 'Asia/Shanghai',
    }
  );

  deliveryJobs.set(industry.id, task);
  console.log(`[DeliveryScheduler] Scheduled industry ${industry.id} with cron ${industry.deliveryCron}`);
}

export function unscheduleIndustryDelivery(industryId: string) {
  const task = deliveryJobs.get(industryId);
  if (task) {
    task.stop();
    deliveryJobs.delete(industryId);
  }
}

export async function reloadIndustryDelivery(industryId: string) {
  const db = getDb();
  const industry = db.select().from(industryConfigs).where(eq(industryConfigs.id, industryId)).get();
  if (!industry) {
    unscheduleIndustryDelivery(industryId);
    return;
  }
  scheduleIndustryDelivery(industry);
}

export async function initDeliveryScheduler() {
  const db = getDb();
  const rows = db
    .select()
    .from(industryConfigs)
    .where(eq(industryConfigs.deliveryEnabled, true))
    .all();
  for (const row of rows) scheduleIndustryDelivery(row);
  console.log(`[DeliveryScheduler] Loaded ${deliveryJobs.size} industry delivery job(s)`);
}
