import { UPLOAD } from "@/lib/config";
import { requireSession } from "@/lib/auth";
import { loadEntryOr404 } from "@/lib/entries";
import { extensionFor, presignGetObject } from "@/lib/r2";
import { filenameStamp } from "@/lib/format";
import { badRequest, handler, json } from "@/lib/http";

const columnFor = { video: "video_key", audio: "audio_key", thumb: "thumb_key" };
const extFor = { audio: "webm", thumb: "jpg" };

export const GET = handler(async (request, { params }) => {
  await requireSession();
  const { id } = await params;
  const entry = await loadEntryOr404(id);

  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") ?? "video";
  if (!columnFor[kind]) return badRequest("kind must be video, audio or thumb");
  const key = entry[columnFor[kind]];
  if (!key) return json({ error: `no ${kind} for this entry` }, 404);

  const disposition =
    searchParams.get("download") === "1"
      ? `attachment; filename="journal-${filenameStamp(entry.recorded_at)}${kind === "video" ? "" : `-${kind}`}.${kind === "video" ? extensionFor(entry.mime_type) : extFor[kind]}"`
      : undefined;

  const url = await presignGetObject(key, UPLOAD.playbackUrlTtlSeconds, disposition);
  return json({ url, expiresInSeconds: UPLOAD.playbackUrlTtlSeconds });
});
