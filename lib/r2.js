import "server-only";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
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
const bucket = () => requireEnv("R2_BUCKET");
const send = (command) => getR2().send(command);

export const extensionFor = (mimeType) => (mimeType.startsWith("video/mp4") ? "mp4" : "webm");

export const keys = {
  video: (id, mimeType) => `entries/${id}/video.${extensionFor(mimeType)}`,
  audio: (id) => `entries/${id}/audio.webm`,
  thumb: (id) => `entries/${id}/thumb.jpg`,
  meta: (id) => `entries/${id}/meta.json`,
};

export const assetContentTypes = { audio: "audio/webm", thumb: "image/jpeg" };

export const checkBucket = () => send(new HeadBucketCommand({ Bucket: bucket() }));

export const createMultipartUpload = async (key, contentType) => {
  const res = await send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: contentType }));
  return res.UploadId;
};

export const abortMultipartUpload = async (key, uploadId) => {
  try {
    await send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }));
  } catch (err) {
    console.warn("[r2] abort ignored:", err.name);
  }
};

export const listAllParts = async (key, uploadId) => {
  const parts = [];
  let marker;
  do {
    const res = await send(new ListPartsCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, MaxParts: 1000, PartNumberMarker: marker }));
    parts.push(...(res.Parts ?? []).map((p) => ({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size })));
    marker = res.IsTruncated ? res.NextPartNumberMarker : undefined;
  } while (marker);
  return parts;
};

export const completeMultipartUpload = (key, uploadId, parts) =>
  send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
    }),
  );

// Returns null when the object doesn't exist.
export const headObject = async (key) => {
  try {
    const res = await send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: res.ContentLength, contentType: res.ContentType };
  } catch (err) {
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
};

export const presignUploadPart = (key, uploadId, partNumber, expiresIn) =>
  getSignedUrl(getR2(), new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }), { expiresIn });

export const presignGetObject = (key, expiresIn, responseContentDisposition) =>
  getSignedUrl(getR2(), new GetObjectCommand({ Bucket: bucket(), Key: key, ResponseContentDisposition: responseContentDisposition }), { expiresIn });

export const presignPutObject = (key, contentType, expiresIn) =>
  getSignedUrl(getR2(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn });

export const putJson = (key, value) =>
  send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: JSON.stringify(value, null, 2), ContentType: "application/json" }));

export const isNoSuchUpload = (err) => err?.name === "NoSuchUpload" || err?.Code === "NoSuchUpload";
