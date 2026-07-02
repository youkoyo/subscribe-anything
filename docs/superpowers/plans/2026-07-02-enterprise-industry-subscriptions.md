# Enterprise Industry Subscriptions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first enterprise subscription loop where admins publish industry directions, users add personalized monitoring conditions, similar conditions reuse a monitoring profile, different conditions create or request a new shared collection pool, and scheduled email delivery sends each user the most relevant 5-10 items.

**Architecture:** Upgrade `industry_configs` into an admin-managed enterprise catalog, add monitoring profiles, user industry subscriptions, and delivery logs. Reuse the existing managed subscription pipeline for profile collection pools and the existing email provider abstraction for delivery. Keep event clustering integration optional in this plan; delivery scoring works against `message_cards` first and can consume event-quality fields when they exist.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Drizzle ORM, SQLite, node:test, node-cron, existing OpenAI-compatible agent pipeline, existing email providers.

---

## Scope Check

The approved spec covers enterprise catalog, profile matching, shared collection pools, and scheduled email delivery. This plan implements the first end-to-end version of those pieces. It does not implement organization departments, enterprise address books, cross-tenant isolation, historical backfill, or the separate event clustering data model.

## File Structure

- Modify `src/lib/db/schema.ts`: add enterprise fields to `industryConfigs`; add `industryMonitoringProfiles`, `userIndustrySubscriptions`, `industryDeliveryRuns`, and `userDeliveryLogs`.
- Modify `src/lib/db/migrate.ts`: add idempotent runtime migrations and bootstrap SQL for enterprise fields/tables.
- Modify `src/types/db.ts`: export enterprise DB model types.
- Modify `src/lib/industry-configs/types.ts`: add enterprise fields and status union types.
- Modify `src/lib/industry-configs/service.ts`: switch industry configs to admin-managed catalog semantics.
- Modify `src/app/api/industry-configs/route.ts` and `src/app/api/industry-configs/[id]/route.ts`: admin write, authenticated read with role-aware visibility.
- Create `src/app/api/industry-configs/[id]/publish/route.ts`: admin publish/unpublish endpoint.
- Create `src/lib/enterprise/recipientEmails.ts`: normalize and validate user recipient emails.
- Create `src/lib/enterprise/profileMatcher.ts`: rule-first monitoring profile matching.
- Create `src/lib/enterprise/subscriptionService.ts`: create/approve/pause user industry subscriptions and bind profiles.
- Create `src/lib/enterprise/profileProvisioner.ts`: create shared collection pool subscriptions for monitoring profiles.
- Create `src/lib/enterprise/deliveryScoring.ts`: score message cards for a user's custom criteria.
- Create `src/lib/enterprise/emailTemplate.ts`: render compatible HTML/text industry delivery emails.
- Create `src/lib/enterprise/deliveryService.ts`: run one industry delivery and one user delivery.
- Create `src/lib/enterprise/deliveryScheduler.ts`: register/unregister delivery cron jobs.
- Modify `server.ts`: call delivery scheduler after source scheduler initialization.
- Create `src/app/api/enterprise/industry-catalog/route.ts`: user-visible published industry catalog.
- Create `src/app/api/enterprise/industry-subscriptions/route.ts`: create user industry subscription.
- Create `src/app/api/enterprise/my-industry-subscriptions/route.ts`: list current user's subscriptions.
- Create `src/app/api/enterprise/my-industry-subscriptions/[id]/route.ts`: update current user's criteria/recipients.
- Create `src/app/api/enterprise/my-industry-subscriptions/[id]/pause/route.ts`: pause/resume current user's subscription.
- Create `src/app/api/industry-configs/[id]/profiles/route.ts`: admin profile list for an industry.
- Create `src/app/api/industry-profiles/[id]/approve/route.ts`: admin approve pending profile.
- Create `src/app/api/industry-profiles/[id]/retry/route.ts`: admin retry failed profile provisioning.
- Create `src/app/api/industry-delivery-runs/route.ts`: admin delivery run/log listing.
- Create `src/components/enterprise/IndustryCatalog.tsx`: normal-user catalog and subscription dialog.
- Create `src/components/enterprise/MyIndustrySubscriptions.tsx`: normal-user subscription list.
- Modify `src/components/industry-configs/IndustryConfigManager.tsx`: add admin enterprise fields and publish controls.
- Modify `src/app/industry-configs/page.tsx`: render admin manager for admins and user catalog for non-admins.
- Modify `src/components/layout/NavSidebar.tsx` and `src/components/layout/BottomNav.tsx`: keep the same route but label behavior can stay as "产业配置" for admin and "产业订阅" inside page content.
- Add tests under `tests/enterprise*.test.ts`.

---

### Task 1: Enterprise Schema And Runtime Migration

