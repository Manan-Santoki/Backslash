-- Initial database setup for Backslash
-- This file runs when the PostgreSQL container is first created.
--
-- NOTE: All table/type/index DDL is managed by Drizzle ORM migrations
-- which run automatically when the app starts. This file should only
-- contain extensions or other DB-level setup.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
