CREATE TABLE "documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"file_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"structured_data" jsonb,
	"full_content" jsonb,
	"coreference_resolved_content" jsonb,
	"confidence" real,
	"document_type" text NOT NULL,
	"case_number" text,
	"court" text,
	"parties" jsonb,
	"file_hash" text,
	"text_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"extraction_version" integer DEFAULT 1,
	"embedding_version" integer DEFAULT 1,
	"embedding_provider" text,
	"embedding_model" text
);
--> statement-breakpoint
CREATE TABLE "processing_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"details" jsonb
);
--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"embedding" vector(3072),
	"embedding_provider" text,
	"embedding_model" text,
	"chunk_text_hash" text,
	"token_count" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"role" text DEFAULT 'other' NOT NULL,
	"role_confidence" real DEFAULT 0,
	"entity_type" text,
	"mention_count" integer DEFAULT 0,
	"mentions" text[] DEFAULT '{}',
	"cluster_id" integer,
	"relevance_score" real DEFAULT 0,
	"extraction_version" integer DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE "api_key_usages" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" serial NOT NULL,
	"service" text NOT NULL,
	"endpoint" text NOT NULL,
	"method" text NOT NULL,
	"status" integer NOT NULL,
	"response_time_ms" integer NOT NULL,
	"success" boolean NOT NULL,
	"bytes_processed" bigint NOT NULL,
	"credits_used" integer NOT NULL,
	"ip_address" text NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"permission" jsonb NOT NULL,
	"scopes" jsonb,
	"rate_limit" jsonb,
	"expires_at" timestamp NOT NULL,
	"last_used_at" timestamp DEFAULT now(),
	"is_active" boolean DEFAULT true,
	"allowed_ips" text[],
	"allowed_domains" text[]
);
--> statement-breakpoint
CREATE TABLE "api_users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"subscription_tier" text,
	"organization" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "processing_logs" ADD CONSTRAINT "processing_logs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_api_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."api_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_status_idx" ON "documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("document_type");--> statement-breakpoint
CREATE INDEX "documents_case_number_idx" ON "documents" USING btree ("case_number");--> statement-breakpoint
CREATE INDEX "documents_file_hash_idx" ON "documents" USING btree ("file_hash");--> statement-breakpoint
CREATE INDEX "documents_text_hash_idx" ON "documents" USING btree ("text_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_chunks_document_chunk" ON "document_chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "idx_chunks_document_id" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_participants_document_id" ON "participants" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_participants_normalized_name" ON "participants" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "idx_participants_role" ON "participants" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_participants_doc_role" ON "participants" USING btree ("document_id","role");