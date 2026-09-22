import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import EntryView from "./entry-view";

const EntryPage = async ({ params }) => {
  const session = await getSession();
  if (!session) redirect("/login");
  const { id } = await params;
  return <EntryView id={id} />;
};

export default EntryPage;
