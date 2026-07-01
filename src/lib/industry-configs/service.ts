import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs } from '@/lib/db/schema';
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
  };
}

export function listIndustryConfigs(userId: string, enabledOnly = false) {
  const db = getDb();
  const whereClause = enabledOnly
    ? and(eq(industryConfigs.userId, userId), eq(industryConfigs.isEnabled, true))
    : eq(industryConfigs.userId, userId);

  return db
    .select()
    .from(industryConfigs)
    .where(whereClause)
    .orderBy(desc(industryConfigs.updatedAt))
    .all()
    .map(toApi);
}

export function getIndustryConfigForUser(id: string, userId: string) {
  const db = getDb();
  const row = db
    .select()
    .from(industryConfigs)
    .where(and(eq(industryConfigs.id, id), eq(industryConfigs.userId, userId)))
    .get();

  return row ? toApi(row) : null;
}

export function createIndustryConfig(userId: string, input: IndustryConfigInput) {
  const db = getDb();
  const now = new Date();
  const row = db
    .insert(industryConfigs)
    .values({
      userId,
      ...toDbValues(input),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return toApi(row);
}

export function updateIndustryConfig(id: string, userId: string, input: IndustryConfigInput) {
  const existing = getIndustryConfigForUser(id, userId);
  if (!existing) return null;

  const db = getDb();
  db.update(industryConfigs)
    .set({
      ...toDbValues(input),
      updatedAt: new Date(),
    })
    .where(and(eq(industryConfigs.id, id), eq(industryConfigs.userId, userId)))
    .run();

  return getIndustryConfigForUser(id, userId);
}

export function deleteIndustryConfig(id: string, userId: string): boolean {
  const existing = getIndustryConfigForUser(id, userId);
  if (!existing) return false;

  const db = getDb();
  db.delete(industryConfigs)
    .where(and(eq(industryConfigs.id, id), eq(industryConfigs.userId, userId)))
    .run();

  return true;
}
