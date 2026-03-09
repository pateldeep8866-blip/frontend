"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";

const TRUTH_CARDS = [
  {
    title: "Understanding Beats Guessing",
    text: "The difference between profit and loss often is not the stock. It is knowing why you bought it and when to sell.",
  },
  {
    title: "Research Takes Time",
    text: "A single trade can require hours of reading, analysis, and comparison. Arthastra brings that research into one place.",
  },
  {
    title: "Practice Before Risk",
    text: "Make mistakes with simulated capital first. Every mistake becomes a lesson instead of a loss.",
  },
];

const STEPS = [
  { title: "Learn the Basics", text: "Start in Market School. Know what you are trading before you trade it." },
  { title: "Explore the Research", text: "Click the tabs. Read the executive briefs. See the summaries. Understand the market context." },
  { title: "Make Your Own Trades", text: "Use simulated capital. Research first. Then decide." },
  { title: "Build Real Instinct", text: "Weeks of practice build pattern recognition. Experience becomes confidence." },
  { title: "Ask ASTRA", text: "Use ASTRA to analyze trades and understand signals. Research with an AI assistant built for learning." },
];

const FEATURES = [
  { title: "QUANT_LAB Engine", text: "Scores market instruments using quantitative models and real market data." },
  { title: "ASTRA Auto-Pilot", text: "AI-powered analysis and simulated trades with clear explanations." },
  { title: "Paper Trading", text: "Practice with simulated capital before risking real money." },
  { title: "Crypto Coverage", text: "Research digital assets alongside stocks and global markets." },
  { title: "Market School", text: "Learn investing fundamentals without jargon." },
  { title: "Global Markets", text: "Understand stocks, commodities, crypto, and macro conditions together." },
  { title: "Risk Scores", text: "Transparent confidence and risk ratings." },
];

