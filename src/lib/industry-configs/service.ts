import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs } from '@/lib/db/schema';
import { DEFAULT_INDUSTRY_CONFIGS } from './defaults';
import {
  buildIndustryConfigSnapshot,
  buildIndustrySubscriptionSuggestion,
  encodeStringList,
  normalizeSourceTypes,
} from './utils';
import type { IndustryConfigInput } from './types';

type IndustryConfigRow = typeof industryConfigs.$inferSelect;

function toApi(row: IndustryConfigRow) {
  const snapshot = buildIndustryConfigSnapshot(row);
  return {
    ...row,
    snapshot,
    suggestion: buildIndustrySubscriptionSuggestion(snapshot),
  };
}

function toDbValues(input: IndustryConfigInput) {
  return {
    name: input.name.trim(),
    category: input.category?.trim() || null,
    subCategory: input.subCategory?.trim() || null,
    description: input.description?.trim() || null,
    keywordsJson: encodeStringList(input.keywords),
    riskTermsJson: encodeStringList(input.riskTerms),
    regionsJson: encodeStringList(input.regions),
    entitiesJson: encodeStringList(input.entities),
    sourceTypesJson: JSON.stringify(normalizeSourceTypes(input.sourceTypes)),
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

export function listIndustryConfigsForAdmin() {
  const db = getDb();
  return db
    .select()
    .from(industryConfigs)
    .orderBy(desc(industryConfigs.updatedAt))
    .all()
    .map(toApi);
}

export function listPublishedIndustryConfigsForUser(enabledOnly = true) {
  const db = getDb();
  const conditions = [eq(industryConfigs.visibility, 'published')];
  if (enabledOnly) conditions.push(eq(industryConfigs.isEnabled, true));

  return db
    .select()
    .from(industryConfigs)
    .where(and(...conditions))
    .orderBy(desc(industryConfigs.updatedAt))
    .all()
    .map(toApi);
}

export function seedDefaultIndustryConfigsForAdmin(adminUserId: string) {
  const db = getDb();
  const existing = db
    .select({ id: industryConfigs.id })
    .from(industryConfigs)
    .limit(1)
    .get();

  if (existing) return 0;

  const now = new Date();
  db.insert(industryConfigs)
    .values(
      DEFAULT_INDUSTRY_CONFIGS.map((input) => ({
        userId: adminUserId,
        createdBy: adminUserId,
        ...toDbValues({ ...input, visibility: 'draft' }),
        createdAt: now,
        updatedAt: now,
      }))
    )
    .run();

  return DEFAULT_INDUSTRY_CONFIGS.length;
}

export function getIndustryConfigForAdmin(id: string) {
  const db = getDb();
  const row = db.select().from(industryConfigs).where(eq(industryConfigs.id, id)).get();
  return row ? toApi(row) : null;
}

export function getPublishedIndustryConfig(id: string) {
  const db = getDb();
  const row = db
    .select()
    .from(industryConfigs)
    .where(
      and(
        eq(industryConfigs.id, id),
        eq(industryConfigs.visibility, 'published'),
        eq(industryConfigs.isEnabled, true)
      )
    )
    .get();
  return row ? toApi(row) : null;
}

export function createIndustryConfigForAdmin(adminUserId: string, input: IndustryConfigInput) {
  const db = getDb();
  const now = new Date();
  const row = db
    .insert(industryConfigs)
    .values({
      userId: adminUserId,
      createdBy: adminUserId,
      ...toDbValues(input),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return toApi(row);
}

export function updateIndustryConfigForAdmin(id: string, input: IndustryConfigInput) {
  const existing = getIndustryConfigForAdmin(id);
  if (!existing) return null;

  const db = getDb();
  db.update(industryConfigs)
    .set({
      ...toDbValues(input),
      updatedAt: new Date(),
    })
    .where(eq(industryConfigs.id, id))
    .run();

  return getIndustryConfigForAdmin(id);
}

export function deleteIndustryConfigForAdmin(id: string): boolean {
  const existing = getIndustryConfigForAdmin(id);
  if (!existing) return false;

  const db = getDb();
  db.delete(industryConfigs).where(eq(industryConfigs.id, id)).run();
  return true;
}

export function publishIndustryConfig(id: string, published: boolean) {
  const db = getDb();
  db.update(industryConfigs)
    .set({
      visibility: published ? 'published' : 'draft',
      updatedAt: new Date(),
    })
    .where(eq(industryConfigs.id, id))
    .run();

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
