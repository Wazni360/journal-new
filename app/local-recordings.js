"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Status } from "@/app/ui";
import { deleteRecordingLocal, listRecordings, localEvents, recoverInterrupted } from "@/lib/local";
import { downloadRecording } from "@/lib/download";
import { formatBytes, formatDate, formatDuration, formatTime } from "@/lib/format";

const statusText = (row) => {
  if (row.status === "recording") return "Recording now in another tab.";
  if (row.interrupted) return "Recovered after an interruption. Not uploaded yet.";
  return "Not uploaded yet.";
};

const LocalRecordings = () => {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);

  const refresh = useCallback(async () => {
    await recoverInterrupted();
    setRows(await listRecordings());
  }, []);

  useEffect(() => {
    localEvents.addEventListener("change", refresh);
    localEvents.dispatchEvent(new Event("change")); // initial load through the same path as updates
    return () => localEvents.removeEventListener("change", refresh);
  }, [refresh]);

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
      <ul className="space-y-5">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-serif text-lg">
              {formatDate(row.recordedAt)}, {formatTime(row.recordedAt)}
            </span>
            <span className="font-mono text-sm tabular-nums text-muted">
              {formatDuration(row.durationMs)} · {formatBytes(row.totalBytes)}
            </span>
            <Status className="basis-full">{statusText(row)}</Status>
            {row.status !== "recording" && (
              <span className="flex gap-2">
                <Button onClick={() => download(row)} disabled={busy === row.id}>
                  {busy === row.id ? "Preparing…" : "Download"}
                </Button>
                <Button variant="quiet" onClick={() => discard(row)}>
                  Discard
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

export default LocalRecordings;
