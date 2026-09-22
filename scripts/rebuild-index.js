// Rebuilds the `entries` table from the meta.json files in R2.
//
// R2 is the source of truth; the database is a rebuildable index. Run this after losing or resetting the database:
//
//   node scripts/rebuild-index.js --dry-run     # show what would change
//   node scripts/rebuild-index.js               # apply
//
// Reads R2 and writes Postgres only. It never deletes or modifies objects in the bucket.
import "dotenv/config";
import knex from "knex";
import { ListObjectsV2Command, GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { planRebuild } from "../lib/rebuild.js";

const dryRun = process.argv.includes("--dry-run");
const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
});
const bucket = env("R2_BUCKET");

const listMetaKeys = async () => {
  const keys = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "entries/", ContinuationToken: token }));
    keys.push(...(res.Contents ?? []).map((o) => o.Key).filter((k) => k.endsWith("/meta.json")));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return keys;
};

const readMeta = async (key) => {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return JSON.parse(await res.Body.transformToString());
};

const db = knex({
  client: "pg",
  connection: { connectionString: env("DATABASE_URL"), ssl: { rejectUnauthorized: false } },
  pool: { min: 0, max: 1 },
});

try {
  const keys = await listMetaKeys();
  console.log(`found ${keys.length} meta.json file${keys.length === 1 ? "" : "s"} in r2://${bucket}/entries/`);

  const metas = [];
  const unreadable = [];
  for (const key of keys) {
    try {
      metas.push(await readMeta(key));
    } catch (err) {
      unreadable.push({ key, reason: err.message });
    }
  }

  const existing = await db("entries").select("*");
  const existingById = new Map(existing.map((row) => [row.id, row]));

  const plan = [];
  const rejected = [...unreadable];
  for (const meta of metas) {
    try {
      plan.push(...planRebuild([meta], existingById));
    } catch (err) {
      rejected.push({ key: `entries/${meta?.id}/meta.json`, reason: err.message });
    }
  }

  const counts = { insert: 0, update: 0, unchanged: 0 };
  for (const item of plan) counts[item.action]++;
  const orphaned = existing.filter((row) => !plan.some((p) => p.row.id === row.id));

  console.log(`${counts.insert} to insert, ${counts.update} to update, ${counts.unchanged} already correct`);
  for (const item of plan.filter((p) => p.action !== "unchanged")) console.log(`  ${item.action.padEnd(6)} ${item.row.id}  ${item.row.recorded_at}  ${item.row.status}`);
  if (orphaned.length) {
    console.log(`\n${orphaned.length} row${orphaned.length === 1 ? "" : "s"} in the database with no meta.json in R2 (left alone):`);
    for (const row of orphaned) console.log(`  ${row.id}  ${row.video_key}`);
  }
  if (rejected.length) {
    console.log(`\n${rejected.length} file${rejected.length === 1 ? "" : "s"} skipped:`);
    for (const r of rejected) console.log(`  ${r.key}: ${r.reason}`);
  }

  if (dryRun) {
    console.log("\ndry run: nothing written");
  } else {
    const writes = plan.filter((p) => p.action !== "unchanged");
    for (const item of writes) await db("entries").insert(item.row).onConflict("id").merge();
    console.log(`\nwrote ${writes.length} row${writes.length === 1 ? "" : "s"}`);
  }
  process.exitCode = rejected.length ? 1 : 0;
} finally {
  await db.destroy();
}
