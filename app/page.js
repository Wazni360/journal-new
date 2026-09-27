import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listEntries } from "@/lib/entries";
import { entriesQueryString, parseEntriesQuery, parseLibraryParams } from "@/lib/entries-query";
import { Heading, NavLink, Page } from "@/app/ui";
import LogoutButton from "./logout-button";
import LocalRecordings from "./local-recordings";
import Library from "./library";

// The page the URL asks for ships with the HTML, so the library doesn't wait for hydration and then a round trip
// before it can show anything. A date range is in the viewer's timezone, which the server doesn't know, so filtered
// views (and any failure here) fall back to fetching in the browser.
// The JSON round trip gives the client exactly the shape `GET /api/entries` returns (dates as ISO strings).
const serverPage = ({ page, order, from, to }) => {
  if (from || to) return null;
  return listEntries(parseEntriesQuery({ page: String(page), order }))
    .then((result) => JSON.parse(JSON.stringify(result)))
    .catch((err) => {
      console.error(err);
      return null;
    });
};

const HomePage = async ({ searchParams }) => {
  const session = await getSession();
  if (!session) redirect("/login");

  const query = parseLibraryParams(await searchParams);
  const initialPage = await serverPage(query);

  return (
    <Page>
      <header className="mb-12 flex items-baseline justify-between">
        <Heading>Journal</Heading>
        <nav className="flex gap-5">
          <NavLink href="/record">Record</NavLink>
          <NavLink href="/import">Import</NavLink>
          <LogoutButton />
        </nav>
      </header>
      <LocalRecordings />
      <Library initialPage={initialPage} initialKey={entriesQueryString(query)} />
    </Page>
  );
};

export default HomePage;
