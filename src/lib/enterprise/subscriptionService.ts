import { and, desc, eq } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryMonitoringProfiles,
  userIndustrySubscriptions,
  users,
} from '@/lib/db/schema';
import { getPublishedIndustryConfig } from '@/lib/industry-configs/service';
import { matchMonitoringProfile } from './profileMatcher';
import { normalizeRecipientEmails, validateRecipientEmails } from './recipientEmails';

export interface CreateUserIndustrySubscriptionInput {
  userId: string;
  industryConfigId: string;
  customCriteria: string;
  extraRecipientEmails?: string[];
}

export function listMyIndustrySubscriptions(userId: string) {
  const db = getDb();
  return db
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
    .orderBy(desc(userIndustrySubscriptions.updatedAt))
    .all();
}

export function createUserIndustrySubscription(input: CreateUserIndustrySubscriptionInput) {
  const db = getDb();
  const industry = getPublishedIndustryConfig(input.industryConfigId);
  if (!industry) throw new Error('INDUSTRY_NOT_FOUND');

  const user = db.select().from(users).where(eq(users.id, input.userId)).get();
  const recipients = normalizeRecipientEmails(user?.email, input.extraRecipientEmails ?? []);
  const recipientValidation = validateRecipientEmails(recipients);
  if (!recipientValidation.valid) throw new Error(recipientValidation.error);

  const criteria = input.customCriteria.trim();
  if (!criteria) throw new Error('CUSTOM_CRITERIA_REQUIRED');

  const initialStatus =
    industry.subscriptionMode === 'approval_required' ? 'pending_approval' : 'pending_profile';
  const now = new Date();

  const row = db
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
    .returning()
    .get();

  if (initialStatus === 'pending_profile') {
    return bindSubscriptionToProfile(row.id);
  }

  return row;
}

export function bindSubscriptionToProfile(userSubscriptionId: string) {
  const db = getDb();
  const row = db
    .select({
      subscription: userIndustrySubscriptions,
      industry: industryConfigs,
    })
    .from(userIndustrySubscriptions)
    .innerJoin(industryConfigs, eq(userIndustrySubscriptions.industryConfigId, industryConfigs.id))
    .where(eq(userIndustrySubscriptions.id, userSubscriptionId))
    .get();

  if (!row) throw new Error('USER_SUBSCRIPTION_NOT_FOUND');

  const profiles = db
    .select()
    .from(industryMonitoringProfiles)
    .where(eq(industryMonitoringProfiles.industryConfigId, row.industry.id))
    .all();

  const match = matchMonitoringProfile({
    customCriteria: row.subscription.customCriteria,
    profiles,
    autoProfileExpansion: row.industry.autoProfileExpansion,
  });

  const now = new Date();

  if (match.action === 'reuse') {
    db.update(userIndustrySubscriptions)
      .set({
        monitoringProfileId: match.profileId,
        status: 'active',
        updatedAt: now,
      })
      .where(eq(userIndustrySubscriptions.id, row.subscription.id))
      .run();
    return db
      .select()
      .from(userIndustrySubscriptions)
      .where(eq(userIndustrySubscriptions.id, row.subscription.id))
      .get();
  }

  const profile = db
    .insert(industryMonitoringProfiles)
    .values({
      id: createId(),
      industryConfigId: row.industry.id,
      title: match.suggestedTitle,
      seedCriteria: row.subscription.customCriteria,
      criteriaSummary: match.criteriaSummary,
      keywordsJson: JSON.stringify([]),
      targetEntitiesJson: JSON.stringify([]),
      status: match.action === 'create' ? 'creating' : 'pending',
      sharedSubscriptionId: null,
      triggeredByUserId: row.subscription.userId,
      requiresAdminApproval: match.action === 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  if (match.action === 'create') {
    import('./profileProvisioner')
      .then(({ startProfileProvisioning }) => startProfileProvisioning(profile.id))
      .catch((err) => console.error('[enterprise] profile auto provisioning failed', err));
  }

  db.update(userIndustrySubscriptions)
    .set({
      monitoringProfileId: profile.id,
      status: 'pending_profile',
      updatedAt: now,
    })
    .where(eq(userIndustrySubscriptions.id, row.subscription.id))
    .run();

  return db
    .select()
    .from(userIndustrySubscriptions)
    .where(eq(userIndustrySubscriptions.id, row.subscription.id))
    .get();
}

export function approveUserIndustrySubscription(id: string, adminUserId: string) {
  void adminUserId;
  const db = getDb();
  db.update(userIndustrySubscriptions)
    .set({
      status: 'pending_profile',
      approvalReason: null,
      updatedAt: new Date(),
    })
    .where(eq(userIndustrySubscriptions.id, id))
    .run();
  return bindSubscriptionToProfile(id);
}

export function updateMyIndustrySubscription(
  id: string,
  userId: string,
  input: { customCriteria?: string; extraRecipientEmails?: string[] }
) {
  const db = getDb();
  const existing = db
    .select()
    .from(userIndustrySubscriptions)
    .where(and(eq(userIndustrySubscriptions.id, id), eq(userIndustrySubscriptions.userId, userId)))
    .get();
  if (!existing) return null;

  const user = db.select().from(users).where(eq(users.id, userId)).get();
  const recipients = normalizeRecipientEmails(user?.email, input.extraRecipientEmails ?? []);
  const validation = validateRecipientEmails(recipients);
  if (!validation.valid) throw new Error(validation.error);

  db.update(userIndustrySubscriptions)
    .set({
      customCriteria: input.customCriteria?.trim() || existing.customCriteria,
      recipientEmailsJson: JSON.stringify(recipients),
      status: 'pending_profile',
      monitoringProfileId: null,
      updatedAt: new Date(),
    })
    .where(and(eq(userIndustrySubscriptions.id, id), eq(userIndustrySubscriptions.userId, userId)))
    .run();

  return bindSubscriptionToProfile(id);
}

export function pauseMyIndustrySubscription(id: string, userId: string, paused: boolean) {
  const db = getDb();
  db.update(userIndustrySubscriptions)
    .set({
      status: paused ? 'paused' : 'pending_profile',
      updatedAt: new Date(),
    })
    .where(and(eq(userIndustrySubscriptions.id, id), eq(userIndustrySubscriptions.userId, userId)))
    .run();

  const row = db
    .select()
    .from(userIndustrySubscriptions)
    .where(and(eq(userIndustrySubscriptions.id, id), eq(userIndustrySubscriptions.userId, userId)))
    .get();

  if (!row) return null;
  return paused ? row : bindSubscriptionToProfile(row.id);
}
