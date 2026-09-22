/* eslint-disable react-hooks/purity, react-hooks/set-state-in-effect -- throwaway spike page; the compiler rules misfire on async event handlers */
"use client";

import { useEffect, useRef, useState } from "react";
import { openDB } from "idb";
import { RECORDING } from "@/lib/config";

// Extra strings probed alongside the configured candidates, to learn what Chrome actually accepts.
const PROBE_MIME_TYPES = [
  ...RECORDING.videoCandidates.map((c) => c.mimeType),
  "video/mp4",
  "video/mp4;codecs=hvc1,mp4a.40.2",
  "video/mp4;codecs=hvc1,opus",
  "video/mp4;codecs=hvc1.1.6.L93.B0",
  "video/mp4;codecs=hev1",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4;codecs=avc1,opus",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1.640028",
  "video/mp4;codecs=av01",
  "video/mp4;codecs=vp9",
  "video/webm",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=av1,opus",
  "video/webm;codecs=h264,opus",
  "video/x-matroska;codecs=avc1",
  "video/x-matroska;codecs=hvc1",
  RECORDING.sidecarAudio.mimeType,
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4;codecs=opus",
];

const dbPromise =
  typeof indexedDB === "undefined"
    ? null
    : openDB("spike", 1, {
        upgrade: (db) => {
          db.createObjectStore("recordings", { keyPath: "id" });
          db.createObjectStore("chunks", { keyPath: ["recordingId", "seq"] });
        },
      });

const fmtBytes = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const fmtTime = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const mbPerMin = (bytes, ms) => (ms > 0 ? ((bytes / 1024 / 1024) / (ms / 60000)).toFixed(2) : "—");
const extFor = (mimeType) => (mimeType.startsWith("video/mp4") ? "mp4" : mimeType.startsWith("audio/") ? "webm" : "webm");

const loadRecordings = async () => {
  const db = await dbPromise;
  const list = await db.getAll("recordings");
  return list.sort((a, b) => b.startedAt - a.startedAt);
};

const loadBlob = async (recordingId, mimeType) => {
  const db = await dbPromise;
  const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Infinity]);
  const rows = await db.getAll("chunks", range);
  rows.sort((a, b) => a.seq - b.seq);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].seq !== i) throw new Error(`seq gap at ${i} (found ${rows[i].seq})`);
  }
  return new Blob(rows.map((r) => r.blob), { type: mimeType });
};

const deleteRecording = async (recordingId) => {
  const db = await dbPromise;
  const tx = db.transaction(["recordings", "chunks"], "readwrite");
  await tx.objectStore("recordings").delete(recordingId);
  const range = IDBKeyRange.bound([recordingId, 0], [recordingId, Infinity]);
  let cursor = await tx.objectStore("chunks").openCursor(range);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
};

