import { describe, expect, it } from "vitest";
import { buildPartBlob, checkChunkIntegrity, chunksForRange, partCount, partRange, readyPartNumbers, uploadedBytes } from "@/lib/parts";
import { verifyParts } from "@/lib/verify-parts";
import { backoffDelayMs } from "@/lib/backoff";

const P = 10 * 1024 * 1024;

// Chunk rows as the recorder writes them: contiguous, cumulative offsets.
const chunksOf = (...sizes) => {
  let offset = 0;
  return sizes.map((size, seq) => {
    const row = { seq, size, offset, blob: new Blob([new Uint8Array(size).fill(seq % 251)]) };
    offset += size;
    return row;
  });
};

describe("part boundaries", () => {
  it("counts parts, including a short final one", () => {
    expect(partCount(P, P)).toBe(1);
    expect(partCount(P + 1, P)).toBe(2);
    expect(partCount(P * 3 - 1, P)).toBe(3);
  });

  it("ranges are contiguous and clamp to totalBytes", () => {
    const total = P * 2 + 1234;
    expect(partRange(1, total, P)).toEqual({ start: 0, end: P });
    expect(partRange(2, total, P)).toEqual({ start: P, end: P * 2 });
    expect(partRange(3, total, P)).toEqual({ start: P * 2, end: total });
    expect(() => partRange(4, total, P)).toThrow(/out of range/);
  });

  it("only offers full parts while recording, and the last part once stopped", () => {
    expect(readyPartNumbers(P * 2 + 5, P, false)).toEqual([1, 2]);
    expect(readyPartNumbers(P * 2 + 5, P, true)).toEqual([1, 2, 3]);
    expect(readyPartNumbers(P - 1, P, false)).toEqual([]);
    expect(readyPartNumbers(P - 1, P, true)).toEqual([1]); // a short single part is allowed
    expect(readyPartNumbers(P * 2, P, true)).toEqual([1, 2]); // exact multiple: no empty trailing part
  });
});

describe("chunk selection", () => {
  const rows = chunksOf(4 * 1024 * 1024, 4 * 1024 * 1024, 4 * 1024 * 1024, 4 * 1024 * 1024); // 16 MiB over 4 chunks

  it("picks exactly the chunks overlapping a range", () => {
    expect(chunksForRange(rows, 0, P).map((r) => r.seq)).toEqual([0, 1, 2]); // 10 MiB spans chunks 0..2
    expect(chunksForRange(rows, P, 16 * 1024 * 1024).map((r) => r.seq)).toEqual([2, 3]);
  });

  it("excludes a chunk that merely touches the boundary", () => {
    expect(chunksForRange(rows, 4 * 1024 * 1024, 8 * 1024 * 1024).map((r) => r.seq)).toEqual([1]);
  });

  it("builds part blobs of exactly the right size", async () => {
    const total = rows.reduce((n, r) => n + r.size, 0);
    const p1 = buildPartBlob(rows, 1, total, P);
    const p2 = buildPartBlob(rows, 2, total, P);
    expect(p1.size).toBe(P);
    expect(p2.size).toBe(total - P);
    expect(p1.size + p2.size).toBe(total);
  });

  it("part bytes match the concatenated stream", async () => {
    const small = chunksOf(3, 5, 7, 2); // 17 bytes
    const total = 17;
    const partSize = 5;
    const whole = new Uint8Array(await new Blob(small.map((r) => r.blob)).arrayBuffer());
    for (let n = 1; n <= partCount(total, partSize); n++) {
      const { start, end } = partRange(n, total, partSize);
      const bytes = new Uint8Array(await buildPartBlob(small, n, total, partSize).arrayBuffer());
      expect([...bytes]).toEqual([...whole.slice(start, end)]);
    }
  });
});