**Files:**
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/migrate.ts`
- Modify: `src/types/db.ts`
- Test: `tests/enterpriseSchema.test.ts`

- [x] **Step 1: Write the failing schema source tests**

Create `tests/enterpriseSchema.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('schema defines enterprise industry fields', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /visibility: text\('visibility'/);
  assert.match(source, /subscriptionMode: text\('subscription_mode'/);
  assert.match(source, /autoProfileExpansion: integer\('auto_profile_expansion'/);
  assert.match(source, /deliveryCron: text\('delivery_cron'\)/);
  assert.match(source, /maxItemsPerEmail: integer\('max_items_per_email'\)/);
});

test('schema defines monitoring profiles and user industry subscriptions', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /export const industryMonitoringProfiles = sqliteTable\('industry_monitoring_profiles'/);
  assert.match(source, /export const userIndustrySubscriptions = sqliteTable\('user_industry_subscriptions'/);
  assert.match(source, /sharedSubscriptionId: text\('shared_subscription_id'\)/);
  assert.match(source, /customCriteria: text\('custom_criteria'\)/);
  assert.match(source, /recipientEmailsJson: text\('recipient_emails_json'\)/);
});

test('schema defines delivery run and user delivery log tables', async () => {
  const source = await readFile('src/lib/db/schema.ts', 'utf8');

  assert.match(source, /export const industryDeliveryRuns = sqliteTable\('industry_delivery_runs'/);
  assert.match(source, /export const userDeliveryLogs = sqliteTable\('user_delivery_logs'/);
  assert.match(source, /selectedCardIdsJson: text\('selected_card_ids_json'\)/);
});

test('runtime migration creates enterprise industry tables and columns', async () => {
  const source = await readFile('src/lib/db/migrate.ts', 'utf8');

  assert.match(source, /function migrateEnterpriseIndustrySubscriptions/);
  assert.match(source, /ALTER TABLE industry_configs ADD COLUMN visibility TEXT/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS industry_monitoring_profiles/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS user_industry_subscriptions/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS industry_delivery_runs/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS user_delivery_logs/);
});

test('db types export enterprise industry models', async () => {
  const source = await readFile('src/types/db.ts', 'utf8');

  assert.match(source, /IndustryMonitoringProfile = InferSelectModel<typeof industryMonitoringProfiles>/);
  assert.match(source, /UserIndustrySubscription = InferSelectModel<typeof userIndustrySubscriptions>/);
  assert.match(source, /IndustryDeliveryRun = InferSelectModel<typeof industryDeliveryRuns>/);
  assert.match(source, /UserDeliveryLog = InferSelectModel<typeof userDeliveryLogs>/);
});
```

- [x] **Step 2: Run schema tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseSchema.test.ts
```

Expected: FAIL because the new tables and fields do not exist yet.

- [x] **Step 3: Add enterprise fields and tables to Drizzle schema**

Modify `src/lib/db/schema.ts`.

Update `industryConfigs` by keeping the existing `userId` column for SQLite compatibility, and add enterprise fields after `isEnabled`:

```ts
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  visibility: text('visibility', { enum: ['draft', 'published'] })
    .notNull()
    .default('draft'),
  subscriptionMode: text('subscription_mode', { enum: ['open', 'approval_required'] })
    .notNull()
    .default('open'),
  autoProfileExpansion: integer('auto_profile_expansion', { mode: 'boolean' })
    .notNull()
    .default(false),
  deliveryCron: text('delivery_cron'),
  deliveryTimezone: text('delivery_timezone').notNull().default('Asia/Shanghai'),
  deliveryEnabled: integer('delivery_enabled', { mode: 'boolean' }).notNull().default(false),
  maxItemsPerEmail: integer('max_items_per_email').notNull().default(10),
```

Add these tables after `managedBuildLogs`:

```ts
// ─── industry_monitoring_profiles ───────────────────────────────────────────
export const industryMonitoringProfiles = sqliteTable('industry_monitoring_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  industryConfigId: text('industry_config_id')
    .notNull()
    .references(() => industryConfigs.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  seedCriteria: text('seed_criteria').notNull(),
  criteriaSummary: text('criteria_summary'),
  keywordsJson: text('keywords_json').notNull().default('[]'),
  targetEntitiesJson: text('target_entities_json').notNull().default('[]'),
  status: text('status', {
    enum: ['pending', 'creating', 'active', 'failed', 'disabled'],
  }).notNull().default('pending'),
  sharedSubscriptionId: text('shared_subscription_id').references(() => subscriptions.id, {
    onDelete: 'set null',
  }),
  triggeredByUserId: text('triggered_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  requiresAdminApproval: integer('requires_admin_approval', { mode: 'boolean' })
    .notNull()
    .default(false),
  approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
  lastProvisionedAt: integer('last_provisioned_at', { mode: 'timestamp_ms' }),
  provisioningError: text('provisioning_error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── user_industry_subscriptions ────────────────────────────────────────────
export const userIndustrySubscriptions = sqliteTable('user_industry_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  industryConfigId: text('industry_config_id')
    .notNull()
    .references(() => industryConfigs.id, { onDelete: 'cascade' }),
  monitoringProfileId: text('monitoring_profile_id').references(
    () => industryMonitoringProfiles.id,
    { onDelete: 'set null' }
  ),
  status: text('status', {
    enum: ['pending_approval', 'pending_profile', 'active', 'rejected', 'paused'],
  }).notNull().default('pending_profile'),
  customCriteria: text('custom_criteria').notNull(),
  recipientEmailsJson: text('recipient_emails_json').notNull().default('[]'),
  approvalReason: text('approval_reason'),
  lastDeliveredAt: integer('last_delivered_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── industry_delivery_runs ─────────────────────────────────────────────────
export const industryDeliveryRuns = sqliteTable('industry_delivery_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  industryConfigId: text('industry_config_id')
    .notNull()
    .references(() => industryConfigs.id, { onDelete: 'cascade' }),
  scheduledFor: integer('scheduled_for', { mode: 'timestamp_ms' }).notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed'] })
    .notNull()
    .default('running'),
  startedAt: integer('started_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── user_delivery_logs ─────────────────────────────────────────────────────
export const userDeliveryLogs = sqliteTable('user_delivery_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  runId: text('run_id')
    .notNull()
    .references(() => industryDeliveryRuns.id, { onDelete: 'cascade' }),
  userIndustrySubscriptionId: text('user_industry_subscription_id')
    .notNull()
    .references(() => userIndustrySubscriptions.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  recipientEmailsJson: text('recipient_emails_json').notNull().default('[]'),
  selectedCardIdsJson: text('selected_card_ids_json').notNull().default('[]'),
  subject: text('subject').notNull(),
  status: text('status', { enum: ['sent', 'skipped', 'failed'] }).notNull(),
  error: text('error'),
  sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .$defaultFn(() => new Date())
    .notNull(),
});
```

Add relations:

```ts
export const industryMonitoringProfilesRelations = relations(
  industryMonitoringProfiles,
  ({ one, many }) => ({
    industryConfig: one(industryConfigs, {
      fields: [industryMonitoringProfiles.industryConfigId],
      references: [industryConfigs.id],
    }),
    sharedSubscription: one(subscriptions, {
      fields: [industryMonitoringProfiles.sharedSubscriptionId],
      references: [subscriptions.id],
    }),
    userSubscriptions: many(userIndustrySubscriptions),
  })
);

export const userIndustrySubscriptionsRelations = relations(
  userIndustrySubscriptions,
  ({ one, many }) => ({
    user: one(users, {
      fields: [userIndustrySubscriptions.userId],
      references: [users.id],
    }),
    industryConfig: one(industryConfigs, {
      fields: [userIndustrySubscriptions.industryConfigId],
      references: [industryConfigs.id],
    }),
    monitoringProfile: one(industryMonitoringProfiles, {
      fields: [userIndustrySubscriptions.monitoringProfileId],
      references: [industryMonitoringProfiles.id],
    }),
    deliveryLogs: many(userDeliveryLogs),
  })
);

export const industryDeliveryRunsRelations = relations(industryDeliveryRuns, ({ one, many }) => ({
  industryConfig: one(industryConfigs, {
    fields: [industryDeliveryRuns.industryConfigId],
    references: [industryConfigs.id],
  }),
  userLogs: many(userDeliveryLogs),
}));

export const userDeliveryLogsRelations = relations(userDeliveryLogs, ({ one }) => ({
  run: one(industryDeliveryRuns, {
    fields: [userDeliveryLogs.runId],
    references: [industryDeliveryRuns.id],
  }),
  userSubscription: one(userIndustrySubscriptions, {
    fields: [userDeliveryLogs.userIndustrySubscriptionId],
    references: [userIndustrySubscriptions.id],
  }),
  user: one(users, {
    fields: [userDeliveryLogs.userId],
    references: [users.id],
  }),
}));
```

Also add these `many(...)` entries:

```ts
// inside usersRelations
userIndustrySubscriptions: many(userIndustrySubscriptions),
userDeliveryLogs: many(userDeliveryLogs),

// inside industryConfigsRelations
monitoringProfiles: many(industryMonitoringProfiles),
userSubscriptions: many(userIndustrySubscriptions),
deliveryRuns: many(industryDeliveryRuns),
```

- [x] **Step 4: Add runtime migration helper**

Modify `src/lib/db/migrate.ts`.

Call the helper after `migrateIndustryConfigs(sqlite);`:

```ts
  migrateEnterpriseIndustrySubscriptions(sqlite);
```

Add this helper:

```ts
function migrateEnterpriseIndustrySubscriptions(sqlite: InstanceType<typeof Database>) {
  try { sqlite.exec('ALTER TABLE industry_configs ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL'); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE industry_configs ADD COLUMN visibility TEXT NOT NULL DEFAULT 'draft'"); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE industry_configs ADD COLUMN subscription_mode TEXT NOT NULL DEFAULT 'open'"); } catch { /* already exists */ }
  try { sqlite.exec('ALTER TABLE industry_configs ADD COLUMN auto_profile_expansion INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { sqlite.exec('ALTER TABLE industry_configs ADD COLUMN delivery_cron TEXT'); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE industry_configs ADD COLUMN delivery_timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai'"); } catch { /* already exists */ }
  try { sqlite.exec('ALTER TABLE industry_configs ADD COLUMN delivery_enabled INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { sqlite.exec('ALTER TABLE industry_configs ADD COLUMN max_items_per_email INTEGER NOT NULL DEFAULT 10'); } catch { /* already exists */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS industry_monitoring_profiles (
      id TEXT PRIMARY KEY,
      industry_config_id TEXT NOT NULL REFERENCES industry_configs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      seed_criteria TEXT NOT NULL,
      criteria_summary TEXT,
      keywords_json TEXT NOT NULL DEFAULT '[]',
      target_entities_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      shared_subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
      triggered_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      requires_admin_approval INTEGER NOT NULL DEFAULT 0,
      approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      approved_at INTEGER,
      last_provisioned_at INTEGER,
      provisioning_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_industry_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      industry_config_id TEXT NOT NULL REFERENCES industry_configs(id) ON DELETE CASCADE,
      monitoring_profile_id TEXT REFERENCES industry_monitoring_profiles(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending_profile',
      custom_criteria TEXT NOT NULL,
      recipient_emails_json TEXT NOT NULL DEFAULT '[]',
      approval_reason TEXT,
      last_delivered_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS industry_delivery_runs (
      id TEXT PRIMARY KEY,
      industry_config_id TEXT NOT NULL REFERENCES industry_configs(id) ON DELETE CASCADE,
      scheduled_for INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_delivery_logs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES industry_delivery_runs(id) ON DELETE CASCADE,
      user_industry_subscription_id TEXT NOT NULL REFERENCES user_industry_subscriptions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_emails_json TEXT NOT NULL DEFAULT '[]',
      selected_card_ids_json TEXT NOT NULL DEFAULT '[]',
      subject TEXT NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      sent_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_industry_profiles_industry_status
      ON industry_monitoring_profiles(industry_config_id, status);
    CREATE INDEX IF NOT EXISTS idx_user_industry_subs_user
      ON user_industry_subscriptions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_user_industry_subs_industry
      ON user_industry_subscriptions(industry_config_id, status);
    CREATE INDEX IF NOT EXISTS idx_delivery_runs_industry
      ON industry_delivery_runs(industry_config_id, scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_user_delivery_logs_run
      ON user_delivery_logs(run_id, status);
  `);

  sqlite.exec(`
    UPDATE industry_configs
       SET created_by = COALESCE(created_by, user_id),
           visibility = COALESCE(visibility, 'draft')
     WHERE created_by IS NULL OR visibility IS NULL
  `);

  console.log('[DB] Enterprise industry subscription migration complete');
}
```

In `bootstrapSchema(sqlite)`, update the `industry_configs` SQL with the same enterprise columns and add the four new `CREATE TABLE IF NOT EXISTS` blocks from the helper.

- [x] **Step 5: Export DB types**

Modify `src/types/db.ts` imports:

```ts
  industryMonitoringProfiles,
  userIndustrySubscriptions,
  industryDeliveryRuns,
  userDeliveryLogs,
```

Add exports:

```ts
export type IndustryMonitoringProfile = InferSelectModel<typeof industryMonitoringProfiles>;
export type NewIndustryMonitoringProfile = InferInsertModel<typeof industryMonitoringProfiles>;

export type UserIndustrySubscription = InferSelectModel<typeof userIndustrySubscriptions>;
export type NewUserIndustrySubscription = InferInsertModel<typeof userIndustrySubscriptions>;

export type IndustryDeliveryRun = InferSelectModel<typeof industryDeliveryRuns>;
export type NewIndustryDeliveryRun = InferInsertModel<typeof industryDeliveryRuns>;

export type UserDeliveryLog = InferSelectModel<typeof userDeliveryLogs>;
export type NewUserDeliveryLog = InferInsertModel<typeof userDeliveryLogs>;
```

- [x] **Step 6: Run schema tests and typecheck**

Run:

```bash
npm test -- tests/enterpriseSchema.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/migrate.ts src/types/db.ts tests/enterpriseSchema.test.ts
git commit -m "feat: add enterprise industry schema"
```

---

### Task 2: Enterprise Type Contracts And Recipient Email Utilities

**Files:**
- Modify: `src/lib/industry-configs/types.ts`
- Create: `src/lib/enterprise/recipientEmails.ts`
- Test: `tests/enterpriseRecipientEmails.test.ts`

- [x] **Step 1: Write failing utility tests**

Create `tests/enterpriseRecipientEmails.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeRecipientEmails,
  validateRecipientEmails,
} from '../src/lib/enterprise/recipientEmails';

test('normalizeRecipientEmails includes account email first and deduplicates extras', () => {
  assert.deepEqual(
    normalizeRecipientEmails('user@example.com', [
      ' Team@Example.com ',
      'user@example.com',
      '',
      'team@example.com',
    ]),
    ['user@example.com', 'team@example.com']
  );
});

test('normalizeRecipientEmails limits total recipient count to five', () => {
  assert.deepEqual(
    normalizeRecipientEmails('owner@example.com', [
      'a@example.com',
      'b@example.com',
      'c@example.com',
      'd@example.com',
      'e@example.com',
    ]),
    ['owner@example.com', 'a@example.com', 'b@example.com', 'c@example.com', 'd@example.com']
  );
});

test('validateRecipientEmails rejects invalid email syntax', () => {
  const result = validateRecipientEmails(['ok@example.com', 'bad-email']);

  assert.equal(result.valid, false);
  assert.equal(result.error, '收件邮箱格式不正确：bad-email');
});

