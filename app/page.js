import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Heading, NavLink, Page } from "@/app/ui";
import LogoutButton from "./logout-button";
import LocalRecordings from "./local-recordings";
import Library from "./library";

const HomePage = async () => {
  const session = await getSession();
  if (!session) redirect("/login");

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
      <Library />
    </Page>
  );
};

export default HomePage;
