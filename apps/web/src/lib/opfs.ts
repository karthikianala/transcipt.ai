const CHUNKS_DIR = "chunks";

async function chunksRoot(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(CHUNKS_DIR, { create: true });
}

async function sessionDir(
  sessionId: string,
  create = false,
): Promise<FileSystemDirectoryHandle> {
  const root = await chunksRoot();
  return root.getDirectoryHandle(sessionId, { create });
}

export async function writeChunkToOpfs(
  sessionId: string,
  seq: number,
  blob: Blob,
): Promise<void> {
  const dir = await sessionDir(sessionId, true);
  const file = await dir.getFileHandle(`${seq}.wav`, { create: true });
  const writable = await file.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function readChunkFromOpfs(
  sessionId: string,
  seq: number,
): Promise<Blob | null> {
  try {
    const dir = await sessionDir(sessionId);
    const file = await dir.getFileHandle(`${seq}.wav`);
    return await file.getFile();
  } catch {
    return null;
  }
}

export async function deleteChunkFromOpfs(
  sessionId: string,
  seq: number,
): Promise<void> {
  try {
    const dir = await sessionDir(sessionId);
    await dir.removeEntry(`${seq}.wav`);
  } catch {
    // noop
  }
}

export async function listOpfsSessions(): Promise<string[]> {
  try {
    const root = await chunksRoot();
    const sessions: string[] = [];
    const iter = (
      root as unknown as {
        values: () => AsyncIterable<FileSystemHandle>;
      }
    ).values();
    for await (const entry of iter) {
      if (entry.kind === "directory") sessions.push(entry.name);
    }
    return sessions;
  } catch {
    return [];
  }
}

export async function listOpfsChunkSeqs(sessionId: string): Promise<number[]> {
  try {
    const dir = await sessionDir(sessionId);
    const seqs: number[] = [];
    const iter = (
      dir as unknown as {
        values: () => AsyncIterable<FileSystemHandle>;
      }
    ).values();
    for await (const entry of iter) {
      if (entry.kind === "file" && entry.name.endsWith(".wav")) {
        const seq = Number.parseInt(entry.name.replace(".wav", ""), 10);
        if (!Number.isNaN(seq)) seqs.push(seq);
      }
    }
    return seqs.sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export async function clearOpfsSession(sessionId: string): Promise<void> {
  try {
    const root = await chunksRoot();
    await root.removeEntry(sessionId, { recursive: true });
  } catch {
    // noop
  }
}
