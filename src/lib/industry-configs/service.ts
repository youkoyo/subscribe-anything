import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs, industryMonitoringProfiles } from '@/lib/db/schema';
import { DEFAULT_INDUSTRY_CONFIGS } from './defaults';
import {
  buildIndustryConfigSnapshot,
  buildIndustrySubscriptionSuggestion,
  encodeStringList,
  normalizeSourceTypes,
  normalizeSourcePreferences,
} from './utils';
import {
  DEFAULT_SOURCE_PREFERENCES,
} from './types';
import { mapIndustrySourceTypesToPreferences } from '@/lib/discovery-sources/catalog';
import type { IndustryConfigInput } from './types';
import { generateIndustryTermProfile } from '@/lib/ai/agents/industryProfileAgent';
import { buildFallbackIndustryTermProfile, type IndustryTermProfile } from './term-profile';

type IndustryConfigRow = typeof industryConfigs.$inferSelect;

function toApi(row: IndustryConfigRow) {
  const snapshot = buildIndustryConfigSnapshot(row);
  return {
    ...row,
    snapshot,
    suggestion: buildIndustrySubscriptionSuggestion(snapshot),
  };
}

function toDbValues(input: IndustryConfigInput, termProfile?: IndustryTermProfile) {
  const sourceTypes = normalizeSourceTypes(input.sourceTypes);
  const sourcePreferences = normalizeSourcePreferences(input.sourcePreferences);
  return {
    name: input.name.trim(),
    category: input.category?.trim() || null,
    subCategory: input.subCategory?.trim() || null,
    description: input.description?.trim() || null,
    keywordsJson: encodeStringList(input.keywords),
    riskTermsJson: encodeStringList(input.riskTerms),
    regionsJson: encodeStringList(input.regions),
    entitiesJson: encodeStringList(input.entities),
    sourceTypesJson: JSON.stringify(sourceTypes),
    sourcePreferencesJson: JSON.stringify(
      sourcePreferences.length > 0
        ? sourcePreferences
        : (mapIndustrySourceTypesToPreferences(sourceTypes).length > 0
          ? mapIndustrySourceTypesToPreferences(sourceTypes)
          : DEFAULT_SOURCE_PREFERENCES)
    ),
    allowAiDiscoveryFallback: input.allowAiDiscoveryFallback !== false,
    termProfileJson: JSON.stringify(termProfile ?? buildFallbackIndustryTermProfile({
      topic: input.name,
      criteria: input.description,
      sourcePreferences: sourcePreferences.length > 0 ? sourcePreferences : undefined,
    })),
    alertLevel: input.alertLevel?.trim() || '一般关注',
    isEnabled: input.isEnabled !== false,
    visibility: input.visibility ?? 'draft',
    subscriptionMode: input.subscriptionMode ?? 'open',
    autoProfileExpansion: input.autoProfileExpansion === true,
    deliveryCron: input.deliveryCron?.trim() || null,
    deliveryTimezone: input.deliveryTimezone?.trim() || 'Asia/Shanghai',
    deliveryEnabled: input.deliveryEnabled === true,
    maxItemsPerEmail: Math.min(10, Math.max(5, Number(input.maxItemsPerEmail ?? 10))),
  };
}

export async function listIndustryConfigsForAdmin() {
  const db = getDb();
  return (await db
    .select()
    .from(industryConfigs)
    .orderBy(desc(industryConfigs.updatedAt)))
    .map(toApi);
}

export async function listPublishedIndustryConfigsForUser(enabledOnly = true) {
  const db = getDb();
  const conditions = [eq(industryConfigs.visibility, 'published')];
  if (enabledOnly) conditions.push(eq(industryConfigs.isEnabled, true));

  const rows = await db
    .select()
    .from(industryConfigs)
    .where(and(...conditions))
    .orderBy(desc(industryConfigs.updatedAt));

  const visibleRows = [];
  for (const row of rows) {
    const activePool = (await db
        .select({ id: industryMonitoringProfiles.id })
        .from(industryMonitoringProfiles)
        .where(
          and(
            eq(industryMonitoringProfiles.industryConfigId, row.id),
            eq(industryMonitoringProfiles.status, 'active'),
            isNotNull(industryMonitoringProfiles.sharedSubscriptionId)
          )
        ))[0];
    if (activePool) visibleRows.push(row);
  }

  return visibleRows.map(toApi);
}

