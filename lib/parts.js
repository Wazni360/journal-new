// Part math for the multipart upload. Part N (1-based) covers bytes [(N-1)·P, N·P) of the concatenated chunk stream.

export const partCount = (totalBytes, partSize) => Math.ceil(totalBytes / partSize);

export const partRange = (partNumber, totalBytes, partSize) => {
  const start = (partNumber - 1) * partSize;
  const end = Math.min(partNumber * partSize, totalBytes);
  if (start >= end) throw new Error(`part ${partNumber} is out of range for ${totalBytes} bytes`);
  return { start, end };
};

// Which parts can be uploaded right now. While recording, only full parts; once stopped, the final short part too.
export const readyPartNumbers = (totalBytes, partSize, stopped) => {
  const count = stopped ? partCount(totalBytes, partSize) : Math.floor(totalBytes / partSize);
  return Array.from({ length: count }, (_, i) => i + 1);
};

// chunkRows: [{ offset, size, blob }] sorted by seq, offsets cumulative. Returns the rows overlapping [start, end).
export const chunksForRange = (chunkRows, start, end) => {
  const out = [];
  for (const row of chunkRows) {
    if (row.offset >= end) break;
    if (row.offset + row.size > start) out.push(row);
  }
  return out;
};

export const buildPartBlob = (chunkRows, partNumber, totalBytes, partSize) => {
  const { start, end } = partRange(partNumber, totalBytes, partSize);
  const rows = chunksForRange(chunkRows, start, end);
  if (!rows.length) throw new Error(`no chunks cover part ${partNumber}`);
  const base = rows[0].offset;
  return new Blob(rows.map((r) => r.blob)).slice(start - base, end - base);
};

// Local chunk rows must line up exactly with the row's counters before anything is sent or completed.
export const checkChunkIntegrity = (chunkRows, totalBytes) => {
  let expectedOffset = 0;
  for (const [i, row] of chunkRows.entries()) {
    if (row.seq !== i) return { ok: false, reason: `chunk ${i} missing` };
    if (row.offset !== expectedOffset) return { ok: false, reason: `chunk ${i} offset ${row.offset}, expected ${expectedOffset}` };
    expectedOffset += row.size;
  }
  if (expectedOffset !== totalBytes) return { ok: false, reason: `chunks total ${expectedOffset} bytes, row says ${totalBytes}` };
  return { ok: true };
};

export const uploadedBytes = (parts) => parts.reduce((n, p) => n + (p.size ?? 0), 0);
