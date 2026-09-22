import "server-only";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { requireEnv } from "@/lib/env";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const verifyPassword = (password) => {
  const hash = Buffer.from(requireEnv("APP_PASSWORD_HASH_B64"), "base64").toString("utf8");
  return bcrypt.compare(password, hash);
};

export const getSession = async () => {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
};

// Every route handler calls this itself. Proxy only handles page redirects.
export const requireSession = async () => {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
};

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.status = 401;
  }
}