test('validateRecipientEmails accepts one to five valid emails', () => {
  const result = validateRecipientEmails(['a@example.com', 'b@example.com']);

  assert.deepEqual(result, { valid: true });
});
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseRecipientEmails.test.ts
```

Expected: FAIL because `src/lib/enterprise/recipientEmails.ts` does not exist.

- [x] **Step 3: Add enterprise union types**

Modify `src/lib/industry-configs/types.ts` and append:

```ts
export type IndustryVisibility = 'draft' | 'published';
export type IndustrySubscriptionMode = 'open' | 'approval_required';
export type MonitoringProfileStatus = 'pending' | 'creating' | 'active' | 'failed' | 'disabled';
export type UserIndustrySubscriptionStatus =
  | 'pending_approval'
  | 'pending_profile'
  | 'active'
  | 'rejected'
  | 'paused';
export type IndustryDeliveryRunStatus = 'running' | 'completed' | 'failed';
export type UserDeliveryLogStatus = 'sent' | 'skipped' | 'failed';

export interface EnterpriseIndustryFields {
  visibility?: IndustryVisibility;
  subscriptionMode?: IndustrySubscriptionMode;
  autoProfileExpansion?: boolean;
  deliveryCron?: string | null;
  deliveryTimezone?: string;
  deliveryEnabled?: boolean;
  maxItemsPerEmail?: number;
}
```

Extend `IndustryConfigInput`:

```ts
export interface IndustryConfigInput extends EnterpriseIndustryFields {
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
```

- [x] **Step 4: Implement recipient email utilities**

Create `src/lib/enterprise/recipientEmails.ts`:

```ts
const MAX_RECIPIENT_EMAILS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeRecipientEmails(
  accountEmail: string | null | undefined,
  extraEmails: unknown
): string[] {
  const rawExtras = Array.isArray(extraEmails) ? extraEmails : [];
  const seen = new Set<string>();
  const result: string[] = [];

  const push = (value: unknown) => {
    const email = String(value ?? '').trim().toLowerCase();
    if (!email || seen.has(email)) return;
    seen.add(email);
    result.push(email);
  };

  push(accountEmail);
  for (const item of rawExtras) {
    push(item);
    if (result.length >= MAX_RECIPIENT_EMAILS) break;
  }

  return result.slice(0, MAX_RECIPIENT_EMAILS);
}

export function validateRecipientEmails(
  emails: string[]
): { valid: true } | { valid: false; error: string } {
  if (emails.length === 0) {
    return { valid: false, error: '至少需要一个收件邮箱' };
  }
  if (emails.length > MAX_RECIPIENT_EMAILS) {
    return { valid: false, error: `收件邮箱最多 ${MAX_RECIPIENT_EMAILS} 个` };
  }
  for (const email of emails) {
    if (!EMAIL_RE.test(email)) {
      return { valid: false, error: `收件邮箱格式不正确：${email}` };
    }
  }
  return { valid: true };
}

export function parseRecipientEmailsJson(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}
```

- [x] **Step 5: Run utility tests**

Run:

```bash
npm test -- tests/enterpriseRecipientEmails.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/lib/industry-configs/types.ts src/lib/enterprise/recipientEmails.ts tests/enterpriseRecipientEmails.test.ts
git commit -m "feat: add enterprise recipient email utilities"
```

---

### Task 3: Admin-Managed Industry Config Service And API

**Files:**
- Modify: `src/lib/industry-configs/service.ts`
- Modify: `src/app/api/industry-configs/route.ts`
- Modify: `src/app/api/industry-configs/[id]/route.ts`
- Create: `src/app/api/industry-configs/[id]/publish/route.ts`
- Test: `tests/enterpriseIndustryConfigApi.test.ts`

- [x] **Step 1: Write failing API source tests**

Create `tests/enterpriseIndustryConfigApi.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry config write routes require admin access', async () => {
  const listRoute = await readFile('src/app/api/industry-configs/route.ts', 'utf8');
  const itemRoute = await readFile('src/app/api/industry-configs/[id]/route.ts', 'utf8');
  const publishRoute = await readFile('src/app/api/industry-configs/[id]/publish/route.ts', 'utf8');

  assert.match(listRoute, /requireAdmin/);
  assert.match(itemRoute, /requireAdmin/);
  assert.match(publishRoute, /requireAdmin/);
});

test('industry config service exposes admin and catalog list functions', async () => {
  const source = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(source, /listIndustryConfigsForAdmin/);
  assert.match(source, /listPublishedIndustryConfigsForUser/);
  assert.match(source, /publishIndustryConfig/);
  assert.match(source, /seedDefaultIndustryConfigsForAdmin/);
});

test('ordinary catalog reads only published enabled industry configs', async () => {
  const source = await readFile('src/lib/industry-configs/service.ts', 'utf8');

  assert.match(source, /eq\(industryConfigs\.visibility, 'published'\)/);
  assert.match(source, /eq\(industryConfigs\.isEnabled, true\)/);
});
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseIndustryConfigApi.test.ts
```

Expected: FAIL because route/service semantics are still user-scoped.

- [x] **Step 3: Update industry config service**

Modify `src/lib/industry-configs/service.ts`.

Keep `toApi` and `toDbValues`, and extend `toDbValues`:

```ts
    visibility: input.visibility ?? 'draft',
    subscriptionMode: input.subscriptionMode ?? 'open',
    autoProfileExpansion: input.autoProfileExpansion === true,
    deliveryCron: input.deliveryCron?.trim() || null,
    deliveryTimezone: input.deliveryTimezone?.trim() || 'Asia/Shanghai',
    deliveryEnabled: input.deliveryEnabled === true,
    maxItemsPerEmail: Math.min(10, Math.max(5, Number(input.maxItemsPerEmail ?? 10))),
```

Replace user-scoped list/create helpers with these functions:

```ts
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
```

Keep compatibility exports if existing code still imports old names:

```ts
export const listIndustryConfigs = (_userId: string, enabledOnly = false) =>
  listPublishedIndustryConfigsForUser(enabledOnly);
export const createIndustryConfig = createIndustryConfigForAdmin;
export const updateIndustryConfig = (id: string, _userId: string, input: IndustryConfigInput) =>
  updateIndustryConfigForAdmin(id, input);
export const deleteIndustryConfig = (id: string, _userId: string) =>
  deleteIndustryConfigForAdmin(id);
export const getIndustryConfigForUser = (id: string, _userId: string) =>
  getPublishedIndustryConfig(id);
```

- [x] **Step 4: Update industry config routes**

Modify `src/app/api/industry-configs/route.ts`:

```ts
import { requireAdmin, requireAuth } from '@/lib/auth';
import {
  createIndustryConfigForAdmin,
  listIndustryConfigsForAdmin,
  listPublishedIndustryConfigsForUser,
  seedDefaultIndustryConfigsForAdmin,
} from '@/lib/industry-configs/service';
import type { IndustryConfigInput } from '@/lib/industry-configs/types';

function handleAuthError(err: unknown): Response | null {
  if (err instanceof Error && err.message === 'UNAUTHORIZED') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (err instanceof Error && err.message === 'FORBIDDEN') {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
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

    if (session.isAdmin) {
      seedDefaultIndustryConfigsForAdmin(session.userId);
      return Response.json(listIndustryConfigsForAdmin());
    }

    return Response.json(listPublishedIndustryConfigsForUser(enabledOnly));
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs GET]', err);
    return Response.json({ error: 'Failed to load industry configs' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireAdmin();
    const body = await req.json().catch(() => ({})) as IndustryConfigInput;
    const error = validateInput(body);
    if (error) return Response.json({ error }, { status: 400 });

    const created = createIndustryConfigForAdmin(session.userId, body);
    return Response.json(created, { status: 201 });
  } catch (err) {
    const authError = handleAuthError(err);
    if (authError) return authError;
    console.error('[industry-configs POST]', err);
    return Response.json({ error: 'Failed to create industry config' }, { status: 500 });
  }
}
```

Modify `src/app/api/industry-configs/[id]/route.ts` to use `requireAdmin` for `PATCH` and `DELETE`, and use `getIndustryConfigForAdmin` for admin GET while non-admin GET uses `getPublishedIndustryConfig`.

- [x] **Step 5: Add publish route**

Create `src/app/api/industry-configs/[id]/publish/route.ts`:

```ts
import { requireAdmin } from '@/lib/auth';
import { publishIndustryConfig } from '@/lib/industry-configs/service';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { published?: boolean };
    const updated = publishIndustryConfig(id, body.published !== false);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry-configs publish POST]', err);
    return Response.json({ error: 'Failed to publish industry config' }, { status: 500 });
  }
}
```

- [x] **Step 6: Run API tests and typecheck**

Run:

```bash
npm test -- tests/enterpriseIndustryConfigApi.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/lib/industry-configs src/app/api/industry-configs tests/enterpriseIndustryConfigApi.test.ts
git commit -m "feat: make industry configs admin managed"
```

---

### Task 4: Monitoring Profile Matcher

**Files:**
- Create: `src/lib/enterprise/profileMatcher.ts`
- Test: `tests/enterpriseProfileMatcher.test.ts`

- [x] **Step 1: Write failing profile matcher tests**

Create `tests/enterpriseProfileMatcher.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchMonitoringProfile, summarizeCriteriaTokens } from '../src/lib/enterprise/profileMatcher';

const profiles = [
  {
    id: 'profile_policy',
    title: '食品安全法规政策',
    seedCriteria: '食品安全管理条例相关',
    criteriaSummary: '关注食品安全法规、条例、监管政策和地方执行动态',
    keywordsJson: '["食品安全","法规","条例","政策","监管"]',
    targetEntitiesJson: '["市场监管部门"]',
    status: 'active',
  },
  {
    id: 'profile_catering',
    title: '餐饮企业经营影响',
    seedCriteria: '食品安全对餐饮公司影响',
    criteriaSummary: '关注食品安全监管对餐饮企业经营、成本、处罚和合规动作的影响',
    keywordsJson: '["食品安全","餐饮","公司","处罚","合规"]',
    targetEntitiesJson: '["餐饮企业"]',
    status: 'active',
  },
];

test('summarizeCriteriaTokens extracts stable Chinese intent tokens', () => {
  assert.deepEqual(
    summarizeCriteriaTokens('食品安全管理条例和监管政策相关'),
    ['食品安全', '管理条例', '监管', '政策']
  );
});

test('matchMonitoringProfile reuses a similar policy profile', () => {
  const result = matchMonitoringProfile({
    customCriteria: '食品安全条例政策解读',
    profiles,
    autoProfileExpansion: false,
  });

  assert.equal(result.action, 'reuse');
  assert.equal(result.profileId, 'profile_policy');
  assert.ok(result.score >= 0.35);
});

