import { formatBytes } from "@/lib/format";

// One place for the words the user reads about an upload. Honest by construction: nothing says "done" before the
// server has verified the object.
export const uploadCopy = (row, status) => {
  if (!status) return { text: row.status === "recording" ? "Recording now in another tab." : "Saved on this Mac. Waiting to upload.", tone: "muted" };
  const { phase, message, uploadedBytes = 0, totalBytes = row.totalBytes } = status;
  if (message) return { text: message, tone: phase === "held" ? "accent" : "muted" };
  switch (phase) {
    case "recording":
      return { text: `Recording. Uploaded ${formatBytes(uploadedBytes)} so far.`, tone: "muted" };
    case "uploading":
      return { text: `Uploading ${formatBytes(uploadedBytes)} of ${formatBytes(totalBytes)}.`, tone: "muted" };
    case "verifying":
      return { text: "Verifying with the server.", tone: "muted" };
    case "assets":
      return { text: "Video verified. Uploading audio and thumbnail.", tone: "muted" };
    case "done":
      return { text: "Uploaded and verified.", tone: "ok" };
    default:
      return { text: "Saved on this Mac. Waiting to upload.", tone: "muted" };
  }
};

export const uploadProgress = (status) => {
  if (!status?.totalBytes) return null;
  if (status.phase === "done") return 1;
  return Math.min(1, (status.uploadedBytes ?? 0) / status.totalBytes);
};
