"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Status } from "@/app/ui";
import EntryThumb from "@/app/entry-thumb";
import { fetchEntries } from "@/lib/entries-client";
import { localEvents } from "@/lib/local";
import { formatDuration, formatMonth, formatShortDate, formatTime, monthKey } from "@/lib/format";

const groupByMonth = (entries) => {
  const groups = [];
  for (const entry of entries) {
    const key = monthKey(entry.recorded_at);
    if (groups.at(-1)?.key !== key) groups.push({ key, label: formatMonth(entry.recorded_at), entries: [] });
    groups.at(-1).entries.push(entry);
  }
  return groups;
};

const Library = () => {
  const [state, setState] = useState({ status: "loading", entries: [], error: null });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchEntries()
        .then((entries) => !cancelled && setState({ status: "ready", entries, error: null }))
        .catch((err) => !cancelled && setState((s) => ({ ...s, status: "error", error: err.message })));
    load();
    // An upload finishing removes the local row, which is the moment a new entry exists on the server.
    localEvents.addEventListener("change", load);
    return () => {
      cancelled = true;
      localEvents.removeEventListener("change", load);
    };
  }, []);

  if (state.status === "loading") return <Status>Loading…</Status>;
  if (state.status === "error") return <Status tone="accent">Couldn&apos;t load your entries: {state.error}</Status>;
  if (!state.entries.length) return <Status>No entries yet. <Link href="/record" className="underline">Record one</Link>.</Status>;

  return (
    <div className="space-y-10">
      {groupByMonth(state.entries).map((group) => (
        <section key={group.key}>
          <h2 className="mb-4 text-sm text-muted">{group.label}</h2>
          <ul className="space-y-5">
            {group.entries.map((entry) => (
              <li key={entry.id}>
                <Link href={`/entries/${entry.id}`} className="group flex gap-5">
                  <EntryThumb entry={entry} />
                  <div className="min-w-0 flex-1">
                    <div className="font-serif text-lg group-hover:underline">{entry.title || formatShortDate(entry.recorded_at)}</div>
                    <div className="font-mono text-sm tabular-nums text-muted">
                      {formatTime(entry.recorded_at)}
                      {entry.duration_seconds ? ` · ${formatDuration(entry.duration_seconds * 1000)}` : ""}
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default Library;
