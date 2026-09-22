import { UPLOAD } from "@/lib/config";
import { requireSession } from "@/lib/auth";
import { loadEntryOr404 } from "@/lib/entries";
import { assetContentTypes, keys, presignPutObject } from "@/lib/r2";
import { badRequest, handler, json, readJson } from "@/lib/http";

export const POST = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  await loadEntryOr404(id);
  const body = await readJson(request);
  const type = body?.type;
  if (!assetContentTypes[type]) return badRequest("type must be 'audio' or 'thumb'");
  const key = keys[type](id);
  const url = await presignPutObject(key, assetContentTypes[type], UPLOAD.partUrlTtlSeconds);
  return json({ key, url, contentType: assetContentTypes[type] });
});
