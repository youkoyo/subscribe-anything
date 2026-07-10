CREATE TABLE "collection_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"level" text NOT NULL,
	"event" text NOT NULL,
	"message" text NOT NULL,
	"payload" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_logs" ADD CONSTRAINT "collection_logs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_logs_source_id_idx" ON "collection_logs" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "collection_logs_created_at_idx" ON "collection_logs" USING btree ("created_at");