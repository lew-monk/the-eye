ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "storage_key" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "storage_bucket" text;
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "content_type" text;
