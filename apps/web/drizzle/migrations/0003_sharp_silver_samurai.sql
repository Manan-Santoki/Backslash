ALTER TABLE "project_public_shares" ADD COLUMN IF NOT EXISTS "token" varchar(128);--> statement-breakpoint
UPDATE "project_public_shares"
SET "token" = "id"::text
WHERE "token" IS NULL;--> statement-breakpoint
ALTER TABLE "project_public_shares" ALTER COLUMN "token" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_shares_token_idx" ON "project_public_shares" USING btree ("token");
