import { describe, expect, it } from "vitest";
import { planRebuild, rowFromMeta } from "@/lib/rebuild";

const meta = (over = {}) => ({
  id: "3c0f60df-acf6-45cf-9686-2731b6f621c2",
  created_at: "2026-09-22T11:00:00.000Z",
  recorded_at: "2026-09-22T10:48:43.390Z",
  duration_seconds: 11.454,
  title: "A quiet Tuesday",
  status: "uploaded",
  video_key: "entries/3c0f60df-acf6-45cf-9686-2731b6f621c2/video.mp4",
  upload_id: null,
  mime_type: "video/mp4;codecs=hvc1.1.6.L153.B0",
  codec_label: "hevc",
  width: 1760,
  height: 1328,
  size_bytes: 5911450,
  audio_key: "entries/3c0f60df-acf6-45cf-9686-2731b6f621c2/audio.webm",
  thumb_key: "entries/3c0f60df-acf6-45cf-9686-2731b6f621c2/thumb.jpg",
  transcript: null,
  transcript_status: "none",
  deleted_at: null,
  ...over,
});

describe("rebuilding a row from meta.json", () => {
  it("round-trips every column", () => {
    const row = rowFromMeta(meta());
    expect(row.id).toBe(meta().id);
    expect(row.title).toBe("A quiet Tuesday");
    expect(row.size_bytes).toBe(5911450);
    expect(row.thumb_key).toBe(meta().thumb_key);
    expect(row.status).toBe("uploaded");
  });

  it("keeps a soft delete", () => {
    expect(rowFromMeta(meta({ deleted_at: "2026-09-22T12:00:00.000Z" })).deleted_at).toBe("2026-09-22T12:00:00.000Z");
  });

  it("never restores an unfinished upload as uploaded", () => {
    expect(rowFromMeta(meta({ status: "uploading", size_bytes: null })).status).toBe("uploading");
    expect(rowFromMeta(meta({ status: "something else" })).status).toBe("uploading");
  });

  it("rejects meta.json that can't identify an object", () => {
    expect(() => rowFromMeta(meta({ id: "nope" }))).toThrow(/valid id/);
    expect(() => rowFromMeta(meta({ video_key: null }))).toThrow(/video_key/);
    expect(() => rowFromMeta(meta({ recorded_at: "not a date" }))).toThrow(/recorded_at/);
    expect(() => rowFromMeta(meta({ mime_type: undefined }))).toThrow(/mime_type/);
    expect(() => rowFromMeta(null)).toThrow();
  });

  it("fills in defaults an older meta.json might lack", () => {
    const { codec_label, transcript_status, ...older } = meta();
    const row = rowFromMeta(older);
    expect(row.codec_label).toBe("unknown");
    expect(row.transcript_status).toBe("none");
  });
});

describe("rebuild plan", () => {
  it("inserts what the database doesn't have", () => {
    expect(planRebuild([meta()], new Map())[0].action).toBe("insert");
  });

  it("leaves an identical row alone", () => {
    const row = rowFromMeta(meta());
    expect(planRebuild([meta()], new Map([[row.id, row]]))[0].action).toBe("unchanged");
  });

  it("updates a row that drifted from R2", () => {
    const row = { ...rowFromMeta(meta()), title: "stale title" };
    expect(planRebuild([meta()], new Map([[row.id, row]]))[0].action).toBe("update");
  });

  it("compares loosely enough for pg's string bigints and Date objects", () => {
    const row = { ...rowFromMeta(meta()), size_bytes: "5911450", recorded_at: new Date(meta().recorded_at) };
    // pg hands these back typed differently from the JSON in R2; that alone must not look like a change.
    expect(planRebuild([meta({ recorded_at: new Date(meta().recorded_at).toISOString() })], new Map([[row.id, row]]))[0].action).toBe("unchanged");
  });
});

describe("comparison normalization", () => {
  it("names the columns that actually differ", () => {
    const row = { ...rowFromMeta(meta()), title: "stale", width: 640 };
    const plan = planRebuild([meta()], new Map([[row.id, row]]))[0];
    expect(plan.changed.sort()).toEqual(["title", "width"]);
  });

  it("numeric duration from pg matches the JSON number", () => {
    const row = { ...rowFromMeta(meta()), duration_seconds: "11.454" };
    expect(planRebuild([meta()], new Map([[row.id, row]]))[0].action).toBe("unchanged");
  });

  it("a title that looks numeric is still compared as text", () => {
    const row = { ...rowFromMeta(meta({ title: "2026" })), title: "2026" };
    expect(planRebuild([meta({ title: "2026" })], new Map([[row.id, row]]))[0].action).toBe("unchanged");
    expect(planRebuild([meta({ title: "2027" })], new Map([[row.id, row]]))[0].action).toBe("update");
  });
});
