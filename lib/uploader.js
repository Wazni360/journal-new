import { UPLOAD } from "@/lib/config";
import { apiPost, ApiError } from "@/lib/api";
import { backoffDelayMs } from "@/lib/backoff";
import { buildRecordingBlob } from "@/lib/download";
import { deleteChunks, deleteRecordingLocal, getChunkRows, getRecording, getThumb, listRecordings, localEvents, patchRecording, recoverInterrupted } from "@/lib/local";
import { buildPartBlob, checkChunkIntegrity, readyPartNumbers, uploadedBytes } from "@/lib/parts";

// Page-level singleton. Walks every local recording, oldest first, and pushes it toward "verified in R2":
// create entry → upload ready parts → complete → audio + thumb → delete local copy. Every step is resumable from
// the local row, retries forever with backoff, and never deletes local bytes before the server has confirmed them.

const MAX_AUTO_RESTARTS = 2;
const SIGN_BATCH = 8;

const statuses = new Map(); // recordingId → { phase, message, uploadedBytes, totalBytes, nextAttemptAt }
const attempts = new Map(); // recordingId → consecutive failures
const restarts = new Map(); // recordingId → automatic restarts this session
const listeners = new Set();

let started = false;
let wake = null;
let wakeTimer = null;
let signedOut = false;

// useSyncExternalStore compares snapshots by identity, so the snapshot is rebuilt only when something changed.
let snapshot = new Map();
const emit = () => {
  snapshot = new Map(statuses);
  listeners.forEach((fn) => fn());
};
export const subscribeUploads = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getUploadStatus = (id) => snapshot.get(id);
export const getAllUploadStatuses = () => snapshot;
export const hasPendingUploads = () => [...snapshot.values()].some((s) => s.phase !== "done");

const setStatus = (id, patch) => {
  statuses.set(id, { ...(statuses.get(id) ?? {}), ...patch });
  emit();
};

class RestartNeeded extends Error {}
class Hold extends Error {} // stop retrying automatically; the user can kick it

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runLimited = async (items, limit, fn) => {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
};

const noSuchUpload = async (res) => res.status === 404 && (await res.clone().text()).includes("NoSuchUpload");

// PUT one blob to a presigned URL. 403 usually means the URL expired: re-sign once and retry.
const putSigned = async (blob, url, resign) => {
  let res = await fetch(url, { method: "PUT", body: blob });
  if (res.status === 403 && resign) res = await fetch(await resign(), { method: "PUT", body: blob });
  if (await noSuchUpload(res)) throw new RestartNeeded("NoSuchUpload");
  if (!res.ok) throw new Error(`upload failed with ${res.status}`);
  return res;
};

const ensureEntry = async (row) => {
  if (row.serverInitialized && row.upload) return row;
  const r = await apiPost("/api/entries", { id: row.id, recordedAt: row.recordedAt, mimeType: row.mimeType, codecLabel: row.codecLabel });
  return patchRecording(row.id, { serverInitialized: true, upload: { key: r.key, uploadId: r.uploadId, parts: row.upload?.parts ?? [] } });
};

const restartUpload = async (row) => {
  const r = await apiPost(`/api/entries/${row.id}/restart`);
  return patchRecording(row.id, { upload: { key: r.key, uploadId: r.uploadId, parts: [] } });
};

const uploadParts = async (row, partNumbers, chunkRows) => {
  const P = UPLOAD.partSizeBytes;
  for (let i = 0; i < partNumbers.length; i += SIGN_BATCH) {
    const batch = partNumbers.slice(i, i + SIGN_BATCH);
    const { urls } = await apiPost(`/api/entries/${row.id}/parts/sign`, { partNumbers: batch });
    await runLimited(batch, UPLOAD.maxConcurrentParts, async (n) => {
      const blob = buildPartBlob(chunkRows, n, row.totalBytes, P);
      const resign = async () => (await apiPost(`/api/entries/${row.id}/parts/sign`, { partNumbers: [n] })).urls[0].url;
      const res = await putSigned(blob, urls.find((u) => u.partNumber === n).url, resign);
      const etag = res.headers.get("etag");
      if (!etag) throw new Error("R2 didn't expose the ETag header. Check the bucket's CORS rule has ExposeHeaders: [\"ETag\"].");
      row = await patchRecording(row.id, (r) => ({
        upload: { ...r.upload, parts: [...r.upload.parts.filter((p) => p.partNumber !== n), { partNumber: n, etag, size: blob.size }] },
      }));
      setStatus(row.id, { uploadedBytes: uploadedBytes(row.upload.parts), totalBytes: row.totalBytes });
    });
  }
  return row;
};

