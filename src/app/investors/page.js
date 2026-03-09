"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AzulaThemeBackground from "@/components/AzulaThemeBackground";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";

function fmtPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "--";
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "--";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function InvestorsPage() {
  const [theme, setTheme] = useState("dark");
  const [code, setCode] = useState("");
  const [authError, setAuthError] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  useEffect(() => {
    try {
      const t = localStorage.getItem("theme_mode");
      if (["dark", "light", "cherry", "azula", "alerik"].includes(t)) setTheme(t);
    } catch {}
  }, []);

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isAlerik = theme === "alerik";
  const isLight = theme === "light" || isCherry || isAzula;

  const pageClass = useMemo(() => {
    if (isCherry) return "cherry-mode bg-[#fffefc] text-[#3a2530]";
    if (isAzula) return "azula-mode bg-[#020508] text-[#e8f4ff]";
    if (isAlerik) return "alerik-mode bg-[#050505] text-[#f5f0e8]";
    if (isLight) return "bg-slate-50 text-slate-900";
    return "bg-[#05070d] text-white";
  }, [isCherry, isAzula, isAlerik, isLight]);

  async function loadMetrics() {
    setLoading(true);
    setAuthError("");
    try {
      const res = await fetch("/api/investors/metrics", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setAuthorized(false);
        return;
      }
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
      setAuthorized(true);
    } catch (e) {
      setAuthError(String(e?.message || "Failed to load metrics"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitCode() {
    setAuthError("");
    setLoading(true);
    try {
      const res = await fetch("/api/investors/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthError(body?.error || "Invalid code");
        return;
      }
      await loadMetrics();
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await fetch("/api/investors/auth", { method: "DELETE" });
    setAuthorized(false);
    setData(null);
  }

  return (
    <div className={`min-h-screen relative overflow-hidden ${pageClass}`}>
      {isCherry && <SakuraThemeBackground />}
      {isAzula && <AzulaThemeBackground />}
      <div className="relative z-10 mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between gap-3 mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Investor Portal</h1>
          <div className="flex items-center gap-2">
            {authorized && (
              <button
                onClick={signOut}
                className={`px-3 py-1.5 rounded-lg border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/80"}`}
              >
                Sign out
              </button>
            )}
            <Link href="/home" className={`px-3 py-1.5 rounded-lg border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/80"}`}>
              Back Home
            </Link>
          </div>
        </div>

        {!authorized ? (
          <div className={`rounded-2xl border p-6 max-w-xl ${isLight ? "border-slate-300 bg-white/90" : "border-white/15 bg-white/[0.04]"}`}>
            <p className={`text-sm mb-3 ${isLight ? "text-slate-600" : "text-white/70"}`}>
              Enter investor access code to view live metrics.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitCode()}
                placeholder="Access code"
                className={`flex-1 px-3 py-2 rounded-lg border ${isLight ? "border-slate-300 bg-white text-slate-900" : "border-white/20 bg-[#0f1422] text-white"}`}
              />
              <button onClick={submitCode} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold">
                Unlock
              </button>
            </div>
            {authError && <p className="mt-3 text-sm text-rose-400">{authError}</p>}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`rounded-2xl border p-5 ${isLight ? "border-slate-300 bg-white/90" : "border-white/15 bg-white/[0.04]"}`}>
              <div className={`text-xs uppercase tracking-[0.16em] ${isLight ? "text-slate-500" : "text-white/60"}`}>System</div>
              <div className="mt-3 space-y-2 text-sm">
                <div>Coverage: <span className="font-semibold">{data?.metrics?.coveragePct ?? "--"}%</span></div>
                <div>Breadth score: <span className="font-semibold">{data?.metrics?.breadthScore ?? "--"}</span></div>
                <div>Positive movers: <span className="font-semibold">{data?.metrics?.positiveCount ?? "--"}</span></div>
                <div>As of: <span className="font-semibold">{data?.asOf ? new Date(data.asOf).toLocaleString() : "--"}</span></div>
              </div>
            </div>
            <div className={`rounded-2xl border p-5 ${isLight ? "border-slate-300 bg-white/90" : "border-white/15 bg-white/[0.04]"}`}>
              <div className={`text-xs uppercase tracking-[0.16em] ${isLight ? "text-slate-500" : "text-white/60"}`}>Providers</div>
              <div className="mt-3 space-y-2 text-sm">
                <div>Finnhub: {data?.metrics?.providers?.finnhub ? "Configured" : "Not configured"}</div>
                <div>Yahoo: {data?.metrics?.providers?.yahoo ? "Active" : "Off"}</div>
                <div>CoinGecko: {data?.metrics?.providers?.coingecko ? "Active" : "Off"}</div>
              </div>
            </div>

            <div className={`rounded-2xl border p-5 md:col-span-2 ${isLight ? "border-slate-300 bg-white/90" : "border-white/15 bg-white/[0.04]"}`}>
              <div className={`text-xs uppercase tracking-[0.16em] mb-3 ${isLight ? "text-slate-500" : "text-white/60"}`}>Live Market Snapshot</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {(Array.isArray(data?.live) ? data.live : []).map((row) => (
                  <div key={row.symbol} className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/12 bg-white/[0.02]"}`}>
                    <div className="text-xs font-semibold">{row.symbol}</div>
                    <div className="text-sm mt-1">{fmtPrice(row.price)}</div>
                    <div className={`text-xs mt-1 ${Number(row.changePct) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmtPct(row.changePct)}</div>
                    <div className={`text-[10px] mt-1 ${isLight ? "text-slate-500" : "text-white/50"}`}>{row.source}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {loading && <div className="fixed bottom-4 right-4 text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg">Loading...</div>}
    </div>
  );
}

