# Industry Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-owned industry configuration feature that can be selected during new subscription creation to prefill topic and criteria, while storing both the config relationship and a creation-time snapshot.

**Architecture:** Add a small industry-config domain module for normalization, snapshots, and DB operations; expose it through authenticated API routes; render a focused `/industries` management page; then connect the selected config into the existing subscription wizard and managed creation flow. The first version only uses industry configs as subscription templates and preserves ordinary subscriptions when no config is selected.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM, SQLite, node:test, Radix/shadcn UI primitives, lucide-react icons.

---

## Scope Check

The approved spec is one cohesive feature: industry config CRUD plus optional selection during subscription creation. The AI prompt injection, event center, risk factor modeling, and timeline data model stay out of this implementation plan.

## File Structure

- Create `src/lib/industry-configs/types.ts`: shared industry config payload, snapshot, and source-type types.
- Create `src/lib/industry-configs/utils.ts`: list normalization, JSON encoding/decoding, snapshot building, and subscription suggestion helpers.
- Create `src/lib/industry-configs/service.ts`: DB access helpers scoped by `userId`.
- Modify `src/lib/db/schema.ts`: add `industryConfigs`, add optional fields to `subscriptions`, and add relations.
- Modify `src/lib/db/migrate.ts`: create/alter tables idempotently for existing SQLite files and update bootstrap schema.
- Modify `src/types/db.ts`: export `IndustryConfig` and `NewIndustryConfig`.
- Create `src/app/api/industry-configs/route.ts`: list and create configs.
- Create `src/app/api/industry-configs/[id]/route.ts`: update and delete a config.
- Create `src/components/industries/IndustryConfigManager.tsx`: page-level client state and API calls.
- Create `src/components/industries/IndustryConfigFormDialog.tsx`: create/edit form.
- Create `src/components/industries/IndustryConfigCard.tsx`: compact list card.
- Create `src/app/industries/page.tsx`: route wrapper.
- Modify `src/components/layout/NavSidebar.tsx` and `src/components/layout/BottomNav.tsx`: add menu entries.
- Modify `src/types/wizard.ts`: add selected industry config fields.
- Modify `src/components/wizard/Step1Topic.tsx`: fetch/select/apply industry config.
- Modify `src/components/wizard/WizardShell.tsx`: persist selected config through manual and managed flows.
- Modify `src/app/api/subscriptions/route.ts`: accept and store `industryConfigId` and `industryConfigSnapshot`.
- Modify `src/app/api/subscriptions/managed/route.ts`: accept and store selected config in placeholder subscriptions and wizard state.
- Modify `src/app/api/subscriptions/[id]/route.ts`: allow wizard state patches to carry industry config data.
- Modify `src/app/api/subscriptions/[id]/complete-wizard/route.ts`: preserve existing industry fields on activation.
- Add tests under `tests/` using node:test and `tsx`.

---

### Task 1: Test Runner And Industry Config Utilities

**Files:**
- Modify: `package.json`
- Create: `src/lib/industry-configs/types.ts`
- Create: `src/lib/industry-configs/utils.ts`
- Test: `tests/industryConfigUtils.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `tests/industryConfigUtils.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIndustryConfigSnapshot,
  buildIndustrySubscriptionSuggestion,
  decodeStringList,
  encodeStringList,
  normalizeStringList,
} from '../src/lib/industry-configs/utils';

test('normalizeStringList trims, deduplicates, and drops empty values', () => {
  assert.deepEqual(
    normalizeStringList([' 化工 ', '', '危化品', '化工', '  ']),
    ['化工', '危化品']
  );
});

test('encodeStringList and decodeStringList round-trip clean arrays', () => {
  const encoded = encodeStringList(['爆炸', '泄漏', '爆炸']);
  assert.equal(encoded, '["爆炸","泄漏"]');
  assert.deepEqual(decodeStringList(encoded), ['爆炸', '泄漏']);
});

test('decodeStringList tolerates invalid JSON', () => {
  assert.deepEqual(decodeStringList('{not json'), []);
});

test('buildIndustryConfigSnapshot converts DB JSON strings to arrays', () => {
  const snapshot = buildIndustryConfigSnapshot({
    id: 'cfg_1',
    name: '化工原料产业',
    category: '化工产业',
    subCategory: '化工原料',
    description: '关注危化品生产和园区监管',
    keywordsJson: '["危化品","化工园区"]',
    riskTermsJson: '["爆炸","环保处罚"]',
    regionsJson: '["山东","江苏"]',
    entitiesJson: '["重点园区"]',
    sourceTypesJson: '["authority","news"]',
    alertLevel: '需跟踪',
  });

  assert.deepEqual(snapshot.keywords, ['危化品', '化工园区']);
  assert.deepEqual(snapshot.riskTerms, ['爆炸', '环保处罚']);
  assert.equal(snapshot.alertLevel, '需跟踪');
});

test('buildIndustrySubscriptionSuggestion creates topic and criteria text', () => {
  const suggestion = buildIndustrySubscriptionSuggestion({
    id: 'cfg_1',
    name: '化工原料产业',
    category: '化工产业',
    subCategory: '化工原料',
    description: '',
    keywords: ['危化品', '化工园区'],
    riskTerms: ['爆炸', '环保处罚'],
    regions: ['山东'],
    entities: [],
    sourceTypes: ['authority'],
    alertLevel: '重点关注',
  });

  assert.equal(suggestion.topic, '化工原料产业动态监测');
  assert.match(suggestion.criteria, /危化品/);
  assert.match(suggestion.criteria, /环保处罚/);
  assert.match(suggestion.criteria, /山东/);
});
```

- [ ] **Step 2: Add a test script and verify the tests fail**

Modify `package.json` scripts:

```json
"test": "node --import tsx --test tests/*.test.ts"
```

Run:

```bash
npm test -- tests/industryConfigUtils.test.ts
```

Expected: FAIL because `src/lib/industry-configs/utils.ts` does not exist.

- [ ] **Step 3: Add shared industry config types**

Create `src/lib/industry-configs/types.ts`:

```ts
export const SOURCE_TYPE_OPTIONS = [
  'authority',
  'news',
  'social',
  'wechat',
  'custom',
] as const;

