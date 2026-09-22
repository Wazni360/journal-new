import { requireSession } from "@/lib/auth";
import { loadEntryOr404, updateEntry, writeMeta } from "@/lib/entries";
import { assetContentTypes, headObject, keys } from "@/lib/r2";
import { badRequest, handler, json, readJson } from "@/lib/http";

const columns = { audio: "audio_key", thumb: "thumb_key" };

export const POST = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  await loadEntryOr404(id);
  const body = await readJson(request);
  const { type, size } = body ?? {};
  if (!assetContentTypes[type]) return badRequest("type must be 'audio' or 'thumb'");

  const key = keys[type](id);
  const head = await headObject(key);
  if (!head) return json({ confirmed: false, reason: "object not found" });
  if (Number.isInteger(size) && head.size !== size) return json({ confirmed: false, reason: `object is ${head.size} bytes, expected ${size}` });

  const updated = await updateEntry(id, { [columns[type]]: key });
  await writeMeta(updated);
  return json({ confirmed: true, key, size: head.size });
});