test('matchMonitoringProfile creates pending profile for different criteria when auto expansion is off', () => {
  const result = matchMonitoringProfile({
    customCriteria: '预制菜食品安全对连锁餐饮公司的影响',
    profiles: [profiles[0]],
    autoProfileExpansion: false,
  });

  assert.equal(result.action, 'pending');
  assert.equal(result.profileId, undefined);
  assert.match(result.suggestedTitle, /餐饮|食品安全/);
});

test('matchMonitoringProfile creates profile automatically when auto expansion is on', () => {
  const result = matchMonitoringProfile({
    customCriteria: '食品安全对餐饮公司成本和处罚影响',
    profiles: [profiles[0]],
    autoProfileExpansion: true,
  });

  assert.equal(result.action, 'create');
  assert.equal(result.profileId, undefined);
  assert.match(result.suggestedTitle, /餐饮|食品安全/);
});
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseProfileMatcher.test.ts
```

Expected: FAIL because matcher does not exist.

- [x] **Step 3: Implement rule-first profile matcher**

Create `src/lib/enterprise/profileMatcher.ts`:

```ts
interface ProfileLike {
  id: string;
  title: string;
  seedCriteria: string;
  criteriaSummary: string | null;
  keywordsJson: string | null;
  targetEntitiesJson: string | null;
  status: string;
}

export interface ProfileMatchInput {
  customCriteria: string;
  profiles: ProfileLike[];
  autoProfileExpansion: boolean;
}

export type ProfileMatchResult =
  | { action: 'reuse'; profileId: string; score: number; reason: string }
  | { action: 'create'; score: number; suggestedTitle: string; criteriaSummary: string; reason: string }
  | { action: 'pending'; score: number; suggestedTitle: string; criteriaSummary: string; reason: string };

const DOMAIN_TERMS = [
  '食品安全',
  '管理条例',
  '法规',
  '政策',
  '监管',
  '处罚',
  '召回',
  '事故',
  '餐饮',
  '公司',
  '企业',
  '成本',
  '合规',
  '影响',
  '舆情',
  '价格',
  '供应',
];

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

export function summarizeCriteriaTokens(criteria: string): string[] {
  const text = criteria.trim();
  const result: string[] = [];
  for (const term of DOMAIN_TERMS) {
    if (text.includes(term) && !result.includes(term)) {
      result.push(term);
    }
  }
  if (result.length > 0) return result;
  return text
    .split(/[\s,，、;；。]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
    .slice(0, 8);
}

function scoreProfile(criteriaTokens: string[], profile: ProfileLike): number {
  const profileTokens = new Set([
    ...summarizeCriteriaTokens(profile.title),
    ...summarizeCriteriaTokens(profile.seedCriteria),
    ...summarizeCriteriaTokens(profile.criteriaSummary ?? ''),
    ...parseJsonList(profile.keywordsJson),
    ...parseJsonList(profile.targetEntitiesJson),
  ]);
  if (criteriaTokens.length === 0 || profileTokens.size === 0) return 0;
  const overlap = criteriaTokens.filter((token) => profileTokens.has(token)).length;
  const union = new Set([...criteriaTokens, ...profileTokens]).size;
  return overlap / union;
}

function suggestTitle(criteria: string, tokens: string[]): string {
  if (tokens.includes('餐饮') || tokens.includes('公司') || tokens.includes('企业')) {
    return '餐饮企业经营影响';
  }
  if (tokens.includes('法规') || tokens.includes('政策') || tokens.includes('管理条例')) {
    return '法规政策监控';
  }
  if (tokens.includes('处罚') || tokens.includes('召回') || tokens.includes('事故')) {
    return '风险事件监控';
  }
  return criteria.trim().slice(0, 24) || '产业动态监控';
}

export function matchMonitoringProfile(input: ProfileMatchInput): ProfileMatchResult {
  const tokens = summarizeCriteriaTokens(input.customCriteria);
  const candidates = input.profiles.filter((profile) =>
    profile.status === 'active' || profile.status === 'creating'
  );

  let best: { profile: ProfileLike; score: number } | null = null;
  for (const profile of candidates) {
    const score = scoreProfile(tokens, profile);
    if (!best || score > best.score) best = { profile, score };
  }

  if (best && best.score >= 0.30) {
    return {
      action: 'reuse',
      profileId: best.profile.id,
      score: best.score,
      reason: `与监控需求簇「${best.profile.title}」关键词重合度较高`,
    };
  }

  const suggestedTitle = suggestTitle(input.customCriteria, tokens);
  const criteriaSummary = tokens.length > 0
    ? `关注${tokens.join('、')}相关信息`
    : `关注${input.customCriteria.trim()}相关信息`;

  return {
    action: input.autoProfileExpansion ? 'create' : 'pending',
    score: best?.score ?? 0,
    suggestedTitle,
    criteriaSummary,
    reason: input.autoProfileExpansion
      ? '未找到足够相似的监控需求簇，按产业方向配置自动创建新簇'
      : '未找到足够相似的监控需求簇，需要管理员确认扩展',
  };
}
```

- [x] **Step 4: Run matcher tests**

Run:

```bash
npm test -- tests/enterpriseProfileMatcher.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/enterprise/profileMatcher.ts tests/enterpriseProfileMatcher.test.ts
git commit -m "feat: add monitoring profile matcher"
```

---

### Task 5: User Industry Subscription Service And APIs

**Files:**
- Create: `src/lib/enterprise/subscriptionService.ts`
- Create: `src/app/api/enterprise/industry-catalog/route.ts`
- Create: `src/app/api/enterprise/industry-subscriptions/route.ts`
- Create: `src/app/api/enterprise/my-industry-subscriptions/route.ts`
- Create: `src/app/api/enterprise/my-industry-subscriptions/[id]/route.ts`
- Create: `src/app/api/enterprise/my-industry-subscriptions/[id]/pause/route.ts`
- Test: `tests/enterpriseSubscriptionApiSource.test.ts`

- [x] **Step 1: Write failing API source tests**

Create `tests/enterpriseSubscriptionApiSource.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('enterprise catalog route exposes published industry configs', async () => {
  const source = await readFile('src/app/api/enterprise/industry-catalog/route.ts', 'utf8');

  assert.match(source, /requireAuth/);
  assert.match(source, /listPublishedIndustryConfigsForUser/);
});

test('enterprise subscription route creates user industry subscriptions', async () => {
  const source = await readFile('src/app/api/enterprise/industry-subscriptions/route.ts', 'utf8');

  assert.match(source, /createUserIndustrySubscription/);
  assert.match(source, /normalizeRecipientEmails/);
});

test('subscription service binds users to monitoring profiles', async () => {
  const source = await readFile('src/lib/enterprise/subscriptionService.ts', 'utf8');

  assert.match(source, /matchMonitoringProfile/);
  assert.match(source, /userIndustrySubscriptions/);
  assert.match(source, /industryMonitoringProfiles/);
  assert.match(source, /pending_approval/);
  assert.match(source, /pending_profile/);
});

test('my subscription routes are scoped to the current user', async () => {
  const listRoute = await readFile('src/app/api/enterprise/my-industry-subscriptions/route.ts', 'utf8');
  const itemRoute = await readFile('src/app/api/enterprise/my-industry-subscriptions/[id]/route.ts', 'utf8');
  const pauseRoute = await readFile('src/app/api/enterprise/my-industry-subscriptions/[id]/pause/route.ts', 'utf8');

  assert.match(listRoute, /session\.userId/);
  assert.match(itemRoute, /session\.userId/);
  assert.match(pauseRoute, /session\.userId/);
});
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseSubscriptionApiSource.test.ts
```

Expected: FAIL because enterprise routes/service do not exist.

- [x] **Step 3: Implement subscription service**

Create `src/lib/enterprise/subscriptionService.ts`:

```ts
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
    return db.select().from(userIndustrySubscriptions).where(eq(userIndustrySubscriptions.id, row.subscription.id)).get();
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

  db.update(userIndustrySubscriptions)
    .set({
      monitoringProfileId: profile.id,
      status: match.action === 'create' ? 'pending_profile' : 'pending_profile',
      updatedAt: now,
    })
    .where(eq(userIndustrySubscriptions.id, row.subscription.id))
    .run();

  return db.select().from(userIndustrySubscriptions).where(eq(userIndustrySubscriptions.id, row.subscription.id)).get();
}

export function approveUserIndustrySubscription(id: string, adminUserId: string) {
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
```

The `adminUserId` parameter in `approveUserIndustrySubscription` is intentionally accepted for audit extension; this task does not write an audit row.

- [x] **Step 4: Add enterprise catalog route**

Create `src/app/api/enterprise/industry-catalog/route.ts`:

```ts
import { requireAuth } from '@/lib/auth';
import { listPublishedIndustryConfigsForUser } from '@/lib/industry-configs/service';

export async function GET() {
  try {
    await requireAuth();
    return Response.json(listPublishedIndustryConfigsForUser(true));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[enterprise industry-catalog GET]', err);
    return Response.json({ error: 'Failed to load industry catalog' }, { status: 500 });
  }
}
```

- [x] **Step 5: Add user subscription routes**

Create `src/app/api/enterprise/industry-subscriptions/route.ts`:

```ts
import { requireAuth } from '@/lib/auth';
import { createUserIndustrySubscription } from '@/lib/enterprise/subscriptionService';
import { normalizeRecipientEmails } from '@/lib/enterprise/recipientEmails';

export async function POST(req: Request) {
  try {
    const session = await requireAuth();
    const body = await req.json().catch(() => ({})) as {
      industryConfigId?: string;
      customCriteria?: string;
      extraRecipientEmails?: string[];
    };

    if (!body.industryConfigId) {
      return Response.json({ error: 'industryConfigId is required' }, { status: 400 });
    }
    if (!body.customCriteria?.trim()) {
      return Response.json({ error: 'customCriteria is required' }, { status: 400 });
    }

    normalizeRecipientEmails(null, body.extraRecipientEmails ?? []);
    const created = createUserIndustrySubscription({
      userId: session.userId,
      industryConfigId: body.industryConfigId,
      customCriteria: body.customCriteria,
      extraRecipientEmails: body.extraRecipientEmails ?? [],
    });

    return Response.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'INDUSTRY_NOT_FOUND') {
      return Response.json({ error: 'Industry not found' }, { status: 404 });
    }
    console.error('[enterprise industry-subscriptions POST]', err);
    return Response.json({ error: message }, { status: 400 });
  }
}
```

Create list/update/pause routes using the service functions:

`src/app/api/enterprise/my-industry-subscriptions/route.ts`

```ts
import { requireAuth } from '@/lib/auth';
import { listMyIndustrySubscriptions } from '@/lib/enterprise/subscriptionService';