export type IndustrySourceType = (typeof SOURCE_TYPE_OPTIONS)[number];

export const SOURCE_TYPE_LABELS: Record<IndustrySourceType, string> = {
  authority: '权威事实源',
  news: '新闻发现源',
  social: '社媒线索源',
  wechat: '公众号源',
  custom: '自有补充源',
};

export interface IndustryConfigSnapshot {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  description: string;
  keywords: string[];
  riskTerms: string[];
  regions: string[];
  entities: string[];
  sourceTypes: IndustrySourceType[];
  alertLevel: string;
}

export interface IndustryConfigInput {
  name: string;
  category?: string;
  subCategory?: string;
  description?: string;
  keywords?: string[];
  riskTerms?: string[];
  regions?: string[];
  entities?: string[];
  sourceTypes?: string[];
  alertLevel?: string;
  isEnabled?: boolean;
}

export interface IndustrySubscriptionSuggestion {
  topic: string;
  criteria: string;
}
```

- [ ] **Step 4: Implement utility functions**

Create `src/lib/industry-configs/utils.ts`:

```ts
import {
  SOURCE_TYPE_OPTIONS,
  type IndustryConfigSnapshot,
  type IndustrySourceType,
  type IndustrySubscriptionSuggestion,
} from './types';

interface IndustryConfigRowLike {
  id: string;
  name: string;
  category: string | null;
  subCategory: string | null;
  description: string | null;
  keywordsJson: string | null;
  riskTermsJson: string | null;
  regionsJson: string | null;
  entitiesJson: string | null;
  sourceTypesJson: string | null;
  alertLevel: string | null;
}

export function normalizeStringList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of raw) {
    const text = String(item ?? '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }

  return result;
}

export function encodeStringList(value: unknown): string {
  return JSON.stringify(normalizeStringList(value));
}

export function decodeStringList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return normalizeStringList(JSON.parse(value));
  } catch {
    return [];
  }
}

export function normalizeSourceTypes(value: unknown): IndustrySourceType[] {
  return normalizeStringList(value).filter((item): item is IndustrySourceType =>
    SOURCE_TYPE_OPTIONS.includes(item as IndustrySourceType)
  );
}

export function buildIndustryConfigSnapshot(row: IndustryConfigRowLike): IndustryConfigSnapshot {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? '',
    subCategory: row.subCategory ?? '',
    description: row.description ?? '',
    keywords: decodeStringList(row.keywordsJson),
    riskTerms: decodeStringList(row.riskTermsJson),
    regions: decodeStringList(row.regionsJson),
    entities: decodeStringList(row.entitiesJson),
    sourceTypes: normalizeSourceTypes(decodeStringList(row.sourceTypesJson)),
    alertLevel: row.alertLevel ?? '一般关注',
  };
}

export function buildIndustrySubscriptionSuggestion(
  snapshot: IndustryConfigSnapshot
): IndustrySubscriptionSuggestion {
  const criteriaParts = [
    ...snapshot.keywords,
    ...snapshot.riskTerms,
    ...snapshot.regions,
    ...snapshot.entities,
  ];

  return {
    topic: `${snapshot.name}动态监测`,
    criteria: normalizeStringList(criteriaParts).join('、'),
  };
}
```

- [ ] **Step 5: Run utility tests**

Run:

```bash
npm test -- tests/industryConfigUtils.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/lib/industry-configs/types.ts src/lib/industry-configs/utils.ts tests/industryConfigUtils.test.ts
git commit -m "feat: add industry config utilities"
```

---

### Task 2: Database Schema And Migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/migrate.ts`
- Modify: `src/types/db.ts`
- Test: `tests/industryConfigSchema.test.ts`

- [ ] **Step 1: Write schema source tests**

