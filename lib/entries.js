import "server-only";
import { getDb } from "@/lib/db";
import { keys, putJson } from "@/lib/r2";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID.test(v);

// pg returns bigint columns as strings; the API speaks numbers.
export const serializeEntry = (row) => (row ? { ...row, size_bytes: row.size_bytes == null ? null : Number(row.size_bytes), duration_seconds: row.duration_seconds == null ? null : Number(row.duration_seconds) } : null);

export const getEntry = (id) => getDb()("entries").where({ id }).first();

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
