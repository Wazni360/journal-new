// Deletes objects in R2 that nothing refers to any more.
//
//   node scripts/prune-r2.js                          # report only (default)
//   node scripts/prune-r2.js --delete --orphans       # delete objects with no database row
//   node scripts/prune-r2.js --delete --deleted       # delete objects of soft-deleted entries, and their rows
//   node scripts/prune-r2.js --delete --strays        # delete unreferenced files inside a live entry's folder
//   node scripts/prune-r2.js --delete --all           # all three
//   --older-than 7                                    # only touch objects at least this many days old (default 7)
//   --abort-uploads                                   # also abort incomplete multipart uploads older than the cutoff
//
// Deleting from R2 is permanent: R2 has no versioning, so there is nothing to undo with. Objects of a live entry are
// never touched, and the script refuses to run at all if the database doesn't describe the bucket.
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import knex from "knex";
import { AbortMultipartUploadCommand, DeleteObjectCommand, ListMultipartUploadsCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { classifyObjects, olderThan, safetyCheck, summarize } from "../lib/prune.js";

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i === -1 ? fallback : Number(args[i + 1]);
};

const doDelete = has("--delete");
const days = valueOf("--older-than", 7);
const wanted = {
  orphan: has("--orphans") || has("--all"),
  deleted: has("--deleted") || has("--all"),
  stray: has("--strays") || has("--all"),
};
const abortUploads = has("--abort-uploads");

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

const db = knex({
  client: "pg",
  connection: { connectionString: env("DATABASE_URL"), ssl: { rejectUnauthorized: false } },
  pool: { min: 0, max: 1 },
});

const listAll = async () => {
  const objects = [];
  let token;
  do {
    const res = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    objects.push(...(res.Contents ?? []).map((o) => ({ key: o.Key, size: o.Size, lastModified: o.LastModified })));
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return objects;
};

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const report = (label, items) => {
  const { count, bytes } = summarize(items);
  console.log(`\n${label}: ${count} object${count === 1 ? "" : "s"}, ${mb(bytes)}`);
  for (const item of items) console.log(`  ${item.key}  ${mb(item.size)}  (${item.reason})`);
};

try {
  const [objects, rows] = await Promise.all([listAll(), db("entries").select("id", "video_key", "audio_key", "thumb_key", "deleted_at")]);
  const groups = classifyObjects(objects, rows);

  console.log(`bucket r2://${bucket}: ${objects.length} objects, ${mb(summarize(objects).bytes)}`);
  console.log(`database: ${rows.length} entries (${rows.filter((r) => r.deleted_at).length} soft-deleted)`);
  console.log(`keeping ${groups.keep.length} objects referenced by live entries, ${mb(summarize(groups.keep).bytes)}`);

  report("Orphans (no database row)", groups.orphan);
  report("Objects of soft-deleted entries", groups.deleted);
  report("Strays inside a live entry's folder", groups.stray);

  const uploads = abortUploads
    ? (await s3.send(new ListMultipartUploadsCommand({ Bucket: bucket })))?.Uploads?.filter((u) => olderThan({ lastModified: u.Initiated }, days)) ?? []
    : [];
  if (abortUploads) console.log(`\nIncomplete multipart uploads older than ${days} days: ${uploads.length}`);

  const selected = Object.entries(wanted)
    .filter(([, on]) => on)
    .flatMap(([group]) => groups[group])
    .filter((item) => olderThan(item, days));
  const skippedForAge = Object.entries(wanted)
    .filter(([, on]) => on)
    .flatMap(([group]) => groups[group]).length - selected.length;

  if (!doDelete) {
    console.log(`\nReport only. Nothing was deleted. Re-run with --delete plus --orphans / --deleted / --strays / --all to remove.`);
    process.exit(0);
  }
  if (!selected.length && !uploads.length) {
    console.log(`\nNothing selected to delete${skippedForAge ? ` (${skippedForAge} skipped: newer than ${days} days)` : ""}.`);
    process.exit(0);
  }

  const check = safetyCheck({ objects, rows, keepCount: groups.keep.length });
  if (!check.safe) {
    console.error(`\nRefusing to delete: ${check.reason}`);
    process.exit(1);
  }

  const { count, bytes } = summarize(selected);
  console.log(`\nAbout to permanently delete ${count} object${count === 1 ? "" : "s"} (${mb(bytes)})${uploads.length ? ` and abort ${uploads.length} multipart upload(s)` : ""}.`);
  if (skippedForAge) console.log(`${skippedForAge} object(s) skipped for being newer than ${days} days.`);
  if (wanted.deleted && groups.deleted.length) console.log("Rows for fully purged soft-deleted entries will also be removed from the database.");
  console.log("R2 has no versioning, so this cannot be undone.");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question("Type the number of objects to confirm: ");
  rl.close();
  if (answer.trim() !== String(count)) {
    console.log("Not confirmed; nothing deleted.");
    process.exit(1);
  }

  for (const item of selected) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: item.key }));
    console.log(`deleted ${item.key}`);
  }
  for (const u of uploads) {
    await s3.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: u.Key, UploadId: u.UploadId }));
    console.log(`aborted multipart upload for ${u.Key}`);
  }

  if (wanted.deleted) {
    const purgedIds = [...new Set(groups.deleted.map((i) => i.id))].filter((id) => groups.deleted.filter((i) => i.id === id).every((i) => selected.includes(i)));
    if (purgedIds.length) {
      await db("entries").whereIn("id", purgedIds).del();
      console.log(`removed ${purgedIds.length} soft-deleted row(s) from the database`);
    }
  }
  console.log(`\ndone: ${count} object(s) deleted, ${mb(bytes)} freed`);
} finally {
  await db.destroy();
}
