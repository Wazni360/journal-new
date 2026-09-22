"use client";

import { useRouter } from "next/navigation";

const LogoutButton = () => {
  const router = useRouter();
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };
  return (
    <button onClick={logout} className="underline text-sm">
      Sign out
    </button>
  );
};

export default LogoutButton;
