ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "embedding_dimensions" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "parent_chunk_index" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "ocr_confidence" real;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "superseded_by" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chunks_embedding_model" ON "document_chunks" USING btree ("embedding_model");--> statement-breakpoint
-- HNSW over the fixed pgvector typmod (vector(3072)). Trailing zeros from
-- same-model padding do not change cosine; filter embedding_model at query time.
CREATE INDEX IF NOT EXISTS "idx_chunks_embedding_hnsw"
	ON "document_chunks"
	USING hnsw ("embedding" vector_cosine_ops)
	WITH (m = 16, ef_construction = 200);
