CREATE TABLE "firecrawl_config" (
  "id" text PRIMARY KEY NOT NULL,
  "api_key" text DEFAULT '' NOT NULL,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL
);
