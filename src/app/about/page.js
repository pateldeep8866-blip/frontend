"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";

const PILLARS = [
  {
    icon: "🔬",
    title: "Research First",
    text: "Every strong decision starts with real research. Arthastra helps you evaluate fundamentals, technicals, and macro context before capital is at risk.",
  },
  {
    icon: "🎓",
    title: "Learn by Doing",
    text: "Simulation bridges the gap between theory and execution. You can practice under live market conditions without real-money risk.",
  },
  {
    icon: "🧠",
    title: "Understand the Why",
    text: "Price movement alone is noise. We focus on why moves happen, what it means, and how to respond with discipline.",
  },
];

const TYPES = [
  { icon: "⚡", name: "Day Trading", horizon: "Minutes to Hours" },
  { icon: "📈", name: "Swing Trading", horizon: "Days to Weeks" },
  { icon: "🏗️", name: "Long-Term Investing", horizon: "Years to Decades" },
  { icon: "🌐", name: "International Markets", horizon: "Any Timeframe" },
  { icon: "🏛️", name: "Bonds & Fixed Income", horizon: "Months to Years" },
  { icon: "💎", name: "Value Investing", horizon: "Years" },
  { icon: "🚀", name: "Growth Investing", horizon: "Years" },
  { icon: "₿", name: "Crypto & Digital Assets", horizon: "Varies" },
];

const METRICS = [
  { label: "Core Product", value: "Paper Trading + AI Research" },
  { label: "Coverage", value: "Stocks · Crypto · FX · Metals · Macro" },
  { label: "Learning Model", value: "Explainable Signals + Summaries" },
  { label: "Positioning", value: "Educational-first Fintech" },
];

const MOATS = [
  {
    title: "Integrated Workflow",
    text: "Research, simulation, and execution logic are in one interface, reducing context switching and decision latency.",
  },
  {
    title: "Explainability Layer",
    text: "Signals are translated into plain-language reasoning, helping users learn and retain decision frameworks.",
  },
  {
    title: "Adaptive Intelligence",
    text: "ASTRA and QUANT_LAB combine market data, regime context, and structured scoring to support disciplined decisions.",
  },
];

const ROADMAP = [
  { phase: "Now", item: "Education-first simulator with global market intelligence" },
  { phase: "Next", item: "Deeper strategy benchmarking and performance attribution" },
  { phase: "Later", item: "Advanced institutional-grade research workflows" },
];

