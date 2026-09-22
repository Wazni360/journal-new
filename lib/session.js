import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { requireEnv } from "@/lib/env";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const secretKey = () => new TextEncoder().encode(requireEnv("SESSION_SECRET"));

export const createSessionToken = () =>
  new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());

export const verifySessionToken = async (token) => {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.sub === "owner" ? payload : null;
  } catch {
    return null;
  }
};

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
});
