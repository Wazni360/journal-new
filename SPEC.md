# Video Journal — Project Spec

Single-user video journaling web app. Record in the browser (Chrome on macOS), store video in Cloudflare R2, metadata in Postgres (hosted on Supabase), Next.js on Vercel.

## Prime directive

**A recording must never be lost.** Every design decision serves this:

1. Every recorded chunk is written to IndexedDB the moment it arrives, before anything else happens with it.
2. Local data is deleted only after the server has verified the object in R2 (byte size matches).
3. Uploads retry indefinitely. A failed upload is a state, not an ending.
4. Until upload is verified, the user can always download the local recording, fully offline.
5. Recording must never be blocked by the network. It starts even if the server is unreachable.

If any change would weaken one of these, stop and ask.

## Working agreement

- Build in the phases below. At the end of each phase, stop, summarize what was built and how to test it, and wait for approval.
- Surface decisions and tradeoffs explicitly. Don't pick silently.
- Items marked **VERIFY** are planning-stage assumptions that haven't been confirmed. Confirm them against current docs or by testing, and report back if they're wrong.

## Code conventions

- **JavaScript, not TypeScript.** `.js` / `.jsx` only. No `.d.ts`, no JSDoc type annotations.
- **ESM everywhere.** `"type": "module"` in `package.json`. `import`/`export` in app code, Knex config, and migrations.
- **Arrow functions** for all function definitions, including route handlers, React components, and module-level helpers.
- Prettier defaults for formatting.
- Everything tunable lives in `lib/config.js` as plain exported objects.

## Stack

- **Next.js** (App Router) on Vercel: UI + API route handlers. There is no other backend.
- **Cloudflare R2**: video storage via the S3 API (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`). Endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, region `auto`.
- **Postgres on Supabase**, accessed directly with **Knex + `pg`** over `DATABASE_URL`. Knex is used for both migrations and runtime queries. No `supabase-js`, no Supabase Auth, no Supabase Storage, no PostgREST.
  - Runtime connects through Supabase's session-mode pooler (port 5432). Pool `{ min: 0, max: 1 }` per serverless function; this is a single-user app.
  - TLS with `rejectUnauthorized: false`: the pooler's certificate is signed by Supabase's own CA, which Node doesn't trust by default. The connection is encrypted but the chain isn't verified. Pinning Supabase's CA cert is the upgrade path if that ever matters.
  - Migrations run locally with `npx knex migrate:latest`, never during the Vercel build.
- **IndexedDB** (via `idb`): local chunk storage.
- **Tailwind** for styling.
- **Vitest** for unit tests.
- **No transcoding, no FFmpeg.** The file the browser records is the final file.

Video bytes must never pass through Vercel functions. The browser uploads directly to R2 using presigned URLs.

## Recording config

`lib/config.js`:

```js
export const RECORDING = {
  video: {
    width: { ideal: 2560, max: 2560 },   // cap at 1440p; take the best the camera offers under it
    height: { ideal: 1440, max: 1440 },
    frameRate: { ideal: 30 },
  },
  timesliceMs: 2000,
  audioBitsPerSecond: 128_000,
  // First supported candidate wins.
  videoCandidates: [
    { label: 'hevc', mimeType: 'video/mp4;codecs=hvc1.1.6.L153.B0', videoBitsPerSecond: 4_000_000 },
    { label: 'h264', mimeType: 'video/mp4;codecs=avc1', videoBitsPerSecond: 6_000_000 },
    { label: 'vp9',  mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 6_000_000 },
  ],
  sidecarAudio: { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 },
};

export const UPLOAD = {
  partSizeBytes: 10 * 1024 * 1024, // 10 MiB → ~97 GiB max per recording (10,000 parts)
  maxConcurrentParts: 2,
  partUrlTtlSeconds: 3600,
  playbackUrlTtlSeconds: 6 * 3600, // long, so a URL doesn't expire mid-watch
};
```

- **Confirmed (Phase 0, Chrome on macOS):** bare `hvc1` is rejected; Chrome requires a full HEVC profile/level string. `video/mp4;codecs=hvc1.1.6.L153.B0` is accepted and records at 4 Mbps ≈ 29 MB/min. `video/mp4;codecs=avc1` records at 6 Mbps ≈ 43 MB/min. Both produce MP4s with a real duration and working seek. `video/webm;codecs=vp9,opus` records but reports `duration: null` / seekable to `Infinity`, so it is the last resort only.
- **Confirmed (Phase 0):** the built-in camera delivers 1760×1328 @ 30fps under the `max: 2560/1440` constraint. Nothing is upscaled. Store whatever `getSettings()` reports.

## R2 object layout

```
entries/{entryId}/video.{mp4|webm}
entries/{entryId}/audio.webm      # low-bitrate sidecar for future captions
entries/{entryId}/thumb.jpg
entries/{entryId}/meta.json       # full copy of the DB row
```

The bucket is private: no public access, no r2.dev. R2 is the source of truth and the database is a rebuildable index, because Supabase free plan backups can't be downloaded. `meta.json` is rewritten whenever the row changes.

## Data model

Managed by Knex migrations in `db/migrations/`. Schema as it should exist after the initial migration:

```sql
create table entries (
  id uuid primary key,                 -- generated by the client so recording can start offline
  created_at timestamptz not null default now(),
  recorded_at timestamptz not null,
  duration_seconds numeric,
  title text,
  status text not null default 'uploading' check (status in ('uploading', 'uploaded')),
  video_key text not null,
  upload_id text,
  mime_type text not null,
  codec_label text not null,
  width int,
  height int,
  size_bytes bigint,
  audio_key text,
  thumb_key text,
  transcript text,
  transcript_status text not null default 'none',
  deleted_at timestamptz
);

create table login_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  success boolean not null,
  attempted_at timestamptz not null default now()
);

