export const RECORDING = {
  video: {
    width: { ideal: 2560, max: 2560 }, // cap at 1440p; take the best the camera offers under it
    height: { ideal: 1440, max: 1440 },
    frameRate: { ideal: 30 },
  },
  timesliceMs: 2000,
  audioBitsPerSecond: 128_000,
  // First supported candidate wins.
  videoCandidates: [
    { label: "hevc", mimeType: "video/mp4;codecs=hvc1.1.6.L153.B0", videoBitsPerSecond: 4_000_000 },
    { label: "h264", mimeType: "video/mp4;codecs=avc1", videoBitsPerSecond: 6_000_000 },
    { label: "vp9", mimeType: "video/webm;codecs=vp9,opus", videoBitsPerSecond: 6_000_000 },
  ],
  sidecarAudio: { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32_000 },
};

export const UPLOAD = {
  partSizeBytes: 10 * 1024 * 1024, // 10 MiB → ~97 GiB max per recording (10,000 parts)
  maxConcurrentParts: 2,
  partUrlTtlSeconds: 3600,
  playbackUrlTtlSeconds: 6 * 3600, // long, so a URL doesn't expire mid-watch
};
