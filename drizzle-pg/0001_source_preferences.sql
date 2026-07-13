CREATE TABLE "source_preferences" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "source_type" text DEFAULT 'general_news' NOT NULL,
  "priority" text DEFAULT 'preferred' NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "created_by" text,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL,
  CONSTRAINT "source_preferences_url_unique" UNIQUE("url")
);
--> statement-breakpoint
ALTER TABLE "source_preferences" ADD CONSTRAINT "source_preferences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
