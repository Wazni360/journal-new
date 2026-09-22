"use client";

import { useEffect, useState } from "react";
import { Thumb } from "@/app/ui";
import { fetchMediaUrl } from "@/lib/entries-client";

// Presigned thumbnail URLs are fetched per entry and cached for the session, so scrolling the library doesn't
// re-sign the same object.
const cache = new Map();

const EntryThumb = ({ entry }) => {
  const [src, setSrc] = useState(() => cache.get(entry.id) ?? null);

  useEffect(() => {
    if (!entry.thumb_key || cache.has(entry.id)) return;
    let cancelled = false;
    fetchMediaUrl(entry.id, "thumb")
      .then((url) => {
        cache.set(entry.id, url);
        if (!cancelled) setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.thumb_key]);

  return <Thumb src={src} />;
};

export default EntryThumb;