export async function GET() {
  try {
    const session = await requireAuth();
    return Response.json(listMyIndustrySubscriptions(session.userId));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[enterprise my subscriptions GET]', err);
    return Response.json({ error: 'Failed to load subscriptions' }, { status: 500 });
  }
}
```

`src/app/api/enterprise/my-industry-subscriptions/[id]/route.ts`

```ts
import { requireAuth } from '@/lib/auth';
import { updateMyIndustrySubscription } from '@/lib/enterprise/subscriptionService';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as {
      customCriteria?: string;
      extraRecipientEmails?: string[];
    };
    const updated = updateMyIndustrySubscription(id, session.userId, body);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[enterprise my subscription PATCH]', err);
    return Response.json({ error: message }, { status: 400 });
  }
}
```

`src/app/api/enterprise/my-industry-subscriptions/[id]/pause/route.ts`

```ts
import { requireAuth } from '@/lib/auth';
import { pauseMyIndustrySubscription } from '@/lib/enterprise/subscriptionService';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth();
    const { id } = await params;
    const body = await req.json().catch(() => ({})) as { paused?: boolean };
    const updated = pauseMyIndustrySubscription(id, session.userId, body.paused !== false);
    if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[enterprise my subscription pause POST]', err);
    return Response.json({ error: 'Failed to update subscription' }, { status: 500 });
  }
}
```

- [x] **Step 6: Run API source tests and typecheck**

Run:

```bash
npm test -- tests/enterpriseSubscriptionApiSource.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/lib/enterprise src/app/api/enterprise tests/enterpriseSubscriptionApiSource.test.ts
git commit -m "feat: add user enterprise industry subscriptions"
```

---

### Task 6: Admin Profile Approval And Shared Collection Pool Provisioning

**Files:**
- Create: `src/lib/enterprise/profileProvisioner.ts`
- Create: `src/app/api/industry-configs/[id]/profiles/route.ts`
- Create: `src/app/api/industry-profiles/[id]/approve/route.ts`
- Create: `src/app/api/industry-profiles/[id]/retry/route.ts`
- Test: `tests/enterpriseProfileProvisioningSource.test.ts`

- [x] **Step 1: Write failing source tests**

Create `tests/enterpriseProfileProvisioningSource.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('profile provisioner reuses managed pipeline for shared collection pools', async () => {
  const source = await readFile('src/lib/enterprise/profileProvisioner.ts', 'utf8');

  assert.match(source, /runManagedPipeline/);
  assert.match(source, /sharedSubscriptionId/);
  assert.match(source, /status: 'creating'/);
  assert.match(source, /status: 'active'/);
  assert.match(source, /provisioningError/);
});

test('admin profile routes require admin access', async () => {
  const profilesRoute = await readFile('src/app/api/industry-configs/[id]/profiles/route.ts', 'utf8');
  const approveRoute = await readFile('src/app/api/industry-profiles/[id]/approve/route.ts', 'utf8');
  const retryRoute = await readFile('src/app/api/industry-profiles/[id]/retry/route.ts', 'utf8');

  assert.match(profilesRoute, /requireAdmin/);
  assert.match(approveRoute, /requireAdmin/);
  assert.match(retryRoute, /requireAdmin/);
});

test('profile approval can trigger provisioning', async () => {
  const source = await readFile('src/app/api/industry-profiles/[id]/approve/route.ts', 'utf8');

  assert.match(source, /approveMonitoringProfile/);
  assert.match(source, /startProfileProvisioning/);
});
```

- [x] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseProfileProvisioningSource.test.ts
```

Expected: FAIL because profile provisioner and admin profile routes do not exist.

- [x] **Step 3: Implement profile provisioner**

Create `src/lib/enterprise/profileProvisioner.ts`:

```ts
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

function buildProfileCriteria(industry: typeof industryConfigs.$inferSelect, profile: typeof industryMonitoringProfiles.$inferSelect) {
  const parts = [
    industry.keywordsJson,
    industry.riskTermsJson,
    industry.regionsJson,
    industry.entitiesJson,
  ].flatMap((value) => {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  });
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
        .select({ managedStatus: subscriptions.managedStatus, managedError: subscriptions.managedError })
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
```

- [x] **Step 4: Add admin profile routes**

Create `src/app/api/industry-configs/[id]/profiles/route.ts`:

```ts
import { requireAdmin } from '@/lib/auth';
import { listMonitoringProfilesForIndustry } from '@/lib/enterprise/profileProvisioner';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    return Response.json(listMonitoringProfilesForIndustry(id));
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry profiles GET]', err);
    return Response.json({ error: 'Failed to load profiles' }, { status: 500 });
  }
}
```

Create `src/app/api/industry-profiles/[id]/approve/route.ts`:

```ts
import { requireAdmin } from '@/lib/auth';
import {
  approveMonitoringProfile,
  startProfileProvisioning,
} from '@/lib/enterprise/profileProvisioner';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const profile = approveMonitoringProfile(id, session.userId);
    if (!profile) return Response.json({ error: 'Not found' }, { status: 404 });
    await startProfileProvisioning(id);
    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry profile approve POST]', err);
    return Response.json({ error: 'Failed to approve profile' }, { status: 500 });
  }
}
```

Create `src/app/api/industry-profiles/[id]/retry/route.ts`:

```ts
import { requireAdmin } from '@/lib/auth';
import { startProfileProvisioning } from '@/lib/enterprise/profileProvisioner';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const result = await startProfileProvisioning(id);
    return Response.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry profile retry POST]', err);
    return Response.json({ error: 'Failed to retry profile' }, { status: 500 });
  }
}
```

- [x] **Step 5: Trigger automatic provisioning for auto-created profiles**

Modify `src/lib/enterprise/subscriptionService.ts` inside the `match.action === 'create'` path after profile insert:

```ts
  if (match.action === 'create') {
    import('./profileProvisioner')
      .then(({ startProfileProvisioning }) => startProfileProvisioning(profile.id))
      .catch((err) => console.error('[enterprise] profile auto provisioning failed', err));
  }
```

- [x] **Step 6: Run tests and typecheck**

Run:

```bash
npm test -- tests/enterpriseProfileProvisioningSource.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/lib/enterprise src/app/api/industry-configs src/app/api/industry-profiles tests/enterpriseProfileProvisioningSource.test.ts
git commit -m "feat: provision monitoring profile collection pools"
```

---

### Task 7: Delivery Scoring And Email Template

**Files:**
- Create: `src/lib/enterprise/deliveryScoring.ts`
- Create: `src/lib/enterprise/emailTemplate.ts`
- Test: `tests/enterpriseDeliveryScoring.test.ts`
- Test: `tests/enterpriseEmailTemplate.test.ts`

- [ ] **Step 1: Write failing delivery scoring tests**

Create `tests/enterpriseDeliveryScoring.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreDeliveryCard, selectDeliveryCards } from '../src/lib/enterprise/deliveryScoring';

const cards = [
  {
    id: 'regulation',
    title: '市场监管总局发布食品安全管理条例修订说明',
    summary: '涉及食品安全管理条例、监管政策和地方执行要求。',
    sourceName: '市场监管总局',
    publishedAt: new Date('2026-07-02T01:00:00Z'),
    createdAt: new Date('2026-07-02T01:00:00Z'),
  },
  {
    id: 'catering',
    title: '食品安全检查影响多家餐饮公司经营成本',
    summary: '多地餐饮企业因食品安全合规要求增加检测和整改成本。',
    sourceName: '行业媒体',
    publishedAt: new Date('2026-07-02T02:00:00Z'),
    createdAt: new Date('2026-07-02T02:00:00Z'),
  },
  {
    id: 'generic',
    title: '今日食品行业资讯汇总',
    summary: '整理近期食品行业资讯。',
    sourceName: '聚合站',
    publishedAt: new Date('2026-07-02T03:00:00Z'),
    createdAt: new Date('2026-07-02T03:00:00Z'),
  },
];

test('scoreDeliveryCard prioritizes relevance to custom criteria', () => {
  const regulationScore = scoreDeliveryCard(cards[0], '食品安全管理条例相关', new Date('2026-07-02T09:00:00Z'));
  const genericScore = scoreDeliveryCard(cards[2], '食品安全管理条例相关', new Date('2026-07-02T09:00:00Z'));

  assert.ok(regulationScore.total > genericScore.total);
  assert.ok(regulationScore.relevance > genericScore.relevance);
});

test('selectDeliveryCards returns top relevant cards within max count', () => {
  const selected = selectDeliveryCards({
    cards,
    customCriteria: '食品安全对餐饮公司影响',
    now: new Date('2026-07-02T09:00:00Z'),
    maxItems: 2,
  });

  assert.equal(selected.length, 2);
  assert.equal(selected[0].card.id, 'catering');
  assert.ok(selected[0].score.total >= selected[1].score.total);
});
```

Create `tests/enterpriseEmailTemplate.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderIndustryDeliveryEmail } from '../src/lib/enterprise/emailTemplate';

test('renderIndustryDeliveryEmail includes summary and table rows', () => {
  const email = renderIndustryDeliveryEmail({
    industryName: '食品安全',
    profileTitle: '法规政策监控',
    customCriteria: '食品安全管理条例相关',
    dateLabel: '2026-07-02',
    items: [
      {
        title: '市场监管总局发布食品安全管理条例修订说明',
        sourceName: '市场监管总局',
        authorityLabel: '高',
        relevanceLabel: '高',
        publishedAtLabel: '2026-07-02 09:00',
        summary: '涉及食品安全管理条例和监管执行要求。',
        url: 'https://example.com/a',
        reason: '与管理条例高度相关',
      },
    ],
  });

  assert.match(email.subject, /食品安全产业信息/);
  assert.match(email.html, /<table/);
  assert.match(email.html, /市场监管总局发布食品安全管理条例修订说明/);
  assert.match(email.text, /与管理条例高度相关/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseDeliveryScoring.test.ts tests/enterpriseEmailTemplate.test.ts
```

Expected: FAIL because scoring and template modules do not exist.