Create `tests/industryConfigSchema.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('schema defines industry configs and subscription linkage fields', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /export const industryConfigs = sqliteTable\('industry_configs'/);
  assert.match(source, /industryConfigId: text\('industry_config_id'\)/);
  assert.match(source, /industryConfigSnapshot: text\('industry_config_snapshot'\)/);
});

test('runtime migration creates industry config table and subscription columns', async () => {
  const source = await readFile('src/lib/db/migrate.ts', 'utf8');

  assert.match(source, /function migrateIndustryConfigs/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS industry_configs/);
  assert.match(source, /ALTER TABLE subscriptions ADD COLUMN industry_config_id TEXT/);
  assert.match(source, /ALTER TABLE subscriptions ADD COLUMN industry_config_snapshot TEXT/);
});

test('db types export industry config models', async () => {
  const source = await readFile('src/types/db.ts', 'utf8');

  assert.match(source, /IndustryConfig = InferSelectModel<typeof industryConfigs>/);
  assert.match(source, /NewIndustryConfig = InferInsertModel<typeof industryConfigs>/);
});
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run:

```bash
npm test -- tests/industryConfigSchema.test.ts
```

Expected: FAIL because the table and fields are missing.

- [ ] **Step 3: Add Drizzle schema**

Modify `src/lib/db/schema.ts`.

Add `industryConfigs` after `subscriptions`:

```ts
export const industryConfigs = sqliteTable('industry_configs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  category: text('category'),
  subCategory: text('sub_category'),
  description: text('description'),
  keywordsJson: text('keywords_json').notNull().default('[]'),
  riskTermsJson: text('risk_terms_json').notNull().default('[]'),
  regionsJson: text('regions_json').notNull().default('[]'),
  entitiesJson: text('entities_json').notNull().default('[]'),
  sourceTypesJson: text('source_types_json').notNull().default('[]'),
  alertLevel: text('alert_level').notNull().default('一般关注'),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
});
```

Add fields to `subscriptions`:

```ts
industryConfigId: text('industry_config_id').references(() => industryConfigs.id, {
  onDelete: 'set null',
}),
industryConfigSnapshot: text('industry_config_snapshot'),
```

Add relations:

```ts
export const industryConfigsRelations = relations(industryConfigs, ({ one, many }) => ({
  user: one(users, {
    fields: [industryConfigs.userId],
    references: [users.id],
  }),
  subscriptions: many(subscriptions),
}));
```

Add to `usersRelations`:

```ts
industryConfigs: many(industryConfigs),
```

Add to `subscriptionsRelations`:

```ts
industryConfig: one(industryConfigs, {
  fields: [subscriptions.industryConfigId],
  references: [industryConfigs.id],
}),
```

- [ ] **Step 4: Add runtime migration helper**

Modify `src/lib/db/migrate.ts`.

Call this helper in `runMigrations()` after `migrateUserSystem(sqlite);`:

```ts
migrateIndustryConfigs(sqlite);
```

Add this helper near the other migration helpers:

```ts
function migrateIndustryConfigs(sqlite: InstanceType<typeof Database>) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS industry_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT,
      sub_category TEXT,
      description TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      risk_terms_json TEXT NOT NULL DEFAULT '[]',
      regions_json TEXT NOT NULL DEFAULT '[]',
      entities_json TEXT NOT NULL DEFAULT '[]',
      source_types_json TEXT NOT NULL DEFAULT '[]',
      alert_level TEXT NOT NULL DEFAULT '一般关注',
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  try { sqlite.exec('ALTER TABLE subscriptions ADD COLUMN industry_config_id TEXT REFERENCES industry_configs(id) ON DELETE SET NULL'); } catch { /* already exists */ }
  try { sqlite.exec('ALTER TABLE subscriptions ADD COLUMN industry_config_snapshot TEXT'); } catch { /* already exists */ }

  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_industry_configs_user ON industry_configs(user_id)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_industry_configs_user_enabled ON industry_configs(user_id, is_enabled)');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_subscriptions_industry_config ON subscriptions(industry_config_id)');

  console.log('[DB] Industry config migration complete');
}
```

Update `bootstrapSchema(sqlite)` so new installations also create the table and subscription fields. In the `subscriptions` table SQL add:

```sql
industry_config_id TEXT REFERENCES industry_configs(id) ON DELETE SET NULL,
industry_config_snapshot TEXT,
```

In the same bootstrap block, add:

```sql
CREATE TABLE IF NOT EXISTS industry_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT,
  sub_category TEXT,
  description TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  risk_terms_json TEXT NOT NULL DEFAULT '[]',
  regions_json TEXT NOT NULL DEFAULT '[]',
  entities_json TEXT NOT NULL DEFAULT '[]',
  source_types_json TEXT NOT NULL DEFAULT '[]',
  alert_level TEXT NOT NULL DEFAULT '一般关注',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- [ ] **Step 5: Export DB types**

Modify `src/types/db.ts`.

Add `industryConfigs` to the schema import:

```ts
industryConfigs,
```

Add exports:

```ts
export type IndustryConfig = InferSelectModel<typeof industryConfigs>;
export type NewIndustryConfig = InferInsertModel<typeof industryConfigs>;
```

- [ ] **Step 6: Run schema tests**

Run:

```bash
npm test -- tests/industryConfigSchema.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrate.ts src/types/db.ts tests/industryConfigSchema.test.ts
git commit -m "feat: add industry config schema"
```

---

### Task 3: Industry Config API

**Files:**
- Create: `src/lib/industry-configs/service.ts`
- Create: `src/app/api/industry-configs/route.ts`
- Create: `src/app/api/industry-configs/[id]/route.ts`
- Test: `tests/industryConfigApiSource.test.ts`

- [ ] **Step 1: Write API source tests**

Create `tests/industryConfigApiSource.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry config API routes require auth', async () => {
  const listRoute = await readFile('src/app/api/industry-configs/route.ts', 'utf8');
  const itemRoute = await readFile('src/app/api/industry-configs/[id]/route.ts', 'utf8');

  assert.match(listRoute, /requireAuth/);
  assert.match(itemRoute, /requireAuth/);
});

test('industry config API routes scope operations by user id', async () => {
  const service = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(service, /eq\(industryConfigs\.userId, userId\)/);
  assert.match(service, /buildIndustryConfigSnapshot/);
});

test('industry config create route returns suggestions for UI reuse', async () => {
  const listRoute = await readFile('src/app/api/industry-configs/route.ts', 'utf8');

  assert.match(listRoute, /buildIndustrySubscriptionSuggestion/);
});
```

- [ ] **Step 2: Run API source tests to verify they fail**

Run:

```bash
npm test -- tests/industryConfigApiSource.test.ts
```

Expected: FAIL because the service and routes are missing.

- [ ] **Step 3: Implement DB service helpers**

Create `src/lib/industry-configs/service.ts`:

