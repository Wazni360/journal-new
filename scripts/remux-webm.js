// Makes WebM entries seekable. Chrome's MediaRecorder writes WebM with no duration and no seek index (Cues), so the
// player shows an endless timeline and can't jump ahead. This rewrites the container around the same audio and video
// data — no re-encoding — and points the entry at the new file.
//
//   node scripts/remux-webm.js --dry-run       # download, remux and verify every entry; writes nothing
//   node scripts/remux-webm.js                 # apply
//   --id <entry id>                            # only this entry
//
// H.264 can't live in a proper WebM, so it becomes an MP4 (`video.mp4`, faststart). VP8/VP9/AV1 stay WebM with Cues
// written up front (`video.seekable.webm`). The original object is never modified or deleted: once nothing refers to
// it, `prune-r2 --strays` can remove it. The row only changes after the new file decodes to exactly the same audio
// and video as the original and R2 reports the expected size. Needs ffmpeg/ffprobe on PATH.
import "dotenv/config";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import knex from "knex";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const run = promisify(execFile);
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyId = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;

const env = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
  // R2 rejects the CRC32 checksum headers newer SDK versions add by default.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const bucket = env("R2_BUCKET");

const SEEKABLE_WEBM = "video.seekable.webm";

const download = async (key, path) => {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(res.Body, createWriteStream(path));
};

const headSize = async (key) => (await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))).ContentLength;

const videoCodec = async (path) => {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", path]);
  return stdout.trim();
};

const duration = async (path) => {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]);
  const seconds = Number(stdout.trim());
  return seconds > 0 ? Math.round(seconds * 1000) / 1000 : null;
};

// Hash of every decoded stream. Equal hashes mean the new file plays back exactly the same pictures and sound.
// Passthrough stops ffmpeg duplicating/dropping frames to a constant rate, which it would do differently for each
// container's timestamp rounding and make identical frames hash differently.
const decodedHash = async (path) => {
  const { stdout } = await run("ffmpeg", ["-v", "quiet", "-i", path, "-map", "0", "-fps_mode", "passthrough", "-f", "streamhash", "-hash", "sha256", "-"], {
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim().split("\n").sort().join(" ");
};

const remux = (input, output, codec) =>
  run("ffmpeg", ["-v", "error", "-y", "-i", input, "-map", "0", "-c", "copy", ...(codec === "h264" ? ["-movflags", "+faststart"] : ["-cues_to_front", "1"]), output]);

const db = knex({
  client: "pg",
  connection: { connectionString: env("DATABASE_URL"), ssl: { rejectUnauthorized: false } },
  pool: { min: 0, max: 1 },
});

const work = await mkdtemp(join(tmpdir(), "journal-remux-"));
try {
  const query = db("entries").where({ status: "uploaded" }).whereNull("deleted_at").where("mime_type", "like", "video/webm%").orderBy("recorded_at");
  if (onlyId) query.where({ id: onlyId });
  const rows = (await query).filter((row) => !row.video_key.endsWith(`/${SEEKABLE_WEBM}`));
  console.log(`${rows.length} WebM entr${rows.length === 1 ? "y" : "ies"} to make seekable\n`);

  let done = 0;
  for (const row of rows) {
    const label = `${row.recorded_at.toISOString().slice(0, 16)}Z ${row.id}${row.title ? ` "${row.title}"` : ""}`;
    const input = join(work, `${row.id}.in`);
    try {
      process.stdout.write(`${label} … `);
      await download(row.video_key, input);
      if ((await stat(input)).size !== Number(row.size_bytes)) throw new Error(`R2 object doesn't match the row's size_bytes (${row.size_bytes})`);

      const codec = await videoCodec(input);
      const toMp4 = codec === "h264";
      const output = join(work, `${row.id}.out.${toMp4 ? "mp4" : "webm"}`);
      await remux(input, output, codec);

      const [before, after] = await Promise.all([decodedHash(input), decodedHash(output)]);
      if (!before || before !== after) throw new Error("remuxed file doesn't decode to the same audio/video; left as is");
      const seconds = await duration(output);
      if (!seconds) throw new Error("remuxed file still has no duration; left as is");

      const size = (await stat(output)).size;
      const key = `entries/${row.id}/${toMp4 ? "video.mp4" : SEEKABLE_WEBM}`;
      const mimeType = toMp4 ? "video/mp4" : "video/webm";
      if (dryRun) {
        console.log(`ok: ${codec} → ${key}, ${seconds}s, ${size} bytes`);
        done++;
        continue;
      }

      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: createReadStream(output), ContentLength: size, ContentType: mimeType }));
      if ((await headSize(key)) !== size) throw new Error(`R2 has the wrong size for ${key}; row not changed`);

      const [updated] = await db("entries").where({ id: row.id }).update({ video_key: key, mime_type: mimeType, size_bytes: size, duration_seconds: seconds }).returning("*");
      const meta = { ...updated, size_bytes: Number(updated.size_bytes), duration_seconds: Number(updated.duration_seconds) };
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: `entries/${row.id}/meta.json`, Body: JSON.stringify(meta, null, 2), ContentType: "application/json" }));
      console.log(`done: ${key} (original kept at ${row.video_key})`);
      done++;
    } catch (err) {
      console.log(`FAILED: ${err.message.split("\n")[0]}`);
    } finally {
      await rm(input, { force: true });
      await rm(join(work, `${row.id}.out.mp4`), { force: true });
      await rm(join(work, `${row.id}.out.webm`), { force: true });
    }
  }

  console.log(`\n${dryRun ? "dry run: " : ""}${done} of ${rows.length} ${dryRun ? "verified, nothing written" : "made seekable"}`);
  if (!dryRun && done) console.log("once you've checked them, `npm run prune-r2 -- --delete --strays` removes the originals");
  process.exitCode = done < rows.length ? 1 : 0;
} finally {
  await rm(work, { recursive: true, force: true });
  await db.destroy();
}
