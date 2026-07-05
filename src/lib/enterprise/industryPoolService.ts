import { and, desc, eq, ne } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryDeliveryRuns,
  industryMonitoringProfiles,
  messageCards,
  sources,
  subscriptions,
  userIndustrySubscriptions,
} from '@/lib/db/schema';
import {
  buildIndustryConfigSnapshot,
  buildIndustrySubscriptionSuggestion,
} from '@/lib/industry-configs/utils';

export interface BindIndustryPoolInput {
  industryConfigId: string;
  subscriptionId: string;
  adminUserId: string;
}

function firstActivePool(profiles: Array<typeof industryMonitoringProfiles.$inferSelect>) {
  return profiles.find((profile) => profile.status === 'active' && !!profile.sharedSubscriptionId) ?? null;
}

export function bindSubscriptionAsIndustryPool(input: BindIndustryPoolInput) {
  const db = getDb();
  const industry = db
    .select()
    .from(industryConfigs)
    .where(eq(industryConfigs.id, input.industryConfigId))
    .get();

  if (!industry) throw new Error('INDUSTRY_NOT_FOUND');

  const subscription = db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, input.subscriptionId))
    .get();

  if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');

  const now = new Date();
  const snapshot = buildIndustryConfigSnapshot(industry);

  db.update(subscriptions)
    .set({
      industryConfigId: industry.id,
      industryConfigSnapshot: JSON.stringify(snapshot),
      isEnabled: true,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, subscription.id))
    .run();

  const existing = db
    .select()
    .from(industryMonitoringProfiles)
    .where(
      and(
        eq(industryMonitoringProfiles.industryConfigId, industry.id),
        eq(industryMonitoringProfiles.sharedSubscriptionId, subscription.id)
      )
    )
    .get();

  const existingDefault = db
    .select()
    .from(industryMonitoringProfiles)
    .where(
      and(
        eq(industryMonitoringProfiles.industryConfigId, industry.id),
        eq(industryMonitoringProfiles.title, '默认信息池')
      )
    )
    .get();

  const profile = existing ?? existingDefault;

  if (profile) {
    db.update(industryMonitoringProfiles)
      .set({
        title: '默认信息池',
        seedCriteria: subscription.criteria ?? industry.description ?? industry.name,
        criteriaSummary: `${industry.name}通用产业信息池`,
        status: 'active',
        sharedSubscriptionId: subscription.id,
        requiresAdminApproval: false,
        approvedBy: input.adminUserId,
        approvedAt: profile.approvedAt ?? now,
        lastProvisionedAt: now,
        provisioningError: null,
        updatedAt: now,
      })
      .where(eq(industryMonitoringProfiles.id, profile.id))
      .run();
  } else {
    db.insert(industryMonitoringProfiles)
      .values({
        id: createId(),
        industryConfigId: industry.id,
        title: '默认信息池',
        seedCriteria: subscription.criteria ?? industry.description ?? industry.name,
        criteriaSummary: `${industry.name}通用产业信息池`,
        keywordsJson: industry.keywordsJson,
        targetEntitiesJson: industry.entitiesJson,
        status: 'active',
        sharedSubscriptionId: subscription.id,
        triggeredByUserId: input.adminUserId,
        requiresAdminApproval: false,
        approvedBy: input.adminUserId,
        approvedAt: now,
        lastProvisionedAt: now,
        provisioningError: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const activeProfile = db
    .select()
    .from(industryMonitoringProfiles)
    .where(
      and(
        eq(industryMonitoringProfiles.industryConfigId, industry.id),
        eq(industryMonitoringProfiles.sharedSubscriptionId, subscription.id)
      )
    )
    .get();

  if (activeProfile) {
    const pendingSubscribers = db
      .select()
      .from(userIndustrySubscriptions)
      .where(
        and(
          eq(userIndustrySubscriptions.industryConfigId, industry.id),
          ne(userIndustrySubscriptions.status, 'paused'),
          ne(userIndustrySubscriptions.status, 'rejected')
        )
      )
      .all();

    for (const row of pendingSubscribers) {
      if (row.status === 'pending_approval') continue;
      db.update(userIndustrySubscriptions)
        .set({
          monitoringProfileId: activeProfile.id,
          status: 'active',
          updatedAt: now,
        })
        .where(eq(userIndustrySubscriptions.id, row.id))
        .run();
    }
  }

  db.update(industryConfigs)
    .set({
      visibility: 'published',
      isEnabled: true,
      deliveryEnabled: true,
      updatedAt: now,
    })
    .where(eq(industryConfigs.id, industry.id))
    .run();

  return activeProfile;
}

export function listIndustryPoolSummariesForAdmin() {
  const db = getDb();
  const configs = db.select().from(industryConfigs).orderBy(desc(industryConfigs.updatedAt)).all();

  return configs.map((config) => {
    const profiles = db
      .select()
      .from(industryMonitoringProfiles)
      .where(eq(industryMonitoringProfiles.industryConfigId, config.id))
      .orderBy(desc(industryMonitoringProfiles.updatedAt))
      .all();
    const activeProfile = firstActivePool(profiles);
    const poolSources = activeProfile?.sharedSubscriptionId
      ? db
          .select()
          .from(sources)
          .where(eq(sources.subscriptionId, activeProfile.sharedSubscriptionId))
          .all()
      : [];
    const cards = activeProfile?.sharedSubscriptionId
      ? db
          .select({ id: messageCards.id, createdAt: messageCards.createdAt })
          .from(messageCards)
          .where(eq(messageCards.subscriptionId, activeProfile.sharedSubscriptionId))
          .all()
      : [];
    const subscribers = db
      .select()
      .from(userIndustrySubscriptions)
      .where(eq(userIndustrySubscriptions.industryConfigId, config.id))
      .all();
    const lastRun = db
      .select()
      .from(industryDeliveryRuns)
      .where(eq(industryDeliveryRuns.industryConfigId, config.id))
      .orderBy(desc(industryDeliveryRuns.createdAt))
      .limit(1)
      .get();

    return {
      ...config,
      snapshot: buildIndustryConfigSnapshot(config),
      suggestion: buildIndustrySubscriptionSuggestion(buildIndustryConfigSnapshot(config)),
      poolStats: {
        profileId: activeProfile?.id ?? null,
        profileStatus: activeProfile?.status ?? null,
        sharedSubscriptionId: activeProfile?.sharedSubscriptionId ?? null,
        profileCount: profiles.length,
        sourceCount: poolSources.length,
        activeSourceCount: poolSources.filter((source) => source.isEnabled && source.status === 'active').length,
        failedSourceCount: poolSources.filter((source) => source.status === 'failed').length,
        messageCount: cards.length,
        lastCollectedAt:
          cards
            .map((card) => card.createdAt)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
        subscriberCount: subscribers.length,
        activeSubscriberCount: subscribers.filter((row) => row.status === 'active').length,
        skippedSubscriberCount: subscribers.filter((row) => row.status === 'pending_profile').length,
        lastDeliveryStatus: lastRun?.status ?? null,
        lastDeliveryAt: lastRun?.createdAt ?? null,
      },
    };
  });
}
