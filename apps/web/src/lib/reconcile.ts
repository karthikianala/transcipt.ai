import { fetchAcks, uploadChunkWithRetry } from "./api";
import {
  clearOpfsSession,
  deleteChunkFromOpfs,
  listOpfsChunkSeqs,
  listOpfsSessions,
  readChunkFromOpfs,
} from "./opfs";

export type ReconcileResult = {
  sessions: number;
  reuploaded: number;
  cleaned: number;
  errors: number;
};

export async function reconcileAllSessions(): Promise<ReconcileResult> {
  const sessions = await listOpfsSessions();
  const result: ReconcileResult = {
    sessions: sessions.length,
    reuploaded: 0,
    cleaned: 0,
    errors: 0,
  };

  for (const sessionId of sessions) {
    const localSeqs = await listOpfsChunkSeqs(sessionId);
    if (localSeqs.length === 0) {
      await clearOpfsSession(sessionId);
      continue;
    }

    let remoteAcks: number[];
    try {
      remoteAcks = await fetchAcks(sessionId);
    } catch {
      result.errors++;
      continue;
    }
    const ackedSet = new Set(remoteAcks);

    for (const seq of localSeqs) {
      if (ackedSet.has(seq)) {
        await deleteChunkFromOpfs(sessionId, seq);
        result.cleaned++;
        continue;
      }
      const blob = await readChunkFromOpfs(sessionId, seq);
      if (!blob) continue;
      try {
        await uploadChunkWithRetry(sessionId, seq, blob);
        await deleteChunkFromOpfs(sessionId, seq);
        result.reuploaded++;
      } catch {
        result.errors++;
      }
    }

    const remaining = await listOpfsChunkSeqs(sessionId);
    if (remaining.length === 0) {
      await clearOpfsSession(sessionId);
    }
  }

  return result;
}
