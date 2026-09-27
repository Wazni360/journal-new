import { describe, expect, it } from "vitest";
import { chunkPlan } from "@/lib/import";

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
