"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Button, Input, Select, Status } from "@/app/ui";
import EntryThumb from "@/app/entry-thumb";
import { fetchEntries } from "@/lib/entries-client";
import { dayEnd, dayStart } from "@/lib/entries-query";
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

const NO_FILTER = { from: "", to: "", order: "desc" };
const isFiltered = ({ from, to, order }) => from !== "" || to !== "" || order !== NO_FILTER.order;

// False on the server and during hydration, true after. Dates are formatted in the viewer's timezone, which the
// server doesn't know, so the list is only ever rendered in the browser.
const noSubscribe = () => () => {};
const useHydrated = () => useSyncExternalStore(noSubscribe, () => true, () => false);

// `initialPage` is the unfiltered first page, rendered with the HTML (or null if the server couldn't load it).
const Library = ({ initialPage = null }) => {
  const hydrated = useHydrated();
  const [query, setQuery] = useState({ ...NO_FILTER, page: 1 });
  const [state, setState] = useState(() => (initialPage ? { status: "ready", page: initialPage, error: null } : { status: "loading", page: null, error: null }));
  // The first load is already in hand when the server sent it; later query changes and local writes still fetch.
  const skipLoad = useRef(Boolean(initialPage));
  const { page, from, to, order } = query;

  // Changing a filter always returns to the first page; only the pager moves between pages.
  const filter = (patch) => setQuery((q) => ({ ...q, ...patch, page: 1 }));
  const goTo = (n) => setQuery((q) => ({ ...q, page: n }));

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    const load = () =>
      fetchEntries({ page, order, from: from && dayStart(from), to: to && dayEnd(to) })
        .then((data) => !cancelled && setState({ status: "ready", page: data, error: null }))
        .catch((err) => !cancelled && setState((s) => ({ ...s, status: "error", error: err.message })));
    if (skipLoad.current) skipLoad.current = false;
    else load();
    // Local writes fire on every recorded chunk. Debounce, so recording doesn't refetch the library every few seconds;
    // what matters is the write that removes a local row, which is when a new entry exists on the server.
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 1_500);
    };
    localEvents.addEventListener("change", schedule);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      localEvents.removeEventListener("change", schedule);
    };
  }, [page, from, to, order]);

  const data = state.page;
  if (!hydrated) return <Status>Loading…</Status>;
  if (!data) {
    if (state.status === "error") return <Status tone="accent">Couldn&apos;t load your entries: {state.error}</Status>;
    return <Status>Loading…</Status>;
  }
  // Nothing at all, and nothing filtered away: the app is empty, so don't show controls for an empty list.
  if (!data.total && !isFiltered(query)) return <Status>No entries yet. <Link href="/record" className="underline">Record one</Link>.</Status>;

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          From
          <Input type="date" value={from} max={to || undefined} onChange={(e) => filter({ from: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          To
          <Input type="date" value={to} min={from || undefined} onChange={(e) => filter({ to: e.target.value })} />
        </label>
        <Select aria-label="Sort by date" value={order} onChange={(e) => filter({ order: e.target.value })}>
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </Select>
        {isFiltered(query) && (
          <Button variant="quiet" onClick={() => setQuery({ ...NO_FILTER, page: 1 })}>
            Clear
          </Button>
        )}
        <span className="ml-auto font-mono text-sm tabular-nums text-muted">
          {data.total} {data.total === 1 ? "entry" : "entries"}
        </span>
      </div>

      {state.status === "error" && <Status tone="accent">Couldn&apos;t refresh your entries: {state.error}</Status>}

      {!data.total ? (
        <Status>No entries in that date range.</Status>
      ) : (
        groupByMonth(data.entries).map((group) => (
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
        ))
      )}

      {data.pageCount > 1 && (
        <nav className="flex items-center justify-between border-t border-line pt-5">
          <Button onClick={() => goTo(data.page - 1)} disabled={data.page <= 1}>
            Previous
          </Button>
          <span className="font-mono text-sm tabular-nums text-muted">
            Page {data.page} of {data.pageCount}
          </span>
          <Button onClick={() => goTo(data.page + 1)} disabled={data.page >= data.pageCount}>
            Next
          </Button>
        </nav>
      )}
    </div>
  );
};

export default Library;