- [ ] **Step 3: Implement delivery scoring**

Create `src/lib/enterprise/deliveryScoring.ts`:

```ts
export interface DeliveryCardLike {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string | null;
  publishedAt: Date | string | null;
  createdAt: Date | string;
}

export interface DeliveryScore {
  relevance: number;
  authority: number;
  importance: number;
  freshness: number;
  contentQuality: number;
  total: number;
}

const IMPORTANT_TERMS = ['事故', '处罚', '召回', '监管', '政策', '条例', '检查', '整改', '风险'];
const AUTHORITY_TERMS = ['监管', '市场监管', '政府', '总局', '部', '厅', '局', '法院', '协会'];

function tokenize(text: string): string[] {
  return text
    .split(/[\s,，、;；。！？!?.：:（）()《》"“”]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function scoreRelevance(text: string, criteria: string) {
  const criteriaTokens = tokenize(criteria);
  if (criteriaTokens.length === 0) return 0;
  const matched = criteriaTokens.filter((token) => text.includes(token)).length;
  return Math.min(100, Math.round((matched / criteriaTokens.length) * 100));
}

function scoreFreshness(value: Date | string | null, now: Date) {
  const date = value ? new Date(value) : now;
  const ageHours = Math.max(0, (now.getTime() - date.getTime()) / 3_600_000);
  if (ageHours <= 24) return 100;
  if (ageHours <= 72) return 70;
  if (ageHours <= 168) return 40;
  return 15;
}

export function scoreDeliveryCard(
  card: DeliveryCardLike,
  customCriteria: string,
  now: Date
): DeliveryScore {
  const text = `${card.title} ${card.summary ?? ''}`;
  const relevance = scoreRelevance(text, customCriteria);
  const authority = includesAny(card.sourceName ?? '', AUTHORITY_TERMS) ? 90 : 55;
  const importance = includesAny(text, IMPORTANT_TERMS) ? 85 : 45;
  const freshness = scoreFreshness(card.publishedAt ?? card.createdAt, now);
  const contentQuality = (card.summary?.length ?? 0) >= 30 ? 80 : 45;
  const total = Math.round(
    relevance * 0.45 +
      authority * 0.20 +
      importance * 0.15 +
      freshness * 0.10 +
      contentQuality * 0.10
  );

  return { relevance, authority, importance, freshness, contentQuality, total };
}

export function selectDeliveryCards(input: {
  cards: DeliveryCardLike[];
  customCriteria: string;
  now: Date;
  maxItems: number;
}) {
  return input.cards
    .map((card) => ({
      card,
      score: scoreDeliveryCard(card, input.customCriteria, input.now),
    }))
    .filter((item) => item.score.relevance >= 20 || item.score.total >= 55)
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, Math.min(10, Math.max(5, input.maxItems)));
}

export function scoreToLabel(score: number) {
  if (score >= 75) return '高';
  if (score >= 45) return '中';
  return '低';
}
```

- [ ] **Step 4: Implement email template**

Create `src/lib/enterprise/emailTemplate.ts`:

```ts
export interface DeliveryEmailItem {
  title: string;
  sourceName: string;
  authorityLabel: string;
  relevanceLabel: string;
  publishedAtLabel: string;
  summary: string;
  url: string;
  reason: string;
}

export interface RenderIndustryDeliveryEmailInput {
  industryName: string;
  profileTitle: string;
  customCriteria: string;
  dateLabel: string;
  items: DeliveryEmailItem[];
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderIndustryDeliveryEmail(input: RenderIndustryDeliveryEmailInput) {
  const subject = `${input.industryName}产业信息早报｜${input.profileTitle}｜${input.dateLabel}`;
  const rows = input.items
    .map((item, index) => `
      <tr>
        <td style="padding:8px;border:1px solid #d8dee9;">${index + 1}</td>
        <td style="padding:8px;border:1px solid #d8dee9;"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.sourceName)}</td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.authorityLabel)}</td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.relevanceLabel)}</td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.publishedAtLabel)}</td>
        <td style="padding:8px;border:1px solid #d8dee9;">${escapeHtml(item.summary)}<br/><span style="color:#64748b;">${escapeHtml(item.reason)}</span></td>
      </tr>
    `)
    .join('');

  const html = `
    <!doctype html>
    <html>
      <body style="font-family:Arial,'Microsoft YaHei',sans-serif;color:#0f172a;line-height:1.6;">
        <h2>${escapeHtml(subject)}</h2>
        <p>本次为你筛选出 ${input.items.length} 条与「${escapeHtml(input.customCriteria)}」相关的产业信息。</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="padding:8px;border:1px solid #d8dee9;">序号</th>
              <th style="padding:8px;border:1px solid #d8dee9;">标题</th>
              <th style="padding:8px;border:1px solid #d8dee9;">来源</th>
              <th style="padding:8px;border:1px solid #d8dee9;">权威性</th>
              <th style="padding:8px;border:1px solid #d8dee9;">相关性</th>
              <th style="padding:8px;border:1px solid #d8dee9;">发布时间</th>
              <th style="padding:8px;border:1px solid #d8dee9;">概要</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:20px;color:#64748b;font-size:12px;">此邮件由系统自动发送，请勿直接回复。</p>
      </body>
    </html>
  `;

  const text = [
    subject,
    `本次为你筛选出 ${input.items.length} 条与「${input.customCriteria}」相关的产业信息。`,
    ...input.items.map((item, index) =>
      `${index + 1}. ${item.title}\n来源：${item.sourceName}\n权威性：${item.authorityLabel}，相关性：${item.relevanceLabel}\n概要：${item.summary}\n原因：${item.reason}\n链接：${item.url}`
    ),
  ].join('\n\n');

  return { subject, html, text };
}
```

- [ ] **Step 5: Run scoring/template tests**

Run:

```bash
npm test -- tests/enterpriseDeliveryScoring.test.ts tests/enterpriseEmailTemplate.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/enterprise/deliveryScoring.ts src/lib/enterprise/emailTemplate.ts tests/enterpriseDeliveryScoring.test.ts tests/enterpriseEmailTemplate.test.ts
git commit -m "feat: add industry delivery scoring and email template"
```

---

### Task 8: Delivery Service And Scheduler

**Files:**
- Create: `src/lib/enterprise/deliveryService.ts`
- Create: `src/lib/enterprise/deliveryScheduler.ts`
- Create: `src/app/api/industry-delivery-runs/route.ts`
- Modify: `server.ts`
- Test: `tests/enterpriseDeliverySource.test.ts`

- [ ] **Step 1: Write failing delivery source tests**

Create `tests/enterpriseDeliverySource.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('delivery service sends scored email and writes logs', async () => {
  const source = await readFile('src/lib/enterprise/deliveryService.ts', 'utf8');

  assert.match(source, /industryDeliveryRuns/);
  assert.match(source, /userDeliveryLogs/);
  assert.match(source, /selectDeliveryCards/);
  assert.match(source, /renderIndustryDeliveryEmail/);
  assert.match(source, /sendEmail/);
  assert.match(source, /status: 'skipped'/);
});

test('delivery scheduler registers enabled industry delivery cron jobs', async () => {
  const source = await readFile('src/lib/enterprise/deliveryScheduler.ts', 'utf8');

  assert.match(source, /node-cron/);
  assert.match(source, /deliveryEnabled/);
  assert.match(source, /runIndustryDelivery/);
});

test('server initializes delivery scheduler after source scheduler', async () => {
  const source = await readFile('server.ts', 'utf8');

  assert.match(source, /initScheduler/);
  assert.match(source, /initDeliveryScheduler/);
});

test('delivery run API requires admin access', async () => {
  const source = await readFile('src/app/api/industry-delivery-runs/route.ts', 'utf8');

  assert.match(source, /requireAdmin/);
  assert.match(source, /industryDeliveryRuns/);
  assert.match(source, /userDeliveryLogs/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseDeliverySource.test.ts
```

Expected: FAIL because delivery service, scheduler, and route do not exist.

- [ ] **Step 3: Implement delivery service**

Create `src/lib/enterprise/deliveryService.ts`:

