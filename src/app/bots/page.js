"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function BotsPage() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (saved === "dark" || saved === "light" || saved === "cherry" || saved === "azula" || saved === "alerik") {
        setTheme(saved);
      }
    } catch {}
  }, []);

  const isLight = theme === "light" || theme === "cherry" || theme === "azula";
  const setThemeMode = (mode) => {
    const next = String(mode || "").toLowerCase();
    if (!["dark", "light", "cherry", "azula", "alerik"].includes(next)) return;
    setTheme(next);
    try {
      localStorage.setItem("theme_mode", next);
      window.dispatchEvent(new Event("theme-updated"));
    } catch {}
  };

  return (
    <div className={`min-h-screen ${isLight ? "bg-slate-50 text-slate-900" : "bg-[#05070d] text-white"}`}>
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">Bots</h1>
            <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/70"}`}>
              Choose one bot. No market tabs here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={theme}
              onChange={(e) => setThemeMode(e.target.value)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"
              }`}
              aria-label="Theme"
            >
              <option value="dark">Theme: Dark</option>
              <option value="light">Theme: Light</option>
              <option value="cherry">Theme: Sakura</option>
              <option value="azula">Theme: Azula</option>
              <option value="alerik">Theme: Alerik</option>
            </select>
            <Link
              href="/home"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100" : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"
              }`}
            >
              Back Home
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/simulator?bot=quant"
            className={`rounded-2xl border p-6 transition ${
              isLight ? "border-slate-200 bg-white hover:border-blue-300" : "border-white/12 bg-white/[0.03] hover:border-cyan-300/40"
            }`}
          >
            <div className="text-xs uppercase tracking-[0.14em] text-blue-500">QUANT</div>
            <h2 className="mt-2 text-xl font-semibold">Quant Simulator Bot</h2>
            <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>
              Existing portfolio simulator, manual trading, and ASTRA auto-pilot.
            </p>
          </Link>

          <Link
            href="/arbi-dashboard.html"
            className={`rounded-2xl border p-6 transition ${
              isLight ? "border-slate-200 bg-white hover:border-blue-300" : "border-white/12 bg-white/[0.03] hover:border-cyan-300/40"
            }`}
          >
            <div className="text-xs uppercase tracking-[0.14em] text-blue-500">ARBI</div>
            <h2 className="mt-2 text-xl font-semibold">Arbitrage Intelligence Bot</h2>
            <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>
              Cross-market spread monitoring and arbitrage signal workspace.
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
