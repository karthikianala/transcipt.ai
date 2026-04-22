import { db, schema } from "@my-better-t-app/db";
import { eq } from "drizzle-orm";
import {
  createTranscript,
  getTranscript,
  toSegments,
  uploadAudio,
} from "./assemblyai";
import { listSessionChunkSeqs, readChunk } from "./storage";
import { concatWav } from "./wav";

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 10 * 60 * 1000;

async function pollUntilDone(
  transcriptId: string,
  jobId: string,
): Promise<void> {
  const deadline = Date.now() + MAX_POLL_MS;
  while (Date.now() < deadline) {
    const job = await getTranscript(jobId);
    if (job.status === "completed") {
      await db
        .update(schema.transcripts)
        .set({
          status: "done",
          text: job.text ?? "",
          segmentsJson: JSON.stringify(toSegments(job)),
          completedAt: new Date(),
        })
        .where(eq(schema.transcripts.id, transcriptId));
      return;
    }
    if (job.status === "error") {
      await db
        .update(schema.transcripts)
        .set({
          status: "failed",
          error: job.error ?? "unknown error",
          completedAt: new Date(),
        })
        .where(eq(schema.transcripts.id, transcriptId));
      return;
    }
    await db
      .update(schema.transcripts)
      .set({ status: "processing" })
      .where(eq(schema.transcripts.id, transcriptId));
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  await db
    .update(schema.transcripts)
    .set({
      status: "failed",
      error: "timeout waiting for transcription",
      completedAt: new Date(),
    })
    .where(eq(schema.transcripts.id, transcriptId));
}

export async function runTranscriptionJob(
  sessionId: string,
  transcriptId: string,
): Promise<void> {
  try {
    const seqs = await listSessionChunkSeqs(sessionId);
    if (seqs.length === 0) {
      throw new Error("no chunks found for session");
    }
    const parts: Buffer[] = [];
    for (const seq of seqs) {
      const buf = await readChunk(sessionId, seq);
      if (!buf) throw new Error(`missing chunk seq=${seq}`);
      parts.push(buf);
    }
    const merged = concatWav(parts);
    const uploadUrl = await uploadAudio(merged);
    const jobId = await createTranscript(uploadUrl);
    await db
      .update(schema.transcripts)
      .set({ providerJobId: jobId, status: "processing" })
      .where(eq(schema.transcripts.id, transcriptId));
    await pollUntilDone(transcriptId, jobId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(schema.transcripts)
      .set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      })
      .where(eq(schema.transcripts.id, transcriptId));
  }
}
