CREATE TABLE IF NOT EXISTS "ingestion_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"collection" text DEFAULT 'judgments' NOT NULL,
	"source" text NOT NULL,
	"root" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"done_files" integer DEFAULT 0 NOT NULL,
	"failed_files" integer DEFAULT 0 NOT NULL,
	"total_bytes" integer DEFAULT 0 NOT NULL,
	"transferred_bytes" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ingestion_jobs_status_idx" ON "ingestion_jobs" ("status");
CREATE INDEX IF NOT EXISTS "ingestion_jobs_collection_idx" ON "ingestion_jobs" ("collection");
