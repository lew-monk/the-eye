CREATE TABLE IF NOT EXISTS "coreference_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
	"resolved_text" text,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"source_text_hash" text,
	"processed_at" timestamp,
	"processing_time_ms" integer,
	"input_char_count" integer,
	"chunked" boolean,
	"chunk_size" integer,
	"chunk_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coreference_clusters" (
	"id" serial PRIMARY KEY NOT NULL,
	"result_id" integer NOT NULL REFERENCES "coreference_results"("id") ON DELETE CASCADE,
	"cluster_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coreference_mentions" (
	"id" serial PRIMARY KEY NOT NULL,
	"cluster_id" integer NOT NULL REFERENCES "coreference_clusters"("id") ON DELETE CASCADE,
	"text" text NOT NULL,
	"start_pos" integer NOT NULL,
	"end_pos" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coref_results_document_id" ON "coreference_results" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coref_clusters_result_id" ON "coreference_clusters" ("result_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_coref_mentions_cluster_id" ON "coreference_mentions" ("cluster_id");