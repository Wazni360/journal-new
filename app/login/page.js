"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Heading, Status } from "@/app/ui";

const messages = {
  401: "Wrong password.",
  429: "Too many attempts. Try again in 15 minutes.",
};

const LoginPage = () => {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(messages[res.status] ?? "Something went wrong. Try again.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-[40rem] px-6 pt-24 md:pt-40">
      <form onSubmit={submit} className="max-w-xs space-y-6">
        <Heading>Journal</Heading>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-control border border-line bg-transparent px-3 py-2 outline-none placeholder:text-muted focus:border-muted"
        />
        <Button type="submit" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        {error && <Status tone="accent">{error}</Status>}
      </form>
    </main>
  );
};

export default LoginPage;
