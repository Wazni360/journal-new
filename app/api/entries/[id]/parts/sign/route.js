import { UPLOAD } from "@/lib/config";
import { requireSession } from "@/lib/auth";
import { loadEntryOr404 } from "@/lib/entries";
import { presignUploadPart } from "@/lib/r2";
import { badRequest, handler, json, readJson } from "@/lib/http";

const MAX_BATCH = 20;

export const POST = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  const entry = await loadEntryOr404(id);

  const body = await readJson(request);
  const partNumbers = body?.partNumbers;
  if (!Array.isArray(partNumbers) || !partNumbers.length || partNumbers.length > MAX_BATCH) return badRequest(`partNumbers must be 1..${MAX_BATCH} items`);
  if (!partNumbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 10_000)) return badRequest("part numbers must be integers in 1..10000");
  if (!entry.upload_id) return json({ error: "no multipart upload in progress" }, 409);

  const urls = await Promise.all(
    partNumbers.map(async (partNumber) => ({ partNumber, url: await presignUploadPart(entry.video_key, entry.upload_id, partNumber, UPLOAD.partUrlTtlSeconds) })),
  );
  return json({ urls, expiresInSeconds: UPLOAD.partUrlTtlSeconds });
});
