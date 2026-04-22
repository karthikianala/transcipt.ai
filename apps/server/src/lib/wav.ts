const WAV_HEADER_SIZE = 44;
const RIFF_SIZE_OFFSET = 4;
const DATA_SIZE_OFFSET = 40;

export function concatWav(parts: Buffer[]): Buffer {
  if (parts.length === 0) {
    throw new Error("concatWav: no parts provided");
  }
  if (parts.length === 1) {
    return parts[0] as Buffer;
  }

  const firstHeader = (parts[0] as Buffer).subarray(0, WAV_HEADER_SIZE);
  const pcmParts = parts.map((p) => p.subarray(WAV_HEADER_SIZE));
  const totalPcm = pcmParts.reduce((n, p) => n + p.length, 0);

  const out = Buffer.alloc(WAV_HEADER_SIZE + totalPcm);
  firstHeader.copy(out, 0);
  out.writeUInt32LE(36 + totalPcm, RIFF_SIZE_OFFSET);
  out.writeUInt32LE(totalPcm, DATA_SIZE_OFFSET);

  let offset = WAV_HEADER_SIZE;
  for (const part of pcmParts) {
    part.copy(out, offset);
    offset += part.length;
  }

  return out;
}
