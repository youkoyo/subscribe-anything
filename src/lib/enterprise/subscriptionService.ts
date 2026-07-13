import { and, desc, eq, gte } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryMonitoringProfiles,
  messageCards,
  sources,
  userIndustrySubscriptions,
  users,
} from '@/lib/db/schema';
import { getPublishedIndustryConfig } from '@/lib/industry-configs/service';
import { matchMonitoringProfile } from './profileMatcher';
import { normalizeRecipientEmails, validateRecipientEmails } from './recipientEmails';
import { selectDeliveryCards } from './deliveryScoring';

export interface CreateUserIndustrySubscriptionInput {
  userId: string;
  industryConfigId: string;
  customCriteria: string;
  extraRecipientEmails?: string[];
}

const POOL_FRESHNESS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

async function hasRecentPoolCoverage(
  db: ReturnType<typeof getDb>,
  sharedSubscriptionId: string,
  customCriteria: string
) {
  const now = new Date();
  const cards = await db
    .select({
      id: messageCards.id,
      title: messageCards.title,
      summary: messageCards.summary,
      sourceName: sources.title,
      publishedAt: messageCards.publishedAt,
      createdAt: messageCards.createdAt,
    })
    .from(messageCards)
    .innerJoin(sources, eq(messageCards.sourceId, sources.id))
    .where(
      and(
        eq(messageCards.subscriptionId, sharedSubscriptionId),
        gte(messageCards.publishedAt, new Date(now.getTime() - POOL_FRESHNESS_WINDOW_MS))
      )
    )
    .orderBy(desc(messageCards.publishedAt))
    .limit(200);

  return selectDeliveryCards({
    cards,
    customCriteria,
    now,
    maxItems: 1,
  }).length > 0;
}

export async function listMyIndustrySubscriptions(userId: string) {
  const db = getDb();
  return (await db
    .select({
      subscription: userIndustrySubscriptions,
      industry: industryConfigs,
      profile: industryMonitoringProfiles,
    })
    .from(userIndustrySubscriptions)
    .innerJoin(industryConfigs, eq(userIndustrySubscriptions.industryConfigId, industryConfigs.id))
    .leftJoin(
      industryMonitoringProfiles,
      eq(userIndustrySubscriptions.monitoringProfileId, industryMonitoringProfiles.id)
    )
    .where(eq(userIndustrySubscriptions.userId, userId))
    .orderBy(desc(userIndustrySubscriptions.updatedAt)));
}

export async function listIndustrySubscribersForAdmin(industryConfigId: string) {
  const db = getDb();
  return (await db
    .select({
      subscription: userIndustrySubscriptions,
      user: {
        id: users.id,
        email: users.email,
        name: users.name,
      },
      profile: industryMonitoringProfiles,
    })
    .from(userIndustrySubscriptions)
    .innerJoin(users, eq(userIndustrySubscriptions.userId, users.id))
    .leftJoin(
      industryMonitoringProfiles,
      eq(userIndustrySubscriptions.monitoringProfileId, industryMonitoringProfiles.id)
    )
    .where(eq(userIndustrySubscriptions.industryConfigId, industryConfigId))
    .orderBy(desc(userIndustrySubscriptions.updatedAt)));
}

export async function createUserIndustrySubscription(input: CreateUserIndustrySubscriptionInput) {
  const db = getDb();
  const industry = await getPublishedIndustryConfig(input.industryConfigId);
  if (!industry) throw new Error('INDUSTRY_NOT_FOUND');

  const user = (await db.select().from(users).where(eq(users.id, input.userId)))[0];
  const recipients = normalizeRecipientEmails(user?.email, input.extraRecipientEmails ?? []);
  const recipientValidation = validateRecipientEmails(recipients);
  if (!recipientValidation.valid) throw new Error(recipientValidation.error);

  const criteria = input.customCriteria.trim();
  if (!criteria) throw new Error('CUSTOM_CRITERIA_REQUIRED');

  const initialStatus =
    industry.subscriptionMode === 'approval_required' ? 'pending_approval' : 'pending_profile';
  const now = new Date();

  const row = (await db
    .insert(userIndustrySubscriptions)
    .values({
      id: createId(),
      userId: input.userId,
      industryConfigId: input.industryConfigId,
      monitoringProfileId: null,
      status: initialStatus,
      customCriteria: criteria,
      recipientEmailsJson: JSON.stringify(recipients),
      createdAt: now,
      updatedAt: now,
    })
    .returning())[0];

  if (initialStatus === 'pending_profile') {
    return bindSubscriptionToProfile(row.id);
  }

  return row;
}