export default function AboutPage() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("theme_mode");
    if (["dark", "light", "cherry", "azula", "alerik"].includes(saved)) {
      setTheme(saved);
    }
  }, []);

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isAlerik = theme === "alerik";
  const isLight = theme === "light" || isCherry || isAzula;

  const pageClass = useMemo(() => {
    if (isCherry) return "cherry-mode bg-[#fffefc] text-[#3a2530]";
    if (isAzula) return "azula-mode bg-[#09090b] text-[#e7e1c5]";
    if (isAlerik) return "alerik-mode bg-[#050505] text-[#f5f0e8]";
    if (isLight) return "light-mode bg-[#fbfdff] text-slate-900";
    return "dark-mode bg-slate-950 text-white";
  }, [isCherry, isAzula, isAlerik, isLight]);

  const accentPillClass = isAlerik
    ? "border-[#c9a84c]/45 bg-[#17120a] text-[#e8c96a]"
    : isAzula
      ? "border-[#cdb270]/50 bg-[#1a1710] text-[#e7d9ae]"
    : isCherry
      ? "border-rose-300 bg-rose-50 text-rose-700"
      : isLight
        ? "border-slate-300 bg-white text-slate-700"
        : "border-cyan-400/30 bg-cyan-500/10 text-cyan-200";

  return (
    <div className={`min-h-screen relative overflow-hidden ${pageClass}`}>
      {isCherry && <SakuraThemeBackground />}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(125,211,252,0.12),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(147,197,253,0.08),transparent_42%)]" />

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className={`text-xs uppercase tracking-[0.2em] ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>
            About Arthastra
          </div>
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
              isAlerik
                ? "border-[#c9a84c]/28 bg-[#0b0b0b]/85 text-[#f5f0e8] hover:bg-[#16120c]"
                : isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
            }`}
          >
            Back Home
          </Link>
        </div>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <div className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.16em] ${accentPillClass}`}>
            Company Overview
          </div>
          <h1 className={`text-4xl md:text-6xl font-semibold leading-tight ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>
            Built for people who want to understand before they invest.
          </h1>
          <p className={`mt-4 max-w-3xl text-sm md:text-base leading-7 ${isAlerik ? "text-[#f5f0e8]/72" : isLight ? "text-slate-600" : "text-white/75"}`}>
            Most platforms take your money first and explain later. Arthastra is built to close that gap: research, education, and simulation first, then informed decision-making.
          </p>
          <p className={`mt-4 text-xs ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>
            Founders: Juan M. Ramirez · Deep Patel
          </p>
          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {METRICS.map((m) => (
              <div key={m.label} className={`rounded-xl border p-3 ${isAlerik ? "border-[#c9a84c]/18 bg-[#141210]/78" : isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>{m.label}</div>
                <div className={`mt-1 text-sm font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>{m.value}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <article className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)]">
            <h2 className={`text-2xl font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>The Origin Story</h2>
            <div className={`mt-4 space-y-4 text-sm leading-7 ${isAlerik ? "text-[#f5f0e8]/78" : isLight ? "text-slate-700" : "text-white/80"}`}>
              <p>
                During the pandemic, Juan moved from passive index investing into deeper independent research. One stock he researched in detail moved from the teens to $68.
              </p>
              <p>
                The difference was not luck. It was understanding why to hold, and when to exit. That insight became the foundation for Arthastra.
              </p>
              <p>
                Arthastra exists to help users make informed, explainable decisions instead of blind follow-through.
              </p>
            </div>
          </article>

          <article className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)]">
            <h2 className={`text-2xl font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Platform Philosophy</h2>
            <div className={`mt-4 space-y-3 text-sm leading-7 ${isAlerik ? "text-[#f5f0e8]/78" : isLight ? "text-slate-700" : "text-white/80"}`}>
              <p>Research should be accessible.</p>
              <p>Execution should be practiced safely.</p>
              <p>Learning should be continuous and measurable.</p>
            </div>
            <div className={`mt-5 rounded-xl border p-4 ${isLight ? "border-slate-300 bg-white/80" : "border-white/10 bg-white/5"}`}>
              <p className={`text-sm ${isAlerik ? "text-[#f5f0e8]/72" : isLight ? "text-slate-600" : "text-white/75"}`}>
                Arthastra AI is a paper-trading simulator for educational purposes only. It does not provide financial advice.
              </p>
            </div>
          </article>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl font-semibold mb-4 ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Founders Photo</h2>
          <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <Image
                src="/founders-team.jpg"
                alt="Deep Patel and Juan M. Ramirez"
                width={1800}
                height={2200}
                className="h-auto w-full object-cover"
                priority
              />
            </div>
            <div className="space-y-3">
              <div className={`rounded-xl border p-4 ${isAlerik ? "border-[#c9a84c]/18 bg-[#141210]/78" : isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>Juan M. Ramirez</div>
                <div className={`mt-1 text-sm font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Co-Founder · Systems & Product</div>
                <p className={`mt-2 text-sm leading-6 ${isAlerik ? "text-[#f5f0e8]/72" : isLight ? "text-slate-600" : "text-white/75"}`}>
                  Focused on architecture, execution systems, and product strategy that turns research into repeatable process.
                </p>
              </div>
              <div className={`rounded-xl border p-4 ${isAlerik ? "border-[#c9a84c]/18 bg-[#141210]/78" : isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>Deep Patel</div>
                <div className={`mt-1 text-sm font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Co-Founder · Market Research</div>
                <p className={`mt-2 text-sm leading-6 ${isAlerik ? "text-[#f5f0e8]/72" : isLight ? "text-slate-600" : "text-white/75"}`}>
                  Leads analytical framing and market interpretation to ensure signals stay grounded and educational.
                </p>
              </div>
              <div className={`rounded-xl border p-4 ${isAlerik ? "border-[#c9a84c]/18 bg-[#141210]/78" : isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>Why This Team</div>
                <p className={`mt-2 text-sm leading-6 ${isAlerik ? "text-[#f5f0e8]/72" : isLight ? "text-slate-600" : "text-white/75"}`}>
                  Builder + researcher partnership with a clear thesis: improve financial outcomes by improving decision quality first.
                </p>
              </div>
            </div>
          </div>
          <p className={`mt-3 text-xs ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>
            Deep Patel and Juan M. Ramirez
          </p>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl font-semibold mb-4 ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Why Arthastra Wins</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {MOATS.map((m) => (
              <div key={m.title} className={`rounded-xl border p-4 ${isAlerik ? "border-[#c9a84c]/18 bg-[#141210]/78" : isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-sm font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>{m.title}</div>
                <p className={`mt-2 text-sm leading-6 ${isAlerik ? "text-[#f5f0e8]/72" : isLight ? "text-slate-600" : "text-white/75"}`}>{m.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl font-semibold mb-4 ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Mission Pillars</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {PILLARS.map((pillar) => (
              <div key={pillar.title} className={`rounded-xl border p-4 ${isAlerik ? "border-[#c9a84c]/18 bg-[#141210]/78" : isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className="text-2xl">{pillar.icon}</div>
                <div className={`mt-2 text-base font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>{pillar.title}</div>
                <p className={`mt-2 text-sm leading-6 ${isAlerik ? "text-[#f5f0e8]/72" : isLight ? "text-slate-600" : "text-white/75"}`}>{pillar.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl font-semibold mb-4 ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Roadmap</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {ROADMAP.map((r) => (
              <div key={r.phase} className={`rounded-xl border p-4 ${isAlerik ? "border-[#c9a84c]/18 bg-[#141210]/78" : isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>{r.phase}</div>
                <div className={`mt-1 text-sm font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>{r.item}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl font-semibold mb-4 ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Investor Paths We Support</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {TYPES.map((t) => (
              <div key={t.name} className={`rounded-xl border p-3 ${isAlerik ? "border-[#c9a84c]/18 bg-[#141210]/78" : isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className="text-xl">{t.icon}</div>
                <div className={`mt-2 text-sm font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>{t.name}</div>
                <div className={`mt-1 text-[11px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/60"}`}>{t.horizon}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="text-center py-4">
          <h3 className={`text-2xl md:text-3xl font-semibold ${isAlerik ? "text-[#f5f0e8]" : isLight ? "text-slate-900" : "text-white"}`}>Your market classroom starts here.</h3>
          <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/70"}`}>Practice, learn, and build conviction before real capital is on the line.</p>
          <div className="mt-5">
            <Link
              href="/simulator"
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold ${
                isAzula
                  ? "bg-[#b7954c] text-[#111112]"
                  : isCherry
                    ? "bg-rose-600 text-white"
                    : "bg-blue-600 text-white"
              }`}
            >
              Open Simulator
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