```ts
import { and, desc, eq, gt } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { getDb } from '@/lib/db';
import {
  industryConfigs,
  industryDeliveryRuns,
  industryMonitoringProfiles,
  messageCards,
  sources,
  userDeliveryLogs,
  userIndustrySubscriptions,
} from '@/lib/db/schema';
import { sendEmail } from '@/lib/email/smtp';
import { parseRecipientEmailsJson } from './recipientEmails';
import { scoreToLabel, selectDeliveryCards } from './deliveryScoring';
import { renderIndustryDeliveryEmail } from './emailTemplate';

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export async function runIndustryDelivery(industryConfigId: string, scheduledFor = new Date()) {
  const db = getDb();
  const run = db
    .insert(industryDeliveryRuns)
    .values({
      id: createId(),
      industryConfigId,
      scheduledFor,
      status: 'running',
      startedAt: new Date(),
      createdAt: new Date(),
    })
    .returning()
    .get();

  try {
    const userSubs = db
      .select({
        userSub: userIndustrySubscriptions,
        profile: industryMonitoringProfiles,
        industry: industryConfigs,
      })
      .from(userIndustrySubscriptions)
      .innerJoin(
        industryMonitoringProfiles,
        eq(userIndustrySubscriptions.monitoringProfileId, industryMonitoringProfiles.id)
      )
      .innerJoin(industryConfigs, eq(userIndustrySubscriptions.industryConfigId, industryConfigs.id))
      .where(
        and(
          eq(userIndustrySubscriptions.industryConfigId, industryConfigId),
          eq(userIndustrySubscriptions.status, 'active'),
          eq(industryMonitoringProfiles.status, 'active')
        )
      )
      .all();

    for (const row of userSubs) {
      await runUserDelivery(run.id, row.userSub.id);
    }

    db.update(industryDeliveryRuns)
      .set({ status: 'completed', finishedAt: new Date() })
      .where(eq(industryDeliveryRuns.id, run.id))
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.update(industryDeliveryRuns)
      .set({ status: 'failed', error: message, finishedAt: new Date() })
      .where(eq(industryDeliveryRuns.id, run.id))
      .run();
  }

  return run;
}

export async function runUserDelivery(runId: string, userIndustrySubscriptionId: string) {
  const db = getDb();
  const row = db
    .select({
      userSub: userIndustrySubscriptions,
      profile: industryMonitoringProfiles,
      industry: industryConfigs,
    })
    .from(userIndustrySubscriptions)
    .innerJoin(
      industryMonitoringProfiles,
      eq(userIndustrySubscriptions.monitoringProfileId, industryMonitoringProfiles.id)
    )
    .innerJoin(industryConfigs, eq(userIndustrySubscriptions.industryConfigId, industryConfigs.id))
    .where(eq(userIndustrySubscriptions.id, userIndustrySubscriptionId))
    .get();

  if (!row || !row.profile.sharedSubscriptionId) return null;

  const since = row.userSub.lastDeliveredAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rawCards = db
    .select({
      id: messageCards.id,
      title: messageCards.title,
      summary: messageCards.summary,
      sourceName: sources.title,
      sourceUrl: messageCards.sourceUrl,
      publishedAt: messageCards.publishedAt,
      createdAt: messageCards.createdAt,
    })
    .from(messageCards)
    .innerJoin(sources, eq(messageCards.sourceId, sources.id))
    .where(
      and(
        eq(messageCards.subscriptionId, row.profile.sharedSubscriptionId),
        gt(messageCards.createdAt, since)
      )
    )
    .orderBy(desc(messageCards.createdAt))
    .limit(100)
    .all();

  const selected = selectDeliveryCards({
    cards: rawCards,
    customCriteria: row.userSub.customCriteria,
    now: new Date(),
    maxItems: row.industry.maxItemsPerEmail,
  });

  const recipients = parseRecipientEmailsJson(row.userSub.recipientEmailsJson);
  if (selected.length === 0 || recipients.length === 0) {
    db.insert(userDeliveryLogs)
      .values({
        id: createId(),
        runId,
        userIndustrySubscriptionId: row.userSub.id,
        userId: row.userSub.userId,
        recipientEmailsJson: JSON.stringify(recipients),
        selectedCardIdsJson: '[]',
        subject: `${row.industry.name}产业信息报送`,
        status: 'skipped',
        error: selected.length === 0 ? '无高相关新增信息' : '无有效收件邮箱',
        createdAt: new Date(),
      })
      .run();
    return null;
  }

  const email = renderIndustryDeliveryEmail({
    industryName: row.industry.name,
    profileTitle: row.profile.title,
    customCriteria: row.userSub.customCriteria,
    dateLabel: formatDateTime(new Date()).slice(0, 10),
    items: selected.map(({ card, score }) => ({
      title: card.title,
      sourceName: card.sourceName ?? '未知来源',
      authorityLabel: scoreToLabel(score.authority),
      relevanceLabel: scoreToLabel(score.relevance),
      publishedAtLabel: formatDateTime(card.publishedAt ?? card.createdAt),
      summary: card.summary ?? '',
      url: (card as { sourceUrl?: string }).sourceUrl ?? '',
      reason: `相关性 ${score.relevance}，综合评分 ${score.total}`,
    })),
  });

  const sendResults = [];
  for (const recipient of recipients) {
    sendResults.push(await sendEmail({
      to: recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
    }));
  }
  const failed = sendResults.find((result) => !result.success);

  db.insert(userDeliveryLogs)
    .values({
      id: createId(),
      runId,
      userIndustrySubscriptionId: row.userSub.id,
      userId: row.userSub.userId,
      recipientEmailsJson: JSON.stringify(recipients),
      selectedCardIdsJson: JSON.stringify(selected.map((item) => item.card.id)),
      subject: email.subject,
      status: failed ? 'failed' : 'sent',
      error: failed?.error ?? null,
      sentAt: failed ? null : new Date(),
      createdAt: new Date(),
    })
    .run();

  if (!failed) {
    db.update(userIndustrySubscriptions)
      .set({ lastDeliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(userIndustrySubscriptions.id, row.userSub.id))
      .run();
  }

  return { sent: !failed, selectedCount: selected.length };
}
```

- [ ] **Step 4: Implement delivery scheduler**

Create `src/lib/enterprise/deliveryScheduler.ts`:

```ts
import cron, { type ScheduledTask } from 'node-cron';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { industryConfigs } from '@/lib/db/schema';
import { runIndustryDelivery } from './deliveryService';

const deliveryJobs = new Map<string, ScheduledTask>();

export function scheduleIndustryDelivery(industry: typeof industryConfigs.$inferSelect) {
  unscheduleIndustryDelivery(industry.id);
  if (!industry.deliveryEnabled || !industry.deliveryCron || industry.visibility !== 'published') return;
  if (!cron.validate(industry.deliveryCron)) {
    console.warn(`[DeliveryScheduler] Invalid cron for industry ${industry.id}: ${industry.deliveryCron}`);
    return;
  }

  const task = cron.schedule(industry.deliveryCron, () => {
    runIndustryDelivery(industry.id).catch((err) =>
      console.error(`[DeliveryScheduler] Delivery failed for industry ${industry.id}`, err)
    );
  }, {
    timezone: industry.deliveryTimezone || 'Asia/Shanghai',
  });

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
```

- [ ] **Step 5: Initialize scheduler in server**

Modify `server.ts` after `await initScheduler();`:

```ts
  const { initDeliveryScheduler } = await import('./src/lib/enterprise/deliveryScheduler');
  await initDeliveryScheduler();
```

- [ ] **Step 6: Add delivery run admin API**

Create `src/app/api/industry-delivery-runs/route.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { industryDeliveryRuns, userDeliveryLogs } from '@/lib/db/schema';

export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const industryConfigId = url.searchParams.get('industryConfigId');
    const db = getDb();
    const runs = industryConfigId
      ? db
          .select()
          .from(industryDeliveryRuns)
          .where(eq(industryDeliveryRuns.industryConfigId, industryConfigId))
          .orderBy(desc(industryDeliveryRuns.createdAt))
          .limit(50)
          .all()
      : db
          .select()
          .from(industryDeliveryRuns)
          .orderBy(desc(industryDeliveryRuns.createdAt))
          .limit(50)
          .all();

    const logs = db
      .select()
      .from(userDeliveryLogs)
      .orderBy(desc(userDeliveryLogs.createdAt))
      .limit(100)
      .all();

    return Response.json({ runs, logs });
  } catch (err) {
    if (err instanceof Error && err.message === 'UNAUTHORIZED') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }
    console.error('[industry-delivery-runs GET]', err);
    return Response.json({ error: 'Failed to load delivery runs' }, { status: 500 });
  }
}
```

- [ ] **Step 7: Run tests and typecheck**

Run:

```bash
npm test -- tests/enterpriseDeliverySource.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/enterprise/deliveryService.ts src/lib/enterprise/deliveryScheduler.ts src/app/api/industry-delivery-runs server.ts tests/enterpriseDeliverySource.test.ts
git commit -m "feat: add enterprise industry email delivery"
```

---

### Task 9: Enterprise Catalog And Admin UI Source Integration

**Files:**
- Create: `src/components/enterprise/IndustryCatalog.tsx`
- Create: `src/components/enterprise/MyIndustrySubscriptions.tsx`
- Modify: `src/app/industry-configs/page.tsx`
- Modify: `src/components/industry-configs/IndustryConfigManager.tsx`
- Test: `tests/enterpriseUiSource.test.ts`

- [ ] **Step 1: Write failing UI source tests**

Create `tests/enterpriseUiSource.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('industry page renders admin manager for admins and user catalog for normal users', async () => {
  const source = await readFile('src/app/industry-configs/page.tsx', 'utf8');

  assert.match(source, /useAuth/);
  assert.match(source, /IndustryConfigManager/);
  assert.match(source, /IndustryCatalog/);
  assert.match(source, /MyIndustrySubscriptions/);
});

test('user industry catalog calls enterprise subscription APIs', async () => {
  const source = await readFile('src/components/enterprise/IndustryCatalog.tsx', 'utf8');

  assert.match(source, /\/api\/enterprise\/industry-catalog/);
  assert.match(source, /\/api\/enterprise\/industry-subscriptions/);
  assert.match(source, /customCriteria/);
  assert.match(source, /extraRecipientEmails/);
});

test('my industry subscriptions component supports pause and edit', async () => {
  const source = await readFile('src/components/enterprise/MyIndustrySubscriptions.tsx', 'utf8');

  assert.match(source, /\/api\/enterprise\/my-industry-subscriptions/);
  assert.match(source, /\/pause/);
  assert.match(source, /recipientEmailsJson/);
});

test('admin industry manager exposes enterprise delivery and publication fields', async () => {
  const source = await readFile('src/components/industry-configs/IndustryConfigManager.tsx', 'utf8');

  assert.match(source, /visibility/);
  assert.match(source, /subscriptionMode/);
  assert.match(source, /autoProfileExpansion/);
  assert.match(source, /deliveryCron/);
  assert.match(source, /maxItemsPerEmail/);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- tests/enterpriseUiSource.test.ts
```

Expected: FAIL because user catalog components and enterprise UI fields do not exist.

- [ ] **Step 3: Add user catalog component**

Create `src/components/enterprise/IndustryCatalog.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  deliveryCron?: string | null;
  maxItemsPerEmail?: number;
  subscriptionMode?: 'open' | 'approval_required';
  snapshot?: { keywords: string[]; riskTerms: string[]; regions: string[] };
}

export default function IndustryCatalog() {
  const { toast } = useToast();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [selected, setSelected] = useState<CatalogItem | null>(null);
  const [customCriteria, setCustomCriteria] = useState('');
  const [extraRecipientEmails, setExtraRecipientEmails] = useState('');

  useEffect(() => {
    fetch('/api/enterprise/industry-catalog')
      .then((res) => res.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => toast({ title: '加载产业目录失败', variant: 'destructive' }));
  }, [toast]);

  async function submitSubscription() {
    if (!selected || !customCriteria.trim()) {
      toast({ title: '请填写监控条件', variant: 'destructive' });
      return;
    }
    const res = await fetch('/api/enterprise/industry-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        industryConfigId: selected.id,
        customCriteria,
        extraRecipientEmails: extraRecipientEmails
          .split(/[\n,，;；]/)
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast({ title: data.error ?? '订阅失败', variant: 'destructive' });
      return;
    }
    toast({ title: selected.subscriptionMode === 'approval_required' ? '已提交审批' : '订阅已提交' });
    setSelected(null);
    setCustomCriteria('');
    setExtraRecipientEmails('');
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <article key={item.id} className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">{item.name}</h2>
              {item.description ? <p className="mt-2 text-sm text-muted-foreground">{item.description}</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">
                报送：{item.deliveryCron || '未启用'} · 每封最多 {item.maxItemsPerEmail ?? 10} 条
              </p>
            </div>
            <Button onClick={() => setSelected(item)}>订阅</Button>
          </div>
        </article>
      ))}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>订阅{selected?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <label className="grid gap-2 text-sm font-medium">
              个性化监控条件
              <Textarea value={customCriteria} onChange={(event) => setCustomCriteria(event.target.value)} />
            </label>
            <label className="grid gap-2 text-sm font-medium">
              额外收件邮箱
              <Input
                value={extraRecipientEmails}
                onChange={(event) => setExtraRecipientEmails(event.target.value)}
                placeholder="多个邮箱用逗号分隔"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>取消</Button>
            <Button onClick={submitSubscription}>提交</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Add my subscriptions component**

Create `src/components/enterprise/MyIndustrySubscriptions.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';