export async function bindSubscriptionToProfile(userSubscriptionId: string) {
  const db = getDb();
  const row = (await db
    .select({
      subscription: userIndustrySubscriptions,
      industry: industryConfigs,
    })
    .from(userIndustrySubscriptions)
    .innerJoin(industryConfigs, eq(userIndustrySubscriptions.industryConfigId, industryConfigs.id))
    .where(eq(userIndustrySubscriptions.id, userSubscriptionId)))[0];

  if (!row) throw new Error('USER_SUBSCRIPTION_NOT_FOUND');

  const profiles = (await db
    .select()
    .from(industryMonitoringProfiles)
    .where(eq(industryMonitoringProfiles.industryConfigId, row.industry.id)));

  const now = new Date();
  const reusableProfiles = profiles.filter(
    (profile) => profile.status === 'active' && !!profile.sharedSubscriptionId
  );
  let match = matchMonitoringProfile({
    customCriteria: row.subscription.customCriteria,
    profiles: reusableProfiles,
    autoProfileExpansion: false,
  });

  if (match.action === 'reuse') {
    const matchedProfile = reusableProfiles.find((profile) => profile.id === match.profileId);
    if (matchedProfile?.sharedSubscriptionId && await hasRecentPoolCoverage(
      db,
      matchedProfile.sharedSubscriptionId,
      row.subscription.customCriteria
    )) {
      await db.update(userIndustrySubscriptions)
        .set({
          monitoringProfileId: match.profileId,
          status: 'active',
          updatedAt: now,
        })
        .where(eq(userIndustrySubscriptions.id, row.subscription.id));
      return (await db
        .select()
        .from(userIndustrySubscriptions)
        .where(eq(userIndustrySubscriptions.id, row.subscription.id)))[0];
    }

    // A similarly named pool is not reusable when it has no fresh content for
    // the user's actual condition. Request a separately provisioned pool.
    match = matchMonitoringProfile({
      customCriteria: row.subscription.customCriteria,
      profiles: [],
      autoProfileExpansion: false,
    });
  }

  if (match.action === 'reuse') {
    throw new Error('PROFILE_MATCH_REQUIRES_FRESH_POOL');
  }

  const pendingTitle = match.suggestedTitle;
  const criteriaSummary = match.criteriaSummary;

  const profile = (await db
    .insert(industryMonitoringProfiles)
    .values({
      id: createId(),
      industryConfigId: row.industry.id,
      title: pendingTitle,
      seedCriteria: row.subscription.customCriteria,
      criteriaSummary,
      keywordsJson: JSON.stringify([]),
      targetEntitiesJson: JSON.stringify([]),
      status: 'pending',
      sharedSubscriptionId: null,
      triggeredByUserId: row.subscription.userId,
      requiresAdminApproval: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning())[0];

  await db.update(userIndustrySubscriptions)
    .set({
      monitoringProfileId: profile.id,
      status: 'pending_profile',
      updatedAt: now,
    })
    .where(eq(userIndustrySubscriptions.id, row.subscription.id));

  return (await db
    .select()
    .from(userIndustrySubscriptions)
    .where(eq(userIndustrySubscriptions.id, row.subscription.id)))[0];
}

export async function approveUserIndustrySubscription(id: string, adminUserId: string) {
  void adminUserId;
  const db = getDb();
  await db.update(userIndustrySubscriptions)
    .set({
      status: 'pending_profile',
      approvalReason: null,
      updatedAt: new Date(),
    })
    .where(eq(userIndustrySubscriptions.id, id));
  return bindSubscriptionToProfile(id);
}

export async function updateMyIndustrySubscription(
  id: string,
  userId: string,
  input: { customCriteria?: string; extraRecipientEmails?: string[] }
) {
  const db = getDb();
  const existing = (await db
    .select()
    .from(userIndustrySubscriptions)
    .where(and(eq(userIndustrySubscriptions.id, id), eq(userIndustrySubscriptions.userId, userId))))[0];
  if (!existing) return null;

  const user = (await db.select().from(users).where(eq(users.id, userId)))[0];
  const recipients = normalizeRecipientEmails(user?.email, input.extraRecipientEmails ?? []);
  const validation = validateRecipientEmails(recipients);
  if (!validation.valid) throw new Error(validation.error);

  await db.update(userIndustrySubscriptions)
    .set({
      customCriteria: input.customCriteria?.trim() || existing.customCriteria,
      recipientEmailsJson: JSON.stringify(recipients),
      status: 'pending_profile',
      monitoringProfileId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(userIndustrySubscriptions.id, id), eq(userIndustrySubscriptions.userId, userId)));

  return bindSubscriptionToProfile(id);
}

export async function pauseMyIndustrySubscription(id: string, userId: string, paused: boolean) {
  const db = getDb();
  await db.update(userIndustrySubscriptions)
    .set({
      status: paused ? 'paused' : 'pending_profile',
      updatedAt: new Date(),
    })
    .where(and(eq(userIndustrySubscriptions.id, id), eq(userIndustrySubscriptions.userId, userId)));

  const row = (await db
    .select()
    .from(userIndustrySubscriptions)
    .where(and(eq(userIndustrySubscriptions.id, id), eq(userIndustrySubscriptions.userId, userId))))[0];

  if (!row) return null;
  return paused ? row : bindSubscriptionToProfile(row.id);
}
