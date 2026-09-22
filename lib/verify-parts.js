// Pure check of a ListParts result against what the client says it uploaded. Shared by the /complete route and tests.
// Returns { ok: true } or { ok: false, reason, retryParts? } where retryParts are part numbers the client should
// upload again (missing or wrong size) when the overall shape is otherwise right.
export const verifyParts = (parts, totalBytes, partSize) => {
  if (!Number.isInteger(totalBytes) || totalBytes <= 0) return { ok: false, reason: "totalBytes must be a positive integer" };
  const expectedCount = Math.ceil(totalBytes / partSize);
  const byNumber = new Map(parts.map((p) => [p.partNumber, p]));
  const retryParts = [];
  for (let n = 1; n <= expectedCount; n++) {
    const expectedSize = n < expectedCount ? partSize : totalBytes - (expectedCount - 1) * partSize;
    const part = byNumber.get(n);
    if (!part || part.size !== expectedSize) retryParts.push(n);
  }
  const extra = parts.filter((p) => p.partNumber > expectedCount).map((p) => p.partNumber);
  if (extra.length) return { ok: false, reason: `unexpected parts beyond ${expectedCount}: ${extra.join(", ")}`, restart: true };
  if (retryParts.length) return { ok: false, reason: `${retryParts.length} of ${expectedCount} parts missing or wrong size`, retryParts };
  const sum = parts.reduce((n, p) => n + p.size, 0);
  if (sum !== totalBytes) return { ok: false, reason: `parts sum to ${sum}, expected ${totalBytes}`, restart: true };
  return { ok: true };
};