export default function HomeTabPage() {
  const [theme, setTheme] = useState("dark");
  const [language, setLanguage] = useState("English");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("theme_mode");
    if (saved === "dark" || saved === "light" || saved === "cherry" || saved === "azula") {
      setTheme(saved);
    }
  }, []);

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isLight = theme === "light" || isCherry || isAzula;

  const pageClass = useMemo(() => {
    if (isCherry) return "cherry-mode bg-[#fffefc] text-[#3a2530]";
    if (isAzula) return "azula-mode bg-[#09090b] text-[#e7e1c5]";
    if (isLight) return "light-mode bg-[#fbfdff] text-slate-900";
    return "dark-mode bg-slate-950 text-white";
  }, [isCherry, isAzula, isLight]);

  const ctaClass = isAzula
    ? "bg-[#b7954c] text-[#111112]"
    : isCherry
      ? "bg-rose-600 text-white"
      : isLight
        ? "bg-blue-600 text-white"
        : "bg-cyan-500 text-slate-950";

  return (
    <div className={`min-h-screen relative overflow-hidden ${pageClass}`}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,rgba(125,211,252,0.12),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(147,197,253,0.08),transparent_42%)]" />
      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        <section className="text-center mb-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <details className="relative">
                <summary className={`list-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer [&::-webkit-details-marker]:hidden ${
                  isLight ? "border-slate-300 bg-white/90 text-slate-800" : "border-white/15 bg-slate-900/60 text-white/85"
                }`}>
                  Theme: {theme === "cherry" ? "Sakura" : theme === "azula" ? "Azula" : theme === "light" ? "Light" : "Dark"}
                  <span className="text-[10px]">▼</span>
                </summary>
                <div className={`absolute left-0 top-full mt-2 w-40 rounded-xl border p-1.5 shadow-2xl ${
                  isLight ? "border-slate-300 bg-white/95" : "border-white/15 bg-slate-900/95"
                }`}>
                  {["dark", "light", "cherry", "azula"].map((mode) => (
                    <button
                      key={mode}
                      onClick={() => {
                        setTheme(mode);
                        if (typeof window !== "undefined") localStorage.setItem("theme_mode", mode);
                      }}
                      className={`mt-1 first:mt-0 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                        theme === mode
                          ? "bg-blue-600 text-white"
                          : isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/85 hover:bg-white/10"
                      }`}
                    >
                      {mode === "cherry" ? "Sakura" : mode === "azula" ? "Azula" : mode[0].toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
              </details>

              <details className="relative">
                <summary className={`list-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer [&::-webkit-details-marker]:hidden ${
                  isLight ? "border-slate-300 bg-white/90 text-slate-800" : "border-white/15 bg-slate-900/60 text-white/85"
                }`}>
                  Language: {language}
                  <span className="text-[10px]">▼</span>
                </summary>
                <div className={`absolute left-0 top-full mt-2 w-40 rounded-xl border p-1.5 shadow-2xl ${
                  isLight ? "border-slate-300 bg-white/95" : "border-white/15 bg-slate-900/95"
                }`}>
                  {["English", "Spanish", "French", "Hindi"].map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setLanguage(lang)}
                      className={`mt-1 first:mt-0 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                        language === lang
                          ? "bg-blue-600 text-white"
                          : isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/85 hover:bg-white/10"
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </details>
            </div>
            <details className="relative">
              <summary className={`list-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer [&::-webkit-details-marker]:hidden ${
                isLight ? "border-slate-300 bg-white/90 text-slate-800" : "border-white/15 bg-slate-900/60 text-white/85"
              }`}>
                Menu
                <span className="text-[10px]">▼</span>
              </summary>
              <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl border p-2 shadow-2xl flex flex-col gap-1 ${
                isLight ? "border-slate-300 bg-white/95" : "border-white/15 bg-slate-900/95"
              }`}>
                <Link href="/home" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>Home</Link>
                <Link href="/about" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>About</Link>
                <Link href="/market-school" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>Learn</Link>
                <Link href="/simulator" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>Simulator</Link>
              </div>
            </details>
          </div>

          <div className="mt-6 flex justify-center">
            <div className="inline-flex items-center gap-5 md:gap-6">
              <Image src="/arthastra-icon-transparent.svg" alt="Arthastra logo" width={112} height={112} className="h-24 w-24 md:h-28 md:w-28" />
              <div className="text-left">
                <h1 className={`text-5xl md:text-6xl font-semibold leading-none tracking-tight ${
                  isCherry ? "bg-gradient-to-r from-rose-900 via-fuchsia-800 to-indigo-800 bg-clip-text text-transparent"
                    : isAzula ? "azula-title-neon text-transparent bg-clip-text bg-gradient-to-r from-[#d9c58a] via-[#efe3bc] to-[#b9974c]"
                      : isLight ? "text-slate-900" : "bg-gradient-to-r from-white via-cyan-100 to-sky-200 bg-clip-text text-transparent"
                }`}>
                  Arthastra
                </h1>
                <p className={`mt-2 text-3xl md:text-4xl font-medium leading-none tracking-tight ${isCherry ? "text-rose-900" : isAzula ? "text-[#f0e7c8]/95" : isLight ? "text-slate-700" : "text-cyan-100/90"}`}>
                  Analytical Information
                </p>
              </div>
            </div>
          </div>
          <p className={`mt-5 text-lg md:text-xl font-medium ${isCherry ? "text-rose-900/90" : isAzula ? "text-[#ddd2ae]/90" : isLight ? "text-slate-700" : "text-slate-200/90"}`}>Clarity in Every Market.</p>
          <p className={`text-xs mt-3 ${isCherry ? "text-rose-800/80" : isAzula ? "text-[#b8ab82]/80" : isLight ? "text-slate-500" : "text-slate-400/80"}`}>Founder: Deep Patel • Co-founder: Juan M. Ramirez</p>

          <div className={`mt-5 inline-flex rounded-xl overflow-hidden border ${isLight ? "border-slate-300 bg-white/85 shadow-sm" : "border-white/15 bg-slate-900/60"}`}>
            <Link href="/home" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "bg-blue-600 text-white" : "bg-blue-600 text-white"}`}>Home</Link>
            <Link href="/" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Stock</Link>
            <Link href="/" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Crypto</Link>
            <Link href="/" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Metals</Link>
            <Link href="/" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>FX</Link>
            <Link href="/market-school" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Learn</Link>
            <Link href="/simulator" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Simulator</Link>
            <Link href="/" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Geo Politics</Link>
            <Link href="/" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Global Market</Link>
          </div>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-4 md:p-5 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h3 className={`text-lg font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Market Overview</h3>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-10 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-4">
          <h1 className={`text-4xl md:text-6xl font-semibold leading-[1.05] ${isLight ? "text-slate-900" : "text-white"}`}>
            Learn Before You Earn
          </h1>
          <p className={`mt-3 text-xl md:text-2xl font-medium ${isLight ? "text-slate-700" : "text-white/90"}`}>
            It&apos;s time everyday investors can earn too.
          </p>
          <div className={`mt-5 max-w-4xl text-sm md:text-base leading-7 space-y-4 ${isLight ? "text-slate-600" : "text-white/75"}`}>
            <p>
              Making one good trade should not require hours of searching through financial reports, charts, APIs, videos, and news only to end with an educated guess.
            </p>
            <p>
              Investors spend more time collecting information than actually understanding it. Arthastra brings fundamentals, technical analysis, market sentiment, and news together into one research-driven platform.
            </p>
            <p className={`font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>Learn first. Invest second.</p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/" className={`inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold ${ctaClass}`}>
              Start Researching →
            </Link>
            <Link
              href="/about"
              className={`inline-flex rounded-xl border px-4 py-2.5 text-sm font-semibold ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-slate-900/50 text-white/85"}`}
            >
              Read Our Story →
            </Link>
          </div>
          <p className={`mt-4 text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>
            Paper trading simulator for educational purposes only. No real money required. Not financial advice.
          </p>
        </section>

        <section className={`mb-6 rounded-xl border px-4 py-2 text-xs md:text-sm text-center ${isLight ? "border-amber-300 bg-amber-50 text-amber-800" : "border-amber-400/25 bg-amber-500/10 text-amber-200"}`}>
          Free to use · No real money required · Not financial advice · Built to teach and research — not to profit from your losses
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl md:text-3xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Why Arthastra Exists</h2>
          <div className={`mt-4 text-sm md:text-base leading-7 space-y-3 ${isLight ? "text-slate-700" : "text-white/78"}`}>
            <p>Making one good trade used to require hours of research. Financial statements. Charts. News. Market sentiment. All spread across different places.</p>
            <p>Deciding what stock to buy and what not to buy should not require digging through the entire internet.</p>
            <p>So we built Arthastra: a research-first investing platform for everyday investors. We bring everything together in one place — you bring your brain.</p>
          </div>
          <p className={`mt-5 text-base md:text-lg font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
            Most platforms optimize for trading speed. We optimize for decision quality.
          </p>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl md:text-3xl font-semibold mb-4 ${isLight ? "text-slate-900" : "text-white"}`}>Research Is The Real Edge</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {TRUTH_CARDS.map((card) => (
              <div key={card.title} className={`rounded-xl border p-4 ${isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{card.title}</div>
                <p className={`mt-2 text-sm leading-6 ${isLight ? "text-slate-600" : "text-white/75"}`}>{card.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl md:text-3xl font-semibold mb-4 ${isLight ? "text-slate-900" : "text-white"}`}>From Curious to Confident</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {STEPS.map((step, idx) => (
              <div key={step.title} className={`rounded-xl border p-4 ${isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Step {idx + 1}</div>
                <div className={`mt-1 text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{step.title}</div>
                <p className={`mt-2 text-sm leading-6 ${isLight ? "text-slate-600" : "text-white/75"}`}>{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl md:text-3xl font-semibold mb-4 ${isLight ? "text-slate-900" : "text-white"}`}>Built Like Professional Tools — Made for Everyone</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feature) => (
              <div key={feature.title} className={`rounded-xl border p-4 ${isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
                <div className={`text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{feature.title}</div>
                <p className={`mt-2 text-sm leading-6 ${isLight ? "text-slate-600" : "text-white/75"}`}>{feature.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6">
          <h2 className={`text-2xl md:text-3xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Built by Systems Architects</h2>
          <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>
            We built the platform we wished existed when we started researching trades ourselves.
          </p>
          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`rounded-xl border p-4 ${isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
              <div className={`text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Deep Patel</div>
              <div className={`text-xs mt-1 ${isLight ? "text-slate-500" : "text-white/60"}`}>Founder · Systems Architect</div>
              <p className={`mt-3 text-sm leading-6 ${isLight ? "text-slate-600" : "text-white/75"}`}>
                Deep started Arthastra and designed the original platform architecture and research infrastructure. With a cybersecurity and systems design background, he focuses on reliable foundations and disciplined research workflows.
              </p>
              <p className={`mt-3 text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>
                Build the foundation correctly and everything else follows.
              </p>
            </div>
            <div className={`rounded-xl border p-4 ${isLight ? "border-slate-300 bg-white/85" : "border-white/10 bg-white/5"}`}>
              <div className={`text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Juan M. Ramirez</div>
              <div className={`text-xs mt-1 ${isLight ? "text-slate-500" : "text-white/60"}`}>Co-Founder · Systems Architect</div>
              <p className={`mt-3 text-sm leading-6 ${isLight ? "text-slate-600" : "text-white/75"}`}>
                Juan designed the quant-like research engines and AI analysis systems that power Arthastra. With cybersecurity and penetration testing experience, he focuses on turning complexity into clear decisions for everyday investors.
              </p>
              <p className={`mt-3 text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>
                Information is the edge. Research first. Then decide.
              </p>
            </div>
          </div>
          <p className={`mt-4 text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>
            Deep builds it right. Juan researches deeply. Together, that is Arthastra.
          </p>
        </section>

        <section className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] text-center">
          <h2 className={`text-2xl md:text-3xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Start With Practice</h2>
          <p className={`mt-3 text-sm md:text-base ${isLight ? "text-slate-600" : "text-white/75"}`}>
            Make trades. Watch ASTRA. Read the reasoning. Learn in a safe environment. That is the whole point.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/simulator" className={`inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold ${ctaClass}`}>
              Open Simulator →
            </Link>
            <Link
              href="/about"
              className={`inline-flex rounded-xl border px-4 py-2.5 text-sm font-semibold ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-slate-900/50 text-white/85"}`}
            >
              Read Our Story →
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
