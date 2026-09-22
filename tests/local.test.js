import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const load = async () => {
  globalThis.indexedDB = new IDBFactory(); // fresh database per test
  vi.resetModules(); // drop the module-level db singleton too
  return import("@/lib/local");
};

const blob = (n) => new Blob([new Uint8Array(n)]);

const row = (local, over = {}) =>
  local.newRecordingRow({ id: "r1", recordedAt: "2026-09-22T10:00:00.000Z", mimeType: "video/mp4", codecLabel: "hevc", width: 1760, height: 1328, ...over });

describe("local chunk storage", () => {
  let local;
  beforeEach(async () => {
    local = await load();
    await local.putRecording(row(local));
  });

  it("tracks cumulative offsets and counts per chunk", async () => {
    await local.appendChunk({ store: "chunks", recordingId: "r1", seq: 0, blob: blob(100) });
    await local.appendChunk({ store: "chunks", recordingId: "r1", seq: 1, blob: blob(50) });
    const r = await local.appendChunk({ store: "chunks", recordingId: "r1", seq: 2, blob: blob(25) });
    expect(r.totalBytes).toBe(175);
    expect(r.chunkCount).toBe(3);
    const rows = await local.getChunkRows("chunks", "r1");
    expect(rows.map((c) => [c.seq, c.offset, c.size])).toEqual([
      [0, 0, 100],
      [1, 100, 50],
      [2, 150, 25],
    ]);
  });

  it("keeps audio and video counters separate", async () => {
    await local.appendChunk({ store: "chunks", recordingId: "r1", seq: 0, blob: blob(100) });
    const r = await local.appendChunk({ store: "audioChunks", recordingId: "r1", seq: 0, blob: blob(7) });
    expect(r.totalBytes).toBe(100);
    expect(r.audioBytes).toBe(7);
    expect(r.audioChunkCount).toBe(1);
  });

  it("refuses to assemble when a seq is missing", async () => {
    await local.appendChunk({ store: "chunks", recordingId: "r1", seq: 0, blob: blob(10) });
    await local.appendChunk({ store: "chunks", recordingId: "r1", seq: 2, blob: blob(10) });
    await expect(local.getChunkRows("chunks", "r1")).rejects.toThrow(/gap/);
  });

  it("does not mix chunks from different recordings", async () => {
    await local.putRecording(row(local, { id: "r2" }));
    await local.appendChunk({ store: "chunks", recordingId: "r1", seq: 0, blob: blob(10) });
    await local.appendChunk({ store: "chunks", recordingId: "r2", seq: 0, blob: blob(20) });
    await local.appendChunk({ store: "chunks", recordingId: "r2", seq: 1, blob: blob(20) });
    expect((await local.getChunkRows("chunks", "r1")).length).toBe(1);
    expect((await local.getChunkRows("chunks", "r2")).length).toBe(2);
  });

  it("deletes every store for a recording and nothing else", async () => {
    await local.putRecording(row(local, { id: "r2" }));
    await local.appendChunk({ store: "chunks", recordingId: "r1", seq: 0, blob: blob(10) });
    await local.appendChunk({ store: "audioChunks", recordingId: "r1", seq: 0, blob: blob(10) });
    await local.appendChunk({ store: "chunks", recordingId: "r2", seq: 0, blob: blob(10) });
    await local.putThumb("r1", blob(5));
    await local.deleteRecordingLocal("r1");
    expect(await local.getRecording("r1")).toBeUndefined();
    expect(await local.getThumb("r1")).toBeUndefined();
    expect(await local.getChunkRows("chunks", "r1")).toEqual([]);
    expect(await local.getChunkRows("audioChunks", "r1")).toEqual([]);
    expect((await local.getChunkRows("chunks", "r2")).length).toBe(1);
  });
});

describe("crash recovery", () => {
  it("marks stale 'recording' rows stopped and leaves fresh ones alone", async () => {
    const local = await load();
    const { LOCAL } = await import("@/lib/config");
    await local.putRecording(row(local, { id: "stale" }));
    await local.putRecording(row(local, { id: "fresh" }));
    const db = await local.getLocalDb();
    const stale = await db.get("recordings", "stale");
    await db.put("recordings", { ...stale, updatedAt: Date.now() - LOCAL.staleAfterMs - 1 });

    const result = await local.recoverInterrupted();
    expect(result).toEqual({ recovered: 1, stillRecording: 1 });
    expect((await local.getRecording("stale")).status).toBe("stopped");
    expect((await local.getRecording("stale")).interrupted).toBe(true);
    expect((await local.getRecording("fresh")).status).toBe("recording");
  });
});
