"use client";

import Image from "next/image";
import Link from "next/link";
import { Cormorant_Garamond, IBM_Plex_Mono, Syne } from "next/font/google";
import { useEffect, useMemo, useState } from "react";
import AzulaThemeBackground from "@/components/AzulaThemeBackground";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const syne = Syne({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
});

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
  { icon: "🧮", title: "QUANT_LAB Engine", text: "Scores market instruments using quantitative models and real market data." },
  { icon: "🤖", title: "ASTRA Auto-Pilot", text: "AI-powered analysis and simulated trades with clear explanations." },
  { icon: "📊", title: "Paper Trading", text: "Practice with simulated capital before risking real money." },
  { icon: "₿", title: "Crypto Coverage", text: "Research digital assets alongside stocks and global markets." },
  { icon: "📚", title: "Market School", text: "Learn investing fundamentals without jargon." },
  { icon: "🌍", title: "Global Markets", text: "Understand stocks, commodities, crypto, and macro conditions together." },
  { icon: "🛡", title: "Risk Scores", text: "Transparent confidence and risk ratings." },
];

const MARKET_STACK = [
  { label: "Coverage", value: "47 Instruments" },
  { label: "Simulator Capital", value: "$100,000" },
  { label: "Core Positioning", value: "Research-First" },
  { label: "Operating Mode", value: "Educational" },
];

const INFO_BLOCKS = [
  {
    title: "What you can do today",
    body: "Track stocks, crypto, metals, and FX in one workspace. Use ASTRA for guided analysis and test decisions safely in paper trading.",
  },
  {
    title: "How to use it effectively",
    body: "Start with Market School, build a watchlist, write a thesis before each trade, and review outcomes weekly to improve decision quality.",
  },
  {
    title: "Why this is different",
    body: "Most apps optimize for clicks and speed. Arthastra is designed for structured research, risk visibility, and long-term learning discipline.",
  },
];

