import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_ROOT = path.resolve(packageDir, "../../storage");

export function chunkPath(sessionId: string, seq: number): string {
  return path.join(STORAGE_ROOT, sessionId, `${seq}.wav`);
}

export async function writeChunk(
  sessionId: string,
  seq: number,
  data: Buffer,
): Promise<string> {
  const dir = path.join(STORAGE_ROOT, sessionId);
  await fs.mkdir(dir, { recursive: true });
  const p = chunkPath(sessionId, seq);
  await fs.writeFile(p, data);
  return p;
}

export async function readChunk(
  sessionId: string,
  seq: number,
): Promise<Buffer | null> {
  try {
    return await fs.readFile(chunkPath(sessionId, seq));
  } catch {
    return null;
  }
}

export async function chunkExists(
  sessionId: string,
  seq: number,
): Promise<boolean> {
  try {
    await fs.access(chunkPath(sessionId, seq));
    return true;
  } catch {
    return false;
  }
}

export async function listSessionChunkSeqs(
  sessionId: string,
): Promise<number[]> {
  try {
    const files = await fs.readdir(path.join(STORAGE_ROOT, sessionId));
    return files
      .filter((f) => f.endsWith(".wav"))
      .map((f) => Number.parseInt(f.replace(".wav", ""), 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export { STORAGE_ROOT };
