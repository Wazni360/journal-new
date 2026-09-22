import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Heading, NavLink, Page } from "@/app/ui";
import LogoutButton from "./logout-button";
import LocalRecordings from "./local-recordings";

const HomePage = async () => {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <Page>
      <header className="mb-12 flex items-baseline justify-between">
        <Heading>Journal</Heading>
        <nav className="flex gap-5">
          <NavLink href="/record">Record</NavLink>
          <LogoutButton />
        </nav>
      </header>
      <LocalRecordings />
      <p className="text-sm text-muted">The library arrives in Phase 4.</p>
    </Page>
  );
};

export default HomePage;
