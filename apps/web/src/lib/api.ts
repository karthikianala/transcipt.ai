const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";

export type TranscriptSegment = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export type TranscriptState = {
  id?: string;
  status: "none" | "queued" | "processing" | "done" | "failed";
  text?: string;
  segments?: TranscriptSegment[];
  error?: string | null;
};

export async function createSession(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/api/sessions`, { method: "POST" });
  if (!res.ok) throw new Error(`createSession failed: ${res.status}`);
  const { sessionId } = (await res.json()) as { sessionId: string };
  return sessionId;
}

export async function uploadChunk(
  sessionId: string,
  seq: number,
  blob: Blob,
): Promise<void> {
  const form = new FormData();
  form.append("sessionId", sessionId);
  form.append("seq", String(seq));
  form.append("chunk", new File([blob], `${seq}.wav`, { type: "audio/wav" }));
  const res = await fetch(`${SERVER_URL}/api/chunks/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`uploadChunk failed: ${res.status}`);
  }
}

export async function uploadChunkWithRetry(
  sessionId: string,
  seq: number,
  blob: Blob,
  maxAttempts = 3,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await uploadChunk(sessionId, seq, blob);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }
  throw lastErr;
}

export async function fetchAcks(sessionId: string): Promise<number[]> {
  const res = await fetch(
    `${SERVER_URL}/api/sessions/${sessionId}/acks`,
  );
  if (!res.ok) throw new Error(`fetchAcks failed: ${res.status}`);
  const { acks } = (await res.json()) as { acks: number[] };
  return acks;
}

export async function finalizeSession(sessionId: string): Promise<string> {
  const res = await fetch(
    `${SERVER_URL}/api/sessions/${sessionId}/finalize`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`finalize failed: ${res.status}`);
  const { transcriptId } = (await res.json()) as { transcriptId: string };
  return transcriptId;
}

export async function fetchTranscript(
  sessionId: string,
): Promise<TranscriptState> {
  const res = await fetch(
    `${SERVER_URL}/api/sessions/${sessionId}/transcript`,
  );
  if (!res.ok) throw new Error(`fetchTranscript failed: ${res.status}`);
  return (await res.json()) as TranscriptState;
}
