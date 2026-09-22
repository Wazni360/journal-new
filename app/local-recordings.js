"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Button, Progress, Status, Thumb } from "@/app/ui";
import { deleteRecordingLocal, getThumb, listRecordings, localEvents, recoverInterrupted } from "@/lib/local";
import { downloadRecording } from "@/lib/download";
import { getAllUploadStatuses, resumeUpload, subscribeUploads } from "@/lib/uploader";
import { uploadCopy, uploadProgress } from "@/lib/upload-copy";
import { formatBytes, formatDate, formatDuration, formatTime } from "@/lib/format";
import { applyThumbs, thumbDiff } from "@/lib/thumb-cache";

const emptyStatuses = new Map();

const LocalRecordings = () => {
  const [rows, setRows] = useState(null);
  const [thumbs, setThumbs] = useState(() => new Map()); // recordingId → object URL, or null when there's none
  const [busy, setBusy] = useState(null);
  const statuses = useSyncExternalStore(subscribeUploads, getAllUploadStatuses, () => emptyStatuses);

  const refresh = useCallback(async () => {
    setRows(await listRecordings());
  }, []);

  useEffect(() => {
    // Recovery scans the whole store, so it runs on mount, not on every chunk write.
    recoverInterrupted().then(refresh);
    localEvents.addEventListener("change", refresh);
    return () => localEvents.removeEventListener("change", refresh);
  }, [refresh]);

  // Object URLs for thumbnails, created once per recording and revoked when the row goes away.
  // The effect returns early when the cache already matches the rows, so it can never re-trigger itself.
  useEffect(() => {
    if (!rows) return;
    const ids = new Set(rows.map((r) => r.id));
    const { missing, stale } = thumbDiff(ids, thumbs);
    if (!missing.length && !stale.length) return;

    let cancelled = false;
    Promise.all(missing.map(async (id) => [id, await getThumb(id)])).then((pairs) => {
      if (!cancelled) setThumbs((prev) => applyThumbs(prev, pairs, stale, URL.revokeObjectURL.bind(URL)));
    });
    return () => {
      cancelled = true;
    };
  }, [rows, thumbs]);

  // While something still looks like it's recording, keep checking whether it went stale.
  const anyRecording = rows?.some((r) => r.status === "recording");
  useEffect(() => {
    if (!anyRecording) return;
    const id = setInterval(refresh, 5_000);
    return () => clearInterval(id);
  }, [anyRecording, refresh]);

  const download = async (row) => {
    setBusy(row.id);
    try {
      await downloadRecording(row);
    } catch (err) {
      alert(`Couldn't build the file: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const discard = async (row) => {
    if (!confirm("This is the only copy of this recording. Delete it from this Mac?")) return;
    await deleteRecordingLocal(row.id);
  };

  if (!rows?.length) return null;

  return (
    <section className="mb-12 border-b border-line pb-8">
      <h2 className="mb-4 text-sm text-muted">On this Mac</h2>
      <ul className="space-y-6">
        {rows.map((row) => {
          const status = statuses.get(row.id);
          const copy = uploadCopy(row, status);
          const stalled = status && ["held", "retrying", "offline", "paused"].includes(status.phase);
          return (
            <li key={row.id} className="flex gap-5">
              <Thumb src={thumbs.get(row.id)} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-4">
                  <span className="font-serif text-lg">
                    {formatDate(row.recordedAt)}, {formatTime(row.recordedAt)}
                  </span>
                  <span className="font-mono text-sm tabular-nums text-muted">
                    {formatDuration(row.durationMs)} · {formatBytes(row.totalBytes)}
                  </span>
                </div>
                <Status tone={copy.tone}>{copy.text}</Status>
                <Progress value={uploadProgress(status)} />
                {row.status !== "recording" && row.status !== "importing" && (
                  <div className="flex gap-2 pt-1">
                    {stalled && <Button onClick={() => resumeUpload(row.id)}>Resume upload</Button>}
                    <Button onClick={() => download(row)} disabled={busy === row.id}>
                      {busy === row.id ? "Preparing…" : "Download"}
                    </Button>
                    <Button variant="quiet" onClick={() => discard(row)}>
                      Discard
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default LocalRecordings;
