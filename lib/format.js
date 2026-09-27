export const formatBytes = (n) => {
  if (!n) return "0 MB";
  const mb = n / 1024 / 1024;
  return mb >= 1000 ? `${(mb / 1024).toFixed(2)} GB` : mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
};

export const formatDuration = (ms) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
};

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

export const formatShortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

// "September 2026" — the library's month headings.
export const formatMonth = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });

export const monthKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export const formatTime = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

const pad = (n) => String(n).padStart(2, "0");

export const filenameStamp = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
};

// `<input type="datetime-local">` text for an instant, in the viewer's timezone.
export const localInputValue = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// A date field keeps its own text, so typing a year digit by digit doesn't round-trip through a Date and clear it.
// It's only turned into a Date once it's a whole, plausible value; anything else is null.
export const parseLocalInput = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) && date.getFullYear() >= 1970 ? date : null;
};
