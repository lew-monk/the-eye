ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "section" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN IF NOT EXISTS "chunk_uid" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_chunks_chunk_uid" ON "document_chunks" USING btree ("chunk_uid");
