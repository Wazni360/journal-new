import { UPLOAD } from "@/lib/config";
import { requireSession } from "@/lib/auth";
import { loadEntryOr404, serializeEntry, updateEntry, writeMeta } from "@/lib/entries";
import { completeMultipartUpload, headObject, isNoSuchUpload, listAllParts } from "@/lib/r2";
import { verifyParts } from "@/lib/verify-parts";
import { badRequest, handler, json, readJson } from "@/lib/http";

const notVerified = (reason, extra = {}) => json({ verified: false, reason, ...extra });

// Verifies the multipart upload part by part, completes it, and confirms the final object's size before the row is
// marked uploaded. Idempotent: a repeat call for an already-uploaded entry re-checks the object and returns verified.
export const POST = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  const entry = await loadEntryOr404(id);

  const body = await readJson(request);
  const { totalBytes, durationSeconds, width, height } = body ?? {};
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) return badRequest("totalBytes must be a positive integer");

  if (entry.status === "uploaded") {
    const head = await headObject(entry.video_key);
    if (!head) return notVerified("entry is marked uploaded but the object is missing", { restart: true });
    return head.size === totalBytes ? json({ verified: true }) : notVerified(`object is ${head.size} bytes, expected ${totalBytes}`);
  }
  if (!entry.upload_id) return notVerified("no multipart upload in progress", { restart: true });

  let parts;
  try {
    parts = await listAllParts(entry.video_key, entry.upload_id);
  } catch (err) {
    if (isNoSuchUpload(err)) return notVerified("NoSuchUpload", { restart: true });
    throw err;
  }

  const check = verifyParts(parts, totalBytes, UPLOAD.partSizeBytes);
  if (!check.ok) return notVerified(check.reason, { retryParts: check.retryParts, restart: check.restart });

  try {
    await completeMultipartUpload(entry.video_key, entry.upload_id, parts);
  } catch (err) {
    if (isNoSuchUpload(err)) return notVerified("NoSuchUpload", { restart: true });
    throw err;
  }

  const head = await headObject(entry.video_key);
  if (!head) return notVerified("object missing after complete", { restart: true });
  if (head.size !== totalBytes) return notVerified(`object is ${head.size} bytes, expected ${totalBytes}`, { restart: true });

  const updated = await updateEntry(id, {
    status: "uploaded",
    upload_id: null,
    size_bytes: totalBytes,
    duration_seconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
    width: Number.isInteger(width) ? width : null,
    height: Number.isInteger(height) ? height : null,
  });
  await writeMeta(updated);
  return json({ verified: true, entry: serializeEntry(updated) });
});
