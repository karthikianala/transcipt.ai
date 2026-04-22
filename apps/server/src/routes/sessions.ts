import { db, schema } from "@my-better-t-app/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { chunkExists } from "../lib/storage";
import { runTranscriptionJob } from "../lib/transcribe";

const app = new Hono();

function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

app.post("/", async (c) => {
  const id = makeId("sess");
  await db.insert(schema.sessions).values({ id });
  return c.json({ sessionId: id });
});

app.get("/:id/acks", async (c) => {
  const sessionId = c.req.param("id");
  const rows = await db
    .select({ seq: schema.chunks.seq })
    .from(schema.chunks)
    .where(
      and(
        eq(schema.chunks.sessionId, sessionId),
        eq(schema.chunks.status, "acked"),
      ),
    );
  const verified: number[] = [];
  for (const row of rows) {
    if (await chunkExists(sessionId, row.seq)) {
      verified.push(row.seq);
    }
  }
  return c.json({ sessionId, acks: verified });
});

app.post("/:id/finalize", async (c) => {
  const sessionId = c.req.param("id");
  const session = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (session.length === 0) {
    return c.json({ error: "session not found" }, 404);
  }

  await db
    .update(schema.sessions)
    .set({ finalizedAt: new Date() })
    .where(eq(schema.sessions.id, sessionId));

  const existing = await db
    .select()
    .from(schema.transcripts)
    .where(eq(schema.transcripts.sessionId, sessionId))
    .limit(1);

  let transcriptId: string;
  if (existing.length > 0 && existing[0]) {
    transcriptId = existing[0].id;
    await db
      .update(schema.transcripts)
      .set({ status: "queued", error: null, completedAt: null })
      .where(eq(schema.transcripts.id, transcriptId));
  } else {
    transcriptId = makeId("trx");
    await db.insert(schema.transcripts).values({
      id: transcriptId,
      sessionId,
      status: "queued",
    });
  }

  queueMicrotask(() => {
    runTranscriptionJob(sessionId, transcriptId);
  });

  return c.json({ transcriptId, status: "queued" });
});

app.get("/:id/transcript", async (c) => {
  const sessionId = c.req.param("id");
  const rows = await db
    .select()
    .from(schema.transcripts)
    .where(eq(schema.transcripts.sessionId, sessionId))
    .limit(1);
  if (rows.length === 0 || !rows[0]) {
    return c.json({ status: "none" });
  }
  const t = rows[0];
  const segments = t.segmentsJson ? JSON.parse(t.segmentsJson) : [];
  return c.json({
    id: t.id,
    status: t.status,
    text: t.text ?? "",
    segments,
    error: t.error,
  });
});

export default app;
