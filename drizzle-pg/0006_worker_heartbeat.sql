CREATE TABLE "worker_heartbeats" (
  "id" text PRIMARY KEY NOT NULL DEFAULT 'primary',
  "last_heartbeat_at" timestamp NOT NULL,
  "current_job_id" text,
  "updated_at" timestamp NOT NULL
);
