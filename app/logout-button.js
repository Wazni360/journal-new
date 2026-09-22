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
    <button onClick={logout} className="text-sm text-muted hover:text-ink transition-colors duration-150">
      Sign out
    </button>
  );
};

export default LogoutButton;
