ALTER TABLE "project_shares" ADD COLUMN IF NOT EXISTS "expires_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shares_expires_idx" ON "project_shares" USING btree ("expires_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_public_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"role" "share_role" DEFAULT 'viewer' NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_public_shares" ADD CONSTRAINT "project_public_shares_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_shares_project_idx" ON "project_public_shares" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_shares_expires_idx" ON "project_public_shares" USING btree ("expires_at");
