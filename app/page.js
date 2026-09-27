import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listEntries } from "@/lib/entries";
import { parseEntriesQuery } from "@/lib/entries-query";
import { Heading, NavLink, Page } from "@/app/ui";
import LogoutButton from "./logout-button";
import LocalRecordings from "./local-recordings";
import Library from "./library";

// The unfiltered first page ships with the HTML, so the library doesn't wait for hydration and then a round trip
// before it can show anything. If this fails, the library falls back to fetching it in the browser as before.
// The JSON round trip gives the client exactly the shape `GET /api/entries` returns (dates as ISO strings).
const firstPage = () =>
  listEntries(parseEntriesQuery({}))
    .then((page) => JSON.parse(JSON.stringify(page)))
    .catch((err) => {
      console.error(err);
      return null;
    });

const HomePage = async () => {
  const session = await getSession();
  if (!session) redirect("/login");

  const initialPage = await firstPage();

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
      <Library initialPage={initialPage} />
    </Page>
  );
};

export default HomePage;
