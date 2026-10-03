CREATE TABLE IF NOT EXISTS "judgment_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"relative_path" text NOT NULL,
	"filename" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"storage_key" text,
	"storage_bucket" text,
	"status" text DEFAULT 'discovered' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"bytes_transferred" integer DEFAULT 0 NOT NULL,
	"ocr_text" text,
	"summary" text,
	"case_id" integer REFERENCES "cases"("id") ON DELETE SET NULL,
	"job_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "judgment_documents_checksum_unique" UNIQUE("checksum")
);
CREATE UNIQUE INDEX IF NOT EXISTS "judgment_documents_checksum_uidx" ON "judgment_documents" ("checksum");
CREATE INDEX IF NOT EXISTS "judgment_documents_status_idx" ON "judgment_documents" ("status");
CREATE INDEX IF NOT EXISTS "judgment_documents_source_idx" ON "judgment_documents" ("source");
CREATE INDEX IF NOT EXISTS "judgment_documents_job_idx" ON "judgment_documents" ("job_id");
CREATE INDEX IF NOT EXISTS "judgment_documents_case_idx" ON "judgment_documents" ("case_id");

CREATE TABLE IF NOT EXISTS "judgment_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"judgment_id" integer NOT NULL REFERENCES "judgment_documents"("id") ON DELETE CASCADE,
	"text" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"embedding" vector(3072),
	"embedding_provider" text,
	"embedding_model" text,
	"embedding_dimensions" integer,
	"text_hash" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_judgment_chunks_doc_chunk" ON "judgment_chunks" ("judgment_id", "chunk_index");
CREATE INDEX IF NOT EXISTS "idx_judgment_chunks_judgment_id" ON "judgment_chunks" ("judgment_id");
CREATE INDEX IF NOT EXISTS "idx_judgment_chunks_embedding_model" ON "judgment_chunks" ("embedding_model");
