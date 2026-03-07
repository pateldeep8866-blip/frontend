"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

function toPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export default function GlobalMarketPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [items, setItems] = useState([]);
  const [asOf, setAsOf] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/global-market-performance", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (!active) return;
        setItems(Array.isArray(data?.rows) ? data.rows : []);
        setAsOf(String(data?.asOf || ""));
      } catch (e) {
        if (!active) return;
        setError(String(e?.message || "Failed to load global markets"));
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Global Market</h1>
          <Link href="/home" className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/85 hover:bg-white/10">
            Back Home
          </Link>
        </div>

        <div className="rounded-2xl border border-white/12 bg-slate-900/55 p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-white/70">Performance snapshot across major global proxies.</p>
            <p className="text-xs text-white/50">{asOf ? `As of ${asOf}` : ""}</p>
          </div>

          {loading && <p className="text-sm text-white/70">Loading global market data...</p>}
          {error && <p className="text-sm text-rose-300">{error}</p>}

          {!loading && !error && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/55 border-b border-white/10">
                    <th className="py-2 pr-4">Symbol</th>
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4">Daily</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row, idx) => (
                    <tr key={`${row?.symbol || "row"}-${idx}`} className="border-b border-white/5">
                      <td className="py-2 pr-4 font-semibold text-cyan-200">{row?.symbol || "--"}</td>
                      <td className="py-2 pr-4 text-white/80">{row?.name || "--"}</td>
                      <td className="py-2 pr-4">{Number.isFinite(Number(row?.price)) ? `$${Number(row.price).toFixed(2)}` : "--"}</td>
                      <td className={`py-2 pr-4 ${Number(row?.changePct) >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{toPct(row?.changePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
