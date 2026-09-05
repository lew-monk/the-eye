CREATE TABLE "cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"case_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"parties" text[],
	"tags" text[],
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
CREATE INDEX "cases_case_number_idx" ON "cases" ("case_number");
--> statement-breakpoint
CREATE INDEX "cases_case_type_idx" ON "cases" ("case_type");
--> statement-breakpoint
CREATE INDEX "cases_status_idx" ON "cases" ("status");
--> statement-breakpoint
CREATE TABLE "case_relations" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_case_id" integer NOT NULL,
	"target_case_id" integer NOT NULL,
	"relation_type" text NOT NULL,
	"entity_name" text,
	"strength" real,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "case_relations_source_idx" ON "case_relations" ("source_case_id");
--> statement-breakpoint
CREATE INDEX "case_relations_target_idx" ON "case_relations" ("target_case_id");
--> statement-breakpoint
ALTER TABLE "case_relations" ADD CONSTRAINT "case_relations_source_case_id_cases_id_fk" FOREIGN KEY ("source_case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "case_relations" ADD CONSTRAINT "case_relations_target_case_id_cases_id_fk" FOREIGN KEY ("target_case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "case_id" integer;
--> statement-breakpoint
CREATE INDEX "documents_case_id_idx" ON "documents" ("case_id");
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;
