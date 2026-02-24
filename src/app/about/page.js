"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function AboutPage() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (saved === "light" || saved === "dark" || saved === "cherry") setTheme(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("theme_mode", theme);
    } catch {}
  }, [theme]);

  const isCherry = theme === "cherry";
  const isLight = theme === "light" || isCherry;

  const pageClass = isCherry
    ? "cherry-mode min-h-screen relative overflow-hidden bg-[#fffefc] text-[#3a2530]"
    : isLight
      ? "min-h-screen relative overflow-hidden bg-gradient-to-br from-white via-blue-50 to-cyan-50 text-slate-900"
      : "min-h-screen relative overflow-hidden bg-slate-950 text-white";

  const cardClass = isCherry
    ? "rounded-2xl border border-rose-200/60 bg-white/90 backdrop-blur-sm p-6 shadow-[0_10px_36px_rgba(190,24,93,0.12)]"
    : isLight
      ? "rounded-2xl border border-blue-200/80 bg-white/85 backdrop-blur-sm p-6 shadow-[0_10px_40px_rgba(59,130,246,0.12)]"
      : "rounded-2xl border border-white/12 bg-slate-900/55 p-6";

  const chipClass = isCherry
    ? "rounded-xl border border-rose-200/70 bg-rose-50/70 p-3 text-rose-900"
    : isLight
      ? "rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-slate-700"
      : "rounded-xl border border-white/10 bg-white/5 p-3 text-slate-300";

  return (
    <div className={pageClass}>
      <div
        className={`pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full blur-3xl ${
          isCherry ? "bg-rose-200/28" : isLight ? "bg-blue-300/35" : "bg-cyan-500/12"
        }`}
      />
      <div
        className={`pointer-events-none absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl ${
          isCherry ? "bg-rose-200/24" : isLight ? "bg-cyan-300/30" : "bg-blue-500/10"
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-0 ${
          isCherry
            ? "bg-[radial-gradient(circle_at_16%_12%,rgba(244,114,182,0.12),transparent_34%),radial-gradient(circle_at_84%_72%,rgba(251,113,133,0.1),transparent_36%)]"
            : isLight
              ? "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.12),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(6,182,212,0.12),transparent_35%)]"
              : "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.07),transparent_35%)]"
        }`}
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 py-10 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-lg border text-xs ${
              isLight
                ? "border-slate-300 bg-white/85 text-slate-700 hover:bg-slate-100"
                : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
            }`}
          >
            Back Home
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme("dark")}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                theme === "dark"
                  ? "bg-blue-600 text-white border-blue-500"
                  : isLight
                    ? "border-slate-300 bg-white/85 text-slate-700"
                    : "border-white/15 bg-slate-900/60 text-white/85"
              }`}
            >
              Dark
            </button>
            <button
              onClick={() => setTheme("light")}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                theme === "light"
                  ? "bg-blue-600 text-white border-blue-500"
                  : isLight
                    ? "border-slate-300 bg-white/85 text-slate-700"
                    : "border-white/15 bg-slate-900/60 text-white/85"
              }`}
            >
              Light
            </button>
            <button
              onClick={() => setTheme("cherry")}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                theme === "cherry"
                  ? "bg-rose-600 text-white border-rose-500"
                  : isLight
                    ? "border-rose-200 bg-white/90 text-rose-800"
                    : "border-white/15 bg-slate-900/60 text-white/85"
              }`}
            >
              Sakura
            </button>
            <a
              href="mailto:support@arthastraai.com"
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/85 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              support@arthastraai.com
            </a>
          </div>
        </div>

        <div className="text-center mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/arthastra-icon-transparent.svg"
            alt="Arthastra logo"
            className="mx-auto h-20 w-20 md:h-24 md:w-24"
          />
          <h1
            className={`mt-4 text-4xl md:text-6xl font-semibold tracking-tight bg-gradient-to-r bg-clip-text text-transparent ${
              isCherry
                ? "from-rose-900 via-fuchsia-800 to-indigo-800"
                : isLight
                  ? "from-slate-900 via-blue-700 to-cyan-600"
                  : "from-white via-cyan-100 to-sky-200"
            }`}
          >
            About Arthastra
          </h1>
          <p className={`mt-3 text-lg ${isCherry ? "text-rose-900/80" : isLight ? "text-slate-600" : "text-slate-300"}`}>
            Clarity in Every Market.
          </p>
          <p className={`mt-2 text-sm ${isCherry ? "text-rose-900/70" : isLight ? "text-slate-500" : "text-slate-400"}`}>
            At ArthastraAI, AI stands for <span className="font-semibold">Analytical Information</span>.
            We provide structured analytical information across stocks, crypto, metals, FX, and global market trends.
          </p>
        </div>

        <section className={`${cardClass} mb-6`}>
          <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
            Founders Photo
          </h2>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/founders-team.jpg"
              alt="Deep Patel and Juan M. Ramirez"
              className="w-full h-auto object-cover"
            />
          </div>
          <p className={`text-xs mt-3 ${isCherry ? "text-rose-900/65" : isLight ? "text-slate-500" : "text-slate-400"}`}>
            Deep Patel and Juan M. Ramirez
          </p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <section className={cardClass}>
            <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
              Our Mission
            </h2>
            <p className={`text-sm leading-relaxed ${isCherry ? "text-rose-900/75" : isLight ? "text-slate-600" : "text-slate-300"}`}>
              Arthastra helps everyday investors make informed decisions through structured
              analytical insights across stocks, crypto, metals, FX, and global market news.
            </p>
          </section>
          <section className={cardClass}>
            <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
              Founders
            </h2>
            <p className={`text-sm ${isCherry ? "text-rose-900/80" : isLight ? "text-slate-700" : "text-slate-300"}`}>Founder: Deep Patel</p>
            <p className={`text-sm mt-1 ${isCherry ? "text-rose-900/80" : isLight ? "text-slate-700" : "text-slate-300"}`}>
              Co-founder: Juan M. Ramirez
            </p>
            <p className={`text-xs mt-3 ${isCherry ? "text-rose-900/65" : isLight ? "text-slate-500" : "text-slate-400"}`}>
              Built to provide clear market context, disciplined frameworks, and practical next steps.
            </p>
          </section>
        </div>

        <section className={`${cardClass} mb-6`}>
          <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
            What ASTRA Covers
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <div className={chipClass}>Stock analytics and trends</div>
            <div className={chipClass}>Crypto market monitoring</div>
            <div className={chipClass}>Precious metals tracking</div>
            <div className={chipClass}>FX conversion and overview</div>
            <div className={chipClass}>World-impact market news</div>
            <div className={chipClass}>ASTRA assistant Q&amp;A support</div>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
            Legal Notice
          </h2>
          <p className={`text-xs leading-relaxed ${isCherry ? "text-rose-900/65" : isLight ? "text-slate-500" : "text-slate-400"}`}>
            For informational purposes only. This platform does not provide financial, investment, legal,
            tax, or accounting advice. All decisions and outcomes are solely your responsibility.
          </p>
        </section>
      </div>
    </div>
  );
}
