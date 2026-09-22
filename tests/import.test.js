import { describe, expect, it } from "vitest";
import { chunkPlan, dateFromFilename } from "@/lib/import";

describe("import filenames", () => {
  it("reads the timestamp out of a spike download", () => {
    const d = dateFromFilename("spike-hevc-2026-09-22-13-02.mp4");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 9, 22, 13, 2]);
  });

  it("reads the timestamp out of a journal download", () => {
    const d = dateFromFilename("journal-2026-09-22-1302.mp4");
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([22, 13, 2]);
  });

  it("falls back to midday for a date-only name", () => {
    const d = dateFromFilename("holiday-2025-12-24.mp4");
    expect([d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([12, 24, 12]);
  });

  it("returns null when there's no date to read", () => {
    expect(dateFromFilename("IMG_0042.mov")).toBeNull();
    expect(dateFromFilename("clip.mp4")).toBeNull();
  });
});

describe("import chunking", () => {
  const P = 5 * 1024 * 1024;

  it("covers the file exactly, with a short final chunk", () => {
    const plan = chunkPlan(P * 2 + 1234, P);
    expect(plan.map((c) => c.size)).toEqual([P, P, 1234]);
    expect(plan.at(-1).offset + plan.at(-1).size).toBe(P * 2 + 1234);
  });

  it("offsets are contiguous", () => {
    let expected = 0;
    for (const c of chunkPlan(P * 3 + 7, P)) {
      expect(c.offset).toBe(expected);
      expected += c.size;
    }
  });

  it("a file smaller than one chunk is a single chunk", () => {
    expect(chunkPlan(10, P)).toEqual([{ seq: 0, offset: 0, size: 10 }]);
  });

  it("an exact multiple produces no empty trailing chunk", () => {
    expect(chunkPlan(P * 2, P).map((c) => c.size)).toEqual([P, P]);
  });
});
