CREATE TABLE "discovery_source_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"feed_url" text NOT NULL,
	"feed_provider" text NOT NULL,
	"original_category" text NOT NULL,
	"preferences_json" text DEFAULT '[]' NOT NULL,
	"trust_level" text NOT NULL,
	"default_usage" text NOT NULL,
	"topic_tags_json" text DEFAULT '[]' NOT NULL,
	"keywords_json" text DEFAULT '[]' NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"health_status" text DEFAULT 'unknown' NOT NULL,
	"last_validated_at" timestamp,
	"last_validation_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	CONSTRAINT "discovery_source_catalog_feed_url_unique" UNIQUE("feed_url")
);
--> statement-breakpoint
ALTER TABLE "industry_configs" ADD COLUMN "source_preferences_json" text DEFAULT '["authoritative","mainstream"]' NOT NULL;--> statement-breakpoint
ALTER TABLE "industry_configs" ADD COLUMN "allow_ai_discovery_fallback" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "catalog_source_id" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "discovery_origin" text;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "collection_strategy" text;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_catalog_source_id_discovery_source_catalog_id_fk" FOREIGN KEY ("catalog_source_id") REFERENCES "public"."discovery_source_catalog"("id") ON DELETE set null ON UPDATE no action;