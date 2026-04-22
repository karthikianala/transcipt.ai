import { db, schema } from "@my-better-t-app/db";
import { Hono } from "hono";
import { writeChunk } from "../lib/storage";

const app = new Hono();

app.post("/upload", async (c) => {
  const form = await c.req.formData();
  const sessionId = form.get("sessionId");
  const seqRaw = form.get("seq");
  const file = form.get("chunk");

  if (typeof sessionId !== "string" || !sessionId) {
    return c.json({ error: "missing sessionId" }, 400);
  }
  if (typeof seqRaw !== "string") {
    return c.json({ error: "missing seq" }, 400);
  }
  const seq = Number.parseInt(seqRaw, 10);
  if (Number.isNaN(seq) || seq < 0) {
    return c.json({ error: "invalid seq" }, 400);
  }
  if (!(file instanceof File)) {
    return c.json({ error: "missing chunk file" }, 400);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const storagePath = await writeChunk(sessionId, seq, buffer);

  const chunkId = `${sessionId}:${seq}`;
  const now = new Date();
  await db
    .insert(schema.chunks)
    .values({
      id: chunkId,
      sessionId,
      seq,
      size: buffer.length,
      storagePath,
      status: "acked",
      ackedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.chunks.id,
      set: {
        size: buffer.length,
        storagePath,
        status: "acked",
        ackedAt: now,
      },
    });

  return c.json({ ok: true, seq, size: buffer.length });
});

export default app;