const uploadAsset = async (row, type, blob) => {
  const sign = () => apiPost(`/api/entries/${row.id}/assets/sign`, { type });
  const { url } = await sign();
  await putSigned(blob, url, async () => (await sign()).url);
  const r = await apiPost(`/api/entries/${row.id}/assets/confirm`, { type, size: blob.size });
  if (!r.confirmed) throw new Error(`${type} upload not confirmed: ${r.reason}`);
};

const processRecording = async (id) => {
  let row = await getRecording(id);
  if (!row) return;
  const P = UPLOAD.partSizeBytes;
  const stopped = row.status === "stopped";

  row = await ensureEntry(row);

  if (!row.videoVerified) {
    if (stopped && row.totalBytes === 0) throw new Hold("This recording is empty (0 bytes). Nothing to upload; discard it.");
    const have = new Set(row.upload.parts.map((p) => p.partNumber));
    const pending = readyPartNumbers(row.totalBytes, P, stopped).filter((n) => !have.has(n));

    if (pending.length) {
      const chunkRows = await getChunkRows("chunks", id);
      if (stopped) {
        const integrity = checkChunkIntegrity(chunkRows, row.totalBytes);
        if (!integrity.ok) throw new Hold(`Local copy is inconsistent (${integrity.reason}). It stays on this Mac; download it.`);
      }
      setStatus(id, { phase: "uploading", uploadedBytes: uploadedBytes(row.upload.parts), totalBytes: row.totalBytes, message: null });
      row = await uploadParts(row, pending, chunkRows);
    }

    if (!stopped) {
      setStatus(id, { phase: "recording", uploadedBytes: uploadedBytes(row.upload.parts), totalBytes: row.totalBytes, message: null });
      return;
    }

    setStatus(id, { phase: "verifying", uploadedBytes: row.totalBytes, totalBytes: row.totalBytes, message: null });
    const result = await apiPost(`/api/entries/${id}/complete`, {
      totalBytes: row.totalBytes,
      durationSeconds: row.durationMs / 1000,
      width: row.width,
      height: row.height,
    });
    if (!result.verified) {
      if (result.retryParts?.length) {
        // Server saw some parts missing or short: drop them locally and let the next pass re-upload just those.
        await patchRecording(id, (r) => ({ upload: { ...r.upload, parts: r.upload.parts.filter((p) => !result.retryParts.includes(p.partNumber)) } }));
        throw new Error(`server asked for ${result.retryParts.length} parts again`);
      }
      if (result.restart) throw new RestartNeeded(result.reason);
      throw new Hold(`The server couldn't verify the upload: ${result.reason}. Your recording is safe on this Mac.`);
    }
    row = await patchRecording(id, { videoVerified: true });
    await deleteChunks("chunks", id); // the only place video bytes leave this Mac, and only after verified: true
  }

  setStatus(id, { phase: "assets", uploadedBytes: row.totalBytes, totalBytes: row.totalBytes, message: null });
  if (!row.audioUploaded) {
    if (row.audioChunkCount > 0) await uploadAsset(row, "audio", await buildRecordingBlob(row, { store: "audioChunks" }));
    row = await patchRecording(id, { audioUploaded: true });
    await deleteChunks("audioChunks", id);
  }
  if (!row.thumbUploaded) {
    const thumb = await getThumb(id);
    if (thumb) await uploadAsset(row, "thumb", thumb);
    row = await patchRecording(id, { thumbUploaded: true });
  }

  await deleteRecordingLocal(id);
  setStatus(id, { phase: "done", message: null });
  attempts.delete(id);
  restarts.delete(id);
  setTimeout(() => {
    statuses.delete(id);
    emit();
  }, 10_000);
};

