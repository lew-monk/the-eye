ALTER TABLE "judgment_documents" ADD COLUMN IF NOT EXISTS "collection" text DEFAULT 'judgments' NOT NULL;
CREATE INDEX IF NOT EXISTS "judgment_documents_collection_idx" ON "judgment_documents" ("collection");
