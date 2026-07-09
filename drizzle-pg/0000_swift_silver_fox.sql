CREATE TABLE "analysis_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"html_content" text DEFAULT '' NOT NULL,
	"card_count" integer DEFAULT 0 NOT NULL,
	"is_starred" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'completed' NOT NULL,
	"error" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_verification_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL,
	"type" text DEFAULT 'register' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"original_card_id" text,
	"title" text NOT NULL,
	"summary" text,
	"thumbnail_url" text,
	"source_url" text NOT NULL,
	"published_at" timestamp,
	"meets_criteria_flag" boolean DEFAULT false NOT NULL,
	"criteria_result" text,
	"metric_value" text,
	"subscription_topic" text,
	"source_title" text,
	"favorite_at" timestamp NOT NULL,
	"is_favorite" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_configs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"sub_category" text,
	"description" text,
	"keywords_json" text DEFAULT '[]' NOT NULL,
	"risk_terms_json" text DEFAULT '[]' NOT NULL,
	"regions_json" text DEFAULT '[]' NOT NULL,
	"entities_json" text DEFAULT '[]' NOT NULL,
	"source_types_json" text DEFAULT '[]' NOT NULL,
	"alert_level" text DEFAULT '一般关注' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"visibility" text DEFAULT 'draft' NOT NULL,
	"subscription_mode" text DEFAULT 'open' NOT NULL,
	"auto_profile_expansion" boolean DEFAULT false NOT NULL,
	"delivery_cron" text,
	"delivery_timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"delivery_enabled" boolean DEFAULT false NOT NULL,
	"max_items_per_email" integer DEFAULT 10 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_delivery_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"industry_config_id" text NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp NOT NULL,
	"finished_at" timestamp,
	"error" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "industry_monitoring_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"industry_config_id" text NOT NULL,
	"title" text NOT NULL,
	"seed_criteria" text NOT NULL,
	"criteria_summary" text,
	"keywords_json" text DEFAULT '[]' NOT NULL,
	"target_entities_json" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"shared_subscription_id" text,
	"triggered_by_user_id" text,
	"requires_admin_approval" boolean DEFAULT false NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"last_provisioned_at" timestamp,
	"provisioning_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key" text NOT NULL,
	"model_id" text NOT NULL,
	"headers" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"total_tokens_used" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managed_build_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"step" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"payload" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"source_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"thumbnail_url" text,
	"source_url" text NOT NULL,
	"published_at" timestamp,
	"meets_criteria_flag" boolean DEFAULT false NOT NULL,
	"criteria_result" text,
	"metric_value" text,
	"read_at" timestamp,
	"raw_data" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"subscription_id" text,
	"related_entity_type" text,
	"related_entity_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_config" (
	"id" text PRIMARY KEY DEFAULT 'google' NOT NULL,
	"client_id" text DEFAULT '' NOT NULL,
	"client_secret" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"state" text NOT NULL,
	"redirect_url" text,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"content" text NOT NULL,
	"default_content" text NOT NULL,
	"provider_id" text,
	"user_id" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rss_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_provider_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"provider" text DEFAULT 'none' NOT NULL,
	"api_key" text DEFAULT '' NOT NULL,
	"created_by" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "smtp_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 465 NOT NULL,
	"secure" boolean DEFAULT true NOT NULL,
	"user" text NOT NULL,
	"password" text NOT NULL,
	"from_email" text,
	"from_name" text DEFAULT '星云棱镜产业信息订阅平台',
	"require_verification" boolean DEFAULT true NOT NULL,
	"provider" text DEFAULT 'smtp' NOT NULL,
	"zeabur_api_key" text,
	"resend_api_key" text,
	"aliyun_directmail_access_key_id" text,
	"aliyun_directmail_access_key_secret" text,
	"aliyun_directmail_region" text DEFAULT 'cn-hangzhou',
	"tls_servername" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"url" text NOT NULL,
	"script" text DEFAULT '' NOT NULL,
	"cron_expression" text DEFAULT '0 * * * *' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_run_at" timestamp,
	"last_run_success" boolean,
	"last_error" text,
	"next_run_at" timestamp,
	"total_runs" integer DEFAULT 0 NOT NULL,
	"success_runs" integer DEFAULT 0 NOT NULL,
	"items_collected" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"topic" text NOT NULL,
	"criteria" text,
	"industry_config_id" text,
	"industry_config_snapshot" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"last_updated_at" timestamp,
	"managed_status" text,
	"managed_error" text,
	"wizard_state_json" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_delivery_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_industry_subscription_id" text NOT NULL,
	"user_id" text NOT NULL,
	"recipient_emails_json" text DEFAULT '[]' NOT NULL,
	"selected_card_ids_json" text DEFAULT '[]' NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"sent_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_industry_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"industry_config_id" text NOT NULL,
	"monitoring_profile_id" text,
	"status" text DEFAULT 'pending_profile' NOT NULL,
	"custom_criteria" text NOT NULL,
	"recipient_emails_json" text DEFAULT '[]' NOT NULL,
	"approval_reason" text,
	"last_delivered_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"password_hash" text,
	"name" text,
	"avatar_url" text,
	"google_id" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_guest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
ALTER TABLE "analysis_reports" ADD CONSTRAINT "analysis_reports_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_reports" ADD CONSTRAINT "analysis_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_configs" ADD CONSTRAINT "industry_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_configs" ADD CONSTRAINT "industry_configs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_delivery_runs" ADD CONSTRAINT "industry_delivery_runs_industry_config_id_industry_configs_id_fk" FOREIGN KEY ("industry_config_id") REFERENCES "public"."industry_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_monitoring_profiles" ADD CONSTRAINT "industry_monitoring_profiles_industry_config_id_industry_configs_id_fk" FOREIGN KEY ("industry_config_id") REFERENCES "public"."industry_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_monitoring_profiles" ADD CONSTRAINT "industry_monitoring_profiles_shared_subscription_id_subscriptions_id_fk" FOREIGN KEY ("shared_subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_monitoring_profiles" ADD CONSTRAINT "industry_monitoring_profiles_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "industry_monitoring_profiles" ADD CONSTRAINT "industry_monitoring_profiles_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "managed_build_logs" ADD CONSTRAINT "managed_build_logs_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_cards" ADD CONSTRAINT "message_cards_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_cards" ADD CONSTRAINT "message_cards_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_provider_id_llm_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."llm_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rss_instances" ADD CONSTRAINT "rss_instances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_provider_config" ADD CONSTRAINT "search_provider_config_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_industry_config_id_industry_configs_id_fk" FOREIGN KEY ("industry_config_id") REFERENCES "public"."industry_configs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_delivery_logs" ADD CONSTRAINT "user_delivery_logs_run_id_industry_delivery_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."industry_delivery_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_delivery_logs" ADD CONSTRAINT "user_delivery_logs_user_industry_subscription_id_user_industry_subscriptions_id_fk" FOREIGN KEY ("user_industry_subscription_id") REFERENCES "public"."user_industry_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_delivery_logs" ADD CONSTRAINT "user_delivery_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_industry_subscriptions" ADD CONSTRAINT "user_industry_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_industry_subscriptions" ADD CONSTRAINT "user_industry_subscriptions_industry_config_id_industry_configs_id_fk" FOREIGN KEY ("industry_config_id") REFERENCES "public"."industry_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_industry_subscriptions" ADD CONSTRAINT "user_industry_subscriptions_monitoring_profile_id_industry_monitoring_profiles_id_fk" FOREIGN KEY ("monitoring_profile_id") REFERENCES "public"."industry_monitoring_profiles"("id") ON DELETE set null ON UPDATE no action;