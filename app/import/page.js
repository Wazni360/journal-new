"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Heading, Page, Progress, Status } from "@/app/ui";
import { importFile, isSupportedFile, recordedAtFor } from "@/lib/import";
import { formatBytes } from "@/lib/format";

const localInputValue = (date) => {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const ImportPage = () => {
  const inputRef = useRef(null);
  const [queue, setQueue] = useState([]); // { file, recordedAt, state, message, progress }
  const [dragging, setDragging] = useState(false);

  const add = (files) => {
    const accepted = [...files].filter(isSupportedFile);
    const rejected = [...files].length - accepted.length;
    setQueue((q) => [
      ...q,
      ...accepted.map((file) => ({ file, recordedAt: recordedAtFor(file), state: "ready", message: null, progress: 0 })),
      ...(rejected ? [{ file: { name: `${rejected} file${rejected > 1 ? "s" : ""} skipped`, size: 0 }, state: "rejected", message: "Only MP4 and WebM video files can be imported.", progress: 0 }] : []),
    ]);
  };

  const patch = (index, next) => setQueue((q) => q.map((item, i) => (i === index ? { ...item, ...next } : item)));

  const importAll = async () => {
    for (const [index, item] of queue.entries()) {
      if (item.state !== "ready") continue;
      patch(index, { state: "importing", message: "Reading the file…" });
      try {
        const result = await importFile(item.file, {
          recordedAt: item.recordedAt,
          onProgress: ({ written, total }) => patch(index, { progress: written / total }),
        });
        patch(index, {
          state: "done",
          progress: 1,
          message: `Saved on this Mac · ${formatBytes(result.totalBytes)}${result.width ? ` · ${result.width}×${result.height}` : ""}. Uploading now.`,
        });
      } catch (err) {
        patch(index, { state: "error", message: err.message });
      }
    }
  };

  const pending = queue.filter((i) => i.state === "ready").length;

  return (
    <Page>
      <header className="mb-8 flex items-baseline justify-between">
        <Heading>Import video</Heading>
        <Link href="/" className="text-sm text-muted hover:text-ink">
          Journal
        </Link>
      </header>

      <Status className="mb-6">
        Add MP4 or WebM files you already have. They&apos;re saved on this Mac first, then uploaded and verified like a
        recording made here. The date is taken from the filename or the file itself — correct it if it&apos;s wrong.
      </Status>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          add(e.dataTransfer.files);
        }}
        className={`rounded-control border border-dashed p-10 text-center transition-colors duration-150 ${dragging ? "border-accent" : "border-line"}`}
      >
        <p className="text-sm text-muted">Drop video files here</p>
        <input ref={inputRef} type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" multiple hidden onChange={(e) => add(e.target.files)} />
        <Button className="mt-4" onClick={() => inputRef.current.click()}>
          Choose files
        </Button>
      </div>

      {queue.length > 0 && (
        <>
          <ul className="mt-8 space-y-5">
            {queue.map((item, index) => (
              <li key={`${item.file.name}-${index}`} className="space-y-1 border-b border-line pb-4 last:border-0">
                <div className="flex flex-wrap items-baseline gap-x-4">
                  <span className="font-serif text-lg break-all">{item.file.name}</span>
                  {item.file.size > 0 && <span className="font-mono text-sm tabular-nums text-muted">{formatBytes(item.file.size)}</span>}
                </div>
                {item.state === "ready" && (
                  <label className="block text-sm text-muted">
                    Recorded
                    <input
                      type="datetime-local"
                      value={localInputValue(item.recordedAt)}
                      onChange={(e) => patch(index, { recordedAt: new Date(e.target.value) })}
                      className="ml-3 rounded-control border border-line bg-transparent px-2 py-1 text-ink"
                    />
                  </label>
                )}
                {item.message && <Status tone={item.state === "error" || item.state === "rejected" ? "accent" : item.state === "done" ? "ok" : "muted"}>{item.message}</Status>}
                {item.state === "importing" && <Progress value={item.progress} />}
              </li>
            ))}
          </ul>

          {pending > 0 && (
            <div className="mt-8">
              <Button variant="accent" onClick={importAll}>
                Import {pending} file{pending > 1 ? "s" : ""}
              </Button>
            </div>
          )}
        </>
      )}
    </Page>
  );
};

export default ImportPage;
