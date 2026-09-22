import { openDB } from "idb";
import { LOCAL } from "@/lib/config";

const DB_NAME = "journal";
const DB_VERSION = 1;

let dbPromise;
export const getLocalDb = () =>
  (dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade: (db) => {
      db.createObjectStore("recordings", { keyPath: "id" });
      db.createObjectStore("chunks", { keyPath: ["recordingId", "seq"] });
      db.createObjectStore("audioChunks", { keyPath: ["recordingId", "seq"] });
      db.createObjectStore("thumbs");
    },
  }));

// Fires "change" after any write to the recordings store, so lists can refresh.
export const localEvents = typeof EventTarget === "undefined" ? null : new EventTarget();
const notify = () => localEvents?.dispatchEvent(new Event("change"));

export const newRecordingRow = ({ id, recordedAt, mimeType, codecLabel, width, height }) => ({
  id,
  recordedAt,
  mimeType,
  codecLabel,
  status: "recording",
  totalBytes: 0,
  chunkCount: 0,
  audioBytes: 0,
  audioChunkCount: 0,
  durationMs: 0,
  width,
  height,
  upload: null,
  serverInitialized: false,
  audioUploaded: false,
  thumbUploaded: false,
  videoVerified: false,
  interrupted: false,
  updatedAt: Date.now(),
});

export const putRecording = async (row) => {
  const db = await getLocalDb();
  await db.put("recordings", { ...row, updatedAt: Date.now() });
  notify();
};

export const getRecording = async (id) => (await getLocalDb()).get("recordings", id);

export const listRecordings = async () => {
  const rows = await (await getLocalDb()).getAll("recordings");
  return rows.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
};

// Read-modify-write in one transaction so concurrent patches (heartbeat, chunk writes) don't clobber each other.
export const patchRecording = async (id, patch) => {
  const db = await getLocalDb();
  const tx = db.transaction("recordings", "readwrite");
  const row = await tx.store.get(id);
  if (!row) throw new Error(`local recording ${id} missing`);
  const next = { ...row, ...(typeof patch === "function" ? patch(row) : patch), updatedAt: Date.now() };
  await tx.store.put(next);
  await tx.done;
  notify();
  return next;
};

// Chunk and row counters are written in the same transaction, so they can never disagree.
export const appendChunk = async ({ store, recordingId, seq, blob }) => {
  const db = await getLocalDb();
  const tx = db.transaction([store, "recordings"], "readwrite");
  const rows = tx.objectStore("recordings");
  const row = await rows.get(recordingId);
  if (!row) throw new Error(`local recording ${recordingId} missing`);
  const isAudio = store === "audioChunks";
  const offset = isAudio ? row.audioBytes : row.totalBytes;
  await tx.objectStore(store).put({ recordingId, seq, blob, size: blob.size, offset });
  const next = isAudio
    ? { ...row, audioBytes: offset + blob.size, audioChunkCount: seq + 1 }
    : { ...row, totalBytes: offset + blob.size, chunkCount: seq + 1 };
  await rows.put({ ...next, updatedAt: Date.now() });
  await tx.done;
  notify();
  return next;
};

const chunkRange = (recordingId) => IDBKeyRange.bound([recordingId, 0], [recordingId, Infinity]);

// Returns chunks in seq order and throws if any seq is missing: a gap means the file is not valid.
export const getChunkRows = async (store, recordingId) => {
  const db = await getLocalDb();
  const rows = await db.getAll(store, chunkRange(recordingId));
  rows.sort((a, b) => a.seq - b.seq);
  rows.forEach((r, i) => {
    if (r.seq !== i) throw new Error(`chunk sequence gap in ${store} for ${recordingId}: expected ${i}, found ${r.seq}`);
  });
  return rows;
};

export const putThumb = async (recordingId, blob) => (await getLocalDb()).put("thumbs", blob, recordingId);
export const getThumb = async (recordingId) => (await getLocalDb()).get("thumbs", recordingId);

// Removes one chunk store for a recording. Called only after the server has verified those bytes.
export const deleteChunks = async (store, recordingId) => {
  const db = await getLocalDb();
  const tx = db.transaction(store, "readwrite");
  let cursor = await tx.store.openCursor(chunkRange(recordingId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
};

export const deleteRecordingLocal = async (recordingId) => {
  const db = await getLocalDb();
  const tx = db.transaction(["recordings", "chunks", "audioChunks", "thumbs"], "readwrite");
  await tx.objectStore("recordings").delete(recordingId);
  await tx.objectStore("thumbs").delete(recordingId);
  for (const store of ["chunks", "audioChunks"]) {
    let cursor = await tx.objectStore(store).openCursor(chunkRange(recordingId));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
  notify();
};


// Any 'recording' row that hasn't been stamped recently belonged to a tab that died. Mark it stopped so it can be
// downloaded and (later) uploaded. The stamp threshold keeps a recording in another live tab from being clobbered.
export const recoverInterrupted = async () => {
  const cutoff = Date.now() - LOCAL.staleAfterMs;
  const rows = await listRecordings();
  const stale = rows.filter((r) => r.status === "recording" && r.updatedAt < cutoff);
  for (const row of stale) {
    await patchRecording(row.id, { status: "stopped", interrupted: true });
  }
  return { recovered: stale.length, stillRecording: rows.filter((r) => r.status === "recording").length - stale.length };
};
