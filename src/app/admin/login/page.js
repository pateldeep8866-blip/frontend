"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setError("Access denied");
        return;
      }
      router.replace("/admin");
    } catch {
      setError("Access denied");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900/70 p-6">
        <div className="text-sm text-white/70 mb-2">Admin Access</div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-lg border border-white/20 bg-black/20 px-3 py-2 text-sm outline-none focus:border-cyan-300/60"
        />
        {error ? <div className="mt-2 text-xs text-rose-300">{error}</div> : null}
        <button
          type="submit"
          disabled={loading}
          className="mt-4 w-full rounded-lg border border-cyan-300/40 bg-cyan-500/20 px-3 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {loading ? "Checking..." : "Enter"}
        </button>
      </form>
    </main>
  );
}

