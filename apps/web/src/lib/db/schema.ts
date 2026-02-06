import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ──────────────────────────────────────────

export const engineEnum = pgEnum("engine", [
  "pdflatex",
  "xelatex",
  "lualatex",
  "latex",
]);

export const buildStatusEnum = pgEnum("build_status", [
  "queued",
  "compiling",
  "success",
  "error",
  "timeout",
]);

// ─── Users ──────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)]
);

// ─── Sessions ───────────────────────────────────────

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sessions_token_idx").on(table.token),
    index("sessions_user_idx").on(table.userId),
  ]
);

// ─── Projects ───────────────────────────────────────

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description").default(""),
    engine: engineEnum("engine").default("pdflatex").notNull(),
    mainFile: varchar("main_file", { length: 500 })
      .default("main.tex")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("projects_user_idx").on(table.userId)]
);

// ─── Project Files ──────────────────────────────────

export const projectFiles = pgTable(
  "project_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: varchar("path", { length: 1000 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).default("text/plain"),
    sizeBytes: integer("size_bytes").default(0),
    isDirectory: boolean("is_directory").default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("files_project_path_idx").on(table.projectId, table.path),
    index("files_project_idx").on(table.projectId),
  ]
);

// ─── Builds ─────────────────────────────────────────

export const builds = pgTable(
  "builds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: buildStatusEnum("status").default("queued").notNull(),
    engine: engineEnum("engine").notNull(),
    logs: text("logs").default(""),
    durationMs: integer("duration_ms"),
    pdfPath: varchar("pdf_path", { length: 1000 }),
    exitCode: integer("exit_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
  },
  (table) => [
    index("builds_project_idx").on(table.projectId),
    index("builds_user_idx").on(table.userId),
    index("builds_status_idx").on(table.status),
  ]
);

// ─── Relations ──────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  sessions: many(sessions),
  builds: many(builds),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, { fields: [projects.userId], references: [users.id] }),
  files: many(projectFiles),
  builds: many(builds),
}));

export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  project: one(projects, {
    fields: [projectFiles.projectId],
    references: [projects.id],
  }),
}));

export const buildsRelations = relations(builds, ({ one }) => ({
  project: one(projects, {
    fields: [builds.projectId],
    references: [projects.id],
  }),
  user: one(users, { fields: [builds.userId], references: [users.id] }),
}));
