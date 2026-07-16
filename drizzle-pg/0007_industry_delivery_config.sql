CREATE TABLE "industry_delivery_config" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "cron" text DEFAULT '0 9 * * *' NOT NULL,
  "timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
  "updated_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

INSERT INTO "industry_delivery_config" ("id", "cron", "timezone", "updated_at")
SELECT
  'default',
  COALESCE((SELECT "delivery_cron" FROM "industry_configs" WHERE "delivery_enabled" = true AND "delivery_cron" IS NOT NULL ORDER BY "updated_at" DESC LIMIT 1), '0 9 * * *'),
  COALESCE((SELECT "delivery_timezone" FROM "industry_configs" WHERE "delivery_enabled" = true AND "delivery_cron" IS NOT NULL ORDER BY "updated_at" DESC LIMIT 1), 'Asia/Shanghai'),
  now()
ON CONFLICT ("id") DO NOTHING;