export default function SpikePage() {
  const videoRef = useRef(null);
  const playerRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const audioRecorderRef = useRef(null);
  const sessionRef = useRef(null);
  const tickRef = useRef(null);

  const [probe, setProbe] = useState([]);
  const [settings, setSettings] = useState(null);
  const [candidateIdx, setCandidateIdx] = useState(0);
  const [withSidecar, setWithSidecar] = useState(true);
  const [state, setState] = useState("idle"); // idle | ready | recording | stopping
  const [live, setLive] = useState({ ms: 0, bytes: 0, audioBytes: 0, chunks: 0 });
  const [recordings, setRecordings] = useState([]);
  const [playback, setPlayback] = useState(null);
  const [log, setLog] = useState([]);

  const addLog = (msg, data) => {
    const line = data === undefined ? msg : `${msg} ${JSON.stringify(data)}`;
    console.log("[spike]", msg, data ?? "");
    setLog((l) => [...l.slice(-199), `${new Date().toLocaleTimeString()} ${line}`]);
  };

  useEffect(() => {
    if (typeof MediaRecorder === "undefined") return;
    const results = PROBE_MIME_TYPES.map((m) => ({ mimeType: m, supported: MediaRecorder.isTypeSupported(m) }));
    setProbe(results);
    console.table(results);
    loadRecordings().then(setRecordings);
  }, []);

  const supportedCandidates = RECORDING.videoCandidates.filter((c) => probe.find((p) => p.mimeType === c.mimeType)?.supported);

  const startCamera = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: RECORDING.video,
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    streamRef.current = stream;
    videoRef.current.srcObject = stream;
    const v = stream.getVideoTracks()[0].getSettings();
    const a = stream.getAudioTracks()[0]?.getSettings();
    setSettings({ video: v, audio: a });
    addLog("video track settings", v);
    addLog("audio track settings", a);
    setState("ready");
  };

  const startRecording = async () => {
    const candidate = supportedCandidates[candidateIdx];
    if (!candidate) return;
    const db = await dbPromise;
    const id = crypto.randomUUID();
    const startedAt = Date.now();
    const rec = {
      id,
      label: candidate.label,
      requestedMimeType: candidate.mimeType,
      mimeType: null,
      videoBitsPerSecond: candidate.videoBitsPerSecond,
      startedAt,
      durationMs: 0,
      bytes: 0,
      chunks: 0,
      audioBytes: 0,
      audioMimeType: null,
      width: settings?.video?.width,
      height: settings?.video?.height,
      status: "recording",
    };
    await db.put("recordings", rec);

    const session = { id, rec, seq: 0, audioSeq: 0, bytes: 0, audioBytes: 0, queue: Promise.resolve(), finalVideo: null, finalAudio: null };
    sessionRef.current = session;

    const recorder = new MediaRecorder(streamRef.current, {
      mimeType: candidate.mimeType,
      videoBitsPerSecond: candidate.videoBitsPerSecond,
      audioBitsPerSecond: RECORDING.audioBitsPerSecond,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (!e.data || e.data.size === 0) return;
      const seq = session.seq++;
      const blob = e.data;
      session.queue = session.queue.then(async () => {
        await db.put("chunks", { recordingId: id, seq, blob, size: blob.size, offset: session.bytes });
        session.bytes += blob.size;
        setLive((l) => ({ ...l, bytes: session.bytes, chunks: seq + 1 }));
      });
    };
    recorder.onerror = (e) => addLog("video recorder error", String(e.error || e));
    session.finalVideo = new Promise((resolve) => (recorder.onstop = resolve));

    let audioRecorder = null;
    if (withSidecar && MediaRecorder.isTypeSupported(RECORDING.sidecarAudio.mimeType)) {
      const audioStream = new MediaStream(streamRef.current.getAudioTracks());
      audioRecorder = new MediaRecorder(audioStream, {
        mimeType: RECORDING.sidecarAudio.mimeType,
        audioBitsPerSecond: RECORDING.sidecarAudio.audioBitsPerSecond,
      });
      audioRecorderRef.current = audioRecorder;
      audioRecorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        const seq = session.audioSeq++;
        const blob = e.data;
        session.queue = session.queue.then(async () => {
          await db.put("chunks", { recordingId: `${id}:audio`, seq, blob, size: blob.size, offset: session.audioBytes });
          session.audioBytes += blob.size;
          setLive((l) => ({ ...l, audioBytes: session.audioBytes }));
        });
      };
      audioRecorder.onerror = (e) => addLog("audio recorder error", String(e.error || e));
      session.finalAudio = new Promise((resolve) => (audioRecorder.onstop = resolve));
    }

    recorder.start(RECORDING.timesliceMs);
    audioRecorder?.start(RECORDING.timesliceMs);

    rec.mimeType = recorder.mimeType;
    rec.audioMimeType = audioRecorder?.mimeType ?? null;
    rec.actualVideoBitsPerSecond = recorder.videoBitsPerSecond;
    rec.actualAudioBitsPerSecond = recorder.audioBitsPerSecond;
    await db.put("recordings", rec);
    addLog("recording started", {
      requested: candidate.mimeType,
      actual: recorder.mimeType,
      videoBitsPerSecond: recorder.videoBitsPerSecond,
      audioBitsPerSecond: recorder.audioBitsPerSecond,
      sidecar: audioRecorder?.mimeType ?? "off",
    });

    setLive({ ms: 0, bytes: 0, audioBytes: 0, chunks: 0 });
    setState("recording");
    tickRef.current = setInterval(() => setLive((l) => ({ ...l, ms: Date.now() - startedAt })), 500);
  };

  const stopRecording = async () => {
    setState("stopping");
    clearInterval(tickRef.current);
    const session = sessionRef.current;
    const recorder = recorderRef.current;
    const audioRecorder = audioRecorderRef.current;
    const durationMs = Date.now() - session.rec.startedAt;

    recorder.stop();
    audioRecorder?.stop();
    await Promise.all([session.finalVideo, session.finalAudio]);
    await session.queue;

    const db = await dbPromise;
    const rec = { ...session.rec, status: "stopped", durationMs, bytes: session.bytes, chunks: session.seq, audioBytes: session.audioBytes };
    await db.put("recordings", rec);
    addLog("recording stopped", { durationMs, bytes: session.bytes, chunks: session.seq, audioBytes: session.audioBytes, mbPerMin: mbPerMin(session.bytes, durationMs) });

    recorderRef.current = null;
    audioRecorderRef.current = null;
    sessionRef.current = null;
    setRecordings(await loadRecordings());
    setState("ready");
  };

  const play = async (rec) => {
    if (playback?.url) URL.revokeObjectURL(playback.url);
    const blob = await loadBlob(rec.id, rec.mimeType);
    const url = URL.createObjectURL(blob);
    setPlayback({ id: rec.id, url, blobSize: blob.size, duration: null, seekable: null, seekResult: null });
    addLog("playback blob built", { id: rec.id, size: blob.size });
  };

  const onLoadedMetadata = () => {
    const v = playerRef.current;
    const seekable = v.seekable.length ? `${v.seekable.start(0).toFixed(2)}–${v.seekable.end(0).toFixed(2)}` : "none";
    addLog("loadedmetadata", { duration: v.duration, seekable, videoWidth: v.videoWidth, videoHeight: v.videoHeight });
    setPlayback((p) => ({ ...p, duration: v.duration, seekable }));
  };

  const onDurationChange = () => {
    const v = playerRef.current;
    addLog("durationchange", { duration: v.duration });
    setPlayback((p) => (p ? { ...p, duration: v.duration } : p));
  };

  const testSeek = () => {
    const v = playerRef.current;
    const target = Number.isFinite(v.duration) ? v.duration / 2 : 10;
    const t0 = performance.now();
    const onSeeked = () => {
      v.removeEventListener("seeked", onSeeked);
      const result = { target: target.toFixed(2), landed: v.currentTime.toFixed(2), ms: Math.round(performance.now() - t0) };
      addLog("seeked", result);
      setPlayback((p) => ({ ...p, seekResult: result }));
    };
    v.addEventListener("seeked", onSeeked);
    v.currentTime = target;
  };

  const forceDuration = () => {
    // Chrome trick: seeking past the end forces it to scan and compute a real duration.
    const v = playerRef.current;
    const onSeeked = () => {
      v.removeEventListener("seeked", onSeeked);
      addLog("after force-duration seek", { duration: v.duration, currentTime: v.currentTime });
      setPlayback((p) => ({ ...p, duration: v.duration }));
      v.currentTime = 0;
    };
    v.addEventListener("seeked", onSeeked);
    v.currentTime = 1e101;
  };

  const download = async (rec, kind = "video") => {
    const isAudio = kind === "audio";
    const blob = await loadBlob(isAudio ? `${rec.id}:audio` : rec.id, isAudio ? rec.audioMimeType : rec.mimeType);
    const ext = isAudio ? "webm" : extFor(rec.mimeType);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `spike-${rec.label}-${new Date(rec.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const remove = async (rec) => {
    await deleteRecording(rec.id);
    await deleteRecording(`${rec.id}:audio`);
    if (playback?.id === rec.id) setPlayback(null);
    setRecordings(await loadRecordings());
  };

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-8 font-mono text-sm">
      <h1 className="text-xl">Phase 0 spike</h1>

      <section className="space-y-2">
        <h2 className="font-bold">isTypeSupported</h2>
        <table className="w-full text-left">
          <tbody>
            {probe.map((p) => (
              <tr key={p.mimeType} className="border-t border-neutral-700">
                <td className="py-1 pr-4">{p.mimeType}</td>
                <td className={p.supported ? "text-green-500" : "text-red-500"}>{String(p.supported)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">Camera</h2>
        <video ref={videoRef} autoPlay muted playsInline className="w-full max-w-xl bg-black aspect-video" />
        {state === "idle" && (
          <button onClick={startCamera} className="px-3 py-1 border">
            Start camera
          </button>
        )}
        {settings && <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(settings, null, 2)}</pre>}
      </section>

      {state !== "idle" && (
        <section className="space-y-3">
          <h2 className="font-bold">Record</h2>
          <div className="flex flex-wrap items-center gap-3">
            <select value={candidateIdx} onChange={(e) => setCandidateIdx(Number(e.target.value))} disabled={state !== "ready"} className="border px-2 py-1 bg-transparent">
              {supportedCandidates.map((c, i) => (
                <option key={c.label} value={i}>
                  {c.label} — {c.mimeType} @ {c.videoBitsPerSecond / 1e6} Mbps
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={withSidecar} onChange={(e) => setWithSidecar(e.target.checked)} disabled={state !== "ready"} />
              sidecar audio
            </label>
            {state === "ready" && (
              <button onClick={startRecording} disabled={!supportedCandidates.length} className="px-3 py-1 border">
                Record
              </button>
            )}
            {state === "recording" && (
              <button onClick={stopRecording} className="px-3 py-1 border border-red-500 text-red-500">
                Stop
              </button>
            )}
            {state === "stopping" && <span>finalizing…</span>}
          </div>
          {state === "recording" && (
            <div>
              {fmtTime(live.ms)} · {fmtBytes(live.bytes)} video · {fmtBytes(live.audioBytes)} audio · {live.chunks} chunks · {mbPerMin(live.bytes, live.ms)} MB/min
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-bold">Recordings (IndexedDB)</h2>
        {recordings.length === 0 && <div className="text-neutral-500">none</div>}
        <table className="w-full text-left">
          <thead>
            <tr className="text-neutral-500">
              <th>codec</th>
              <th>actual mime</th>
              <th>res</th>
              <th>duration</th>
              <th>video</th>
              <th>MB/min</th>
              <th>audio</th>
              <th>chunks</th>
              <th>status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recordings.map((r) => (
              <tr key={r.id} className="border-t border-neutral-700">
                <td className="py-1">{r.label}</td>
                <td className="text-xs">{r.mimeType}</td>
                <td>
                  {r.width}×{r.height}
                </td>
                <td>{fmtTime(r.durationMs)}</td>
                <td>{fmtBytes(r.bytes)}</td>
                <td>{mbPerMin(r.bytes, r.durationMs)}</td>
                <td>{fmtBytes(r.audioBytes)}</td>
                <td>{r.chunks}</td>
                <td>{r.status}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <button onClick={() => play(r)} className="underline">
                    play
                  </button>
                  <button onClick={() => download(r)} className="underline">
                    download
                  </button>
                  {r.audioBytes > 0 && (
                    <button onClick={() => download(r, "audio")} className="underline">
                      audio
                    </button>
                  )}
                  <button onClick={() => remove(r)} className="underline text-red-500">
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {playback && (
        <section className="space-y-3">
          <h2 className="font-bold">Playback</h2>
          <video ref={playerRef} src={playback.url} controls playsInline onLoadedMetadata={onLoadedMetadata} onDurationChange={onDurationChange} className="w-full max-w-xl bg-black aspect-video" />
          <div>
            blob {fmtBytes(playback.blobSize)} · duration <b>{String(playback.duration)}</b> · seekable {playback.seekable ?? "—"}
            {playback.seekResult && (
              <>
                {" "}
                · seek → {playback.seekResult.target}s landed {playback.seekResult.landed}s in {playback.seekResult.ms}ms
              </>
            )}
          </div>
          <div className="space-x-3">
            <button onClick={testSeek} className="px-3 py-1 border">
              Seek to middle
            </button>
            <button onClick={forceDuration} className="px-3 py-1 border">
              Force duration (seek to 1e101)
            </button>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-bold">Log</h2>
        <pre className="text-xs whitespace-pre-wrap max-h-80 overflow-auto border p-2">{log.join("\n")}</pre>
      </section>
    </main>
  );
}
