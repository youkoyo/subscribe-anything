CREATE TABLE "managed_llm_calls" (
  "id" text PRIMARY KEY NOT NULL,
  "subscription_id" text NOT NULL REFERENCES "subscriptions"("id") ON DELETE CASCADE,
  "source_url" text DEFAULT '' NOT NULL,
  "call_index" integer NOT NULL,
  "payload" text NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "managed_llm_calls_identity_idx"
  ON "managed_llm_calls" ("subscription_id", "source_url", "call_index");
--> statement-breakpoint
CREATE INDEX "managed_llm_calls_subscription_updated_idx"
  ON "managed_llm_calls" ("subscription_id", "updated_at");
