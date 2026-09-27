import { LIBRARY } from "@/lib/config";

const ORDERS = new Set(["asc", "desc"]);

// A `<input type="date">` value is a calendar day in the viewer's timezone, but `recorded_at` is an instant.
// The boundaries are built locally so "22 September" means the whole of that day where the user is, and both
// ends of the range are inclusive.
const parts = (value) => value.split("-").map(Number);
export const dayStart = (value) => {
  const [y, m, d] = parts(value);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
};
export const dayEnd = (value) => {
  const [y, m, d] = parts(value);
  return new Date(y, m - 1, d, 23, 59, 59, 999).toISOString();
};

// Accepts URLSearchParams or a plain object. Returns `{ error }` when anything is off, so the route can answer 400.
export const parseEntriesQuery = (params) => {
  const read = (key) => {
    const value = typeof params?.get === "function" ? params.get(key) : params?.[key];
    return value == null || value === "" ? null : String(value);
  };

  const rawPage = read("page");
  // Plain digits only, so "1e3" and " 2 " are errors rather than a page number nobody asked for.
  if (rawPage != null && !/^[0-9]+$/.test(rawPage)) return { error: "page must be a positive integer" };
  const page = rawPage == null ? 1 : Number(rawPage);
  if (page < 1) return { error: "page must be a positive integer" };

  const order = read("order") ?? "desc";
  if (!ORDERS.has(order)) return { error: "order must be asc or desc" };

  const rawFrom = read("from");
  const rawTo = read("to");
  if (rawFrom != null && Number.isNaN(Date.parse(rawFrom))) return { error: "from must be a date" };
  if (rawTo != null && Number.isNaN(Date.parse(rawTo))) return { error: "to must be a date" };
  const from = rawFrom == null ? null : new Date(rawFrom).toISOString();
  const to = rawTo == null ? null : new Date(rawTo).toISOString();
  // Both are UTC ISO strings of the same shape, so a lexicographic compare is a chronological one.
  if (from && to && from > to) return { error: "from must not be after to" };

  return { page, pageSize: LIBRARY.pageSize, order, from, to };
};

export const entriesQueryString = ({ page, order, from, to } = {}) => {
  const params = new URLSearchParams();
  if (page && page !== 1) params.set("page", String(page));
  if (order && order !== "desc") params.set("order", order);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return query ? `?${query}` : "";
};

// The library's own URL (`/?page=2&order=asc&from=2026-09-01`). Unlike the API's, `from` and `to` here are calendar
// days as the date pickers hold them, since the server doesn't know the viewer's timezone. Anything malformed falls
// back to its default rather than erroring, so a hand-edited URL still shows the library.
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
export const parseLibraryParams = (params) => {
  const read = (key) => (typeof params?.get === "function" ? params.get(key) : params?.[key]) ?? "";
  const page = /^[1-9][0-9]*$/.test(read("page")) ? Number(read("page")) : 1;
  const order = ORDERS.has(read("order")) ? read("order") : "desc";
  const from = DAY.test(read("from")) ? read("from") : "";
  const to = DAY.test(read("to")) ? read("to") : "";
  return { page, order, from, to };
};
