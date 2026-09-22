import { describe, expect, it } from "vitest";
import { classifyObjects, entryIdFromKey, olderThan, safetyCheck, summarize } from "@/lib/prune";

const id = "3c0f60df-acf6-45cf-9686-2731b6f621c2";
const gone = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const obj = (key, size = 100) => ({ key, size, lastModified: "2026-09-01T00:00:00.000Z" });

const liveRow = {
  id,
  video_key: `entries/${id}/video.mp4`,
  audio_key: `entries/${id}/audio.webm`,
  thumb_key: `entries/${id}/thumb.jpg`,
  deleted_at: null,
};

describe("classifying objects", () => {
  it("keeps every file a live entry points at, including meta.json", () => {
    const objects = [obj(liveRow.video_key), obj(liveRow.audio_key), obj(liveRow.thumb_key), obj(`entries/${id}/meta.json`)];
    const groups = classifyObjects(objects, [liveRow]);
    expect(groups.keep.map((o) => o.key)).toEqual(objects.map((o) => o.key));
    expect(groups.orphan.concat(groups.stray, groups.deleted)).toEqual([]);
  });

  it("flags a leftover file in a live entry's folder as a stray, never as keep", () => {
    const groups = classifyObjects([obj(liveRow.video_key), obj(`entries/${id}/video.webm`)], [liveRow]);
    expect(groups.stray.map((o) => o.key)).toEqual([`entries/${id}/video.webm`]);
    expect(groups.keep).toHaveLength(1);
  });

  it("groups every file of a soft-deleted entry together", () => {
    const row = { ...liveRow, deleted_at: "2026-09-20T00:00:00.000Z" };
    const groups = classifyObjects([obj(row.video_key), obj(`entries/${id}/meta.json`)], [row]);
    expect(groups.deleted).toHaveLength(2);
    expect(groups.deleted[0].reason).toMatch(/deleted 2026-09-20/);
    expect(groups.keep).toEqual([]);
  });

  it("treats files with no row as orphans", () => {
    const groups = classifyObjects([obj(`entries/${gone}/video.mp4`), obj("stray-at-the-root.txt")], [liveRow]);
    expect(groups.orphan).toHaveLength(2);
    expect(groups.orphan[1].reason).toMatch(/not under entries/);
  });

  it("never puts a live entry's file in a deletable group", () => {
    const objects = [obj(liveRow.video_key), obj(`entries/${gone}/video.mp4`)];
    const groups = classifyObjects(objects, [liveRow, { ...liveRow, id: "other", deleted_at: "2026-09-01" }]);
    for (const group of ["orphan", "deleted", "stray"]) {
      expect(groups[group].some((o) => o.key === liveRow.video_key)).toBe(false);
    }
  });

  it("reads the entry id out of a key", () => {
    expect(entryIdFromKey(`entries/${id}/video.mp4`)).toBe(id);
    expect(entryIdFromKey("nope.txt")).toBeNull();
  });
});

describe("safety checks", () => {
  it("refuses when the database has no entries, so a lost index can't wipe the bucket", () => {
    expect(safetyCheck({ objects: [obj("a")], rows: [], keepCount: 0 })).toEqual({ safe: false, reason: expect.stringMatching(/rebuild the index/) });
  });

  it("refuses when nothing in the bucket is referenced by a live entry", () => {
    expect(safetyCheck({ objects: [obj("a")], rows: [liveRow], keepCount: 0 }).safe).toBe(false);
  });

  it("allows a prune when the index still describes the bucket", () => {
    expect(safetyCheck({ objects: [obj("a")], rows: [liveRow], keepCount: 1 })).toEqual({ safe: true });
  });
});

describe("age cutoff", () => {
  const now = Date.parse("2026-09-22T00:00:00.000Z");

  it("protects recent objects", () => {
    expect(olderThan({ lastModified: "2026-09-21T00:00:00.000Z" }, 7, now)).toBe(false);
    expect(olderThan({ lastModified: "2026-09-01T00:00:00.000Z" }, 7, now)).toBe(true);
  });

  it("sums sizes for the report", () => {
    expect(summarize([obj("a", 10), obj("b", 20)])).toEqual({ count: 2, bytes: 30 });
  });
});