export default function HomeTabPage() {
  const [theme, setTheme] = useState("dark");
  const [language, setLanguage] = useState("English");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem("theme_mode");
    if (saved === "dark" || saved === "light" || saved === "cherry" || saved === "azula" || saved === "alerik") {
      setTheme(saved);
    }
  }, []);

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll(".reveal"));
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.16 }
    );

    nodes.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isAlerik = theme === "alerik";
  const isLight = theme === "light" || isCherry || isAzula;

  const setThemeMode = (mode) => {
    const next = String(mode || "").toLowerCase();
    if (!["dark", "light", "cherry", "azula", "alerik"].includes(next)) return;
    setTheme(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("theme_mode", next);
      window.dispatchEvent(new Event("theme-updated"));
    }
  };

  const pageClass = useMemo(() => {
    if (isCherry) return "cherry-mode bg-[#fffefc] text-[#3a2530]";
    if (isAzula) return "azula-mode bg-[#050506] text-[#efe5cb]";
    if (isAlerik) return "alerik-mode bg-[#050505] text-[#f5f0e8]";
    if (isLight) return "light-mode bg-[#fbfdff] text-slate-900";
    return "dark-mode bg-slate-950 text-white";
  }, [isAlerik, isCherry, isAzula, isLight]);

  const ctaClass = isAzula
    ? "bg-[#cfb06a] text-[#101012] hover:bg-[#dec284]"
    : isCherry
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : isAlerik
        ? "bg-[#cfb06a] text-[#101012] hover:bg-[#dec284]"
      : isLight
        ? "bg-blue-600 text-white hover:bg-blue-700"
        : "bg-cyan-500 text-slate-950 hover:bg-cyan-400";

  const shellClass = isLight
    ? "border-slate-300 bg-white/90 text-slate-800"
    : isAlerik
      ? "border-[#c9a84c]/35 bg-[#0b0b0b]/90 text-[#f5f0e8]"
      : "border-white/15 bg-slate-900/60 text-white/85";

  const cardClass = isLight
    ? "border-slate-300 bg-white/90 shadow-sm"
    : isAzula
      ? "border-[#b99654]/40 bg-[#0f1013]/85"
      : "border-white/12 bg-slate-900/55";

  const softCardClass = isLight
    ? "border-slate-300 bg-white/85"
    : isAzula
      ? "border-[#b99654]/25 bg-[#16171b]/70"
      : "border-white/10 bg-white/5";

  const mutedTextClass = isLight ? "text-slate-600" : isAzula ? "text-[#d9ccaa]/80" : "text-white/75";

  const accentLabelClass = isCherry
    ? "text-rose-700"
    : isAzula
      ? "text-[#d6be86]"
      : isLight
        ? "text-slate-500"
        : "text-cyan-200/80";

  const honestClass = isCherry
    ? "border-rose-300 bg-rose-50 text-rose-800"
    : isAzula
      ? "border-[#c8a865]/30 bg-[#c8a865]/10 text-[#e8d7ac]"
      : isLight
        ? "border-amber-300 bg-amber-50 text-amber-800"
        : "border-cyan-400/25 bg-cyan-500/10 text-cyan-200";

  const heroGlowClass = isCherry
    ? "bg-[radial-gradient(circle_at_12%_8%,rgba(244,63,94,0.14),transparent_36%),radial-gradient(circle_at_85%_72%,rgba(217,70,239,0.08),transparent_42%)]"
    : isAzula
      ? "bg-[radial-gradient(circle_at_12%_8%,rgba(212,175,106,0.16),transparent_36%),radial-gradient(circle_at_85%_72%,rgba(212,175,106,0.1),transparent_42%)]"
      : isLight
        ? "bg-[radial-gradient(circle_at_12%_8%,rgba(59,130,246,0.12),transparent_36%),radial-gradient(circle_at_85%_72%,rgba(14,165,233,0.08),transparent_42%)]"
      : "bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.12),transparent_36%),radial-gradient(circle_at_85%_72%,rgba(56,189,248,0.08),transparent_42%)]";

  return (
    <div className={`min-h-screen relative overflow-hidden ${pageClass} ${syne.className}`}>
      {isCherry && <SakuraThemeBackground />}
      {isAzula && <AzulaThemeBackground />}
      <div className="pointer-events-none absolute inset-0 opacity-[0.16] [background-image:linear-gradient(to_right,rgba(148,163,184,0.22)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.22)_1px,transparent_1px)] [background-size:54px_54px]" />
      <div className={`pointer-events-none absolute inset-0 ${heroGlowClass} animate-panGlow`} />

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        <section className="text-center mb-8 reveal reveal-up">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <details className="relative">
                <summary className={`list-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer [&::-webkit-details-marker]:hidden ${shellClass}`}>
                  Theme: {theme === "cherry" ? "Sakura" : theme === "azula" ? "Azula" : theme === "light" ? "Light" : "Dark"}
                  <span className="text-[10px]">▼</span>
                </summary>
                <div className={`absolute left-0 top-full mt-2 w-40 rounded-xl border p-1.5 shadow-2xl ${shellClass}`}>
                  {["dark", "light", "cherry", "azula", "alerik"].map((mode) => (
                    <button
                      key={mode}
                      onClick={() => setThemeMode(mode)}
                      className={`mt-1 first:mt-0 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                        theme === mode
                          ? "bg-blue-600 text-white"
                          : isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/85 hover:bg-white/10"
                      }`}
                    >
                      {mode === "cherry" ? "Sakura" : mode === "azula" ? "Azula" : mode === "alerik" ? "Alerik" : mode[0].toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                </div>
              </details>

              <details className="relative">
                <summary className={`list-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer [&::-webkit-details-marker]:hidden ${shellClass}`}>
                  Language: {language}
                  <span className="text-[10px]">▼</span>
                </summary>
                <div className={`absolute left-0 top-full mt-2 w-40 rounded-xl border p-1.5 shadow-2xl ${shellClass}`}>
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
              <summary className={`list-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer [&::-webkit-details-marker]:hidden ${shellClass}`}>
                Menu
                <span className="text-[10px]">▼</span>
              </summary>
              <div className={`absolute right-0 top-full mt-2 w-56 rounded-xl border p-2 shadow-2xl flex flex-col gap-1 ${shellClass}`}>
                <Link href="/home" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>Home</Link>
                <Link href="/about" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>About</Link>
                <Link href="/market-school" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>Learn</Link>
                <Link href="/bots" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>Bots</Link>
                <Link href="/global-market" className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/85"}`}>Global Market</Link>
              </div>
            </details>
          </div>

          <div className="mt-6 flex justify-center reveal reveal-zoom delay-1">
            <div className="inline-flex items-center gap-5 md:gap-6">
              <Image src="/arthastra-icon-transparent.svg" alt="Arthastra logo" width={112} height={112} className="h-24 w-24 md:h-28 md:w-28 animate-floatSlow" />
              <div className="text-left">
                <h1 className={`text-5xl md:text-6xl font-semibold leading-none tracking-tight ${
                  isCherry ? "bg-gradient-to-r from-rose-900 via-fuchsia-800 to-indigo-800 bg-clip-text text-transparent"
                    : isAzula ? "text-transparent bg-clip-text bg-gradient-to-r from-[#d9c58a] via-[#efe3bc] to-[#b9974c]"
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
          <p className={`mt-5 text-lg md:text-xl font-medium reveal reveal-up delay-2 ${isCherry ? "text-rose-900/90" : isAzula ? "text-[#ddd2ae]/90" : isLight ? "text-slate-700" : "text-slate-200/90"}`}>Clarity in Every Market.</p>
          <p className={`text-xs mt-3 reveal reveal-up delay-3 ${isCherry ? "text-rose-800/80" : isAzula ? "text-[#b8ab82]/80" : isLight ? "text-slate-500" : "text-slate-400/80"}`}>Founder: Deep Patel • Co-founder: Juan M. Ramirez</p>

          <div className={`mt-5 inline-flex rounded-xl overflow-hidden border reveal reveal-up delay-4 ${shellClass}`}>
            <Link href="/home" className="px-3 py-1.5 text-xs font-semibold inline-flex items-center bg-blue-600 text-white">Home</Link>
            <Link href="/briefing" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Stock</Link>
            <Link href="/briefing" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Crypto</Link>
            <Link href="/global-market" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Metals</Link>
            <Link href="/global-market" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>FX</Link>
            <Link href="/market-school" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Learn</Link>
            <Link href="/bots" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Bots</Link>
            <Link href="/briefing" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Geo Politics</Link>
            <Link href="/global-market" className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"}`}>Global Market</Link>
          </div>
        </section>

        <section className={`rounded-2xl border backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6 reveal reveal-up ${cardClass}`}>
          <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_0.9fr] gap-6 items-start">
            <div>
              <p className={`text-[11px] uppercase tracking-[0.22em] font-semibold ${accentLabelClass} ${plexMono.className}`}>Home • Research First</p>
              <h2 className={`mt-2 text-5xl md:text-7xl font-semibold leading-[0.95] reveal reveal-left delay-1 ${isLight ? "text-slate-900" : "text-white"} ${cormorant.className}`}>Learn Before You Earn</h2>
              <p className={`mt-3 text-xl md:text-2xl font-medium reveal reveal-left delay-2 ${isLight ? "text-slate-700" : isAzula ? "text-[#eadfbf]" : "text-white/90"}`}>It&apos;s time everyday investors can earn too.</p>
              <div className={`mt-5 max-w-4xl text-sm md:text-base leading-7 space-y-4 reveal reveal-left delay-3 ${mutedTextClass}`}>
                <p>Making one good trade should not require hours of searching through financial reports, charts, APIs, videos, and news only to end with an educated guess.</p>
                <p>Investors spend more time collecting information than actually understanding it. Arthastra brings fundamentals, technical analysis, market sentiment, and news together into one research-driven platform.</p>
                <p className={`font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Learn first. Invest second.</p>
              </div>
              <div className="mt-6 flex flex-wrap gap-3 reveal reveal-left delay-4">
                <Link href="/briefing" className={`inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${ctaClass}`}>Start Researching →</Link>
                <Link href="/about" className={`inline-flex rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "border-white/15 bg-slate-900/50 text-white/85 hover:bg-white/10"}`}>Read Our Story →</Link>
              </div>
              <p className={`mt-4 text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Paper trading simulator for educational purposes only. No real money required. Not financial advice.</p>
            </div>

            <div className={`rounded-2xl border p-4 md:p-5 reveal reveal-right delay-2 ${softCardClass}`}>
              <h3 className={`text-sm font-semibold uppercase tracking-wide ${isLight ? "text-slate-700" : isAzula ? "text-[#d6be86]" : "text-cyan-100/90"}`}>Market Overview</h3>
              <div className="mt-3 space-y-2">
                {MARKET_STACK.map((item, idx) => (
                  <div key={item.label} className={`rounded-lg border px-3 py-2.5 flex items-center justify-between reveal reveal-right ${idx === 0 ? "delay-2" : idx === 1 ? "delay-3" : idx === 2 ? "delay-4" : "delay-5"} ${softCardClass}`}>
                    <span className={`text-xs ${isLight ? "text-slate-600" : "text-white/65"}`}>{item.label}</span>
                    <span className={`text-xs font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={`mb-6 rounded-xl border px-4 py-2 text-xs md:text-sm text-center reveal reveal-up ${honestClass}`}>
          Free to use · No real money required · Not financial advice · Built to teach and research — not to profit from your losses
        </section>

        <section className={`rounded-2xl border backdrop-blur-md p-6 md:p-8 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6 reveal reveal-up ${cardClass}`}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className={`text-2xl md:text-3xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>What You Get Inside Arthastra</h2>
            <span className={`text-[11px] uppercase tracking-[0.18em] font-semibold ${accentLabelClass} ${plexMono.className}`}>Research Workflow</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {INFO_BLOCKS.map((block, idx) => (
              <div key={block.title} className={`rounded-xl border p-4 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg reveal reveal-up ${idx === 0 ? "delay-1" : idx === 1 ? "delay-2" : "delay-3"} ${softCardClass}`}>
                <div className={`text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{block.title}</div>
                <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>{block.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`rounded-2xl border backdrop-blur-md p-6 md:p-10 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6 reveal reveal-up ${cardClass}`}>
          <p className={`text-[11px] uppercase tracking-[0.24em] ${accentLabelClass} ${plexMono.className}`}>Why We Built This</p>
          <h2 className={`mt-2 text-4xl md:text-6xl leading-[0.98] ${isLight ? "text-slate-900" : "text-white"} ${cormorant.className}`}>
            Investing without understanding is just{" "}
            <em className={`${isAzula ? "text-[#d6be86]" : isLight ? "text-amber-700" : "text-yellow-300"} italic`}>gambling with extra steps.</em>
          </h2>
          <div className={`mt-4 text-sm md:text-base leading-7 space-y-3 ${mutedTextClass}`}>
            <p>Making one good trade used to require hours of research. Financial statements. Charts. News. Market sentiment. All spread across different places.</p>
            <p>Deciding what stock to buy and what not to buy should not require digging through the entire internet.</p>
            <p>So we built Arthastra: a research-first investing platform for everyday investors. We bring everything together in one place — you bring your brain.</p>
          </div>
          <p className={`mt-5 text-base md:text-lg font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Most platforms optimize for trading speed. We optimize for decision quality.</p>
        </section>

        <section className={`rounded-2xl border backdrop-blur-md p-6 md:p-10 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6 reveal reveal-up ${cardClass}`}>
          <p className={`text-[11px] uppercase tracking-[0.24em] ${accentLabelClass} ${plexMono.className}`}>Truth Section</p>
          <h2 className={`mt-2 text-4xl md:text-6xl leading-[0.98] mb-6 ${isLight ? "text-slate-900" : "text-white"} ${cormorant.className}`}>Research Is The Real Edge</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border rounded-xl overflow-hidden">
            {TRUTH_CARDS.map((card, idx) => (
              <div key={card.title} className={`relative border p-5 md:p-6 transition-all duration-300 hover:-translate-y-1 reveal reveal-up ${idx === 0 ? "delay-1" : idx === 1 ? "delay-2" : "delay-3"} ${softCardClass}`}>
                <div className={`text-6xl leading-none ${cormorant.className} ${isLight ? "text-slate-300" : isAzula ? "text-[#8e7a4d]/35" : "text-white/10"}`}>{String(idx + 1).padStart(2, "0")}</div>
                <div className={`mt-2 text-xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{card.title}</div>
                <p className={`mt-3 text-sm leading-7 ${mutedTextClass}`}>{card.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`rounded-2xl border backdrop-blur-md p-6 md:p-10 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6 reveal reveal-up ${cardClass}`}>
          <p className={`text-[11px] uppercase tracking-[0.24em] ${accentLabelClass} ${plexMono.className}`}>How It Works</p>
          <h2 className={`mt-2 text-4xl md:text-6xl leading-[0.98] mb-6 ${isLight ? "text-slate-900" : "text-white"} ${cormorant.className}`}>
            Four steps from{" "}
            <em className={`${isAzula ? "text-[#d6be86]" : isLight ? "text-amber-700" : "text-yellow-300"} italic`}>curious</em>{" "}
            to confident.
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {STEPS.map((step, idx) => (
              <div key={step.title} className={`rounded-xl border p-4 text-center reveal reveal-up ${idx % 2 === 0 ? "delay-1" : "delay-2"} ${softCardClass}`}>
                <div className={`mx-auto mb-3 h-10 w-10 rounded-full border flex items-center justify-center text-[11px] tracking-[0.08em] ${isLight ? "border-slate-400 text-slate-600" : isAzula ? "border-[#b99654]/60 text-[#d6be86]" : "border-white/30 text-white/70"} ${plexMono.className}`}>{String(idx + 1).padStart(2, "0")}</div>
                <div className={`mt-1 text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{step.title}</div>
                <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>{step.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`rounded-2xl border backdrop-blur-md p-6 md:p-10 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6 reveal reveal-up ${cardClass}`}>
          <p className={`text-[11px] uppercase tracking-[0.24em] ${accentLabelClass} ${plexMono.className}`}>Features Inside</p>
          <h2 className={`mt-2 text-4xl md:text-6xl leading-[0.98] mb-3 ${isLight ? "text-slate-900" : "text-white"} ${cormorant.className}`}>
            Built with tools that{" "}
            <em className={`${isAzula ? "text-[#d6be86]" : isLight ? "text-amber-700" : "text-yellow-300"} italic`}>explain themselves.</em>
          </h2>
          <p className={`text-sm md:text-base max-w-3xl ${mutedTextClass}`}>Every feature was designed around one question: will this help someone understand investing better?</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((feature, idx) => (
              <div key={feature.title} className={`rounded-none border p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg reveal reveal-up ${idx % 3 === 0 ? "delay-1" : idx % 3 === 1 ? "delay-2" : "delay-3"} ${softCardClass}`}>
                <div className="text-lg mb-1">{feature.icon}</div>
                <div className={`text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{feature.title}</div>
                <p className={`mt-2 text-sm leading-6 ${mutedTextClass}`}>{feature.text}</p>
                <div className={`mt-3 inline-block text-[10px] uppercase tracking-[0.2em] px-2 py-1 border rounded-sm ${accentLabelClass} ${isLight ? "border-slate-300 bg-slate-50" : "border-white/20 bg-white/5"} ${plexMono.className}`}>
                  {feature.title.includes("ASTRA")
                    ? "Educational AI"
                    : feature.title.includes("QUANT")
                      ? "Under The Hood"
                      : feature.title.includes("Paper")
                        ? "Zero Risk Practice"
                        : feature.title.includes("School")
                          ? "Education"
                          : feature.title.includes("Global")
                            ? "Coverage"
                            : "Research"}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={`rounded-2xl border backdrop-blur-md p-6 md:p-10 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] mb-6 reveal reveal-up ${cardClass}`}>
          <p className={`text-[11px] uppercase tracking-[0.24em] ${accentLabelClass} ${plexMono.className}`}>Who Built This</p>
          <h2 className={`mt-2 text-4xl md:text-6xl leading-[0.98] ${isLight ? "text-slate-900" : "text-white"} ${cormorant.className}`}>
            Two builders who got{" "}
            <em className={`${isAzula ? "text-[#d6be86]" : isLight ? "text-amber-700" : "text-yellow-300"} italic`}>tired of the gap.</em>
          </h2>
          <p className={`mt-2 text-sm ${mutedTextClass}`}>We built the platform we wished existed when we started researching trades ourselves.</p>

          <div className={`mt-4 rounded-xl border p-3 reveal reveal-zoom delay-1 ${softCardClass}`}>
            <Image src="/founders-team.jpg" alt="Deep Patel and Juan M. Ramirez" width={1600} height={900} className="w-full h-auto rounded-lg object-cover" priority />
            <p className={`mt-2 text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Deep Patel and Juan M. Ramirez</p>
          </div>

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className={`rounded-none border p-5 reveal reveal-left delay-2 ${softCardClass}`}>
              <div className={`mb-2 inline-block text-[10px] uppercase tracking-[0.2em] px-2 py-1 border rounded-sm ${accentLabelClass} ${isLight ? "border-slate-300 bg-slate-50" : "border-white/20 bg-white/5"} ${plexMono.className}`}>Founder</div>
              <div className={`text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Deep Patel</div>
              <div className={`text-xs mt-1 ${isLight ? "text-slate-500" : "text-white/60"}`}>Founder · Systems Architect</div>
              <p className={`mt-3 text-sm leading-6 ${mutedTextClass}`}>Deep started Arthastra and designed the original platform architecture and research infrastructure. With a cybersecurity and systems design background, he focuses on reliable foundations and disciplined research workflows.</p>
              <p className={`mt-3 text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>Build the foundation correctly and everything else follows.</p>
            </div>
            <div className={`rounded-none border p-5 reveal reveal-right delay-3 ${softCardClass}`}>
              <div className={`mb-2 inline-block text-[10px] uppercase tracking-[0.2em] px-2 py-1 border rounded-sm ${accentLabelClass} ${isLight ? "border-slate-300 bg-slate-50" : "border-white/20 bg-white/5"} ${plexMono.className}`}>Co-Founder</div>
              <div className={`text-base font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Juan M. Ramirez</div>
              <div className={`text-xs mt-1 ${isLight ? "text-slate-500" : "text-white/60"}`}>Co-Founder · Systems Architect</div>
              <p className={`mt-3 text-sm leading-6 ${mutedTextClass}`}>Juan designed the quant-like research engines and AI analysis systems that power Arthastra. With cybersecurity and penetration testing experience, he focuses on turning complexity into clear decisions for everyday investors.</p>
              <p className={`mt-3 text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>Information is the edge. Research first. Then decide.</p>
            </div>
          </div>
          <p className={`mt-4 text-sm font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>Deep builds it right. Juan researches deeply. Together, that is Arthastra.</p>
        </section>

        <section className={`rounded-2xl border backdrop-blur-md p-6 md:p-8 text-center shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] reveal reveal-up ${cardClass}`}>
          <h2 className={`text-2xl md:text-3xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Start With Practice</h2>
          <p className={`mt-3 text-sm md:text-base ${mutedTextClass}`}>Make trades. Watch ASTRA. Read the reasoning. Learn in a safe environment. That is the whole point.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link href="/bots" className={`inline-flex rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${ctaClass}`}>Open Bots →</Link>
            <Link href="/about" className={`inline-flex rounded-xl border px-4 py-2.5 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50" : "border-white/15 bg-slate-900/50 text-white/85 hover:bg-white/10"}`}>Read Our Story →</Link>
          </div>
        </section>
      </main>

      <style jsx global>{`
        .reveal {
          opacity: 0;
          transform: translate3d(0, 26px, 0);
          transition: opacity 0.75s ease, transform 0.75s ease;
          will-change: transform, opacity;
        }
        .reveal.in-view {
          opacity: 1;
          transform: translate3d(0, 0, 0);
        }
        .reveal-left { transform: translate3d(-34px, 0, 0); }
        .reveal-right { transform: translate3d(34px, 0, 0); }
        .reveal-zoom { transform: scale(0.97); }
        .reveal-up { transform: translate3d(0, 26px, 0); }
        .delay-1 { transition-delay: 0.08s; }
        .delay-2 { transition-delay: 0.16s; }
        .delay-3 { transition-delay: 0.24s; }
        .delay-4 { transition-delay: 0.32s; }
        .delay-5 { transition-delay: 0.4s; }

        @keyframes floatSlow {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        .animate-floatSlow { animation: floatSlow 4.8s ease-in-out infinite; }

        @keyframes panGlow {
          0% { transform: translate3d(0, 0, 0) scale(1); }
          50% { transform: translate3d(0, -6px, 0) scale(1.02); }
          100% { transform: translate3d(0, 0, 0) scale(1); }
        }
        .animate-panGlow { animation: panGlow 10s ease-in-out infinite; }

        @media (prefers-reduced-motion: reduce) {
          .reveal,
          .reveal-left,
          .reveal-right,
          .reveal-zoom,
          .reveal-up,
          .animate-floatSlow,
          .animate-panGlow {
            animation: none !important;
            transition: none !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>
    </div>
  );
}
