import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  finalizedAt: integer("finalized_at", { mode: "timestamp_ms" }),
  durationMs: integer("duration_ms"),
});

export const chunks = sqliteTable("chunks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256"),
  status: text("status", { enum: ["pending", "uploaded", "acked"] })
    .notNull()
    .default("pending"),
  storagePath: text("storage_path").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  ackedAt: integer("acked_at", { mode: "timestamp_ms" }),
});

export const transcripts = sqliteTable("transcripts", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  status: text("status", {
    enum: ["queued", "processing", "done", "failed"],
  })
    .notNull()
    .default("queued"),
  providerJobId: text("provider_job_id"),
  text: text("text"),
  segmentsJson: text("segments_json"),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
});

export type Session = typeof sessions.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type Transcript = typeof transcripts.$inferSelect;
