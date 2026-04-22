# Reliable Recording Chunking Pipeline + Transcription

A hackathon build of a browser recorder that splits audio into 5-second chunks, persists each chunk to OPFS, uploads them to local server storage, acks them in SQLite, and finally produces a multi-speaker transcript via AssemblyAI.

## How It Works

```
Client (Browser)
  ├── 1. Record & chunk audio (16 kHz PCM WAV, 5 s per chunk)
  ├── 2. Persist chunk to OPFS (before any network call)
  ├── 3. Upload chunk → server (POST /api/chunks/upload)
  │        └── server writes to disk + inserts ack row
  ├── 4. On ack success → delete chunk from OPFS
  │
  ├── Recovery (on page load):
  │     └── Scan OPFS → diff vs server acks → re-upload missing, clean acked
  │
  └── Stop → POST /api/sessions/:id/finalize
        └── server concatenates WAV chunks → AssemblyAI async transcribe
              → client polls GET /api/sessions/:id/transcript until done
```

**Invariant:** a chunk is only removed from OPFS after the server has confirmed both disk write and DB ack. Reconciliation on mount re-uploads anything in OPFS that the server is missing (and cleans anything the server already has).

## Tech Stack

- **Next.js 16** (App Router) — web app on port 3001
- **Hono** on **Node** (via `@hono/node-server` + `tsx`) — API on port 3000
- **SQLite** via **libsql** + **Drizzle ORM** — DB at `packages/db/data.db`
- **Local filesystem** — bucket stand-in at `apps/server/storage/<sessionId>/<seq>.wav`
- **AssemblyAI** — async transcription with `speaker_labels: true`
- **TailwindCSS + shadcn/ui** — UI
- **Turborepo** — monorepo

> **Deviations from the original spec.** The assignment lists PostgreSQL + S3-compatible bucket + Bun runtime. For zero-friction judge setup I swapped in SQLite (via libsql, no native compilation) + local filesystem + Node (via tsx). All pipeline semantics (OPFS durable buffer, ack-before-delete, reconciliation with bucket-purge recovery) are preserved.

## Prerequisites

- **Node.js** ≥ 20
- **Internet** (for AssemblyAI uploads)

No Bun, no Docker, no PostgreSQL, no S3 account, no native build tools.

## Getting Started

```bash
# 1. Install deps
npm install

# 2. env files already added:
#    apps/server/.env       (AssemblyAI key)
#    apps/web/.env.local    (server URL)

# 3. Create SQLite schema
npm run db:push

# 4. Run everything
npm run dev
```

- Web: http://localhost:3001
- API: http://localhost:3000

Open the web URL, allow microphone access, click **Record**, speak for 10–30s with two people if possible, click **Stop**. The transcript panel appears once AssemblyAI finishes (usually 20–60 s).

## Project Structure

```
.
├── apps/
│   ├── web/                    # Next.js — recorder UI, OPFS, upload, reconcile
│   │   └── src/
│   │       ├── app/recorder/   # Page: record button + waveform + transcript
│   │       ├── hooks/
│   │       │   └── use-recorder.ts   # MediaStream → chunks → OPFS + upload
│   │       └── lib/
│   │           ├── opfs.ts           # OPFS wrapper (write/read/list/delete)
│   │           ├── api.ts            # Server API client (incl. retry)
│   │           └── reconcile.ts      # On-mount reconciliation
│   └── server/                 # Hono API on Bun
│       └── src/
│           ├── routes/
│           │   ├── sessions.ts       # create, finalize, acks, transcript
│           │   └── chunks.ts         # upload (multipart)
│           └── lib/
│               ├── storage.ts        # filesystem storage
│               ├── wav.ts            # WAV concat
│               ├── assemblyai.ts     # AssemblyAI client
│               └── transcribe.ts     # background job + polling
├── packages/
│   ├── db/                     # Drizzle + SQLite
│   │   └── src/schema/         # sessions, chunks, transcripts
│   ├── env/                    # type-safe env via @t3-oss/env-core
│   ├── ui/                     # shadcn components
│   └── config/                 # shared tsconfig
```

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/sessions` | Create a recording session; returns `{ sessionId }` |
| `POST` | `/api/chunks/upload` | Multipart: `sessionId`, `seq`, `chunk`. Writes to disk + acks in DB. Idempotent on `(sessionId, seq)`. |
| `GET` | `/api/sessions/:id/acks` | Returns `{ acks: number[] }` — only chunks whose file **actually exists on disk** (so a bucket purge would correctly drop ack). Used by client reconciliation. |
| `POST` | `/api/sessions/:id/finalize` | Marks session finalized, queues a transcription job in the background. |
| `GET` | `/api/sessions/:id/transcript` | Returns `{ status, text, segments, error }`. Poll until `status === "done"` or `"failed"`. |

## What to Demo

1. **Record 15–30 s** with two speakers — show record button, waveform, chunk pills going from `opfs → uploading → acked`.
2. **Stop** — transcript panel shows Queued → Processing → Done with `Speaker A / Speaker B` segments.
3. **Kill network + record + restore + reload** — chunks sat in OPFS; reconcile-on-mount re-uploads them silently.
4. **Inspect DB**: `npm run db:studio` shows `sessions`, `chunks`, `transcripts` rows.
5. **Inspect storage**: `apps/server/storage/<sessionId>/*.wav` are the raw chunks on disk.

## Available Scripts

- `npm run dev` — start web + server
- `npm run dev:web` / `npm run dev:server` — individually
- `npm run build` — build both
- `npm run check-types` — TypeScript check
- `npm run db:push` — apply schema to `packages/db/data.db`
- `npm run db:studio` — open Drizzle Studio
- `npm run db:generate` — generate SQL migrations

## Known Gaps / Cuts for Time

- No k6 load test script committed (assignment requests 300K-req validation; out of scope for the 3-hour build).
- Reconciliation is mount-only (no periodic background pass).
- Upload retry is a simple 3-attempt exponential backoff, not a queue with dead-letter handling.

## Environment Varibles
-Server:
  ASSEMBLYAI_API_KEY=d17658331f944d89b829550f25ea7c61
  CORS_ORIGIN=http://localhost:3001
  PORT=3000
  NODE_ENV=development
  
-web:
  NEXT_PUBLIC_SERVER_URL=http://localhost:3000
