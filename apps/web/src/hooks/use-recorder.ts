"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSession, uploadChunkWithRetry } from "@/lib/api";
import { deleteChunkFromOpfs, writeChunkToOpfs } from "@/lib/opfs";

const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

export type ChunkStatus = "opfs" | "uploading" | "acked" | "failed";

export interface WavChunk {
  id: string;
  seq: number;
  blob: Blob;
  url: string;
  duration: number;
  timestamp: number;
  status: ChunkStatus;
}

export type RecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "stopping";

interface UseRecorderOptions {
  chunkDuration?: number;
  deviceId?: string;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.round(input.length / ratio);
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const srcIndex = i * ratio;
    const low = Math.floor(srcIndex);
    const high = Math.min(low + 1, input.length - 1);
    const frac = srcIndex - low;
    output[i] = (input[low] ?? 0) * (1 - frac) + (input[high] ?? 0) * frac;
  }
  return output;
}

export function useRecorder(options: UseRecorderOptions = {}) {
  const { chunkDuration = 5, deviceId } = options;

  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<WavChunk[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const samplesRef = useRef<Float32Array[]>([]);
  const sampleCountRef = useRef(0);
  const chunkThreshold = SAMPLE_RATE * chunkDuration;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const pausedElapsedRef = useRef(0);
  const statusRef = useRef<RecorderStatus>("idle");
  const seqCounterRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const pipelineTasksRef = useRef<Set<Promise<void>>>(new Set());

  statusRef.current = status;

  const setChunkStatus = useCallback((seq: number, s: ChunkStatus) => {
    setChunks((prev) =>
      prev.map((c) => (c.seq === seq ? { ...c, status: s } : c)),
    );
  }, []);

  const runPipeline = useCallback(
    (sid: string, seq: number, blob: Blob): Promise<void> => {
      const task = (async () => {
        try {
          await writeChunkToOpfs(sid, seq, blob);
        } catch {
          setChunkStatus(seq, "failed");
          return;
        }
        setChunkStatus(seq, "uploading");
        try {
          await uploadChunkWithRetry(sid, seq, blob);
          setChunkStatus(seq, "acked");
          await deleteChunkFromOpfs(sid, seq);
        } catch {
          setChunkStatus(seq, "failed");
        }
      })();
      pipelineTasksRef.current.add(task);
      task.finally(() => pipelineTasksRef.current.delete(task));
      return task;
    },
    [setChunkStatus],
  );

  const emitChunk = useCallback(
    (samples: Float32Array) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const blob = encodeWav(samples, SAMPLE_RATE);
      const url = URL.createObjectURL(blob);
      const seq = seqCounterRef.current++;
      const chunk: WavChunk = {
        id: crypto.randomUUID(),
        seq,
        blob,
        url,
        duration: samples.length / SAMPLE_RATE,
        timestamp: Date.now(),
        status: "opfs",
      };
      setChunks((prev) => [...prev, chunk]);
      runPipeline(sid, seq, blob);
    },
    [runPipeline],
  );

  const flushBufferedSamples = useCallback(() => {
    if (samplesRef.current.length === 0) return;
    const totalLen = samplesRef.current.reduce((n, b) => n + b.length, 0);
    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const buf of samplesRef.current) {
      merged.set(buf, offset);
      offset += buf.length;
    }
    samplesRef.current = [];
    sampleCountRef.current = 0;
    emitChunk(merged);
  }, [emitChunk]);

  const start = useCallback(async () => {
    if (statusRef.current === "recording") return;

    setStatus("requesting");
    setError(null);
    try {
      const sid = await createSession();
      sessionIdRef.current = sid;
      setSessionId(sid);
      seqCounterRef.current = 0;
      setChunks([]);

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId
          ? {
              deviceId: { exact: deviceId },
              echoCancellation: true,
              noiseSuppression: true,
            }
          : { echoCancellation: true, noiseSuppression: true },
      });

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(mediaStream);
      const processor = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      const nativeSampleRate = audioCtx.sampleRate;

      processor.onaudioprocess = (e) => {
        if (statusRef.current !== "recording") return;
        const input = e.inputBuffer.getChannelData(0);
        const resampled = resample(
          new Float32Array(input),
          nativeSampleRate,
          SAMPLE_RATE,
        );
        samplesRef.current.push(resampled);
        sampleCountRef.current += resampled.length;
        if (sampleCountRef.current >= chunkThreshold) {
          flushBufferedSamples();
        }
      };

      source.connect(processor);
      processor.connect(audioCtx.destination);

      streamRef.current = mediaStream;
      audioCtxRef.current = audioCtx;
      processorRef.current = processor;
      setStream(mediaStream);

      samplesRef.current = [];
      sampleCountRef.current = 0;
      pausedElapsedRef.current = 0;
      startTimeRef.current = Date.now();
      setElapsed(0);
      setStatus("recording");

      timerRef.current = setInterval(() => {
        if (statusRef.current === "recording") {
          setElapsed(
            pausedElapsedRef.current +
              (Date.now() - startTimeRef.current) / 1000,
          );
        }
      }, 100);
    } catch (err) {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      console.error("[recorder] start failed:", err);
      setError(msg);
      sessionIdRef.current = null;
      setSessionId(null);
      setStatus("idle");
    }
  }, [deviceId, chunkThreshold, flushBufferedSamples]);

  const stop = useCallback(async (): Promise<string | null> => {
    if (statusRef.current === "idle" || statusRef.current === "stopping") {
      return sessionIdRef.current;
    }
    setStatus("stopping");
    flushBufferedSamples();

    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (audioCtxRef.current?.state !== "closed") {
      audioCtxRef.current?.close();
    }
    if (timerRef.current) clearInterval(timerRef.current);

    processorRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;
    setStream(null);

    await Promise.allSettled(Array.from(pipelineTasksRef.current));

    const sid = sessionIdRef.current;
    setStatus("idle");
    return sid;
  }, [flushBufferedSamples]);

  const pause = useCallback(() => {
    if (statusRef.current !== "recording") return;
    pausedElapsedRef.current += (Date.now() - startTimeRef.current) / 1000;
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    startTimeRef.current = Date.now();
    setStatus("recording");
  }, []);

  const reset = useCallback(() => {
    for (const c of chunks) URL.revokeObjectURL(c.url);
    setChunks([]);
    setSessionId(null);
    sessionIdRef.current = null;
    seqCounterRef.current = 0;
    setElapsed(0);
  }, [chunks]);

  useEffect(() => {
    return () => {
      processorRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (audioCtxRef.current?.state !== "closed") {
        audioCtxRef.current?.close();
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return {
    status,
    sessionId,
    chunks,
    elapsed,
    stream,
    error,
    start,
    stop,
    pause,
    resume,
    reset,
  };
}