```ts
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs } from '@/lib/db/schema';
import {
  encodeStringList,
  buildIndustryConfigSnapshot,
  buildIndustrySubscriptionSuggestion,
  normalizeSourceTypes,
} from './utils';
import type { IndustryConfigInput } from './types';

function toApi(row: typeof industryConfigs.$inferSelect) {
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
  const conditions = [eq(industryConfigs.userId, userId)];
  if (enabledOnly) conditions.push(eq(industryConfigs.isEnabled, true));

  return db
    .select()
    .from(industryConfigs)
    .where(and(...conditions))
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
  const db = getDb();
  const existing = getIndustryConfigForUser(id, userId);
  if (!existing) return null;

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
  const db = getDb();
  const existing = getIndustryConfigForUser(id, userId);
  if (!existing) return false;

  db.delete(industryConfigs)
    .where(and(eq(industryConfigs.id, id), eq(industryConfigs.userId, userId)))
    .run();

  return true;
}
```

- [ ] **Step 4: Implement collection route**

Create `src/app/api/industry-configs/route.ts`:

```ts
import { requireAuth } from '@/lib/auth';
import {
  createIndustryConfig,
  listIndustryConfigs,
} from '@/lib/industry-configs/service';
import type { IndustryConfigInput } from '@/lib/industry-configs/types';

function handleAuthError(err: unknown): Response | null {
  if (err instanceof Error && err.message === 'UNAUTHORIZED') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

function validateInput(body: IndustryConfigInput): string | null {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return '产业名称不能为空';
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const session = await requireAuth();
    const { searchParams } = new URL(req.url);
    const enabledOnly = searchParams.get('enabledOnly') === 'true';

    return Response.json(listIndustryConfigs(session.userId, enabledOnly));
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs GET]', err);
    return Response.json({ error: 'Failed to load industry configs' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({})) as IndustryConfigInput;
    const error = validateInput(body);
    if (error) return Response.json({ error }, { status: 400 });

    const created = createIndustryConfig(session.userId, body);
    return Response.json(created, { status: 201 });
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs POST]', err);
    return Response.json({ error: 'Failed to create industry config' }, { status: 500 });
  }
}
```

- [ ] **Step 5: Implement item route**

Create `src/app/api/industry-configs/[id]/route.ts`:

```ts
import { requireAuth } from '@/lib/auth';
import {
  deleteIndustryConfig,
  getIndustryConfigForUser,
  updateIndustryConfig,
} from '@/lib/industry-configs/service';
import type { IndustryConfigInput } from '@/lib/industry-configs/types';

function handleAuthError(err: unknown): Response | null {
  if (err instanceof Error && err.message === 'UNAUTHORIZED') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

function validateInput(body: IndustryConfigInput): string | null {
  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    return '产业名称不能为空';
  }
  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const config = getIndustryConfigForUser(id, session.userId);
    if (!config) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(config);
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs/[id] GET]', err);
    return Response.json({ error: 'Failed to load industry config' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as IndustryConfigInput;
    const error = validateInput(body);
    if (error) return Response.json({ error }, { status: 400 });

    const updated = updateIndustryConfig(id, session.userId, body);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs/[id] PATCH]', err);
    return Response.json({ error: 'Failed to update industry config' }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const deleted = deleteIndustryConfig(id, session.userId);
    if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs/[id] DELETE]', err);
    return Response.json({ error: 'Failed to delete industry config' }, { status: 500 });
  }
}
```

- [ ] **Step 6: Run API source tests**

Run:

```bash
npm test -- tests/industryConfigApiSource.test.ts
```

Expected: PASS.

- [ ] **Step 7: Typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/industry-configs/service.ts src/app/api/industry-configs tests/industryConfigApiSource.test.ts
git commit -m "feat: add industry config api"
```

---

### Task 4: Industry Config Management Page

**Files:**
- Create: `src/components/industries/IndustryConfigCard.tsx`
- Create: `src/components/industries/IndustryConfigFormDialog.tsx`
- Create: `src/components/industries/IndustryConfigManager.tsx`
- Create: `src/app/industries/page.tsx`
- Test: `tests/industryConfigPageSource.test.ts`

- [ ] **Step 1: Write page source tests**

Create `tests/industryConfigPageSource.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industries page renders the industry config manager', async () => {
  const page = await readFile('src/app/industries/page.tsx', 'utf8');
  assert.match(page, /IndustryConfigManager/);
  assert.match(page, /产业配置/);
});

test('industry manager calls the industry config api', async () => {
  const manager = await readFile('src/components/industries/IndustryConfigManager.tsx', 'utf8');
  assert.match(manager, /fetch\('\/api\/industry-configs'\)/);
  assert.match(manager, /method: 'POST'/);
  assert.match(manager, /method: 'PATCH'/);
  assert.match(manager, /method: 'DELETE'/);
});

test('industry form exposes the core configuration fields', async () => {
  const form = await readFile('src/components/industries/IndustryConfigFormDialog.tsx', 'utf8');
  for (const label of ['产业名称', '产业大类', '细分产业', '产业关键词', '风险事件词', '重点地区']) {
    assert.match(form, new RegExp(label));
  }
});
```

- [ ] **Step 2: Run page source tests to verify they fail**

Run:

```bash
npm test -- tests/industryConfigPageSource.test.ts
```

Expected: FAIL because the page and components are missing.

- [ ] **Step 3: Create card component**

Create `src/components/industries/IndustryConfigCard.tsx`:

```tsx
'use client';

