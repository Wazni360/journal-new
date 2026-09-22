// Reconciliation for the local thumbnail cache, kept pure so it can be tested. The invariant that matters:
// when the cache already matches the rows on screen, both lists are empty and the caller does nothing at all.
// A caller that updates state unconditionally re-triggers its own effect and spins the main thread forever.
export const thumbDiff = (ids, cache) => ({
  missing: [...ids].filter((id) => !cache.has(id)),
  stale: [...cache.keys()].filter((id) => !ids.has(id)),
});

export const isInSync = (ids, cache) => {
  const { missing, stale } = thumbDiff(ids, cache);
  return !missing.length && !stale.length;
};

// Returns a new cache with `stale` entries revoked and removed and `pairs` ([id, blob]) added.
export const applyThumbs = (prev, pairs, stale, revoke) => {
  const next = new Map(prev);
  for (const id of stale) {
    const url = next.get(id);
    if (url) revoke(url);
    next.delete(id);
  }
  for (const [id, blob] of pairs) if (!next.has(id)) next.set(id, blob ? URL.createObjectURL(blob) : null);
  return next;
};
