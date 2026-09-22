"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button, Heading, Page, Status } from "@/app/ui";
import { createSession, openCamera } from "@/lib/recorder";
import { downloadRecording } from "@/lib/download";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";

const cameraErrorMessage = (err) => {
  if (err?.name === "NotAllowedError") return "Camera access was denied. Allow camera and microphone for this site in Chrome's site settings, then reload.";
  if (err?.name === "NotFoundError") return "No camera or microphone was found.";
  if (err?.name === "NotReadableError") return "The camera is in use by another app. Close it and reload.";
  return `Couldn't start the camera: ${err?.message ?? err}`;
};

// Locale-formatted dates differ between server and browser; render them only after hydration.
const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

const RecordPage = () => {
  const mounted = useMounted();
  const previewRef = useRef(null);
  const streamRef = useRef(null);
  const settingsRef = useRef(null);
  const sessionRef = useRef(null);

  const [camera, setCamera] = useState("starting"); // starting | ready | error
  const [cameraError, setCameraError] = useState(null);
  const [rec, setRec] = useState(null); // recorder state snapshot
  const [elapsed, setElapsed] = useState(0);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    openCamera()
      .then(({ stream, settings }) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        settingsRef.current = settings;
        previewRef.current.srcObject = stream;
        setCamera("ready");
      })
      .catch((err) => {
        console.error(err);
        setCameraError(cameraErrorMessage(err));
        setCamera("error");
      });

    return () => {
      cancelled = true;
      // Leaving the page mid-recording finalizes it locally instead of losing the tail.
      sessionRef.current?.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const active = rec && (rec.phase === "recording" || rec.phase === "paused" || rec.phase === "stopping");

  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  useEffect(() => {
    if (rec?.phase !== "recording") return;
    const id = setInterval(() => setElapsed(sessionRef.current.elapsedMs()), 250);
    return () => clearInterval(id);
  }, [rec?.phase]);

  const startRecording = async () => {
    try {
      const session = createSession({
        stream: streamRef.current,
        settings: settingsRef.current,
        previewEl: previewRef.current,
        onChange: (s) => {
          setRec(s);
          setElapsed(session.elapsedMs());
        },
      });
      sessionRef.current = session;
      await session.start();
    } catch (err) {
      console.error(err);
      setRec({ phase: "idle", error: err.message });
    }
  };

  const stopRecording = async () => {
    await sessionRef.current.stop();
  };

  const download = async () => {
    setDownloading(true);
    try {
      await downloadRecording(rec.row, { extraChunks: sessionRef.current.getFallbackChunks() });
    } finally {
      setDownloading(false);
    }
  };

  const recordAnother = () => {
    sessionRef.current = null;
    setRec(null);
    setElapsed(0);
  };

  const phase = rec?.phase ?? "idle";

  return (
    <Page wide>
      <header className="mb-8 flex items-baseline justify-between">
        <Heading>{mounted ? formatDate(rec?.row?.recordedAt ?? new Date().toISOString()) : "\u00a0"}</Heading>
        {active ? <span className="text-sm text-muted">Stop the recording to leave</span> : <Link href="/" className="text-sm text-muted hover:text-ink">Journal</Link>}
      </header>

      <div className="aspect-[4/3] w-full overflow-hidden rounded-control bg-surface border border-line">
        <video ref={previewRef} autoPlay muted playsInline className="h-full w-full object-cover -scale-x-100" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {phase === "idle" && (
          <Button variant="accent" onClick={startRecording} disabled={camera !== "ready"}>
            {camera === "starting" ? "Starting camera…" : "Record"}
          </Button>
        )}
        {(phase === "recording" || phase === "paused") && (
          <>
            <Button variant="accent" onClick={stopRecording}>
              Stop
            </Button>
            <Button onClick={() => (phase === "paused" ? sessionRef.current.resume() : sessionRef.current.pause())}>{phase === "paused" ? "Resume" : "Pause"}</Button>
          </>
        )}
        {phase === "stopping" && <Status>Finishing…</Status>}
        {phase === "stopped" && (
          <>
            <Button onClick={download} disabled={downloading}>
              {downloading ? "Preparing…" : "Download"}
            </Button>
            <Button variant="quiet" onClick={recordAnother}>
              Record another
            </Button>
          </>
        )}

        {phase !== "idle" && (
          <span className="ml-auto flex items-center gap-2 font-mono text-sm tabular-nums">
            {phase === "recording" && <span className="recording-dot inline-block h-2 w-2 rounded-full bg-accent" />}
            {phase === "paused" && <span className="text-muted">paused</span>}
            {formatDuration(phase === "stopped" ? rec.activeMs : elapsed)}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-1">
        {camera === "error" && <Status tone="accent">{cameraError}</Status>}
        {rec?.error && <Status tone="accent">{rec.error}</Status>}
        {(phase === "recording" || phase === "paused") && (
          <Status>
            Saved on this Mac · {formatBytes(rec.totalBytes)}
            {rec.unsavedChunks ? ` · ${rec.unsavedChunks} chunks held in memory` : ""}
          </Status>
        )}
        {phase === "stopped" && (
          <Status>
            Saved on this Mac · {formatBytes(rec.totalBytes)} · {rec.codecLabel ?? rec.candidate.label} {rec.row.width}×{rec.row.height}. Not uploaded yet.
          </Status>
        )}
      </div>
    </Page>
  );
};

export default RecordPage;
