import "server-only";
import { UPLOAD } from "@/lib/config";
import { getDb } from "@/lib/db";
import { keys, presignGetObject, putJson } from "@/lib/r2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID.test(v);

// pg returns bigint columns as strings; the API speaks numbers.
export const serializeEntry = (row) => (row ? { ...row, size_bytes: row.size_bytes == null ? null : Number(row.size_bytes), duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds) } : null);

export const getEntry = (id) => getDb()("entries").where({ id }).first();

// One library page for a parsed query (see `parseEntriesQuery`). Shared by `GET /api/entries` and the server-rendered
// first page. Thumbnail URLs are presigned here (a local signature, no network call), so the library doesn't make a
// request per row for them.
export const listEntries = async ({ page: requestedPage, pageSize, order, from, to }) => {
  const filtered = getDb()("entries").whereNull("deleted_at");
  if (from) filtered.where("recorded_at", ">=", from);
  if (to) filtered.where("recorded_at", "<=", to);

  const [{ count }] = await filtered.clone().count({ count: "*" });
  const total = Number(count);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Entries may have been deleted since the page was last rendered; answer the last real page rather than nothing.
  const page = Math.min(requestedPage, pageCount);
  // `id` breaks ties, so two entries with the same timestamp can't swap sides of a page boundary.
  const rows = await filtered
    .orderBy("recorded_at", order)
    .orderBy("id", order)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const entries = await Promise.all(
    rows.map(async (row) => ({
      ...serializeEntry(row),
      thumb_url: row.thumb_key ? await presignGetObject(row.thumb_key, UPLOAD.playbackUrlTtlSeconds) : null,
    })),
  );
  return { entries, page, pageCount, pageSize, total };
};

export const updateEntry = async (id, patch) => {
  const [row] = await getDb()("entries").where({ id }).update(patch).returning("*");
  return row;
};

// R2 is the source of truth; the DB is a rebuildable index. Every row change is mirrored to meta.json.
export const writeMeta = (row) => putJson(keys.meta(row.id), serializeEntry(row));

export class EntryError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const loadEntryOr404 = async (id) => {
  if (!isUuid(id)) throw new EntryError(400, "invalid id");
  const entry = await getEntry(id);
  if (!entry || entry.deleted_at) throw new EntryError(404, "entry not found");
  return entry;
};
