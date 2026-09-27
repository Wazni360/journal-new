import { IMPORT } from "@/lib/config";
import { getLocalDb, localEvents, newRecordingRow, putThumb } from "@/lib/local";

// Importing an existing video file. The file is sliced into IndexedDB exactly like recorded chunks, so everything
// downstream — the upload manager, verification, the library — treats it as an ordinary entry.

export const isSupportedFile = (file) => Boolean(IMPORT.accept[file.type]) || /\.(mp4|webm|mov|m4v)$/i.test(file.name);

export const normalizeType = (file) => {
  if (IMPORT.accept[file.type]) return file.type === "video/quicktime" ? "video/mp4" : file.type;
  return /\.webm$/i.test(file.name) ? "video/webm" : "video/mp4";
};

// Number of local chunks a file of this size becomes.
export const chunkPlan = (size, chunkSize = IMPORT.chunkSizeBytes) => {
  const count = Math.max(1, Math.ceil(size / chunkSize));
  return Array.from({ length: count }, (_, i) => ({ seq: i, offset: i * chunkSize, size: Math.min(chunkSize, size - i * chunkSize) }));
};

const withVideoElement = async (file, fn) => {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error("This file can't be read as video by Chrome."));
      setTimeout(() => reject(new Error("Timed out reading the file's metadata.")), 20_000);
    });
    return await fn(video);
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
  }
};

// MediaRecorder files often report Infinity until Chrome scans them; seeking far past the end forces a real duration.
const resolveDuration = (video) =>
  new Promise((resolve) => {
    if (Number.isFinite(video.duration) && video.duration > 0) return resolve(video.duration);
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.addEventListener("seeked", done);
    video.currentTime = 1e101;
    setTimeout(done, 5_000);
  });

export const probeFile = (file) =>
  withVideoElement(file, async (video) => ({
    durationMs: Math.round((await resolveDuration(video)) * 1000),
    width: video.videoWidth || null,
    height: video.videoHeight || null,
  }));

export const captureThumbnail = (file, atSeconds = 2) =>
  withVideoElement(file, async (video) => {
    const duration = await resolveDuration(video);
    await new Promise((resolve) => {
      video.onseeked = resolve;
      video.currentTime = Math.min(atSeconds, Math.max(0, duration / 2));
      setTimeout(resolve, 5_000);
    });
    if (!video.videoWidth) return null;
    const scale = Math.min(1, 640 / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  });

// Writes the file into IndexedDB as a stopped recording. Slices are Blob views, so nothing is held in memory.
export const importFile = async (file, { recordedAt, onProgress } = {}) => {
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > IMPORT.maxBytes) throw new Error("That file is larger than this app supports.");
  if (!isSupportedFile(file)) throw new Error("Only MP4, MOV and WebM video files can be imported.");

  const mimeType = normalizeType(file);
  const id = crypto.randomUUID();
  const meta = await probeFile(file).catch(() => ({ durationMs: 0, width: null, height: null }));
  const thumb = await captureThumbnail(file).catch(() => null);

  const db = await getLocalDb();
  await db.put("recordings", {
    ...newRecordingRow({
      id,
      recordedAt: (recordedAt ?? new Date()).toISOString(),
      mimeType,
      codecLabel: "imported",
      width: meta.width,
      height: meta.height,
    }),
    status: "importing", // not uploadable until every chunk is written
    durationMs: meta.durationMs,
  });

  const plan = chunkPlan(file.size);
  for (const part of plan) {
    const tx = db.transaction(["chunks", "recordings"], "readwrite");
    await tx.objectStore("chunks").put({ recordingId: id, seq: part.seq, blob: file.slice(part.offset, part.offset + part.size), size: part.size, offset: part.offset });
    const row = await tx.objectStore("recordings").get(id);
    await tx.objectStore("recordings").put({ ...row, totalBytes: part.offset + part.size, chunkCount: part.seq + 1, updatedAt: Date.now() });
    await tx.done;
    onProgress?.({ written: part.offset + part.size, total: file.size });
  }

  if (thumb) await putThumb(id, thumb);
  const row = await db.get("recordings", id);
  await db.put("recordings", { ...row, status: "stopped", updatedAt: Date.now() });
  localEvents.dispatchEvent(new Event("change"));
  return { id, totalBytes: file.size, chunkCount: plan.length, ...meta, hasThumbnail: Boolean(thumb) };
};
