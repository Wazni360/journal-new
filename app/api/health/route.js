import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { checkBucket } from "@/lib/r2";
import { handler, json } from "@/lib/http";

const probe = async (fn) => {
  try {
    await fn();
    return "ok";
  } catch (err) {
    return `error: ${err.name || "Error"}: ${err.message}`;
  }
};

export const GET = handler(async () => {
  await requireSession();
  const [db, r2] = await Promise.all([probe(() => getDb().raw("select 1")), probe(checkBucket)]);
  return json({ db, r2 }, db === "ok" && r2 === "ok" ? 200 : 503);
});
