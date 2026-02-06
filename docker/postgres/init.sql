-- Initial database setup for Backslash
-- This file runs when the PostgreSQL container is first created

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ───────────────────────────────────────────

CREATE TYPE "public"."build_status" AS ENUM('queued', 'compiling', 'success', 'error', 'timeout');
CREATE TYPE "public"."engine" AS ENUM('pdflatex', 'xelatex', 'lualatex', 'latex');

-- ── Tables ──────────────────────────────────────────

CREATE TABLE "users" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "email" varchar(255) NOT NULL,
    "name" varchar(255) NOT NULL,
    "password_hash" text NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "sessions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "token" text NOT NULL,
    "expires_at" timestamp NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "projects" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "name" varchar(255) NOT NULL,
    "description" text DEFAULT '',
    "engine" "engine" DEFAULT 'pdflatex' NOT NULL,
    "main_file" varchar(500) DEFAULT 'main.tex' NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "project_files" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL,
    "path" varchar(1000) NOT NULL,
    "mime_type" varchar(100) DEFAULT 'text/plain',
    "size_bytes" integer DEFAULT 0,
    "is_directory" boolean DEFAULT false,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "builds" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "project_id" uuid NOT NULL,
    "user_id" uuid NOT NULL,
    "status" "build_status" DEFAULT 'queued' NOT NULL,
    "engine" "engine" NOT NULL,
    "logs" text DEFAULT '',
    "duration_ms" integer,
    "pdf_path" varchar(1000),
    "exit_code" integer,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "completed_at" timestamp
);

CREATE TABLE "api_keys" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "user_id" uuid NOT NULL,
    "name" varchar(255) NOT NULL,
    "key_hash" text NOT NULL,
    "key_prefix" varchar(12) NOT NULL,
    "last_used_at" timestamp,
    "request_count" bigint DEFAULT 0 NOT NULL,
    "expires_at" timestamp,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- ── Foreign Keys ────────────────────────────────────

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "builds" ADD CONSTRAINT "builds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;

-- ── Indexes ─────────────────────────────────────────

CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");
CREATE INDEX "projects_user_idx" ON "projects" USING btree ("user_id");
CREATE UNIQUE INDEX "files_project_path_idx" ON "project_files" USING btree ("project_id","path");
CREATE INDEX "files_project_idx" ON "project_files" USING btree ("project_id");
CREATE INDEX "builds_project_idx" ON "builds" USING btree ("project_id");
CREATE INDEX "builds_user_idx" ON "builds" USING btree ("user_id");
CREATE INDEX "builds_status_idx" ON "builds" USING btree ("status");
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");
CREATE UNIQUE INDEX "api_keys_hash_idx" ON "api_keys" USING btree ("key_hash");
