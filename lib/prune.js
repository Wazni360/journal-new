// Deciding which objects in R2 nothing refers to any more. Pure, so the rules are testable without touching a bucket.
//
// Categories:
//   keep        — a key a live (not soft-deleted) entry points at
//   stray       — a key inside a live entry's folder that the row doesn't reference (e.g. a video.webm left behind
//                 when the recording was remade as video.mp4)
//   deleted     — every key belonging to a soft-deleted entry
//   orphan      — every key under an entry id with no row in the database at all

export const entryIdFromKey = (key) => key.match(/^entries\/([^/]+)\//)?.[1] ?? null;

const referencedKeys = (row) => new Set([row.video_key, row.audio_key, row.thumb_key, `entries/${row.id}/meta.json`].filter(Boolean));

export const classifyObjects = (objects, rows) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const out = { keep: [], stray: [], deleted: [], orphan: [] };
  for (const object of objects) {
    const id = entryIdFromKey(object.key);
    const row = id ? byId.get(id) : null;
    if (!id) out.orphan.push({ ...object, id: null, reason: "not under entries/<id>/" });
    else if (!row) out.orphan.push({ ...object, id, reason: "no row in the database" });
    else if (row.deleted_at) out.deleted.push({ ...object, id, reason: `entry deleted ${new Date(row.deleted_at).toISOString().slice(0, 10)}` });
    else if (!referencedKeys(row).has(object.key)) out.stray.push({ ...object, id, reason: "not referenced by the entry" });
    else out.keep.push({ ...object, id });
  }
  return out;
};

// A rebuilt or empty index would make every object look orphaned, so deletion is refused unless the database still
// describes the bucket. This is the guard that keeps a prune from wiping the source of truth.
export const safetyCheck = ({ objects, rows, keepCount }) => {
  if (!objects.length) return { safe: false, reason: "the bucket is empty" };
  if (!rows.length) return { safe: false, reason: "the entries table is empty — rebuild the index first (scripts/rebuild-index.js)" };
  if (!keepCount) return { safe: false, reason: "no object in the bucket is referenced by a live entry, which suggests the index is out of date" };
  return { safe: true };
};

export const olderThan = (item, days, now = Date.now()) => now - new Date(item.lastModified).getTime() >= days * 86_400_000;

export const summarize = (items) => ({ count: items.length, bytes: items.reduce((n, i) => n + (i.size ?? 0), 0) });