describe("local integrity", () => {
  it("accepts a contiguous chunk list", () => {
    const rows = chunksOf(10, 20, 30);
    expect(checkChunkIntegrity(rows, 60)).toEqual({ ok: true });
  });

  it("rejects a gap, a bad offset, or a size mismatch", () => {
    const rows = chunksOf(10, 20, 30);
    expect(checkChunkIntegrity([rows[0], rows[2]], 40).ok).toBe(false);
    expect(checkChunkIntegrity([rows[0], { ...rows[1], offset: 11 }], 30).ok).toBe(false);
    expect(checkChunkIntegrity(rows, 61).ok).toBe(false);
  });

  it("sums confirmed part sizes", () => {
    expect(uploadedBytes([{ size: 10 }, { size: 20 }, {}])).toBe(30);
  });
});

describe("server-side part verification", () => {
  const parts = (...sizes) => sizes.map((size, i) => ({ partNumber: i + 1, size, etag: `"${i}"` }));

  it("accepts equal parts with a short last one", () => {
    expect(verifyParts(parts(P, P, 500), P * 2 + 500, P)).toEqual({ ok: true });
  });

  it("accepts a single short part", () => {
    expect(verifyParts(parts(500), 500, P)).toEqual({ ok: true });
  });

  it("names the parts to retry when one is missing", () => {
    const result = verifyParts([{ partNumber: 1, size: P }, { partNumber: 3, size: 500 }], P * 2 + 500, P);
    expect(result.ok).toBe(false);
    expect(result.retryParts).toEqual([2]);
  });

  it("names the parts to retry when one is short", () => {
    const result = verifyParts(parts(P, P - 1, 500), P * 2 + 500, P);
    expect(result.retryParts).toEqual([2]);
  });

  it("asks for a restart when there are parts beyond the expected count", () => {
    const result = verifyParts(parts(P, P, 500, 10), P * 2 + 500, P);
    expect(result.ok).toBe(false);
    expect(result.restart).toBe(true);
  });

  it("rejects a bad totalBytes", () => {
    expect(verifyParts(parts(P), 0, P).ok).toBe(false);
    expect(verifyParts(parts(P), 1.5, P).ok).toBe(false);
  });

  it("is order-independent", () => {
    const unordered = [{ partNumber: 3, size: 500 }, { partNumber: 1, size: P }, { partNumber: 2, size: P }];
    expect(verifyParts(unordered, P * 2 + 500, P)).toEqual({ ok: true });
  });
});

describe("backoff", () => {
  it("doubles and caps at 60s, never below half the ceiling", () => {
    const min = (a) => backoffDelayMs(a, { random: () => 0 });
    const max = (a) => backoffDelayMs(a, { random: () => 0.999999 });
    expect([min(1), max(1)]).toEqual([500, 1000]);
    expect([min(2), max(2)]).toEqual([1000, 2000]);
    expect([min(7), max(7)]).toEqual([30000, 60000]);
    expect([min(50), max(50)]).toEqual([30000, 60000]);
  });

  it("stays within bounds for random jitter", () => {
    for (let a = 1; a <= 12; a++) {
      const d = backoffDelayMs(a);
      expect(d).toBeGreaterThanOrEqual(Math.min(60000, 1000 * 2 ** (a - 1)) / 2);
      expect(d).toBeLessThanOrEqual(60000);
    }
  });
});

describe("library formatting", () => {
  it("groups entries into months in order", async () => {
    const { monthKey, formatMonth } = await import("@/lib/format");
    expect(monthKey("2026-09-22T10:00:00Z")).toBe("2026-09");
    expect(monthKey("2026-01-02T23:59:00Z")).toMatch(/^2026-0[12]$/); // local time may shift the day, never the year
    expect(formatMonth("2026-09-22T10:00:00Z")).toMatch(/September 2026/);
  });

  it("builds download filenames from the recorded time", async () => {
    const { filenameStamp } = await import("@/lib/format");
    expect(filenameStamp("2026-09-22T13:05:00")).toBe("2026-09-22-1305");
  });

  it("formats durations and sizes for the list", async () => {
    const { formatDuration, formatBytes } = await import("@/lib/format");
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
  });
});
