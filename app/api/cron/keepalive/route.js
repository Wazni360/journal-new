import { getDb } from "@/lib/db";
import { requireEnv } from "@/lib/env";
import { handler, json } from "@/lib/http";

// Vercel Cron, daily. Supabase pauses a free project after a stretch of inactivity, which would take the journal
// offline; a couple of cheap queries a day keep it awake. Vercel sends `Authorization: Bearer $CRON_SECRET`.
export const GET = handler(async (request) => {
  if (request.headers.get("authorization") !== `Bearer ${requireEnv("CRON_SECRET")}`) return json({ error: "unauthorized" }, 401);

  const db = getDb();
  const [{ count: entries }] = await db("entries").whereNull("deleted_at").count({ count: "*" });
  const [{ count: uploading }] = await db("entries").where({ status: "uploading" }).whereNull("deleted_at").count({ count: "*" });
  await db("login_attempts").where("attempted_at", "<", db.raw("now() - interval '30 days'")).del();

  return json({ ok: true, entries: Number(entries), uploading: Number(uploading), at: new Date().toISOString() });
});
