import { IMPORT, RECORDING } from "@/lib/config";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getEntry, isUuid, serializeEntry, updateEntry, writeMeta } from "@/lib/entries";
import { createMultipartUpload, keys } from "@/lib/r2";
import { badRequest, handler, json, readJson } from "@/lib/http";

// Recorded entries carry a full codec string; imported files carry the plain container type.
const allowedMimeTypes = new Set([...RECORDING.videoCandidates.map((c) => c.mimeType), ...Object.keys(IMPORT.accept).map((t) => (t === "video/quicktime" ? "video/mp4" : t))]);

const uploadResponse = (entry) => json({ id: entry.id, key: entry.video_key, uploadId: entry.upload_id, status: entry.status });

export const GET = handler(async () => {
  await requireSession();
  const rows = await getDb()("entries").whereNull("deleted_at").orderBy("recorded_at", "desc");
  return json({ entries: rows.map(serializeEntry) });
});

// Idempotent: the client generated the id and may call this again after a failed or interrupted attempt.
export const POST = handler(async (request) => {
  await requireSession();
  const body = await readJson(request);
  const { id, recordedAt, mimeType, codecLabel } = body ?? {};
  if (!isUuid(id)) return badRequest("id must be a uuid");
  if (!recordedAt || Number.isNaN(Date.parse(recordedAt))) return badRequest("recordedAt must be a date");
  if (!allowedMimeTypes.has(mimeType)) return badRequest("unsupported mimeType");
  if (typeof codecLabel !== "string" || codecLabel.length > 32) return badRequest("codecLabel required");

  let entry = await getEntry(id);
  if (entry?.status === "uploaded") return uploadResponse(entry);
  if (entry?.upload_id) return uploadResponse(entry);

  const key = entry?.video_key ?? keys.video(id, mimeType);
  if (!entry) {
    [entry] = await getDb()("entries")
      .insert({ id, recorded_at: recordedAt, mime_type: mimeType, codec_label: codecLabel, video_key: key, status: "uploading" })
      .onConflict("id")
      .ignore()
      .returning("*");
    entry ??= await getEntry(id); // lost a race with a concurrent identical request
  }
  // A previous attempt may have inserted the row and then failed to reach R2; finish the job here.
  const uploadId = await createMultipartUpload(key, mimeType);
  entry = await updateEntry(id, { upload_id: uploadId });
  await writeMeta(entry);
  return uploadResponse(serializeEntry(entry));
});
