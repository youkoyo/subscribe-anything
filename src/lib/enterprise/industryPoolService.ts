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

export async function bindSubscriptionAsIndustryPool(input: BindIndustryPoolInput) {
  const db = getDb();
  const industry = (await db
    .select()
    .from(industryConfigs)
    .where(eq(industryConfigs.id, input.industryConfigId)))[0];

  if (!industry) throw new Error('INDUSTRY_NOT_FOUND');

  const subscription = (await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, input.subscriptionId)))[0];

  if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');

  const now = new Date();
  const snapshot = buildIndustryConfigSnapshot(industry);

  await db.update(subscriptions)
    .set({
      industryConfigId: industry.id,
      industryConfigSnapshot: JSON.stringify(snapshot),
      isEnabled: true,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, subscription.id));

  const existing = (await db
    .select()
    .from(industryMonitoringProfiles)
    .where(
      and(
        eq(industryMonitoringProfiles.industryConfigId, industry.id),
        eq(industryMonitoringProfiles.sharedSubscriptionId, subscription.id)
      )
    ))[0];

  const existingDefault = (await db
    .select()
    .from(industryMonitoringProfiles)
    .where(
      and(
        eq(industryMonitoringProfiles.industryConfigId, industry.id),
        eq(industryMonitoringProfiles.title, '默认信息池')
      )
    ))[0];

  const profile = existing ?? existingDefault;

  if (profile) {
    await db.update(industryMonitoringProfiles)
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
      .where(eq(industryMonitoringProfiles.id, profile.id));
  } else {
    await db.insert(industryMonitoringProfiles)
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
      });
  }

  const activeProfile = (await db
    .select()
    .from(industryMonitoringProfiles)
    .where(
      and(
        eq(industryMonitoringProfiles.industryConfigId, industry.id),
        eq(industryMonitoringProfiles.sharedSubscriptionId, subscription.id)
      )
    ))[0];

  if (activeProfile) {
    const pendingSubscribers = (await db
      .select()
      .from(userIndustrySubscriptions)
      .where(
        and(
          eq(userIndustrySubscriptions.industryConfigId, industry.id),
          ne(userIndustrySubscriptions.status, 'paused'),
          ne(userIndustrySubscriptions.status, 'rejected')
        )
      ));

    for (const row of pendingSubscribers) {
      if (row.status === 'pending_approval') continue;
      await db.update(userIndustrySubscriptions)
        .set({
          monitoringProfileId: activeProfile.id,
          status: 'active',
          updatedAt: now,
        })
        .where(eq(userIndustrySubscriptions.id, row.id));
    }
  }

  await db.update(industryConfigs)
    .set({
      visibility: 'published',
      isEnabled: true,
      deliveryEnabled: true,
      updatedAt: now,
    })
    .where(eq(industryConfigs.id, industry.id));

  // The process may already be running when a pool is published. Reload the
  // in-memory cron registry now; waiting for the next server restart means
  // subscribers never receive the newly configured digest.
  const { reloadIndustryDelivery } = await import('./deliveryScheduler');
  await reloadIndustryDelivery(industry.id);

  return activeProfile;
}

export async function listIndustryPoolSummariesForAdmin() {
  const db = getDb();
  const configs = (await db.select().from(industryConfigs).orderBy(desc(industryConfigs.updatedAt)));

  return Promise.all(configs.map(async (config) => {
    const profiles = (await db
      .select()
      .from(industryMonitoringProfiles)
      .where(eq(industryMonitoringProfiles.industryConfigId, config.id))
      .orderBy(desc(industryMonitoringProfiles.updatedAt)));
    const activeProfile = firstActivePool(profiles);
    const poolSources = activeProfile?.sharedSubscriptionId
      ? (await db
          .select()
          .from(sources)
          .where(eq(sources.subscriptionId, activeProfile.sharedSubscriptionId)))
      : [];
    const cards = activeProfile?.sharedSubscriptionId
      ? (await db
          .select({ id: messageCards.id, createdAt: messageCards.createdAt })
          .from(messageCards)
          .where(eq(messageCards.subscriptionId, activeProfile.sharedSubscriptionId)))
      : [];
    const subscribers = (await db
      .select()
      .from(userIndustrySubscriptions)
      .where(eq(userIndustrySubscriptions.industryConfigId, config.id)));
    const lastRun = (await db
      .select()
      .from(industryDeliveryRuns)
      .where(eq(industryDeliveryRuns.industryConfigId, config.id))
      .orderBy(desc(industryDeliveryRuns.createdAt))
      .limit(1))[0];

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
  }));
}
