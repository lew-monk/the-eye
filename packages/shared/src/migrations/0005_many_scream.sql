ALTER TABLE "documents" ADD COLUMN "normalized_text" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "text" text NOT NULL;
