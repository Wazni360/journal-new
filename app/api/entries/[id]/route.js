import { requireSession } from "@/lib/auth";
import { loadEntryOr404, serializeEntry, updateEntry, writeMeta } from "@/lib/entries";
import { badRequest, handler, json, readJson } from "@/lib/http";

const MAX_TITLE = 200;

export const GET = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  return json({ entry: serializeEntry(await loadEntryOr404(id)) });
});

export const PATCH = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  await loadEntryOr404(id);
  const body = (await readJson(request)) ?? {};
  if (!("title" in body) && !("recordedAt" in body)) return badRequest("title or recordedAt required");
  const patch = {};

  if ("title" in body) {
    const { title } = body;
    if (title !== null && typeof title !== "string") return badRequest("title must be a string or null");
    if (typeof title === "string" && title.length > MAX_TITLE) return badRequest(`title must be at most ${MAX_TITLE} characters`);
    patch.title = title?.trim() || null;
  }
  if ("recordedAt" in body) {
    const { recordedAt } = body;
    if (typeof recordedAt !== "string" || Number.isNaN(Date.parse(recordedAt))) return badRequest("recordedAt must be a date");
    patch.recorded_at = new Date(recordedAt).toISOString();
  }

  const updated = await updateEntry(id, patch);
  await writeMeta(updated);
  return json({ entry: serializeEntry(updated) });
});

// Soft delete only. The objects stay in R2; there is no hard-delete endpoint in v1.
export const DELETE = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  await loadEntryOr404(id);
  const updated = await updateEntry(id, { deleted_at: new Date() });
  await writeMeta(updated);
  return json({ deleted: true });
});
