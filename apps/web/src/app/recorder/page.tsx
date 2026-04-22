"use client";

import { Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchTranscript,
  finalizeSession,
  type TranscriptSegment,
  type TranscriptState,
} from "@/lib/api";
import { reconcileAllSessions } from "@/lib/reconcile";
import { Button } from "@my-better-t-app/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card";
import { LiveWaveform } from "@/components/ui/live-waveform";
import {
  type ChunkStatus,
  useRecorder,
  type WavChunk,
} from "@/hooks/use-recorder";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STATUS_STYLES: Record<ChunkStatus, string> = {
  opfs: "bg-muted text-muted-foreground",
  uploading: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  acked: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
};

function ChunkPill({ chunk }: { chunk: WavChunk }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLES[chunk.status]}`}
    >
      #{chunk.seq + 1}
      <span className="opacity-60">·</span>
      {chunk.status}
    </span>
  );
}

function TranscriptView({
  segments,
  text,
}: {
  segments: TranscriptSegment[];
  text: string;
}) {
  if (segments.length > 0) {
    return (
      <div className="flex flex-col gap-3">
        {segments.map((seg, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: segments are stable post-transcription
            key={i}
            className="flex flex-col gap-1 rounded-sm border border-border/50 bg-muted/20 p-3"
          >
            <span className="text-xs font-semibold text-muted-foreground">
              Speaker {seg.speaker}
            </span>
            <span className="text-sm leading-relaxed">{seg.text}</span>
          </div>
        ))}
      </div>
    );
  }
  if (text) {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>;
  }
  return null;
}

export default function RecorderPage() {
  const {
    status,
    sessionId,
    chunks,
    elapsed,
    stream,
    error,
    start,
    stop,
    reset,
  } = useRecorder({ chunkDuration: 5 });

  const [transcript, setTranscript] = useState<TranscriptState | null>(null);
  const [finalizeSessionId, setFinalizeSessionId] = useState<string | null>(
    null,
  );
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isRecording = status === "recording";
  const isBusy = status === "requesting" || status === "stopping";
  const isActive = isRecording || status === "paused";

  useEffect(() => {
    reconcileAllSessions().catch(() => {
      // silent — reconciliation is best-effort on mount
    });
  }, []);

  const pollTranscript = useCallback((sid: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    const check = async () => {
      try {
        const t = await fetchTranscript(sid);
        setTranscript(t);
        if (t.status === "done" || t.status === "failed") {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        }
      } catch {
        // keep polling
      }
    };
    check();
    pollIntervalRef.current = setInterval(check, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handlePrimary = useCallback(async () => {
    if (isActive) {
      const sid = await stop();
      if (sid) {
        setFinalizeSessionId(sid);
        setTranscript({ status: "queued" });
        try {
          await finalizeSession(sid);
          pollTranscript(sid);
        } catch (err) {
          setTranscript({
            status: "failed",
            error: err instanceof Error ? err.message : "finalize failed",
          });
        }
      }
    } else {
      setTranscript(null);
      setFinalizeSessionId(null);
      reset();
      await start();
    }
  }, [isActive, stop, start, reset, pollTranscript]);

  const ackedCount = chunks.filter((c) => c.status === "acked").length;
  const failedCount = chunks.filter((c) => c.status === "failed").length;

  return (
    <div className="container mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Recorder</CardTitle>
          <CardDescription>
            Records in 5-second chunks · persists to OPFS · uploads to server
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-6">
          <div className="overflow-hidden rounded-sm border border-border/50 bg-muted/20 text-foreground">
            <LiveWaveform
              active={isRecording}
              processing={status === "paused" || status === "stopping"}
              stream={stream}
              height={80}
              barWidth={3}
              barGap={1}
              barRadius={2}
              sensitivity={1.8}
              smoothingTimeConstant={0.85}
              fadeEdges
              fadeWidth={32}
              mode="static"
            />
          </div>

          <div className="text-center font-mono text-3xl tabular-nums tracking-tight">
            {formatTime(elapsed)}
          </div>

          <div className="flex items-center justify-center">
            <Button
              size="lg"
              variant={isActive ? "destructive" : "default"}
              className="gap-2 px-6"
              onClick={handlePrimary}
              disabled={isBusy}
            >
              {isActive ? (
                <>
                  <Square className="size-4" />
                  Stop
                </>
              ) : (
                <>
                  <Mic className="size-4" />
                  {status === "requesting"
                    ? "Requesting..."
                    : status === "stopping"
                      ? "Stopping..."
                      : "Record"}
                </>
              )}
            </Button>
          </div>

          {error && (
            <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {sessionId && chunks.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {ackedCount}/{chunks.length} chunks acked
                  {failedCount > 0 ? ` · ${failedCount} failed` : ""}
                </span>
                <span className="font-mono text-[10px] opacity-60">
                  {sessionId}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {chunks.map((c) => (
                  <ChunkPill key={c.id} chunk={c} />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {finalizeSessionId && transcript && (
        <Card>
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
            <CardDescription>
              {transcript.status === "queued" && "Queued — preparing audio..."}
              {transcript.status === "processing" &&
                "Transcribing with speaker labels..."}
              {transcript.status === "done" && "Completed"}
              {transcript.status === "failed" &&
                `Failed: ${transcript.error ?? "unknown error"}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {transcript.status === "done" ? (
              <TranscriptView
                segments={transcript.segments ?? []}
                text={transcript.text ?? ""}
              />
            ) : transcript.status === "failed" ? null : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="inline-block size-2 animate-pulse rounded-full bg-amber-500" />
                Working on it — this usually takes 30–60s depending on length.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