export async function seedDefaultIndustryConfigsForAdmin(adminUserId: string) {
  const db = getDb();
  const existing = (await db
    .select({ id: industryConfigs.id })
    .from(industryConfigs)
    .limit(1))[0];

  if (existing) return 0;

  const now = new Date();
  await db.insert(industryConfigs)
    .values(
      DEFAULT_INDUSTRY_CONFIGS.map((input) => ({
        userId: adminUserId,
        createdBy: adminUserId,
        ...toDbValues({ ...input, visibility: 'draft' }),
        createdAt: now,
        updatedAt: now,
      }))
    );

  return DEFAULT_INDUSTRY_CONFIGS.length;
}

export async function getIndustryConfigForAdmin(id: string) {
  const db = getDb();
  const row = (await db.select().from(industryConfigs).where(eq(industryConfigs.id, id)))[0];
  return row ? toApi(row) : null;
}

export async function getPublishedIndustryConfig(id: string) {
  const db = getDb();
  const row = (await db
    .select()
    .from(industryConfigs)
    .where(
      and(
        eq(industryConfigs.id, id),
        eq(industryConfigs.visibility, 'published'),
        eq(industryConfigs.isEnabled, true)
      )
    ))[0];
  if (!row) return null;
  const activePool = (await db
    .select({ id: industryMonitoringProfiles.id })
    .from(industryMonitoringProfiles)
    .where(
      and(
        eq(industryMonitoringProfiles.industryConfigId, row.id),
        eq(industryMonitoringProfiles.status, 'active'),
        isNotNull(industryMonitoringProfiles.sharedSubscriptionId)
      )
    ))[0];
  if (!activePool) return null;
  return toApi(row);
}

export async function createIndustryConfigForAdmin(adminUserId: string, input: IndustryConfigInput) {
  const db = getDb();
  const now = new Date();
  const termProfile = await generateIndustryTermProfile({
    topic: input.name,
    criteria: [input.category, input.subCategory, input.description].filter(Boolean).join('；'),
    sourcePreferences: normalizeSourcePreferences(input.sourcePreferences),
  }, adminUserId);
  const row = (await db
    .insert(industryConfigs)
    .values({
      userId: adminUserId,
      createdBy: adminUserId,
      ...toDbValues(input, termProfile),
      createdAt: now,
      updatedAt: now,
    })
    .returning())[0];

  return toApi(row);
}

export async function updateIndustryConfigForAdmin(id: string, input: IndustryConfigInput) {
  const existing = await getIndustryConfigForAdmin(id);
  if (!existing) return null;

  const db = getDb();
  const termProfile = await generateIndustryTermProfile({
    topic: input.name,
    criteria: [input.category, input.subCategory, input.description].filter(Boolean).join('；'),
    sourcePreferences: normalizeSourcePreferences(input.sourcePreferences),
  }, existing.userId);
  await db.update(industryConfigs)
    .set({
      ...toDbValues(input, termProfile),
      updatedAt: new Date(),
    })
    .where(eq(industryConfigs.id, id));

  return getIndustryConfigForAdmin(id);
}

export async function deleteIndustryConfigForAdmin(id: string): Promise<boolean> {
  const existing = await getIndustryConfigForAdmin(id);
  if (!existing) return false;

  const db = getDb();
  await db.delete(industryConfigs).where(eq(industryConfigs.id, id));
  return true;
}

export async function publishIndustryConfig(id: string, published: boolean) {
  const db = getDb();
  await db.update(industryConfigs)
    .set({
      visibility: published ? 'published' : 'draft',
      updatedAt: new Date(),
    })
    .where(eq(industryConfigs.id, id));

  return getIndustryConfigForAdmin(id);
}

export const listIndustryConfigs = (_userId: string, enabledOnly = false) =>
  listPublishedIndustryConfigsForUser(enabledOnly);

export const seedDefaultIndustryConfigsForUser = seedDefaultIndustryConfigsForAdmin;

export const createIndustryConfig = createIndustryConfigForAdmin;

export const updateIndustryConfig = (id: string, _userId: string, input: IndustryConfigInput) =>
  updateIndustryConfigForAdmin(id, input);

export const deleteIndustryConfig = (id: string, _userId: string) =>
  deleteIndustryConfigForAdmin(id);

export const getIndustryConfigForUser = (id: string, _userId: string) =>
  getPublishedIndustryConfig(id);
