import { and, desc, eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryMonitoringProfiles,
  subscriptions,
  userIndustrySubscriptions,
} from '@/lib/db/schema';
import { buildIndustryConfigSnapshot } from '@/lib/industry-configs/utils';
import { runManagedPipeline } from '@/lib/managed/pipeline';

export function listMonitoringProfilesForIndustry(industryConfigId: string) {
  const db = getDb();
  return db
    .select()
    .from(industryMonitoringProfiles)
    .where(eq(industryMonitoringProfiles.industryConfigId, industryConfigId))
    .orderBy(desc(industryMonitoringProfiles.updatedAt))
    .all();
}

export function approveMonitoringProfile(profileId: string, adminUserId: string) {
  const db = getDb();
  db.update(industryMonitoringProfiles)
    .set({
      status: 'creating',
      requiresAdminApproval: false,
      approvedBy: adminUserId,
      approvedAt: new Date(),
      provisioningError: null,
      updatedAt: new Date(),
    })
    .where(eq(industryMonitoringProfiles.id, profileId))
    .run();

  return db
    .select()
    .from(industryMonitoringProfiles)
    .where(eq(industryMonitoringProfiles.id, profileId))
    .get();
}

function buildProfileTopic(industryName: string, profileTitle: string) {
  return `${industryName} - ${profileTitle}`;
}

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function buildProfileCriteria(
  industry: typeof industryConfigs.$inferSelect,
  profile: typeof industryMonitoringProfiles.$inferSelect
) {
  const parts = [
    industry.keywordsJson,
    industry.riskTermsJson,
    industry.regionsJson,
    industry.entitiesJson,
  ].flatMap(parseJsonList);
  parts.push(profile.seedCriteria);
  if (profile.criteriaSummary) parts.push(profile.criteriaSummary);
  return Array.from(new Set(parts.map((item) => item.trim()).filter(Boolean))).join('、');
}

export async function startProfileProvisioning(profileId: string) {
  const db = getDb();
  const row = db
    .select({
      profile: industryMonitoringProfiles,
      industry: industryConfigs,
    })
    .from(industryMonitoringProfiles)
    .innerJoin(industryConfigs, eq(industryMonitoringProfiles.industryConfigId, industryConfigs.id))
    .where(eq(industryMonitoringProfiles.id, profileId))
    .get();

  if (!row) throw new Error('PROFILE_NOT_FOUND');
  const { profile, industry } = row;
  if (profile.sharedSubscriptionId && profile.status === 'active') return profile;

  const ownerUserId = industry.createdBy ?? profile.triggeredByUserId ?? industry.userId;
  const now = new Date();
  const topic = buildProfileTopic(industry.name, profile.title);
  const criteria = buildProfileCriteria(industry, profile);
  const snapshot = buildIndustryConfigSnapshot(industry);

  const subscription = db
    .insert(subscriptions)
    .values({
      id: createId(),
      userId: ownerUserId,
      topic,
      criteria,
      industryConfigId: industry.id,
      industryConfigSnapshot: JSON.stringify(snapshot),
      isEnabled: false,
      managedStatus: 'managed_creating',
      unreadCount: 0,
      totalCount: 0,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  db.update(industryMonitoringProfiles)
    .set({
      status: 'creating',
      sharedSubscriptionId: subscription.id,
      provisioningError: null,
      updatedAt: now,
    })
    .where(eq(industryMonitoringProfiles.id, profile.id))
    .run();

  runManagedPipeline(subscription.id, {
    topic,
    criteria,
    startStep: 'find_sources',
    userId: ownerUserId,
    industryConfigId: industry.id,
    industryConfigSnapshot: snapshot,
  })
    .then(() => {
      const latest = db
        .select({
          managedStatus: subscriptions.managedStatus,
          managedError: subscriptions.managedError,
        })
        .from(subscriptions)
        .where(eq(subscriptions.id, subscription.id))
        .get();

      if (latest?.managedStatus === null) {
        db.update(industryMonitoringProfiles)
          .set({
            status: 'active',
            lastProvisionedAt: new Date(),
            provisioningError: null,
            updatedAt: new Date(),
          })
          .where(eq(industryMonitoringProfiles.id, profile.id))
          .run();
        db.update(userIndustrySubscriptions)
          .set({ status: 'active', updatedAt: new Date() })
          .where(
            and(
              eq(userIndustrySubscriptions.monitoringProfileId, profile.id),
              eq(userIndustrySubscriptions.status, 'pending_profile')
            )
          )
          .run();
      } else {
        const error = latest?.managedError ?? '共享采集池创建失败';
        db.update(industryMonitoringProfiles)
          .set({ status: 'failed', provisioningError: error, updatedAt: new Date() })
          .where(eq(industryMonitoringProfiles.id, profile.id))
          .run();
      }
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      db.update(industryMonitoringProfiles)
        .set({ status: 'failed', provisioningError: message, updatedAt: new Date() })
        .where(eq(industryMonitoringProfiles.id, profile.id))
        .run();
    });

  return subscription;
}
