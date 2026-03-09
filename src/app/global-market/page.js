"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";
import AzulaThemeBackground from "@/components/AzulaThemeBackground";

function toPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function toPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function GlobalMarketPage() {
  const [theme, setTheme] = useState("dark");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [asOf, setAsOf] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (["dark", "light", "cherry", "azula", "alerik"].includes(saved)) setTheme(saved);
    } catch {}
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/global-market-performance", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (!active) return;
        setItems(Array.isArray(data?.rows) ? data.rows : []);
        setAsOf(String(data?.asOf || ""));
      } catch (e) {
        if (!active) return;
        setError(String(e?.message || "Failed to load global market performance"));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isAlerik = theme === "alerik";
  const isLight = theme === "light" || isCherry || isAzula;

  const pageClass = useMemo(() => {
    if (isCherry) return "cherry-mode bg-[#fffefc] text-[#3a2530]";
    if (isAzula) return "azula-mode bg-[#09090b] text-[#e7e1c5]";
    if (isAlerik) return "alerik-mode bg-[#050505] text-[#f5f0e8]";
    if (isLight) return "bg-[#fbfdff] text-slate-900";
    return "bg-slate-950 text-white";
  }, [isCherry, isAzula, isAlerik, isLight]);

  const shellClass = isAlerik
    ? "border-[#c9a84c]/35 bg-[#0b0b0b]/90 text-[#f5f0e8]"
    : isLight
      ? "border-slate-300 bg-white/90 text-slate-800"
      : "border-white/15 bg-slate-900/60 text-white/85";

  const cardClass = isAlerik
    ? "app-card border-[#c9a84c]/26 bg-[#101010]/92"
    : isLight
      ? "border-slate-300 bg-white/90"
      : isAzula
        ? "app-card border-[#c5a66a]/40 bg-[#111116]/92"
        : "border-white/12 bg-slate-900/55";

  const top = items.slice(0, 3);

  return (
    <div className={`min-h-screen relative overflow-hidden ${pageClass}`}>
      {isCherry && <SakuraThemeBackground />}
      {isAzula && <AzulaThemeBackground />}
      <div className="pointer-events-none absolute inset-0 opacity-[0.16] [background-image:linear-gradient(to_right,rgba(148,163,184,0.18)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.18)_1px,transparent_1px)] [background-size:54px_54px]" />

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        <section className={`rounded-2xl border p-6 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] ${cardClass}`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={`text-[11px] uppercase tracking-[0.22em] font-semibold ${isLight ? "text-slate-500" : "text-cyan-200/85"}`}>Global Market</p>
              <h1 className={`mt-2 text-4xl md:text-5xl font-semibold leading-[0.98] ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>
                Global Market Pulse
              </h1>
              <p className={`mt-3 text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>
                Unified snapshot for global proxies with daily performance and cross-asset context.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2">
              <Link href="/home" className={`rounded-lg border px-3 py-1.5 text-xs ${shellClass}`}>
                Back Home
              </Link>
              <p className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>{asOf ? `As of ${asOf}` : ""}</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
            {top.map((row, idx) => (
              <div key={`${row?.symbol || "top"}-${idx}`} className={`rounded-xl border p-4 ${cardClass}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>{row?.symbol || "--"}</div>
                <div className={`mt-1 text-lg font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>{row?.name || "--"}</div>
                <div className={`mt-2 text-base ${isLight ? "text-slate-700" : "text-white/90"}`}>{toPrice(row?.price)}</div>
                <div className={`text-sm font-semibold ${Number(row?.changePct) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{toPct(row?.changePct)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className={`mt-6 rounded-2xl border p-6 ${cardClass}`}>
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className={`text-xl font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Cross-Asset Table</h2>
            <span className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>{items.length} assets</span>
          </div>

          {loading && <p className={`text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>Loading global market data...</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className={`text-left border-b ${isLight ? "text-slate-500 border-slate-200" : "text-white/55 border-white/10"}`}>
                    <th className="py-2 pr-4">Symbol</th>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4">Daily %</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, idx) => (
                    <tr key={`${row?.symbol || "row"}-${idx}`} className={`border-b ${isLight ? "border-slate-100" : "border-white/5"}`}>
                      <td className={`py-2 pr-4 font-semibold ${isLight ? "text-slate-800" : "text-cyan-200"}`}>{row?.symbol || "--"}</td>
                      <td className={`py-2 pr-4 ${isLight ? "text-slate-700" : "text-white/80"}`}>{row?.name || "--"}</td>
                      <td className={`py-2 pr-4 ${isLight ? "text-slate-700" : "text-white/90"}`}>{toPrice(row?.price)}</td>
                      <td className={`py-2 pr-4 font-semibold ${Number(row?.changePct) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{toPct(row?.changePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
