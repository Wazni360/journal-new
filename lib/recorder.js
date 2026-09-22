import { LOCAL, RECORDING } from "@/lib/config";
import { appendChunk, newRecordingRow, patchRecording, putRecording, putThumb } from "@/lib/local";

export const pickVideoCandidate = () => RECORDING.videoCandidates.find((c) => MediaRecorder.isTypeSupported(c.mimeType)) ?? null;

export const openCamera = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ video: RECORDING.video, audio: true });
  const settings = stream.getVideoTracks()[0].getSettings();
  console.log("[camera]", settings);
  return { stream, settings };
};

const waitFor = (target, event) => new Promise((resolve) => target.addEventListener(event, resolve, { once: true }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const captureThumbnail = async (videoEl) => {
  if (!videoEl?.videoWidth) return null;
  const scale = Math.min(1, LOCAL.thumbnailMaxWidth / videoEl.videoWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(videoEl.videoWidth * scale);
  canvas.height = Math.round(videoEl.videoHeight * scale);
  canvas.getContext("2d").drawImage(videoEl, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
};

// One recording, from the first chunk to the finalized local row. Every chunk goes to IndexedDB through a single
// sequential queue, so seq order is guaranteed. Nothing here talks to the network.
export const createSession = ({ stream, settings, previewEl, onChange }) => {
  const candidate = pickVideoCandidate();
  if (!candidate) throw new Error("This browser can't record in any supported format.");

  const state = {
    id: crypto.randomUUID(),
    phase: "idle", // idle | recording | paused | stopping | stopped
    candidate,
    activeMs: 0,
    segmentStartedAt: null,
    totalBytes: 0,
    chunkCount: 0,
    audioBytes: 0,
    unsavedChunks: 0,
    error: null,
    row: null,
  };
  const fallback = { chunks: [], audioChunks: [] }; // chunks IndexedDB refused; kept in memory so download still works
  const timers = [];
  let recorder;
  let audioRecorder;
  let queue = Promise.resolve();
  let seq = 0;
  let audioSeq = 0;

  const emit = () => onChange?.({ ...state });
  const elapsedMs = () => state.activeMs + (state.phase === "recording" && state.segmentStartedAt ? Date.now() - state.segmentStartedAt : 0);

  const enqueue = (fn) => {
    queue = queue.then(fn).catch((err) => {
      console.error("[recorder] queue task failed", err);
      state.error = err.message;
      emit();
    });
    return queue;
  };

  const writeChunk = (store, blob, chunkSeq) =>
    enqueue(async () => {
      if (fallback[store].length) {
        fallback[store].push(blob); // once we've fallen back, stay in order
        state.unsavedChunks++;
        return;
      }
      for (let attempt = 1; ; attempt++) {
        try {
          const row = await appendChunk({ store, recordingId: state.id, seq: chunkSeq, blob });
          state.totalBytes = row.totalBytes;
          state.chunkCount = row.chunkCount;
          state.audioBytes = row.audioBytes;
          emit();
          return;
        } catch (err) {
          if (attempt >= LOCAL.chunkWriteRetries) {
            console.error("[recorder] chunk write failed, keeping in memory", err);
            fallback[store].push(blob);
            state.unsavedChunks++;
            state.error = "This Mac's storage refused a chunk. The recording continues in memory; download it as soon as you stop.";
            emit();
            return;
          }
          await sleep(250 * attempt);
        }
      }
    });

  const start = async () => {
    const recordedAt = new Date().toISOString();
    state.row = newRecordingRow({
      id: state.id,
      recordedAt,
      mimeType: candidate.mimeType,
      codecLabel: candidate.label,
      width: settings?.width,
      height: settings?.height,
    });
    await putRecording(state.row); // local row exists before the first byte is captured

    recorder = new MediaRecorder(stream, {
      mimeType: candidate.mimeType,
      videoBitsPerSecond: candidate.videoBitsPerSecond,
      audioBitsPerSecond: RECORDING.audioBitsPerSecond,
    });
    recorder.ondataavailable = (e) => {
      if (e.data?.size) writeChunk("chunks", e.data, seq++);
    };
    recorder.onerror = (e) => {
      state.error = `Recorder error: ${e.error?.message ?? e.error ?? "unknown"}`;
      emit();
    };

    if (MediaRecorder.isTypeSupported(RECORDING.sidecarAudio.mimeType)) {
      audioRecorder = new MediaRecorder(new MediaStream(stream.getAudioTracks()), {
        mimeType: RECORDING.sidecarAudio.mimeType,
        audioBitsPerSecond: RECORDING.sidecarAudio.audioBitsPerSecond,
      });
      audioRecorder.ondataavailable = (e) => {
        if (e.data?.size) writeChunk("audioChunks", e.data, audioSeq++);
      };
      audioRecorder.onerror = (e) => console.error("[recorder] sidecar audio error", e.error);
    }

    recorder.start(RECORDING.timesliceMs);
    audioRecorder?.start(RECORDING.timesliceMs);
    if (recorder.mimeType !== candidate.mimeType) {
      await patchRecording(state.id, { mimeType: recorder.mimeType });
    }

    state.phase = "recording";
    state.segmentStartedAt = Date.now();
    emit();

    timers.push(
      setInterval(() => {
        if (state.phase === "recording" || state.phase === "paused") {
          enqueue(() => patchRecording(state.id, { durationMs: elapsedMs() }));
        }
      }, LOCAL.heartbeatMs),
    );
    timers.push(
      setTimeout(async () => {
        const blob = await captureThumbnail(previewEl).catch(() => null);
        if (blob) enqueue(() => putThumb(state.id, blob));
      }, LOCAL.thumbnailAtMs),
    );
  };

  const pause = () => {
    if (state.phase !== "recording") return;
    recorder.pause();
    audioRecorder?.pause();
    state.activeMs += Date.now() - state.segmentStartedAt;
    state.segmentStartedAt = null;
    state.phase = "paused";
    emit();
  };

  const resume = () => {
    if (state.phase !== "paused") return;
    recorder.resume();
    audioRecorder?.resume();
    state.segmentStartedAt = Date.now();
    state.phase = "recording";
    emit();
  };

  const stop = async () => {
    if (state.phase !== "recording" && state.phase !== "paused") return;
    if (state.phase === "recording") state.activeMs += Date.now() - state.segmentStartedAt;
    state.segmentStartedAt = null;
    state.phase = "stopping";
    emit();
    timers.forEach(clearInterval);

    const stopped = Promise.all([waitFor(recorder, "stop"), audioRecorder ? waitFor(audioRecorder, "stop") : null]);
    recorder.stop(); // final dataavailable fires before stop
    audioRecorder?.stop();
    await stopped;
    await queue; // every chunk is on disk (or in the fallback list)

    state.row = await patchRecording(state.id, { status: "stopped", durationMs: state.activeMs });
    state.phase = "stopped";
    emit();
  };

  return {
    start,
    pause,
    resume,
    stop,
    elapsedMs,
    getState: () => ({ ...state }),
    getFallbackChunks: (store = "chunks") => [...fallback[store]],
  };
};
