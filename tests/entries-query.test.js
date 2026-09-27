import { describe, expect, it } from "vitest";
import { LIBRARY } from "@/lib/config";
import { dayEnd, dayStart, entriesQueryString, parseEntriesQuery, parseLibraryParams } from "@/lib/entries-query";

describe("library query parsing", () => {
  it("defaults to the first page, newest first, unfiltered", () => {
    expect(parseEntriesQuery(new URLSearchParams())).toEqual({ page: 1, pageSize: LIBRARY.pageSize, order: "desc", from: null, to: null });
  });

  it("treats an empty value as absent", () => {
    expect(parseEntriesQuery({ page: "", order: "", from: "", to: "" }).page).toBe(1);
  });

  it("reads a page, an order and a range", () => {
    const q = parseEntriesQuery({ page: "3", order: "asc", from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T23:59:59.999Z" });
    expect(q).toMatchObject({ page: 3, order: "asc", from: "2026-09-01T00:00:00.000Z", to: "2026-09-30T23:59:59.999Z" });
  });

  it("never lets the client choose the page size", () => {
    expect(parseEntriesQuery({ pageSize: "500" }).pageSize).toBe(LIBRARY.pageSize);
  });

  it("rejects a page that isn't a positive integer", () => {
    for (const page of ["0", "-1", "1.5", "abc", "1e3"]) expect(parseEntriesQuery({ page }).error).toBeTruthy();
  });

  it("rejects an unknown order", () => {
    expect(parseEntriesQuery({ order: "sideways" }).error).toBeTruthy();
    expect(parseEntriesQuery({ order: "DESC" }).error).toBeTruthy();
  });

  it("rejects dates it can't parse", () => {
    expect(parseEntriesQuery({ from: "yesterday" }).error).toBe("from must be a date");
    expect(parseEntriesQuery({ to: "2026-13-45" }).error).toBe("to must be a date");
  });

  it("rejects an inverted range", () => {
    expect(parseEntriesQuery({ from: "2026-09-30T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }).error).toBeTruthy();
    // The same instant on both ends is a single-moment range, not an inverted one.
    expect(parseEntriesQuery({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }).error).toBeUndefined();
  });
});

describe("calendar day boundaries", () => {
  // Whatever the machine's timezone, a picked day must cover that day where the user is.
  it("spans local midnight to the last millisecond of the day", () => {
    const start = new Date(dayStart("2026-09-22"));
    const end = new Date(dayEnd("2026-09-22"));
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 8, 22]);
    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 8, 22]);
    expect([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([23, 59, 59, 999]);
    expect(end - start).toBe(86_400_000 - 1);
  });
});

describe("library query string", () => {
  it("omits the defaults so a plain library has a clean url", () => {
    expect(entriesQueryString({ page: 1, order: "desc", from: "", to: "" })).toBe("");
    expect(entriesQueryString()).toBe("");
  });

  it("round-trips through parsing", () => {
    const sent = { page: 4, order: "asc", from: dayStart("2026-09-01"), to: dayEnd("2026-09-30") };
    const parsed = parseEntriesQuery(new URLSearchParams(entriesQueryString(sent).slice(1)));
    expect(parsed).toMatchObject(sent);
  });
});

describe("library URL parsing", () => {
  it("defaults to the first page, newest first, unfiltered", () => {
    expect(parseLibraryParams(new URLSearchParams())).toEqual({ page: 1, order: "desc", from: "", to: "" });
  });

  it("reads a page, an order and a range of days", () => {
    expect(parseLibraryParams({ page: "3", order: "asc", from: "2026-09-01", to: "2026-09-30" })).toEqual({ page: 3, order: "asc", from: "2026-09-01", to: "2026-09-30" });
  });

  it("falls back to defaults for anything malformed", () => {
    const q = parseLibraryParams({ page: "0", order: "sideways", from: "2026-09-01T00:00:00Z", to: "yesterday" });
    expect(q).toEqual({ page: 1, order: "desc", from: "", to: "" });
    expect(parseLibraryParams({ page: "1e3" }).page).toBe(1);
  });

  it("round-trips through the query string the library pushes", () => {
    const state = { page: 2, order: "asc", from: "2026-09-01", to: "" };
    expect(parseLibraryParams(new URLSearchParams(entriesQueryString(state).slice(1)))).toEqual(state);
  });
});
