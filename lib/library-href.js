import { useSyncExternalStore } from "react";

// The library's last URL in this tab, so "Journal" links from an entry return to the same page, sort and range.
// A per-tab convenience only: when storage is unavailable, the link is plain "/".
const KEY = "journal:library-href";

export const rememberLibraryHref = (href) => {
  try {
    sessionStorage.setItem(KEY, href);
  } catch {}
};

const read = () => {
  try {
    return sessionStorage.getItem(KEY) || "/";
  } catch {
    return "/";
  }
};

const noSubscribe = () => () => {};
export const useLibraryHref = () => useSyncExternalStore(noSubscribe, read, () => "/");
