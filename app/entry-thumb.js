"use client";

import { useEffect, useState } from "react";
import { Thumb } from "@/app/ui";
import { fetchMediaUrl } from "@/lib/entries-client";

// Presigned thumbnail URLs arrive with the library page (`thumb_url`) and are cached for the session, so a refetched
// page keeps the URL the browser already has the image for instead of re-downloading it under a fresh signature.
// An entry without `thumb_url` still fetches its own.
const cache = new Map();

const EntryThumb = ({ entry }) => {
  const [fetched, setFetched] = useState(null);
  const src = cache.get(entry.id) ?? entry.thumb_url ?? fetched;

  useEffect(() => {
    if (!entry.thumb_key || cache.has(entry.id)) return;
    if (entry.thumb_url) {
      cache.set(entry.id, entry.thumb_url);
      return;
    }
    let cancelled = false;
    fetchMediaUrl(entry.id, "thumb")
      .then((url) => {
        cache.set(entry.id, url);
        if (!cancelled) setFetched(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.thumb_key, entry.thumb_url]);

  return <Thumb src={src} />;
};

export default EntryThumb;