interface MySubscriptionRow {
  subscription: {
    id: string;
    status: string;
    customCriteria: string;
    recipientEmailsJson: string;
  };
  industry: { name: string };
  profile: { title: string; status: string } | null;
}

export default function MyIndustrySubscriptions() {
  const { toast } = useToast();
  const [rows, setRows] = useState<MySubscriptionRow[]>([]);

  async function loadRows() {
    const res = await fetch('/api/enterprise/my-industry-subscriptions');
    if (!res.ok) {
      toast({ title: '加载我的订阅失败', variant: 'destructive' });
      return;
    }
    setRows(await res.json());
  }

  useEffect(() => {
    loadRows();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pause(id: string, paused: boolean) {
    await fetch(`/api/enterprise/my-industry-subscriptions/${id}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused }),
    });
    await loadRows();
  }

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">我的产业订阅</h2>
      <div className="grid gap-3">
        {rows.map((row) => (
          <article key={row.subscription.id} className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium">{row.industry.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{row.subscription.customCriteria}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  状态：{row.subscription.status} · 需求簇：{row.profile?.title ?? '匹配中'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  收件邮箱：{row.subscription.recipientEmailsJson}
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => pause(row.subscription.id, row.subscription.status !== 'paused')}
              >
                {row.subscription.status === 'paused' ? '恢复' : '暂停'}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Render admin/user page variants**

Modify `src/app/industry-configs/page.tsx`:

```tsx
'use client';

import IndustryConfigManager from '@/components/industry-configs/IndustryConfigManager';
import IndustryCatalog from '@/components/enterprise/IndustryCatalog';
import MyIndustrySubscriptions from '@/components/enterprise/MyIndustrySubscriptions';
import { useAuth } from '@/contexts/AuthContext';

export default function IndustryConfigsPage() {
  const { user } = useAuth();
  const isAdmin = user?.isAdmin ?? false;

  if (isAdmin) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">产业方向管理</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            维护企业级产业方向、订阅权限、需求扩展策略和邮件报送规则。
          </p>
        </div>
        <IndustryConfigManager />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">产业订阅</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          选择管理员发布的产业方向，补充你的监控条件，系统会按企业统一节奏发送个性化邮件。
        </p>
      </div>
      <IndustryCatalog />
      <MyIndustrySubscriptions />
    </div>
  );
}
```

- [ ] **Step 6: Add enterprise fields to admin manager**

Modify `src/components/industry-configs/IndustryConfigManager.tsx`:

Add to `IndustryConfigView`:

```ts
  visibility?: 'draft' | 'published';
  subscriptionMode?: 'open' | 'approval_required';
  autoProfileExpansion?: boolean;
  deliveryCron?: string | null;
  deliveryTimezone?: string;
  deliveryEnabled?: boolean;
  maxItemsPerEmail?: number;
```

Add to `FormState` and `emptyForm`:

```ts
  visibility: 'draft',
  subscriptionMode: 'open',
  autoProfileExpansion: false,
  deliveryCron: '0 9 * * *',
  deliveryTimezone: 'Asia/Shanghai',
  deliveryEnabled: false,
  maxItemsPerEmail: 10,
```

Add to `toForm`:

```ts
    visibility: config.visibility ?? 'draft',
    subscriptionMode: config.subscriptionMode ?? 'open',
    autoProfileExpansion: config.autoProfileExpansion === true,
    deliveryCron: config.deliveryCron ?? '0 9 * * *',
    deliveryTimezone: config.deliveryTimezone ?? 'Asia/Shanghai',
    deliveryEnabled: config.deliveryEnabled === true,
    maxItemsPerEmail: config.maxItemsPerEmail ?? 10,
```

Add to `toPayload`:

```ts
    visibility: form.visibility,
    subscriptionMode: form.subscriptionMode,
    autoProfileExpansion: form.autoProfileExpansion,
    deliveryCron: form.deliveryCron,
    deliveryTimezone: form.deliveryTimezone,
    deliveryEnabled: form.deliveryEnabled,
    maxItemsPerEmail: form.maxItemsPerEmail,
```

Add form controls near the existing enabled switch:

```tsx
<div className="grid gap-3 md:grid-cols-2">
  <label className="grid gap-2 text-sm font-medium">
    发布状态
    <Select value={form.visibility} onValueChange={(value: 'draft' | 'published') => updateField('visibility', value)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="draft">草稿</SelectItem>
        <SelectItem value="published">已发布</SelectItem>
      </SelectContent>
    </Select>
  </label>
  <label className="grid gap-2 text-sm font-medium">
    订阅模式
    <Select value={form.subscriptionMode} onValueChange={(value: 'open' | 'approval_required') => updateField('subscriptionMode', value)}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="open">开放订阅</SelectItem>
        <SelectItem value="approval_required">需要审批</SelectItem>
      </SelectContent>
    </Select>
  </label>
</div>

<div className="grid gap-3 md:grid-cols-2">
  <label className="grid gap-2 text-sm font-medium">
    报送 cron
    <Input value={form.deliveryCron} onChange={(event) => updateField('deliveryCron', event.target.value)} />
  </label>
  <label className="grid gap-2 text-sm font-medium">
    每封最多条数
    <Input
      type="number"
      min={5}
      max={10}
      value={form.maxItemsPerEmail}
      onChange={(event) => updateField('maxItemsPerEmail', Number(event.target.value))}
    />
  </label>
</div>

<div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
  <div>
    <div className="text-sm font-medium">允许自动扩展采集池</div>
    <div className="text-xs text-muted-foreground">用户条件不匹配已有需求簇时，自动创建新采集池。</div>
  </div>
  <Switch checked={form.autoProfileExpansion} onCheckedChange={(value) => updateField('autoProfileExpansion', value)} />
</div>

<div className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
  <div>
    <div className="text-sm font-medium">启用邮件报送</div>
    <div className="text-xs text-muted-foreground">按上方 cron 为活跃用户发送个性化邮件。</div>
  </div>
  <Switch checked={form.deliveryEnabled} onCheckedChange={(value) => updateField('deliveryEnabled', value)} />
</div>
```

- [ ] **Step 7: Run UI source tests and typecheck**

Run:

```bash
npm test -- tests/enterpriseUiSource.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/enterprise src/components/industry-configs/IndustryConfigManager.tsx src/app/industry-configs/page.tsx tests/enterpriseUiSource.test.ts
git commit -m "feat: add enterprise industry subscription UI"
```

---

### Task 10: Final Verification

**Files:**
- Modify only if verification reveals defects in files touched by Tasks 1-9.

- [ ] **Step 1: Run all tests**

Run:

```bash
npm test
```

Expected: all tests pass. If the existing middleware icon test still fails, fix `src/middleware.ts` by adding `'/apple-icon'` to `STATIC_PATHS`, then rerun `npm test`.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected: PASS. If native module or local Node version fails, capture the exact error and `node -v` output in the final summary.

- [ ] **Step 4: Start dev server**

Run:

```bash
npm run dev
```

Expected: server starts at `http://localhost:3000`.

- [ ] **Step 5: Manual admin verification**

In the browser:

- Log in as admin.
- Open `/industry-configs`.
- Create a `食品安全` industry direction.
- Set `visibility=published`.
- Set subscription mode to open.
- Set auto expansion off.
- Set delivery cron to `0 9 * * *`.
- Save and verify the card shows published/delivery settings.

- [ ] **Step 6: Manual user verification**

In the browser:

- Log in as a normal user.
- Open `/industry-configs`.
- Verify only published enabled industry directions appear.
- Subscribe to `食品安全`.
- Fill `食品安全管理条例相关`.
- Add one extra valid email.
- Submit and verify the item appears in “我的产业订阅”.

- [ ] **Step 7: Manual profile verification**

In the DB or admin page:

- Verify a monitoring profile was created or reused.
- If auto expansion is off and no profile existed, verify the profile is pending.
- Approve the profile as admin.
- Verify provisioning status changes to creating.

- [ ] **Step 8: Manual delivery verification**

If the profile has an active shared subscription and message cards:

- Trigger delivery by calling `runIndustryDelivery(industryConfigId)` from a temporary Node/tsx snippet or by temporarily setting a near cron.
- Verify `industry_delivery_runs` contains a completed run.
- Verify `user_delivery_logs` contains `sent`, `skipped`, or `failed`.
- Verify sent emails contain a table with title, source, authority, relevance, time, summary, and link.

- [ ] **Step 9: Inspect git status**

Run:

```bash
git status --short
```

Expected: clean after commits or only intentional verification notes.

- [ ] **Step 10: Commit verification fixes**

If verification required fixes:

```bash
git add <fixed-files>
git commit -m "fix: stabilize enterprise industry subscriptions"
```

If verification required no fixes, skip this commit.

---

## Self-Review

- Spec coverage: Tasks cover admin-managed industry directions, ordinary-user catalog, custom criteria, recipient emails, monitoring profiles, matching/reuse, auto or pending expansion, shared collection pool provisioning, scheduled delivery, scored 5-10 item selection, HTML email, and logs.
- Deferred scope: organization departments, address books, custom user delivery times, historical backfill, and event clustering schema are intentionally outside this plan.
- Type consistency: `industryMonitoringProfiles`, `userIndustrySubscriptions`, `industryDeliveryRuns`, and `userDeliveryLogs` are introduced in Task 1 and used consistently in later tasks.
- Testing: Each core layer has either source tests or pure unit tests before implementation, with final full test/build verification.