import { Edit2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { IndustryConfigSnapshot } from '@/lib/industry-configs/types';

export interface IndustryConfigView {
  id: string;
  name: string;
  isEnabled: boolean;
  snapshot: IndustryConfigSnapshot;
  suggestion: { topic: string; criteria: string };
}

interface IndustryConfigCardProps {
  config: IndustryConfigView;
  onEdit: (config: IndustryConfigView) => void;
  onDelete: (config: IndustryConfigView) => void;
}

export function IndustryConfigCard({ config, onEdit, onDelete }: IndustryConfigCardProps) {
  const { snapshot } = config;
  const previewTags = [...snapshot.keywords, ...snapshot.riskTerms, ...snapshot.regions].slice(0, 8);

  return (
    <article className="rounded-lg border border-cyan-400/20 bg-card/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-cyan-50">{config.name}</h2>
            <Badge variant={config.isEnabled ? 'default' : 'outline'}>
              {config.isEnabled ? '启用' : '停用'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[snapshot.category, snapshot.subCategory].filter(Boolean).join(' / ') || '未设置分类'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="icon" onClick={() => onEdit(config)} aria-label="编辑产业配置">
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => onDelete(config)} aria-label="删除产业配置">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {snapshot.description && (
        <p className="mt-3 text-sm text-cyan-100/75">{snapshot.description}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {previewTags.map((tag) => (
          <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
        ))}
      </div>

      <div className="mt-3 rounded-md border border-cyan-400/15 bg-background/40 p-3 text-xs text-muted-foreground">
        <div>建议主题：{config.suggestion.topic}</div>
        <div className="mt-1 line-clamp-2">监控条件：{config.suggestion.criteria || '未配置'}</div>
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Create form dialog**

Create `src/components/industries/IndustryConfigFormDialog.tsx`. Use comma-separated textareas for list fields and convert them in the component.

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import type { IndustryConfigInput } from '@/lib/industry-configs/types';
import type { IndustryConfigView } from './IndustryConfigCard';

const splitList = (value: string) =>
  value.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
const joinList = (value: string[]) => value.join('、');

interface IndustryConfigFormDialogProps {
  open: boolean;
  config: IndustryConfigView | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: IndustryConfigInput) => Promise<void>;
}

export function IndustryConfigFormDialog({
  open,
  config,
  onOpenChange,
  onSubmit,
}: IndustryConfigFormDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [description, setDescription] = useState('');
  const [keywords, setKeywords] = useState('');
  const [riskTerms, setRiskTerms] = useState('');
  const [regions, setRegions] = useState('');
  const [entities, setEntities] = useState('');
  const [alertLevel, setAlertLevel] = useState('一般关注');
  const [isEnabled, setIsEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const snapshot = config?.snapshot;
    setName(snapshot?.name ?? '');
    setCategory(snapshot?.category ?? '');
    setSubCategory(snapshot?.subCategory ?? '');
    setDescription(snapshot?.description ?? '');
    setKeywords(joinList(snapshot?.keywords ?? []));
    setRiskTerms(joinList(snapshot?.riskTerms ?? []));
    setRegions(joinList(snapshot?.regions ?? []));
    setEntities(joinList(snapshot?.entities ?? []));
    setAlertLevel(snapshot?.alertLevel ?? '一般关注');
    setIsEnabled(config?.isEnabled ?? true);
  }, [config, open]);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        category,
        subCategory,
        description,
        keywords: splitList(keywords),
        riskTerms: splitList(riskTerms),
        regions: splitList(regions),
        entities: splitList(entities),
        sourceTypes: ['authority', 'news'],
        alertLevel,
        isEnabled,
      });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{config ? '编辑产业配置' : '新建产业配置'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-2 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label>产业名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="化工原料产业" />
          </div>
          <div className="space-y-1.5">
            <Label>产业大类</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="化工产业" />
          </div>
          <div className="space-y-1.5">
            <Label>细分产业</Label>
            <Input value={subCategory} onChange={(e) => setSubCategory(e.target.value)} placeholder="化工原料" />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>产业说明</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>产业关键词</Label>
            <Textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>风险事件词</Label>
            <Textarea value={riskTerms} onChange={(e) => setRiskTerms(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>重点地区</Label>
            <Textarea value={regions} onChange={(e) => setRegions(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>关注对象</Label>
            <Textarea value={entities} onChange={(e) => setEntities(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>默认关注等级</Label>
            <Input value={alertLevel} onChange={(e) => setAlertLevel(e.target.value)} />
          </div>
          <div className="flex items-center gap-3 pt-6">
            <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
            <Label>启用配置</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !name.trim()}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Create manager component**

Create `src/components/industries/IndustryConfigManager.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import type { IndustryConfigInput } from '@/lib/industry-configs/types';
import { IndustryConfigCard, type IndustryConfigView } from './IndustryConfigCard';
import { IndustryConfigFormDialog } from './IndustryConfigFormDialog';

export function IndustryConfigManager() {
  const { toast } = useToast();
  const [configs, setConfigs] = useState<IndustryConfigView[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IndustryConfigView | null>(null);

  async function loadConfigs() {
    try {
      const res = await fetch('/api/industry-configs');
      if (!res.ok) throw new Error('Failed');
      setConfigs(await res.json());
    } catch {
      toast({ title: '加载产业配置失败', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadConfigs();
  }, []);

  function handleCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  async function handleSubmit(input: IndustryConfigInput) {
    const url = editing ? `/api/industry-configs/${editing.id}` : '/api/industry-configs';
    const res = await fetch(url, {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error('Failed');
    await loadConfigs();
    toast({ title: editing ? '产业配置已更新' : '产业配置已创建' });
  }

  async function handleDelete(config: IndustryConfigView) {
    if (!confirm(`确认删除「${config.name}」？已创建订阅会保留创建时的配置快照。`)) return;
    const res = await fetch(`/api/industry-configs/${config.id}`, { method: 'DELETE' });
    if (!res.ok) {
      toast({ title: '删除失败', variant: 'destructive' });
      return;
    }
    setConfigs((prev) => prev.filter((item) => item.id !== config.id));
    toast({ title: '产业配置已删除' });
  }

  if (loading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-lg border border-border bg-card animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">产业配置</h1>
          <p className="mt-1 text-sm text-muted-foreground">维护可在新增订阅时复用的产业监控画像。</p>
        </div>
        <Button onClick={handleCreate}>
          <Plus className="mr-2 h-4 w-4" />
          新建配置
        </Button>
      </div>

      {configs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-cyan-400/30 p-10 text-center">
          <p className="text-lg font-medium">还没有产业配置</p>
          <p className="mt-2 text-sm text-muted-foreground">先创建一个产业配置，再在新增订阅中选择它。</p>
          <Button className="mt-5" onClick={handleCreate}>创建产业配置</Button>
        </div>
      ) : (
        <div className="grid gap-3">
          {configs.map((config) => (
            <IndustryConfigCard
              key={config.id}
              config={config}
              onEdit={(item) => {
                setEditing(item);
                setDialogOpen(true);
              }}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <IndustryConfigFormDialog
        open={dialogOpen}
        config={editing}
        onOpenChange={setDialogOpen}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
```

- [ ] **Step 6: Create page route**

Create `src/app/industries/page.tsx`:

```tsx
import { IndustryConfigManager } from '@/components/industries/IndustryConfigManager';

export default function IndustriesPage() {
  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <IndustryConfigManager />
    </div>
  );
}
```

- [ ] **Step 7: Run page tests and typecheck**

Run:

```bash
npm test -- tests/industryConfigPageSource.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/industries src/components/industries tests/industryConfigPageSource.test.ts
git commit -m "feat: add industry config page"
```

---

### Task 5: Navigation Entry

**Files:**
- Modify: `src/components/layout/NavSidebar.tsx`
- Modify: `src/components/layout/BottomNav.tsx`
- Test: `tests/industryConfigNavigation.test.ts`

- [ ] **Step 1: Write navigation tests**

Create `tests/industryConfigNavigation.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('desktop sidebar includes industry config nav item between subscriptions and favorites', async () => {
  const source = await readFile('src/components/layout/NavSidebar.tsx', 'utf8');
  const subscriptions = source.indexOf("href: '/subscriptions'");
  const industries = source.indexOf("href: '/industries'");
  const favorites = source.indexOf("href: '/favorites'");

  assert.ok(subscriptions >= 0);
  assert.ok(industries > subscriptions);
  assert.ok(favorites > industries);
  assert.match(source, /label: '产业'/);
});

test('mobile bottom nav includes industry config nav item', async () => {
  const source = await readFile('src/components/layout/BottomNav.tsx', 'utf8');

  assert.match(source, /href: '\/industries'/);
  assert.match(source, /label: '产业'/);
});
```

- [ ] **Step 2: Run navigation tests to verify they fail**

Run:

```bash
npm test -- tests/industryConfigNavigation.test.ts
```

Expected: FAIL because the nav item is missing.

- [ ] **Step 3: Add desktop nav item**

Modify `src/components/layout/NavSidebar.tsx` imports:

```ts
import { BookOpen, Factory, Heart, Settings } from 'lucide-react';
```

Modify `navItems`:

```ts
const navItems = [
  { href: '/subscriptions', label: '订阅', icon: BookOpen },
  { href: '/industries', label: '产业', icon: Factory },
  { href: '/favorites', label: '收藏', icon: Heart },
  { href: '/settings', label: '配置', icon: Settings },
];
```

- [ ] **Step 4: Add mobile nav item**

Modify `src/components/layout/BottomNav.tsx` imports:

```ts
import { BookOpen, Factory, Heart, Settings } from 'lucide-react';
```

Modify `navItems`:

```ts
const navItems = [
  { href: '/subscriptions', label: '订阅', icon: BookOpen },
  { href: '/industries', label: '产业', icon: Factory },
  { href: '/favorites', label: '收藏', icon: Heart },
  { href: '/settings', label: '配置', icon: Settings },
];
```

- [ ] **Step 5: Run navigation tests**

Run:

```bash
npm test -- tests/industryConfigNavigation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/NavSidebar.tsx src/components/layout/BottomNav.tsx tests/industryConfigNavigation.test.ts
git commit -m "feat: add industry config navigation"
```

---

### Task 6: Subscription Wizard Selection And Persistence

**Files:**
- Modify: `src/types/wizard.ts`
- Modify: `src/components/wizard/Step1Topic.tsx`
- Modify: `src/components/wizard/WizardShell.tsx`
- Modify: `src/app/api/subscriptions/route.ts`
- Modify: `src/app/api/subscriptions/managed/route.ts`
- Modify: `src/app/api/subscriptions/[id]/route.ts`
- Modify: `src/app/api/subscriptions/[id]/complete-wizard/route.ts`
- Test: `tests/industryConfigWizardSource.test.ts`

- [ ] **Step 1: Write wizard source tests**

Create `tests/industryConfigWizardSource.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('wizard state stores selected industry config and snapshot', async () => {
  const source = await readFile('src/types/wizard.ts', 'utf8');

  assert.match(source, /industryConfigId\?: string \| null/);
  assert.match(source, /industryConfigSnapshot\?: IndustryConfigSnapshot \| null/);
});

test('step one fetches enabled industry configs and can apply suggestions', async () => {
  const source = await readFile('src/components/wizard/Step1Topic.tsx', 'utf8');

  assert.match(source, /\/api\/industry-configs\?enabledOnly=true/);
  assert.match(source, /应用产业配置建议/);
  assert.match(source, /industryConfigSnapshot/);
});

test('subscription create routes persist industry config relationship and snapshot', async () => {
  const subscriptionsRoute = await readFile('src/app/api/subscriptions/route.ts', 'utf8');
  const managedRoute = await readFile('src/app/api/subscriptions/managed/route.ts', 'utf8');

  assert.match(subscriptionsRoute, /industryConfigId/);
  assert.match(subscriptionsRoute, /industryConfigSnapshot/);
  assert.match(managedRoute, /industryConfigId/);
  assert.match(managedRoute, /industryConfigSnapshot/);
});
```

- [ ] **Step 2: Run wizard source tests to verify they fail**

Run:

```bash
npm test -- tests/industryConfigWizardSource.test.ts
```

Expected: FAIL because wizard state and routes do not include industry config data.

- [ ] **Step 3: Extend wizard state types**

Modify `src/types/wizard.ts`:

```ts
import type { IndustryConfigSnapshot } from '@/lib/industry-configs/types';
```

Add to `WizardState`:

```ts
industryConfigId?: string | null;
industryConfigSnapshot?: IndustryConfigSnapshot | null;
```

- [ ] **Step 4: Update Step1 props and local state**

Modify `src/components/wizard/Step1Topic.tsx` imports:

```ts
import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import type { IndustryConfigSnapshot, IndustrySubscriptionSuggestion } from '@/lib/industry-configs/types';
```

Add view type:

```ts
interface IndustryConfigOption {
  id: string;
  name: string;
  snapshot: IndustryConfigSnapshot;
  suggestion: IndustrySubscriptionSuggestion;
}
```

Change callbacks:

```ts
onStep1Next?: (
  topic: string,
  criteria: string,
  industryConfigId?: string | null,
  industryConfigSnapshot?: IndustryConfigSnapshot | null
) => Promise<void>;
onManagedCreate?: (
  topic: string,
  criteria: string,
  industryConfigId?: string | null,
  industryConfigSnapshot?: IndustryConfigSnapshot | null
) => void;
```

Add state inside the component:

```ts
const [industryConfigs, setIndustryConfigs] = useState<IndustryConfigOption[]>([]);
const [industryConfigId, setIndustryConfigId] = useState(state.industryConfigId ?? 'none');
const [industryConfigSnapshot, setIndustryConfigSnapshot] = useState<IndustryConfigSnapshot | null>(
  state.industryConfigSnapshot ?? null
);
const [pendingSuggestion, setPendingSuggestion] = useState<IndustrySubscriptionSuggestion | null>(null);
```

Fetch enabled configs:

```ts
useEffect(() => {
  let cancelled = false;
  fetch('/api/industry-configs?enabledOnly=true')
    .then((res) => (res.ok ? res.json() : []))
    .then((data: IndustryConfigOption[]) => {
      if (!cancelled) setIndustryConfigs(data);
    })
    .catch(() => {
      if (!cancelled) setIndustryConfigs([]);
    });
  return () => {
    cancelled = true;
  };
}, []);
```

Add apply handler:

```ts
function applyIndustryConfig(config: IndustryConfigOption) {
  setIndustryConfigId(config.id);
  setIndustryConfigSnapshot(config.snapshot);

  const hasUserText = topic.trim() || criteria.trim();
  if (hasUserText) {
    setPendingSuggestion(config.suggestion);
    return;
  }

  setTopic(config.suggestion.topic);
  setCriteria(config.suggestion.criteria);
  onStateChange({
    industryConfigId: config.id,
    industryConfigSnapshot: config.snapshot,
  });
}

function applyPendingSuggestion() {
  if (!pendingSuggestion) return;
  setTopic(pendingSuggestion.topic);
  setCriteria(pendingSuggestion.criteria);
  setPendingSuggestion(null);
}
```

Update submit calls:

```ts
await onStep1Next(trimmed, criteria.trim(), industryConfigId === 'none' ? null : industryConfigId, industryConfigSnapshot);
```

```ts
onManagedCreate?.(trimmed, criteria.trim(), industryConfigId === 'none' ? null : industryConfigId, industryConfigSnapshot);
```

- [ ] **Step 5: Add Step1 industry selector UI**

Add this block above the topic field in `Step1Topic.tsx`:

```tsx
<div className="flex flex-col gap-1.5">
  <label className="text-sm font-medium">
    产业配置 <span className="text-muted-foreground font-normal">（可选）</span>
  </label>
  <Select
    value={industryConfigId}
    onValueChange={(value) => {
      if (value === 'none') {
        setIndustryConfigId('none');
        setIndustryConfigSnapshot(null);
        setPendingSuggestion(null);
        onStateChange({ industryConfigId: null, industryConfigSnapshot: null });
        return;
      }
      const config = industryConfigs.find((item) => item.id === value);
      if (config) applyIndustryConfig(config);
    }}
  >
    <SelectTrigger>
      <SelectValue placeholder="不使用产业配置" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="none">不使用产业配置</SelectItem>
      {industryConfigs.map((config) => (
        <SelectItem key={config.id} value={config.id}>
          {config.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  {industryConfigSnapshot && (
    <div className="rounded-md border border-cyan-400/20 bg-card/60 p-3 text-xs text-muted-foreground">
      <div className="mb-2 font-medium text-cyan-100">已应用产业配置：{industryConfigSnapshot.name}</div>
      <div className="flex flex-wrap gap-1.5">
        {[...industryConfigSnapshot.keywords, ...industryConfigSnapshot.riskTerms, ...industryConfigSnapshot.regions].slice(0, 10).map((tag) => (
          <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>
        ))}
      </div>
      {pendingSuggestion && (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={applyPendingSuggestion}>
          应用产业配置建议
        </Button>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 6: Persist fields through WizardShell**

Modify `src/components/wizard/WizardShell.tsx`.

Update the initial state object to include:

```ts
industryConfigId: null,
industryConfigSnapshot: null,
```

Update `handleStep1Next` signature:

```ts
const handleStep1Next = async (
  topic: string,
  criteria: string,
  industryConfigId?: string | null,
  industryConfigSnapshot?: IndustryConfigSnapshot | null
) => {
```

When creating the bare subscription, include:

```ts
body: JSON.stringify({
  topic,
  criteria,
  bare: true,
  industryConfigId,
  industryConfigSnapshot,
}),
```

When updating wizard state, include:

```ts
industryConfigId: industryConfigId ?? null,
industryConfigSnapshot: industryConfigSnapshot ?? null,
```

Update `handleManagedCreate` to accept and send the same fields:

```ts
const handleManagedCreate = (
  topic: string,
  criteria: string,
  industryConfigId?: string | null,
  industryConfigSnapshot?: IndustryConfigSnapshot | null
) => {
```

In the `/api/subscriptions/managed` body include:

```ts
industryConfigId,
industryConfigSnapshot,
```

Update complete wizard payload in Step4 flow if it is assembled in `WizardShell` or `Step4Confirm`:

```ts
industryConfigId: state.industryConfigId ?? null,
industryConfigSnapshot: state.industryConfigSnapshot ?? null,
```

- [ ] **Step 7: Persist fields in subscription create route**

Modify `src/app/api/subscriptions/route.ts`.

Extend body typing:

```ts
industryConfigId?: string | null;
industryConfigSnapshot?: unknown;
```

Before insert, serialize the snapshot:

```ts
const industryConfigSnapshotText = industryConfigSnapshot
  ? JSON.stringify(industryConfigSnapshot)
  : null;
```

Add to both bare and normal insert values:

```ts
industryConfigId: industryConfigId || null,
industryConfigSnapshot: industryConfigSnapshotText,
```

- [ ] **Step 8: Persist fields in managed create route**

Modify `src/app/api/subscriptions/managed/route.ts`.

Extend body typing:

```ts
industryConfigId?: string | null;
industryConfigSnapshot?: unknown;
```

Add to `initialWizardState` JSON:

```ts
industryConfigId: industryConfigId ?? null,
industryConfigSnapshot: industryConfigSnapshot ?? null,
```

Add to both update and insert values:

```ts
industryConfigId: industryConfigId || null,
industryConfigSnapshot: industryConfigSnapshot ? JSON.stringify(industryConfigSnapshot) : null,
```

- [ ] **Step 9: Preserve fields in existing subscription endpoints**

Modify `src/app/api/subscriptions/[id]/route.ts`.

Allow wizard state patch to pass through as it already stores a string. No extra parsing is needed, but keep this route compatible by not stripping `wizardStateJson`.

Modify `src/app/api/subscriptions/[id]/complete-wizard/route.ts`.

Extend body typing:

```ts
industryConfigId?: string | null;
industryConfigSnapshot?: unknown;
```

Before activation update:

```ts
const snapshotText = body.industryConfigSnapshot
  ? JSON.stringify(body.industryConfigSnapshot)
  : existing.industryConfigSnapshot;
```

Add to update values:

```ts
industryConfigId: body.industryConfigId ?? existing.industryConfigId,
industryConfigSnapshot: snapshotText,
```

- [ ] **Step 10: Run wizard tests and typecheck**

Run:

```bash
npm test -- tests/industryConfigWizardSource.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add src/types/wizard.ts src/components/wizard/Step1Topic.tsx src/components/wizard/WizardShell.tsx src/app/api/subscriptions tests/industryConfigWizardSource.test.ts
git commit -m "feat: connect industry configs to subscription creation"
```

---

### Task 7: Final Verification And Build

**Files:**
- Modify only if verification reveals a defect in files touched by Tasks 1-6.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: PASS for all `tests/*.test.ts`.

- [ ] **Step 2: Run production type/build check**

Run:

```bash
npm run build
```

Expected: PASS. If `isolated-vm` native module fails because the local Node version is unsupported, run:

```bash
node -v
```

Expected follow-up note: record the exact Node version and error. Do not claim build success.

- [ ] **Step 3: Start dev server for manual verification**

Run:

```bash
npm run dev
```

Expected: server starts on `http://localhost:3000`.

- [ ] **Step 4: Manual browser verification**

Open `http://localhost:3000` and verify:

- Sidebar contains `产业`.
- Bottom nav contains `产业` on mobile width.
- `/industries` loads.
- Creating a `化工原料产业` config succeeds.
- Editing the config updates the list card.
- New subscription Step 1 shows the industry config selector.
- Selecting `化工原料产业` shows a summary and can apply suggested topic/criteria.
- Creating a subscription stores the selected industry config relationship and snapshot.
- Creating a normal subscription with `不使用产业配置` still works.

- [ ] **Step 5: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean after all commits.

- [ ] **Step 6: Final commit if verification fixes were needed**

If Task 7 required any fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize industry config workflow"
```

If no fixes were needed, skip this commit.

---

## Self-Review

- Spec coverage: the plan covers menu/page creation, industry config CRUD, subscription selection, automatic topic/criteria suggestions, `industryConfigId`, `industryConfigSnapshot`, ordinary subscription compatibility, and staged AI integration boundaries.
- Placeholder scan: no task depends on unspecified fields; all new paths, callbacks, API names, and DB columns are explicit.
- Type consistency: `IndustryConfigSnapshot`, `IndustryConfigInput`, `industryConfigId`, and `industryConfigSnapshot` are introduced in Task 1/2 and reused consistently in later tasks.
