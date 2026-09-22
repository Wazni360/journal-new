// Turning a meta.json object from R2 back into an `entries` row. Pure, so it can be tested without touching R2.

const COLUMNS = [
  "id",
  "created_at",
  "recorded_at",
  "duration_seconds",
  "title",
  "status",
  "video_key",
  "upload_id",
  "mime_type",
  "codec_label",
  "width",
  "height",
  "size_bytes",
  "audio_key",
  "thumb_key",
  "transcript",
  "transcript_status",
  "deleted_at",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const rowFromMeta = (meta) => {
  if (!meta || typeof meta !== "object") throw new Error("meta.json is not an object");
  if (!UUID.test(meta.id ?? "")) throw new Error("meta.json has no valid id");
  if (!meta.video_key) throw new Error(`${meta.id}: meta.json has no video_key`);
  if (!meta.recorded_at || Number.isNaN(Date.parse(meta.recorded_at))) throw new Error(`${meta.id}: meta.json has no valid recorded_at`);
  if (!meta.mime_type) throw new Error(`${meta.id}: meta.json has no mime_type`);

  const row = {};
  for (const column of COLUMNS) if (meta[column] !== undefined) row[column] = meta[column];
  // An entry that never finished uploading has nothing to serve, so it is not restored as uploaded.
  row.status = meta.status === "uploaded" ? "uploaded" : "uploading";
  row.codec_label ??= "unknown";
  row.transcript_status ??= "none";
  return row;
};

// pg returns timestamptz as Date and bigint as string, while meta.json holds ISO strings and numbers. Compare on a
// normalized form, otherwise every row looks changed on every run.
const normalize = (value) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const asDate = Date.parse(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(asDate)) return new Date(asDate).toISOString();
    const asNumber = Number(value);
    if (value.trim() !== "" && Number.isFinite(asNumber)) return String(asNumber);
  }
  return String(value);
};

// What a rebuild would change, compared with what's in the database now.
export const planRebuild = (metas, existingById) =>
  metas.map((meta) => {
    const row = rowFromMeta(meta);
    const existing = existingById.get(row.id);
    if (!existing) return { action: "insert", row };
    const changed = Object.keys(row).filter((k) => normalize(existing[k]) !== normalize(row[k]));
    return changed.length ? { action: "update", row, changed } : { action: "unchanged", row };
  });
