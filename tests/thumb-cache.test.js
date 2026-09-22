import { describe, expect, it, vi } from "vitest";
import { applyThumbs, isInSync, thumbDiff } from "@/lib/thumb-cache";

describe("thumbnail cache reconciliation", () => {
  it("reports nothing to do when the cache matches the rows", () => {
    const cache = new Map([["a", "blob:a"], ["b", null]]);
    expect(thumbDiff(new Set(["a", "b"]), cache)).toEqual({ missing: [], stale: [] });
    expect(isInSync(new Set(["a", "b"]), cache)).toBe(true);
  });

  it("treats a cached null (no thumbnail yet) as present, not missing", () => {
    // Otherwise the effect would fetch it forever and spin the main thread.
    expect(isInSync(new Set(["a"]), new Map([["a", null]]))).toBe(true);
  });

  it("names entries to add and to drop", () => {
    expect(thumbDiff(new Set(["a", "c"]), new Map([["a", "blob:a"], ["b", "blob:b"]]))).toEqual({ missing: ["c"], stale: ["b"] });
  });

  it("revokes only the urls it drops", () => {
    const revoke = vi.fn();
    const next = applyThumbs(new Map([["a", "blob:a"], ["b", "blob:b"]]), [], ["b"], revoke);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:b");
    expect([...next.keys()]).toEqual(["a"]);
  });

  it("reaches a fixed point after one application", () => {
    const ids = new Set(["a", "b"]);
    let cache = new Map();
    const revoke = vi.fn();
    cache = applyThumbs(cache, [["a", new Blob(["x"])], ["b", null]], [], revoke);
    expect(isInSync(ids, cache)).toBe(true); // second pass has nothing to do: no state update, no loop
  });
});

describe("upload copy", () => {
  const row = { id: "r", status: "stopped", totalBytes: 5_000_000 };

  it("never calls a stopped recording 'recording'", async () => {
    const { uploadCopy } = await import("@/lib/upload-copy");
    expect(uploadCopy(row, { phase: "recording", uploadedBytes: 0, totalBytes: 0 }).text).not.toMatch(/^Recording/);
  });

  it("falls back to the row's size when the status hasn't counted bytes yet", async () => {
    const { uploadCopy } = await import("@/lib/upload-copy");
    expect(uploadCopy(row, { phase: "uploading", uploadedBytes: 0, totalBytes: 0 }).text).toBe("Saved on this Mac. Uploading 4.8 MB.");
  });

  it("only says uploaded once the server has verified it", async () => {
    const { uploadCopy } = await import("@/lib/upload-copy");
    expect(uploadCopy(row, { phase: "verifying" }).tone).toBe("muted");
    expect(uploadCopy(row, { phase: "assets" }).text).toMatch(/Video verified/);
    expect(uploadCopy(row, { phase: "done" })).toEqual({ text: "Uploaded and verified.", tone: "ok" });
  });
});
