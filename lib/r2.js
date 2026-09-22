import "server-only";
import { S3Client, HeadBucketCommand } from "@aws-sdk/client-s3";
import { requireEnv } from "@/lib/env";

const create = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
    // R2 rejects the CRC32 checksum headers newer SDK versions add by default.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

export const getR2 = () => (globalThis.__journalR2 ??= create());
export const bucket = () => requireEnv("R2_BUCKET");

export const extensionFor = (mimeType) => (mimeType.startsWith("video/mp4") ? "mp4" : "webm");

export const keys = {
  video: (id, mimeType) => `entries/${id}/video.${extensionFor(mimeType)}`,
  audio: (id) => `entries/${id}/audio.webm`,
  thumb: (id) => `entries/${id}/thumb.jpg`,
  meta: (id) => `entries/${id}/meta.json`,
};

export const checkBucket = () => getR2().send(new HeadBucketCommand({ Bucket: bucket() }));
