import { getChunkRows } from "@/lib/local";
import { filenameStamp } from "@/lib/format";

export const extensionFor = (mimeType) => (mimeType.startsWith("video/mp4") ? "mp4" : "webm");

// extraChunks: blobs that never made it into IndexedDB (storage write failures), appended after the stored ones.
export const buildRecordingBlob = async (row, { store = "chunks", extraChunks = [] } = {}) => {
  const rows = await getChunkRows(store, row.id);
  const mimeType = store === "audioChunks" ? "audio/webm" : row.mimeType;
  return new Blob([...rows.map((r) => r.blob), ...extraChunks], { type: mimeType });
};

export const recordingFilename = (row, kind = "video") =>
  `journal-${filenameStamp(row.recordedAt)}${kind === "audio" ? "-audio" : ""}.${kind === "audio" ? "webm" : extensionFor(row.mimeType)}`;

export const saveBlob = (blob, filename) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
};

export const downloadRecording = async (row, options) => {
  const blob = await buildRecordingBlob(row, options);
  saveBlob(blob, recordingFilename(row));
};
