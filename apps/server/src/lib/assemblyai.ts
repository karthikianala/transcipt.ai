import { env } from "@my-better-t-app/env/server";

const BASE_URL = "https://api.assemblyai.com/v2";

type AssemblyJob = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text?: string;
  error?: string;
  utterances?: Array<{
    speaker: string;
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
};

async function aaiFetch(
  pathname: string,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("authorization", env.ASSEMBLYAI_API_KEY);
  return fetch(`${BASE_URL}${pathname}`, { ...init, headers });
}

export async function uploadAudio(data: Buffer): Promise<string> {
  const res = await aaiFetch("/upload", {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: data,
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI upload failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { upload_url: string };
  return json.upload_url;
}

export async function createTranscript(uploadUrl: string): Promise<string> {
  const res = await aaiFetch("/transcript", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: uploadUrl,
      speaker_labels: true,
      speakers_expected: 2,
      speech_models: ["universal-2"],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `AssemblyAI transcript create failed: ${res.status} ${await res.text()}`,
    );
  }
  const json = (await res.json()) as { id: string };
  return json.id;
}

export async function getTranscript(jobId: string): Promise<AssemblyJob> {
  const res = await aaiFetch(`/transcript/${jobId}`);
  if (!res.ok) {
    throw new Error(`AssemblyAI get failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as AssemblyJob;
}

export type TranscriptSegment = {
  speaker: string;
  text: string;
  start: number;
  end: number;
};

export function toSegments(job: AssemblyJob): TranscriptSegment[] {
  if (!job.utterances) return [];
  return job.utterances.map((u) => ({
    speaker: u.speaker,
    text: u.text,
    start: u.start,
    end: u.end,
  }));
}
