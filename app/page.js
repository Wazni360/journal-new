import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import LogoutButton from "./logout-button";

const HomePage = async () => {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg">Journal</h1>
        <LogoutButton />
      </header>
      <p className="text-neutral-500 text-sm">Library comes in Phase 4.</p>
    </main>
  );
};

export default HomePage;
