import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-that-is-long-enough-for-hs256";
});

describe("session tokens", () => {
  it("round-trips", async () => {
    const { createSessionToken, verifySessionToken } = await import("@/lib/session");
    const token = await createSessionToken();
    const payload = await verifySessionToken(token);
    expect(payload.sub).toBe("owner");
    expect(payload.exp - payload.iat).toBe(30 * 24 * 60 * 60);
  });

  it("rejects a tampered token", async () => {
    const { createSessionToken, verifySessionToken } = await import("@/lib/session");
    const token = await createSessionToken();
    const [h, p, s] = token.split(".");
    expect(await verifySessionToken(`${h}.${p}.${s.slice(0, -2)}xx`)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const { createSessionToken, verifySessionToken } = await import("@/lib/session");
    const token = await createSessionToken();
    process.env.SESSION_SECRET = "a-different-secret-that-is-also-long-enough";
    expect(await verifySessionToken(token)).toBeNull();
    process.env.SESSION_SECRET = "test-secret-that-is-long-enough-for-hs256";
  });

  it("returns null for missing or garbage input", async () => {
    const { verifySessionToken } = await import("@/lib/session");
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("not-a-jwt")).toBeNull();
  });
});
