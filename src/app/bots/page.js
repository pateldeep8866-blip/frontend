"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AzulaThemeBackground from "@/components/AzulaThemeBackground";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";
import { useTranslation } from "@/hooks/useTranslation";

export default function BotsPage() {
  const { t } = useTranslation();
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (saved === "dark" || saved === "light" || saved === "cherry" || saved === "azula" || saved === "alerik" || saved === "lylah") {
        setTheme(saved);
      }
    } catch {}
  }, []);

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isAlerik = theme === "alerik";
  const isLylah = theme === "lylah";
  const isLight = theme === "light" || isCherry || isLylah;
  const pageClass = isCherry
    ? "cherry-mode bg-[#fffefc] text-[#3a2530]"
    : isAzula
      ? "azula-mode bg-[#020508] text-[#e8f4ff]"
      : isAlerik
        ? "alerik-mode bg-[#050505] text-[#f5f0e8]"
        : isLylah
          ? "lylah-mode bg-[#faf8ff] text-[#120228]"
          : isLight
            ? "bg-slate-50 text-slate-900"
            : "bg-[#05070d] text-white";
  const panelClass = isAlerik
    ? "border-[#c9a84c]/26 bg-[#101010]/92 text-[#f5f0e8]"
    : isLight
      ? "border-slate-200 bg-white text-slate-900 hover:border-blue-300"
      : "border-white/12 bg-white/[0.03] hover:border-cyan-300/40";
  const setThemeMode = (mode) => {
    const next = String(mode || "").toLowerCase();
    if (!["dark", "light", "cherry", "azula", "alerik", "lylah"].includes(next)) return;
    setTheme(next);
    try {
      localStorage.setItem("theme_mode", next);
      window.dispatchEvent(new Event("theme-updated"));
    } catch {}
  };

  return (
    <div className={`min-h-screen relative overflow-hidden ${pageClass}`}>
      {isCherry && <SakuraThemeBackground />}
      {isAzula && <AzulaThemeBackground />}
      <div className="mx-auto max-w-4xl px-6 py-12 relative z-10">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold">{t("botsTitle")}</h1>
            <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/70"}`}>
              {t("botsSubtitle")}
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
              <option value="dark">{t("theme")}: {t("dark")}</option>
              <option value="light">{t("theme")}: {t("light")}</option>
              <option value="cherry">{t("theme")}: {t("sakura")}</option>
              <option value="azula">{t("theme")}: {t("azula")}</option>
              <option value="alerik">{t("theme")}: {t("alerik")}</option>
            </select>
            <Link
              href="/home"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100" : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"
              }`}
            >
              {t("backHome")}
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Link
            href="/simulator?bot=quant"
            className={`rounded-2xl border p-6 transition ${panelClass}`}
          >
            <div className="text-xs uppercase tracking-[0.14em] text-blue-500">{t("botQuantLabel")}</div>
            <h2 className="mt-2 text-xl font-semibold">{t("botQuantTitle")}</h2>
            <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>
              {t("botQuantDesc")}
            </p>
          </Link>

          <Link
            href="/arbi-dashboard.html"
            className={`rounded-2xl border p-6 transition ${panelClass}`}
          >
            <div className="text-xs uppercase tracking-[0.14em] text-blue-500">{t("botArbiLabel")}</div>
            <h2 className="mt-2 text-xl font-semibold">{t("botArbiTitle")}</h2>
            <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>
              {t("botArbiDesc")}
            </p>
          </Link>
        </div>
      </div>
    </div>
  );
}
