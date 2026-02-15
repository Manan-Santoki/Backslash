DO $$ BEGIN
  ALTER TYPE "build_status" ADD VALUE IF NOT EXISTS 'timeout';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "build_status" ADD VALUE IF NOT EXISTS 'canceled';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TYPE "engine" ADD VALUE IF NOT EXISTS 'auto';
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "engine" SET DEFAULT 'auto';
