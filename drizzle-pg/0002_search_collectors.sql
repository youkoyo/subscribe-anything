-- Maintenance window required: ALTER, backfill, and index locks are held until transaction commit.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
SET LOCAL statement_timeout = '10min';
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "collector_type" text DEFAULT 'feed_script' NOT NULL;
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "collector_config_json" text DEFAULT '{}' NOT NULL;
--> statement-breakpoint
ALTER TABLE "message_cards" ADD COLUMN "dedupe_key" text;
--> statement-breakpoint
ALTER TABLE "message_cards" ADD COLUMN "canonical_url" text;
--> statement-breakpoint
ALTER TABLE "message_cards" ADD COLUMN "publisher_name" text;
--> statement-breakpoint
ALTER TABLE "message_cards" ADD COLUMN "collection_method" text;
--> statement-breakpoint
ALTER TABLE "message_cards" ADD COLUMN "evidence_level" text;
--> statement-breakpoint
ALTER TABLE "message_cards" ADD COLUMN "relevance_score" real;
--> statement-breakpoint
ALTER TABLE "message_cards" ADD COLUMN "authority_score" real;
--> statement-breakpoint
ALTER TABLE "message_cards" ADD COLUMN "match_reason" text;
--> statement-breakpoint
UPDATE "message_cards"
SET "dedupe_key" = 'legacy:' || "id"
WHERE "dedupe_key" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "message_cards_subscription_dedupe_key_unique"
ON "message_cards" ("subscription_id", "dedupe_key");
