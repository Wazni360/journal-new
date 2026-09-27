"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Heading, Page, Status } from "@/app/ui";
import { deleteEntry, fetchEntry, fetchMediaUrl, saveEntry } from "@/lib/entries-client";
import { useLibraryHref } from "@/lib/library-href";
import { formatBytes, formatDate, formatDuration, formatTime, localInputValue, parseLocalInput } from "@/lib/format";

const TitleField = ({ entry, onSaved }) => {
  const [value, setValue] = useState(entry.title ?? "");
  const [state, setState] = useState("idle"); // idle | saving | saved | error
  const saved = useRef(entry.title ?? "");

  const commit = async () => {
    if (value === saved.current) return;
    setState("saving");
    try {
      const updated = await saveEntry(entry.id, { title: value });
      saved.current = updated.title ?? "";
      setValue(updated.title ?? "");
      setState("saved");
      onSaved?.(updated);
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="space-y-1">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(saved.current);
            e.currentTarget.blur();
          }
        }}
        placeholder={formatDate(entry.recorded_at)}
        aria-label="Title"
        maxLength={200}
        className="w-full rounded-control border border-transparent bg-transparent px-0 py-1 font-serif text-2xl outline-none placeholder:text-muted hover:border-line focus:border-line focus:px-3"
      />
      {state === "saving" && <Status>Saving…</Status>}
      {state === "saved" && <Status tone="ok">Title saved.</Status>}
      {state === "error" && <Status tone="accent">Couldn&apos;t save the title. Try again.</Status>}
    </div>
  );
};

// The date picker's own UI steals focus while it's open, so this saves on an explicit button (or Enter), not on blur.
const RecordedField = ({ entry, onSaved }) => {
  const [value, setValue] = useState(() => localInputValue(entry.recorded_at));
  const [state, setState] = useState("idle"); // idle | saving | saved | error
  const saved = localInputValue(entry.recorded_at);
  const date = parseLocalInput(value);
  const dirty = value !== saved;

  const commit = async () => {
    if (!dirty || !date) return;
    setState("saving");
    try {
      const updated = await saveEntry(entry.id, { recordedAt: date.toISOString() });
      setValue(localInputValue(updated.recorded_at));
      setState("saved");
      onSaved?.(updated);
      setTimeout(() => setState((s) => (s === "saved" ? "idle" : s)), 2000);
    } catch {
      setState("error");
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">
          Recorded
          <input
            type="datetime-local"
            value={value}
            min="1970-01-01T00:00"
            onChange={(e) => {
              setValue(e.target.value);
              setState("idle");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setValue(saved);
            }}
            className="ml-3 rounded-control border border-line bg-transparent px-2 py-1 text-ink"
          />
        </label>
        {dirty && (
          <>
            <Button onClick={commit} disabled={!date || state === "saving"}>
              {state === "saving" ? "Saving…" : "Save date"}
            </Button>
            <Button variant="quiet" onClick={() => setValue(saved)} disabled={state === "saving"}>
              Cancel
            </Button>
          </>
        )}
      </div>
      {dirty && !date && <Status tone="accent">Enter the full date and time it was recorded.</Status>}
      {state === "saved" && <Status tone="ok">Date saved.</Status>}
      {state === "error" && <Status tone="accent">Couldn&apos;t save the date. Try again.</Status>}
    </div>
  );
};

const EntryView = ({ id }) => {
  const router = useRouter();
  const libraryHref = useLibraryHref();
  const [entry, setEntry] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchEntry(id), fetchMediaUrl(id, "video")])
      .then(([e, url]) => {
        if (cancelled) return;
        setEntry(e);
        setVideoUrl(url);
      })
      .catch((err) => !cancelled && setError(err.status === 404 ? "This entry doesn't exist." : err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const download = async (kind) => {
    setBusy(kind);
    try {
      window.location.href = await fetchMediaUrl(id, kind, true);
    } catch (err) {
      setError(`Couldn't prepare the download: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm("Remove this entry from your journal? The video stays in storage and can be restored by hand.")) return;
    setBusy("delete");
    try {
      await deleteEntry(id);
      router.replace(libraryHref);
      router.refresh();
    } catch (err) {
      setError(`Couldn't delete: ${err.message}`);
      setBusy(null);
    }
  };

  if (error) {
    return (
      <Page wide>
        <Status tone="accent">{error}</Status>
        <Link href={libraryHref} className="mt-4 inline-block text-sm text-muted hover:text-ink">
          Back to the journal
        </Link>
      </Page>
    );
  }
  if (!entry) return <Page wide><Status>Loading…</Status></Page>;

  return (
    <Page wide>
      <header className="mb-8 flex items-baseline justify-between gap-6">
        <Link href={libraryHref} className="text-sm text-muted hover:text-ink">
          Journal
        </Link>
        <span className="font-mono text-sm tabular-nums text-muted">
          {formatDate(entry.recorded_at)}, {formatTime(entry.recorded_at)}
        </span>
      </header>

      <div className="overflow-hidden rounded-control border border-line bg-surface">
        <video src={videoUrl ?? undefined} controls playsInline className="aspect-[4/3] w-full bg-black" />
      </div>

      <div className="mt-6 space-y-4">
        <TitleField entry={entry} onSaved={setEntry} />
        <RecordedField entry={entry} onSaved={setEntry} />
        <Status>
          {entry.codec_label} · {entry.width}×{entry.height}
          {entry.duration_seconds ? ` · ${formatDuration(entry.duration_seconds * 1000)}` : ""}
          {entry.size_bytes ? ` · ${formatBytes(entry.size_bytes)}` : ""}
        </Status>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => download("video")} disabled={busy === "video"}>
            {busy === "video" ? "Preparing…" : "Download"}
          </Button>
          {entry.audio_key && (
            <Button variant="quiet" onClick={() => download("audio")} disabled={busy === "audio"}>
              Audio only
            </Button>
          )}
          <Button variant="quiet" onClick={remove} disabled={busy === "delete"} className="ml-auto text-accent hover:opacity-80">
            {busy === "delete" ? "Removing…" : "Delete"}
          </Button>
        </div>
      </div>
    </Page>
  );
};

export default EntryView;
