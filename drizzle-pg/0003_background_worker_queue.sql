CREATE TABLE "background_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "dedupe_key" text NOT NULL,
  "payload" text NOT NULL,
  "available_at" timestamp NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp,
  "finished_at" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "background_jobs_ready_idx" ON "background_jobs" ("status", "available_at", "priority");
--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_active_dedupe_idx"
  ON "background_jobs" ("dedupe_key")
  WHERE "status" IN ('queued', 'running');
