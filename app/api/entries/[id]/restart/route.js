import { requireSession } from "@/lib/auth";
import { loadEntryOr404, updateEntry, writeMeta } from "@/lib/entries";
import { abortMultipartUpload, createMultipartUpload } from "@/lib/r2";
import { handler, json } from "@/lib/http";

// The old multipart upload is gone or unusable (R2 aborts them after 7 days). Start a fresh one; the client
// re-uploads every part from its local copy.
export const POST = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  const entry = await loadEntryOr404(id);
  if (entry.status === "uploaded") return json({ error: "entry is already uploaded" }, 409);

  if (entry.upload_id) await abortMultipartUpload(entry.video_key, entry.upload_id);
  const uploadId = await createMultipartUpload(entry.video_key, entry.mime_type);
  const updated = await updateEntry(id, { upload_id: uploadId });
  await writeMeta(updated);
  return json({ id, key: entry.video_key, uploadId });
});
