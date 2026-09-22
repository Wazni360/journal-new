import { ApiError } from "@/lib/api";

const request = async (path, options = {}) => {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `${res.status} from ${path}`, data);
  return data;
};

export const fetchEntries = () => request("/api/entries").then((d) => d.entries);
export const fetchEntry = (id) => request(`/api/entries/${id}`).then((d) => d.entry);

export const fetchMediaUrl = (id, kind = "video", download = false) =>
  request(`/api/entries/${id}/media?kind=${kind}${download ? "&download=1" : ""}`).then((d) => d.url);

export const saveTitle = (id, title) =>
  request(`/api/entries/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }).then((d) => d.entry);

export const deleteEntry = (id) => request(`/api/entries/${id}`, { method: "DELETE" });