const scheduleWake = (ms) => {
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => wake?.(), ms);
};

const handleFailure = async (id, err) => {
  console.warn(`[upload ${id}]`, err);
  if (err instanceof ApiError && err.status === 401) {
    signedOut = true;
    setStatus(id, { phase: "paused", message: "Sign in again to resume uploading. Your recording is saved on this Mac." });
    return;
  }
  if (err instanceof RestartNeeded) {
    const n = (restarts.get(id) ?? 0) + 1;
    restarts.set(id, n);
    if (n <= MAX_AUTO_RESTARTS) {
      setStatus(id, { phase: "uploading", message: "The upload session expired on the server. Starting over from the copy on this Mac." });
      try {
        await restartUpload(await getRecording(id));
        scheduleWake(0);
        return;
      } catch (e) {
        err = e;
      }
    } else {
      err = new Hold(`Upload restarted ${MAX_AUTO_RESTARTS} times without finishing (${err.message}). Your recording is safe on this Mac.`);
    }
  }
  if (err instanceof Hold) {
    setStatus(id, { phase: "held", message: err.message });
    return;
  }
  const attempt = (attempts.get(id) ?? 0) + 1;
  attempts.set(id, attempt);
  const delay = backoffDelayMs(attempt);
  const reason = err instanceof ApiError ? `the server said ${err.status}` : err instanceof TypeError ? "the server couldn't be reached" : err.message;
  setStatus(id, { phase: "retrying", message: `Upload paused: ${reason}. Retrying in ${Math.round(delay / 1000)}s. Your recording is saved on this Mac.`, nextAttemptAt: Date.now() + delay });
  scheduleWake(delay);
};

const runOnce = async () => {
  // A recording whose tab died stays marked "recording" until its heartbeat goes stale. This runs on every pass, so
  // recovery happens even when the library page isn't open.
  await recoverInterrupted();

  if (!navigator.onLine) {
    for (const row of await listRecordings()) {
      setStatus(row.id, { phase: "offline", message: "Upload paused: you're offline. Your recording is saved on this Mac and will resume automatically.", totalBytes: row.totalBytes });
    }
    return;
  }
  const rows = (await listRecordings()).filter((r) => r.status !== "importing").sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  for (const row of rows) {
    const status = statuses.get(row.id);
    if (status?.phase === "held") continue;
    if (status?.nextAttemptAt && status.nextAttemptAt > Date.now()) continue;
    if (signedOut) continue;
    try {
      await processRecording(row.id);
      attempts.delete(row.id);
    } catch (err) {
      await handleFailure(row.id, err);
    }
  }
};

const loop = async () => {
  for (;;) {
    try {
      await runOnce();
    } catch (err) {
      console.error("[upload] pass failed", err);
    }
    await new Promise((resolve) => {
      wake = resolve;
    });
    wake = null;
    await sleep(50); // coalesce bursts of chunk writes
  }
};

// Manual kick from the UI: clears backoff, holds, and restart counters for one recording and runs now.
export const resumeUpload = (id) => {
  attempts.delete(id);
  restarts.delete(id);
  signedOut = false;
  setStatus(id, { phase: "uploading", message: null, nextAttemptAt: 0 });
  wake?.();
};

export const startUploadManager = () => {
  if (started || typeof window === "undefined") return;
  started = true;
  const kick = () => wake?.();
  window.addEventListener("online", () => {
    attempts.clear();
    kick();
  });
  localEvents.addEventListener("change", kick);
  setInterval(kick, 30_000);
  // Only one tab uploads at a time. The lock is held for the life of the page; the next tab takes over when it closes.
  if (navigator.locks) navigator.locks.request("journal-upload-manager", loop);
  else loop();
};
