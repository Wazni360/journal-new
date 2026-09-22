import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { badRequest, getClientIp, handler, json } from "@/lib/http";

const MAX_FAILURES = 5;
const WINDOW = "15 minutes";

export const POST = handler(async (request) => {
  const body = await request.json().catch(() => null);
  const password = body?.password;
  if (typeof password !== "string" || !password) return badRequest("password required");

  const db = getDb();
  const ip = getClientIp(request);
  const [{ count }] = await db("login_attempts")
    .where({ ip, success: false })
    .andWhere("attempted_at", ">", db.raw(`now() - interval '${WINDOW}'`))
    .count({ count: "*" });
  if (Number(count) > MAX_FAILURES) return json({ error: "too many attempts" }, 429);

  const ok = await verifyPassword(password);
  await db("login_attempts").insert({ ip, success: ok });
  if (!ok) return json({ error: "wrong password" }, 401);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(), sessionCookieOptions());
  return response;
});
