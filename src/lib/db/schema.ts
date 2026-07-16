import { pgTable, text, integer, real, boolean, timestamp } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { APP_NAME } from '@/lib/branding';

// ─── users ───────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  googleId: text('google_id').unique(),
  isAdmin: boolean('is_admin').notNull().default(false),
  isGuest: boolean('is_guest').notNull().default(false),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── sessions ────────────────────────────────────────────────────────────────
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── oauth_states ────────────────────────────────────────────────────────────
export const oauthStates = pgTable('oauth_states', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  provider: text('provider', { enum: ['google'] }).notNull(),
  state: text('state').notNull(),
  redirectUrl: text('redirect_url'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
});

// ─── llm_providers ───────────────────────────────────────────────────────────
export const llmProviders = pgTable('llm_providers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key').notNull(),
  modelId: text('model_id').notNull(),
  headers: text('headers'), // JSON string, optional extra headers
  isActive: boolean('is_active').notNull().default(false),
  totalTokensUsed: integer('total_tokens_used').notNull().default(0),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── prompt_templates ────────────────────────────────────────────────────────
export const promptTemplates = pgTable('prompt_templates', {
  id: text('id').primaryKey(), // e.g. 'userId-find-sources'
  name: text('name').notNull(),
  description: text('description').notNull(),
  content: text('content').notNull(),
  defaultContent: text('default_content').notNull(),
  // Optional: pin this template to a specific provider; null = use default active provider
  providerId: text('provider_id').references(() => llmProviders.id, { onDelete: 'set null' }),
  // User-specific templates; null for system defaults (migration only)
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── search_provider_config ──────────────────────────────────────────────────
export const searchProviderConfig = pgTable('search_provider_config', {
  id: text('id').primaryKey().default('default'),
  provider: text('provider', { enum: ['tavily', 'serper', 'none'] })
    .notNull()
    .default('none'),
  apiKey: text('api_key').notNull().default(''),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── firecrawl_config ────────────────────────────────────────────────────────
// One administrator-managed key for resilient webpage collection. The key is
// never returned from the settings API after it has been stored.
export const firecrawlConfig = pgTable('firecrawl_config', {
  id: text('id').primaryKey().default('default'),
  apiKey: text('api_key').notNull().default(''),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── discovery_source_catalog ────────────────────────────────────────────────
// Global, versioned discovery candidates. These are not user subscription
// sources: a catalog row can be matched by many subscriptions and can be
// disabled independently when a feed becomes unhealthy.
// One administrator-managed email cadence shared by every published industry
// pool. A pool only decides whether it participates in delivery.
export const industryDeliveryConfig = pgTable('industry_delivery_config', {
  id: text('id').primaryKey().default('default'),
  cron: text('cron').notNull().default('0 9 * * *'),
  timezone: text('timezone').notNull().default('Asia/Shanghai'),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const discoverySourceCatalog = pgTable('discovery_source_catalog', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  feedUrl: text('feed_url').notNull().unique(),
  feedProvider: text('feed_provider', { enum: ['anyfeeder', 'direct'] }).notNull(),
  originalCategory: text('original_category').notNull(),
  preferencesJson: text('preferences_json').notNull().default('[]'),
  trustLevel: text('trust_level', { enum: ['high', 'medium', 'low'] }).notNull(),
  defaultUsage: text('default_usage', {
    enum: ['primary', 'supplementary', 'discovery'],
  }).notNull(),
  topicTagsJson: text('topic_tags_json').notNull().default('[]'),
  keywordsJson: text('keywords_json').notNull().default('[]'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  healthStatus: text('health_status', {
    enum: ['unknown', 'healthy', 'unhealthy'],
  }).notNull().default('unknown'),
  lastValidatedAt: timestamp('last_validated_at', { mode: 'date' }),
  lastValidationError: text('last_validation_error'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── industry_configs ────────────────────────────────────────────────────────
export const industryConfigs = pgTable('industry_configs', {
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
  sourcePreferencesJson: text('source_preferences_json')
    .notNull()
    .default('["authoritative","mainstream"]'),
  allowAiDiscoveryFallback: boolean('allow_ai_discovery_fallback').notNull().default(true),
  termProfileJson: text('term_profile_json').notNull().default('{}'),
  alertLevel: text('alert_level').notNull().default('一般关注'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  visibility: text('visibility', { enum: ['draft', 'published'] })
    .notNull()
    .default('draft'),
  subscriptionMode: text('subscription_mode', { enum: ['open', 'approval_required'] })
    .notNull()
    .default('open'),
  autoProfileExpansion: boolean('auto_profile_expansion')
    .notNull()
    .default(false),
  deliveryCron: text('delivery_cron'),
  deliveryTimezone: text('delivery_timezone').notNull().default('Asia/Shanghai'),
  deliveryEnabled: boolean('delivery_enabled').notNull().default(false),
  maxItemsPerEmail: integer('max_items_per_email').notNull().default(10),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── subscriptions ───────────────────────────────────────────────────────────
export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  topic: text('topic').notNull(),
  criteria: text('criteria'), // optional monitoring criteria
  industryConfigId: text('industry_config_id').references(() => industryConfigs.id, {
    onDelete: 'set null',
  }),
  industryConfigSnapshot: text('industry_config_snapshot'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  unreadCount: integer('unread_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
  lastUpdatedAt: timestamp('last_updated_at', { mode: 'date' }),
  // 创建状态：null = 正常订阅，'manual_creating' = 手动创建中，'managed_creating' = 托管创建中，'failed' = 创建失败
  managedStatus: text('managed_status', {
    enum: ['manual_creating', 'managed_creating', 'failed'],
  }),
  managedError: text('managed_error'),
  // 存储向导中间状态，用于恢复；手动和托管均使用
  wizardStateJson: text('wizard_state_json'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── managed_build_logs ──────────────────────────────────────────────────────
export const managedBuildLogs = pgTable('managed_build_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  subscriptionId: text('subscription_id')
    .notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  step: text('step', { enum: ['find_sources', 'generate_script', 'complete'] }).notNull(),
  level: text('level', { enum: ['info', 'progress', 'success', 'error'] }).notNull(),
  message: text('message').notNull(),
  payload: text('payload'), // JSON：关键步骤结果（foundSources 列表、脚本等）
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// Durable LLM call state shared by the Web process and the background worker.
// One row represents the latest streamed state for a logical LLM call.
export const managedLlmCalls = pgTable('managed_llm_calls', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  subscriptionId: text('subscription_id')
    .notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  sourceUrl: text('source_url').notNull().default(''),
  callIndex: integer('call_index').notNull(),
  payload: text('payload').notNull(),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// Durable handoff between the Web/email process and the background worker.
// Heavy work must never depend on an in-memory Promise owned by an API request.
export const backgroundJobs = pgTable('background_jobs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  type: text('type', {
    enum: ['managed_pipeline', 'managed_step', 'generate_source', 'source_collection', 'source_provisioning'],
  }).notNull(),
  status: text('status', { enum: ['queued', 'running', 'completed', 'failed'] })
    .notNull()
    .default('queued'),
  priority: integer('priority').notNull().default(100),
  dedupeKey: text('dedupe_key').notNull(),
  payload: text('payload').notNull(),
  availableAt: timestamp('available_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  attempts: integer('attempts').notNull().default(0),
  startedAt: timestamp('started_at', { mode: 'date' }),
  finishedAt: timestamp('finished_at', { mode: 'date' }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// A lightweight liveness record written by the dedicated background process.
// The web process reads it to explain whether a queue is busy or the worker is
// actually offline.
export const workerHeartbeats = pgTable('worker_heartbeats', {
  id: text('id').primaryKey().default('primary'),
  lastHeartbeatAt: timestamp('last_heartbeat_at', { mode: 'date' }).notNull(),
  currentJobId: text('current_job_id'),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
});

// ─── industry_monitoring_profiles ───────────────────────────────────────────
export const industryMonitoringProfiles = pgTable('industry_monitoring_profiles', {
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
  requiresAdminApproval: boolean('requires_admin_approval')
    .notNull()
    .default(false),
  approvedBy: text('approved_by').references(() => users.id, { onDelete: 'set null' }),
  approvedAt: timestamp('approved_at', { mode: 'date' }),
  lastProvisionedAt: timestamp('last_provisioned_at', { mode: 'date' }),
  provisioningError: text('provisioning_error'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── user_industry_subscriptions ────────────────────────────────────────────
export const userIndustrySubscriptions = pgTable('user_industry_subscriptions', {
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
  lastDeliveredAt: timestamp('last_delivered_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── industry_delivery_runs ─────────────────────────────────────────────────
export const industryDeliveryRuns = pgTable('industry_delivery_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  industryConfigId: text('industry_config_id')
    .notNull()
    .references(() => industryConfigs.id, { onDelete: 'cascade' }),
  scheduledFor: timestamp('scheduled_for', { mode: 'date' }).notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed'] })
    .notNull()
    .default('running'),
  startedAt: timestamp('started_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  finishedAt: timestamp('finished_at', { mode: 'date' }),
  error: text('error'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── user_delivery_logs ─────────────────────────────────────────────────────
export const userDeliveryLogs = pgTable('user_delivery_logs', {
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
  sentAt: timestamp('sent_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── sources ─────────────────────────────────────────────────────────────────
export const sources = pgTable('sources', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  subscriptionId: text('subscription_id')
    .notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  url: text('url').notNull(),
  catalogSourceId: text('catalog_source_id').references(() => discoverySourceCatalog.id, {
    onDelete: 'set null',
  }),
  discoveryOrigin: text('discovery_origin', { enum: ['catalog', 'ai'] }),
  collectionStrategy: text('collection_strategy', {
    enum: ['generic_rss', 'firecrawl_scrape', 'ai_script'],
  }),
  script: text('script').notNull().default(''),
  cronExpression: text('cron_expression').notNull().default('0 * * * *'),
  isEnabled: boolean('is_enabled').notNull().default(true),
  status: text('status', { enum: ['active', 'failed', 'disabled', 'pending'] })
    .notNull()
    .default('pending'),
  lastRunAt: timestamp('last_run_at', { mode: 'date' }),
  lastRunSuccess: boolean('last_run_success'),
  lastError: text('last_error'),
  nextRunAt: timestamp('next_run_at', { mode: 'date' }),
  totalRuns: integer('total_runs').notNull().default(0),
  successRuns: integer('success_runs').notNull().default(0),
  itemsCollected: integer('items_collected').notNull().default(0),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── favorites ───────────────────────────────────────────────────────────────
// Independent table storing copies of favorited cards
export const favorites = pgTable('favorites', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Original card reference (may be null if original card deleted)
  originalCardId: text('original_card_id'),
  // Copied card data
  title: text('title').notNull(),
  summary: text('summary'),
  thumbnailUrl: text('thumbnail_url'),
  sourceUrl: text('source_url').notNull(),
  publishedAt: timestamp('published_at', { mode: 'date' }),
  meetsCriteriaFlag: boolean('meets_criteria_flag')
    .notNull()
    .default(false),
  criteriaResult: text('criteria_result').$type<'matched' | 'not_matched' | 'invalid'>(),
  metricValue: text('metric_value'),
  // Source info snapshot
  subscriptionTopic: text('subscription_topic'),
  sourceTitle: text('source_title'),
  // Favorite metadata
  favoriteAt: timestamp('favorite_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  // Soft-delete flag: false means unfavorited (hidden but kept for undo)
  isFavorite: boolean('is_favorite').notNull().default(true),
});

// ─── message_cards ───────────────────────────────────────────────────────────
export const messageCards = pgTable('message_cards', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  subscriptionId: text('subscription_id')
    .notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  sourceId: text('source_id')
    .notNull()
    .references(() => sources.id, { onDelete: 'cascade' }),
  contentHash: text('content_hash').notNull(), // sha256(title + url)
  title: text('title').notNull(),
  summary: text('summary'),
  thumbnailUrl: text('thumbnail_url'),
  sourceUrl: text('source_url').notNull(),
  publishedAt: timestamp('published_at', { mode: 'date' }),
  meetsCriteriaFlag: boolean('meets_criteria_flag')
    .notNull()
    .default(false),
  criteriaResult: text('criteria_result').$type<'matched' | 'not_matched' | 'invalid'>(),
  metricValue: text('metric_value'), // raw extracted value, e.g. "¥299"
  readAt: timestamp('read_at', { mode: 'date' }), // null = unread
  rawData: text('raw_data'), // JSON string
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── notifications ───────────────────────────────────────────────────────────
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  type: text('type', {
    enum: ['source_created', 'source_fixed', 'source_failed', 'cards_collected'],
  }).notNull(),
  title: text('title').notNull(),
  body: text('body'),
  isRead: boolean('is_read').notNull().default(false),
  subscriptionId: text('subscription_id').references(() => subscriptions.id, {
    onDelete: 'cascade',
  }),
  relatedEntityType: text('related_entity_type'), // 'source'
  relatedEntityId: text('related_entity_id'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── rss_instances ───────────────────────────────────────────────────────────
export const rssInstances = pgTable('rss_instances', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── oauth_config ─────────────────────────────────────────────────────────────
export const oauthConfig = pgTable('oauth_config', {
  id: text('id').primaryKey().default('google'), // one row per provider
  clientId: text('client_id').notNull().default(''),
  clientSecret: text('client_secret').notNull().default(''),
  enabled: boolean('enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── analysis_reports ────────────────────────────────────────────────────────
export const analysisReports = pgTable('analysis_reports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  subscriptionId: text('subscription_id').notNull()
    .references(() => subscriptions.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  htmlContent: text('html_content').notNull().default(''),
  cardCount: integer('card_count').notNull().default(0),
  isStarred: boolean('is_starred').notNull().default(false),
  status: text('status', { enum: ['generating', 'completed', 'failed'] })
    .notNull()
    .default('completed'),
  error: text('error'),
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date()).notNull(),
});

// ─── Relations ───────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  subscriptions: many(subscriptions),
  industryConfigs: many(industryConfigs),
  userIndustrySubscriptions: many(userIndustrySubscriptions),
  userDeliveryLogs: many(userDeliveryLogs),
  favorites: many(favorites),
  promptTemplates: many(promptTemplates),
  sessions: many(sessions),
  analysisReports: many(analysisReports),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one, many }) => ({
  user: one(users, {
    fields: [subscriptions.userId],
    references: [users.id],
  }),
  industryConfig: one(industryConfigs, {
    fields: [subscriptions.industryConfigId],
    references: [industryConfigs.id],
  }),
  sources: many(sources),
  messageCards: many(messageCards),
  notifications: many(notifications),
  managedBuildLogs: many(managedBuildLogs),
  managedLlmCalls: many(managedLlmCalls),
  analysisReports: many(analysisReports),
}));

export const industryConfigsRelations = relations(industryConfigs, ({ one, many }) => ({
  user: one(users, {
    fields: [industryConfigs.userId],
    references: [users.id],
  }),
  subscriptions: many(subscriptions),
  monitoringProfiles: many(industryMonitoringProfiles),
  userSubscriptions: many(userIndustrySubscriptions),
  deliveryRuns: many(industryDeliveryRuns),
}));

export const managedBuildLogsRelations = relations(managedBuildLogs, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [managedBuildLogs.subscriptionId],
    references: [subscriptions.id],
  }),
}));

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

export const sourcesRelations = relations(sources, ({ one, many }) => ({
  subscription: one(subscriptions, {
    fields: [sources.subscriptionId],
    references: [subscriptions.id],
  }),
  catalogSource: one(discoverySourceCatalog, {
    fields: [sources.catalogSourceId],
    references: [discoverySourceCatalog.id],
  }),
  messageCards: many(messageCards),
}));

export const managedLlmCallsRelations = relations(managedLlmCalls, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [managedLlmCalls.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const discoverySourceCatalogRelations = relations(
  discoverySourceCatalog,
  ({ many }) => ({
    sources: many(sources),
  })
);

export const messageCardsRelations = relations(messageCards, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [messageCards.subscriptionId],
    references: [subscriptions.id],
  }),
  source: one(sources, {
    fields: [messageCards.sourceId],
    references: [sources.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [notifications.subscriptionId],
    references: [subscriptions.id],
  }),
}));

export const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, {
    fields: [favorites.userId],
    references: [users.id],
  }),
}));

export const promptTemplatesRelations = relations(promptTemplates, ({ one }) => ({
  user: one(users, {
    fields: [promptTemplates.userId],
    references: [users.id],
  }),
  provider: one(llmProviders, {
    fields: [promptTemplates.providerId],
    references: [llmProviders.id],
  }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const llmProvidersRelations = relations(llmProviders, ({ one }) => ({
  creator: one(users, {
    fields: [llmProviders.createdBy],
    references: [users.id],
  }),
}));

export const rssInstancesRelations = relations(rssInstances, ({ one }) => ({
  creator: one(users, {
    fields: [rssInstances.createdBy],
    references: [users.id],
  }),
}));

// ─── email_verification_codes ────────────────────────────────────────────────
export const emailVerificationCodes = pgTable('email_verification_codes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull(),
  code: text('code').notNull(), // 6位数字验证码
  type: text('type', { enum: ['register'] }).notNull().default('register'),
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { mode: 'date' }), // null = 未使用
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── password_reset_tokens ───────────────────────────────────────────────────
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(), // 重置令牌
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
  usedAt: timestamp('used_at', { mode: 'date' }), // null = 未使用
  createdAt: timestamp('created_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

// ─── smtp_config ─────────────────────────────────────────────────────────────
export const smtpConfig = pgTable('smtp_config', {
  id: text('id').primaryKey().default('default'),
  host: text('host').notNull(), // SMTP 服务器地址
  port: integer('port').notNull().default(465),
  secure: boolean('secure').notNull().default(true), // SSL/TLS
  user: text('user').notNull(), // SMTP 用户名
  password: text('password').notNull(), // SMTP 密码/授权码
  fromEmail: text('from_email'), // 发件人地址
  fromName: text('from_name').default(APP_NAME),
  requireVerification: boolean('require_verification').notNull().default(true), // 注册是否需要邮箱验证码
  provider: text('provider').notNull().default('smtp'), // 'smtp' | 'zeabur' | 'resend' | 'aliyun'
  zeaburApiKey: text('zeabur_api_key'), // Zeabur Email API Key
  resendApiKey: text('resend_api_key'), // Resend API Key
  aliyunDirectMailAccessKeyId: text('aliyun_directmail_access_key_id'), // 阿里云 DirectMail AccessKey ID
  aliyunDirectMailAccessKeySecret: text('aliyun_directmail_access_key_secret'), // 阿里云 DirectMail AccessKey Secret
  aliyunDirectMailRegion: text('aliyun_directmail_region').default('cn-hangzhou'), // 阿里云 DirectMail 区域
  // 可选：用 IP/CNAME 连中继但证书主机名不一致时，设置此字段让 SNI 和 TLS 主机名校验通过
  tlsServername: text('tls_servername'),
  updatedAt: timestamp('updated_at', { mode: 'date' })
    .$defaultFn(() => new Date())
    .notNull(),
});

export const analysisReportsRelations = relations(analysisReports, ({ one }) => ({
  subscription: one(subscriptions, {
    fields: [analysisReports.subscriptionId],
    references: [subscriptions.id],
  }),
  user: one(users, {
    fields: [analysisReports.userId],
    references: [users.id],
  }),
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
  user: one(users, {
    fields: [passwordResetTokens.userId],
    references: [users.id],
  }),
}));