create index login_attempts_ip_attempted_at_idx on login_attempts (ip, attempted_at);

alter table entries enable row level security;
alter table login_attempts enable row level security;
alter table knex_migrations enable row level security;
alter table knex_migrations_lock enable row level security;
-- Intentionally NO policies. The server connects as the table owner over DATABASE_URL, which bypasses RLS.
-- This prevents the auto-generated Supabase PostgREST API from exposing anything if a public key ever leaks.
```

## Client: local storage (IndexedDB, db name `journal`)

- `recordings`: `{ id, recordedAt, mimeType, codecLabel, status: 'recording' | 'stopped', totalBytes, chunkCount, audioBytes, audioChunkCount, durationMs, width, height, upload: { key, uploadId, parts: { partNumber, etag }[] } | null, serverInitialized, audioUploaded, thumbUploaded, interrupted, updatedAt }`
  - `updatedAt` is stamped on every chunk write and by a heartbeat (`LOCAL.heartbeatMs`) while recording or paused. Crash recovery only touches `recording` rows whose stamp is older than `LOCAL.staleAfterMs`, so a recording live in another tab is never clobbered.
  - Chunk rows and the row's counters are written in one IndexedDB transaction, so they can't disagree.
- `chunks`: key `[recordingId, seq]`, value `{ blob, size, offset }`. `offset` is the chunk's cumulative starting byte position.
- `audioChunks`: same shape, for the sidecar audio.
- `thumbs`: key `recordingId`, value `Blob`.

## Client: recording flow

1. Generate `entryId` (UUID) on the client. Create the `recordings` row locally **first**.
2. Call `getUserMedia` with the config constraints and log `getSettings()`.
3. Start the video `MediaRecorder` (first supported candidate) with `timeslice`. Start a second, audio-only `MediaRecorder` on `new MediaStream(stream.getAudioTracks())` for the sidecar.
4. In the background, `POST /api/entries` to create the DB row and multipart upload. If it fails, retry later. Recording continues regardless.
5. On each `dataavailable`: append the chunk to IndexedDB through a sequential promise queue, so `seq` order is guaranteed, then notify the upload manager. Chunks are never held only in memory.
6. About 2s in, draw a video frame to a canvas, save it as a JPEG to `thumbs`.
7. Pause/resume controls both recorders together. Duration excludes paused time.
8. On stop: call `stop()` on both, wait for the final `dataavailable` and `stop` events, then set status `stopped` and save the duration.
9. While recording, or while any upload is pending: show a `beforeunload` warning.

**Chunk integrity:** MediaRecorder output is only a valid file when every chunk is concatenated in exact order. The first chunk contains the file header. Treat `seq` continuity as critical and check it before completing an upload.

**Crash recovery:** on app load, any local recording with status `recording` and a stale `updatedAt` gets marked `stopped` with `interrupted: true` and becomes uploadable. At most the last chunk is lost. (Phase 0: Chrome's MP4 muxer treats `timesliceMs` as advisory and emits a chunk per fragment, about every 3.3s at 2s timeslice, so the worst-case loss is ~3.5s, not 2s.)

## Client: upload manager

A page-level singleton. It starts on app load and wakes after each new chunk.

- Part N (1-based) is bytes `[(N-1)·P, N·P)` of the concatenated chunk stream, where P = `partSizeBytes`. Build it with `new Blob(overlappingChunkBlobs).slice(...)` using the stored offsets.
- Upload part N only when persisted bytes ≥ N·P, or when the recording has stopped (for the final part). R2 rules: parts must be between 5 MiB and 5 GiB, all parts except the last must be the same size, and there's a maximum of 10,000 parts. The last part has no minimum size.
- Get presigned `UploadPart` URLs in batches from `/api/entries/[id]/parts/sign`. `PUT` with `fetch`, read the `ETag` response header, and persist `{ partNumber, etag }` to IndexedDB immediately.
- Retry with exponential backoff and jitter (1s up to a 60s cap), forever. Pause while `navigator.onLine` is false and resume on the `online` event. On 403, re-sign the URL (it probably expired).
- On `NoSuchUpload`: R2 aborts incomplete multipart uploads after 7 days by default. Call `/api/entries/[id]/restart` for a new `uploadId`, clear the local part list, and re-upload everything from local data. Automatic restarts are capped (`MAX_AUTO_RESTARTS`, 2 per session); past that the recording is held with an explanation rather than looping forever against a broken server.
- If `/complete` answers with `retryParts`, those parts are dropped from the local part list and re-uploaded on the next pass; only those, not the whole file.
- A `held` state stops automatic retries for one recording (empty recording, inconsistent local chunks, unverifiable upload). The banner shows why and offers **Resume upload**, which clears the hold. Local data is never touched in this state.
- A 401 from any route pauses every upload with "Sign in again to resume uploading."
- Only one tab uploads at a time, via a `navigator.locks` lock held for the life of the page.
- After the final part: `POST /api/entries/[id]/complete`.
- Then upload the sidecar audio and thumbnail with single presigned PUTs, and confirm each one.
- Delete local video chunks **only** after `complete` returns `{ verified: true }`. Delete audio chunks and the thumbnail after their confirmations succeed. Then delete the local `recordings` row.

## Server routes

**Every route handler verifies the session itself.** Don't rely on middleware alone, because a 2025 Next.js vulnerability allowed middleware to be bypassed. Middleware only redirects unauthenticated page requests to `/login`. (Confirmed: Next.js 16 renamed it to `proxy.js`; `middleware.js` is deprecated. Proxy runs on the Node runtime.)

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | Body `{ password }`. If an IP has more than 5 failed attempts in 15 min, return 429. Compare with bcrypt and set the session cookie on success. Log every attempt to `login_attempts`. |
| `POST /api/auth/logout` | Clear the cookie. |
| `POST /api/entries` | Body `{ id, recordedAt, mimeType, codecLabel }`. Idempotent: if the entry exists, return it. Otherwise insert the row, call `CreateMultipartUpload` (with ContentType), and return `{ key, uploadId }`. |
| `POST /api/entries/[id]/parts/sign` | Body `{ partNumbers }`. Return presigned `UploadPart` URLs. |
| `POST /api/entries/[id]/complete` | Body `{ totalBytes, durationSeconds, width, height }`. See the verification section below. |
| `POST /api/entries/[id]/restart` | `AbortMultipartUpload` (ignore errors), then `CreateMultipartUpload` and save the new `upload_id`. |
| `POST /api/entries/[id]/assets/sign` | Body `{ type: 'audio' \| 'thumb' }`. Return a presigned `PutObject` URL. |
| `POST /api/entries/[id]/assets/confirm` | Body `{ type }`. `HeadObject` to check it exists, set the key on the row, rewrite `meta.json`. |
| `GET /api/entries` | Non-deleted entries, newest first. |
| `GET /api/entries/[id]/media?kind=video\|audio\|thumb&download=1` | Presigned `GetObject`. With `download=1`, set `ResponseContentDisposition: attachment; filename="journal-YYYY-MM-DD-HHmm.<ext>"`. |
| `PATCH /api/entries/[id]` | Update the title. |
| `DELETE /api/entries/[id]` | Soft delete (set `deleted_at`). There is **no** hard-delete endpoint in v1. |
| `GET /api/cron/keepalive` | Vercel Cron, daily. Check `Authorization: Bearer ${CRON_SECRET}` and run a couple of cheap queries. This keeps the Supabase free project from pausing for inactivity. |

**Completion verification (`/complete`):** (`lib/verify-parts.js` holds the pure check, covered by unit tests)

1. `ListParts` (paginate; max 1000 per page).
2. Check that part numbers are contiguous from 1..N, that all parts except the last are the same size, and that the sizes sum to `totalBytes`.
3. `CompleteMultipartUpload` using the ETags from `ListParts`.
4. `HeadObject`. `ContentLength` must equal `totalBytes`.
5. Set status `uploaded`, fill in the size, duration, and dimensions, clear `upload_id`, and write `meta.json`.
6. Return `{ verified: true }`. On any mismatch, return `{ verified: false, reason }` so the client keeps its local data.
7. The route is idempotent. If the entry is already `uploaded` and `HeadObject` matches, return `verified: true`.

## Auth

- Env var `APP_PASSWORD_HASH_B64` holds the base64-encoded bcrypt hash of the password. Base64 is used because bcrypt hashes contain `$`, which Next.js `.env` loading treats as variable expansion. (Confirmed.)
- Provide `scripts/hash-password.js` that prints this value.
- Session: a JWT (`jose`, HS256, signed with `SESSION_SECRET`) in a cookie named `session` with `httpOnly`, `Secure`, `SameSite=Lax`, 30-day expiry. Rotating `SESSION_SECRET` logs out every device.
- Import `server-only` in every module that touches secrets.

## R2 setup (document in README)

- Private bucket.
- API token with Object Read & Write, scoped to this bucket only.
- CORS rules:

```json
[
  {
    "AllowedOrigins": ["https://<prod-domain>", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Without `ExposeHeaders: ["ETag"]`, the browser can't read part ETags and uploads can't complete. Origins must match exactly, with no trailing slash.

## Env vars (see `.env.example`)

`APP_PASSWORD_HASH_B64`, `SESSION_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `DATABASE_URL`, `CRON_SECRET`

## Tests (Vitest)

Unit tests for the logic where a silent bug corrupts a file:

- Part slicing math: which chunks overlap part N, byte ranges, final-part handling, the 5 MiB minimum.
- `seq` continuity check.
- `/complete` verification: contiguous part numbers, equal sizes except last, sum equals `totalBytes`.
- Backoff schedule (1s → 60s cap, jitter bounds).

The failure tests below are manual.

## UI

Pages:

- `/login`
- `/`: the library. A banner at the top lists local recordings that aren't yet verified, each with **Resume upload** and **Download** buttons, plus a **Discard** action behind a confirm that states it is the only copy (needed to clear test recordings; it is the one place the app deletes unverified data, and only on explicit request).
- `/record`: camera preview, record/pause/stop, elapsed time, and live status (for example "Saved on this Mac" / "Uploaded 42 of 58 MB").
- `/entries/[id]`: player, editable title, download, delete.

Rules:

- Upload status must always be visible and honest. Never show a done state until the server has verified the upload.
- Local download is available on `/record` after stopping and in the library banner. It concatenates chunks from IndexedDB into a Blob and downloads it with the correct file extension.
- If IndexedDB refuses a chunk write (after `LOCAL.chunkWriteRetries`), the recorder keeps that chunk and every later one in memory, shows a warning, and the `/record` download includes them. Leaving `/record` mid-recording (client-side navigation, which `beforeunload` doesn't catch) stops and finalizes the recording locally instead of dropping the tail.
- Preview is mirrored; the recorded file is not.
- Error messages say what happened and what the app is doing about it. For example: "Upload paused — you're offline. Your recording is saved on this Mac and will resume automatically."
- Keep it calm and quiet. This is a private journal, not a dashboard. Before building UI, propose a small design token set (palette, type, layout) for approval. Avoid template defaults.

## Phases

**Phase 0: codec and playback spike.** Scaffold the Next.js app (needed to host the spike) and add a throwaway `/spike` page with no backend. The page is deleted before Phase 1.
- Probe and log `isTypeSupported` for every candidate, and log `getSettings()`.
- Record with each supported candidate at its configured bitrate, persist to IndexedDB, then play back and download.
- Test a recording of 20+ minutes. Check that the duration displays and seeking works in Chrome on Mac, both for the in-page blob playback and for the downloaded file opened in Chrome.
- Report MB per minute for each candidate.
- **Stop and report.** If seeking or duration is broken, we decide on a fix before continuing. (Known risk: MediaRecorder writes no duration in the container header; Chrome may report `Infinity`. The fix, if needed, is a header patch on the client, not transcoding.)

**Phase 1: foundation.** Auth, Knex setup and initial migration, R2 client, env setup, deploy to Vercel.

**Phase 2: local-first recording.** IndexedDB storage, pause/resume, thumbnail, sidecar audio, crash-recovery banner, local download. No uploading yet.
- Test: close the tab mid-recording, reopen, and confirm the recording is listed, downloadable, and plays up to the interruption.

**Phase 3: uploads.** The upload manager and the upload routes: progressive multipart, resume, restart, completion, verification, local cleanup.

**Phase 4: library.** List, playback, download, rename, soft delete.

**Phase 5: hardening.** Login rate limiting, keepalive cron, `scripts/rebuild-index.js` (rebuilds `entries` from R2 `meta.json` files), and the full failure test suite.

### Failure tests (all must pass before calling Phase 3 done; re-run in Phase 5)

1. Go offline (DevTools) for 2 minutes mid-recording. Recording continues and uploads resume afterward.
2. Refresh the tab mid-upload. The upload resumes from the last confirmed part without re-uploading confirmed parts.
3. Force-quit Chrome mid-recording. On reopen, the recording is recoverable and its captured portion uploads.
4. Throttle the network to slow 3G. Parts queue, recording is unaffected, and the upload finishes after stop.
5. An expired presigned URL gets re-signed automatically.
6. Abort the multipart upload manually in R2. The restart path re-uploads from local data.
7. Calling `/complete` twice is idempotent.
8. A size mismatch returns `verified: false` and local data is kept.

## Future (don't build yet)

Captions: send `audio.webm` to a hosted Whisper API, store VTT in R2 and plain text in `entries.transcript`, add full-text search. The schema fields already exist.

## Out of scope

Multi-user support, public sharing, transcoding, end-to-end encryption. Skipping E2E encryption is a conscious decision, because server-side captions will need access to the content.

## Explicitly dropped

- `navigator.storage.persist()` — not called.
- Screen Wake Lock — not used.
- iPhone / Safari playback of downloaded files — not tested or supported. Mac Chrome is the only target.
- Type annotations of any kind.
