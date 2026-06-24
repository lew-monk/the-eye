ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_user_id_api_users_id_fk";
--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "user_id" SET DATA TYPE text;