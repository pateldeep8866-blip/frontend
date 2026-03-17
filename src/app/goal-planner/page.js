"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AzulaThemeBackground from "@/components/AzulaThemeBackground";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";
import { calculateProjection, fmtCompact, fmtDollar, TICKER_SUGGESTIONS } from "@/lib/goalPlannerUtils";

// ── Inline Card component (matches home/page.js Card) ────────────────────────
function Card({ title, right, children, className = "" }) {
  return (
    <div className={`app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-5 md:p-6 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] transition-all duration-300 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between mb-4">
          <div className="app-card-title text-sm font-semibold text-slate-100 tracking-wide">{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Duration quick-select presets ────────────────────────────────────────────
const DURATION_PRESETS = [
  { label: "3mo",  months: 3   },
  { label: "6mo",  months: 6   },
  { label: "1yr",  months: 12  },
  { label: "2yr",  months: 24  },
  { label: "5yr",  months: 60  },
  { label: "10yr", months: 120 },
];

const RISK_OPTIONS = [
  {
    key: "conservative",
    label: "Conservative",
    desc: "Lower risk, steadier growth",
    color: "emerald",
    activeClass: "bg-emerald-600 text-white border-emerald-600",
    textClass: "text-emerald-400",
  },
  {
    key: "moderate",
    label: "Moderate",
    desc: "Balanced risk and return",
    color: "blue",
    activeClass: "bg-blue-600 text-white border-blue-600",
    textClass: "text-blue-400",
  },
  {
    key: "aggressive",
    label: "Aggressive",
    desc: "Higher risk, higher upside",
    color: "rose",
    activeClass: "bg-rose-600 text-white border-rose-600",
    textClass: "text-rose-400",
  },
];

const MARKET_OPTIONS = [
  { key: "stocks", label: "Stocks",   icon: "📈" },
  { key: "etfs",   label: "ETFs",     icon: "🗂️" },
  { key: "crypto", label: "Crypto",   icon: "₿"  },
  { key: "gold",   label: "Gold",     icon: "🥇" },
  { key: "mixed",  label: "Mixed",    icon: "⚖️" },
];

const ALERT_TYPES = [
  { key: "buy",            label: "Buy Alerts",              desc: "Notified when a buy signal is triggered" },
  { key: "sell",           label: "Sell Alerts",             desc: "Notified when a sell signal fires"       },
  { key: "hold",           label: "Hold / Wait Alerts",      desc: "Notified when holding is recommended"    },
  { key: "rebalance",      label: "Rebalancing Alerts",      desc: "Notified when your allocation drifts"    },
  { key: "weekly_summary", label: "Weekly Progress Summary", desc: "A weekly email recap of your plan"       },
];

// ── Main component ────────────────────────────────────────────────────────────
export default function GoalPlannerPage() {
  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    const stored = localStorage.getItem("theme_mode");
    if (stored) setTheme(stored);
    const handler = () => {
      const updated = localStorage.getItem("theme_mode");
      if (updated) setTheme(updated);
    };
    window.addEventListener("theme-updated", handler);
    return () => window.removeEventListener("theme-updated", handler);
  }, []);

  const isCherry = theme === "cherry";
  const isAzula  = theme === "azula";
  const isAlerik = theme === "alerik";
  const isLylah  = theme === "lylah";
  const isLight  = theme === "light" || isCherry || isLylah;

  const pageClass = isCherry
    ? "cherry-mode min-h-screen bg-[#fffefc] text-[#3a2530]"
    : isAzula
      ? "azula-mode min-h-screen bg-[#020508] text-[#e8f4ff]"
      : isAlerik
        ? "alerik-mode min-h-screen bg-[#050505] text-[#f5f0e8]"
        : isLylah
          ? "lylah-mode min-h-screen bg-[#faf8ff] text-[#120228]"
          : isLight
            ? "min-h-screen bg-slate-50 text-slate-900"
            : "min-h-screen bg-[#05070d] text-white";

  // ── Form state ─────────────────────────────────────────────────────────────
  const [initialAmount,       setInitialAmount]       = useState("");
  const [durationMonths,      setDurationMonths]      = useState(12);
  const [riskLevel,           setRiskLevel]           = useState("moderate");
  const [marketPreference,    setMarketPreference]    = useState("stocks");
  const [monthlyContribution, setMonthlyContribution] = useState("");
  const [targetStyle,         setTargetStyle]         = useState("steady");
  const [viewMode,            setViewMode]            = useState("monthly"); // "monthly" | "weekly"

  // ── Results ────────────────────────────────────────────────────────────────
  const [result,        setResult]        = useState(null);
  const [submittedAmt,  setSubmittedAmt]  = useState(0);   // initial amount at submit time
  const [errors,        setErrors]        = useState({});
  const [submitted,     setSubmitted]     = useState(false);

  // ── What to Buy: live price data ───────────────────────────────────────────
  const [tickerPrices,   setTickerPrices]   = useState({});  // { SYM: { price, percentChange, name } }
  const [tickerLoading,  setTickerLoading]  = useState(false);

  // Fetch live prices whenever results change
  useEffect(() => {
    if (!result) return;
    // Collect every unique sym that has a TICKER_SUGGESTIONS entry
    const allSyms = [
      ...new Set(
        result.allocation
          .flatMap((b) => (TICKER_SUGGESTIONS[b.label] || []).map((t) => t.sym))
      ),
    ];
    if (!allSyms.length) return;

    setTickerLoading(true);
    fetch(`/api/compare-stocks?symbols=${encodeURIComponent(allSyms.join(","))}`)
      .then((r) => r.json())
      .then((data) => {
        const map = {};
        (data.rows || []).forEach((r) => { if (r.valid) map[r.symbol] = r; });
        setTickerPrices(map);
      })
      .catch(() => {})
      .finally(() => setTickerLoading(false));
  }, [result]);

  // ── Email alerts state ─────────────────────────────────────────────────────
  const [alertEmail,      setAlertEmail]      = useState("");
  const [enabledAlerts,   setEnabledAlerts]   = useState({ weekly_summary: true });
  const [alertSaving,     setAlertSaving]     = useState(false);
  const [alertSaveMsg,    setAlertSaveMsg]    = useState(null); // { ok, text }

  // ── Input validation ───────────────────────────────────────────────────────
  function validate() {
    const errs = {};
    const amt = Number(String(initialAmount).replace(/,/g, ""));
    if (!initialAmount || isNaN(amt) || amt < 1) {
      errs.initialAmount = "Enter a valid starting amount (minimum $1).";
    }
    if (!durationMonths || durationMonths < 1 || durationMonths > 600) {
      errs.durationMonths = "Duration must be between 1 and 600 months.";
    }
    const contrib = Number(String(monthlyContribution).replace(/,/g, ""));
    if (monthlyContribution !== "" && (isNaN(contrib) || contrib < 0)) {
      errs.monthlyContribution = "Monthly contribution must be 0 or more.";
    }
    return errs;
  }

  function handleCalculate() {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    const amt    = Number(String(initialAmount).replace(/,/g, ""));
    const contrib = monthlyContribution === "" ? 0 : Number(String(monthlyContribution).replace(/,/g, ""));

    const projection = calculateProjection({
      initialAmount:       amt,
      durationMonths:      Number(durationMonths),
      riskLevel,
      marketPreference,
      monthlyContribution: contrib,
      targetStyle,
    });

    setResult(projection);
    setSubmittedAmt(amt);
    setSubmitted(true);

    // Smooth scroll to results
    setTimeout(() => {
      document.getElementById("gp-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  }

  // ── Alert save handler ─────────────────────────────────────────────────────
  async function handleSaveAlerts() {
    if (!alertEmail || !alertEmail.includes("@")) {
      setAlertSaveMsg({ ok: false, text: "Please enter a valid email address." });
      return;
    }
    const selected = Object.entries(enabledAlerts)
      .filter(([, v]) => v)
      .map(([k]) => k);
    if (selected.length === 0) {
      setAlertSaveMsg({ ok: false, text: "Select at least one alert type." });
      return;
    }
    setAlertSaving(true);
    setAlertSaveMsg(null);
    try {
      const res  = await fetch("/api/goal-planner-alerts", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:        alertEmail,
          alertTypes:   selected,
          planSnapshot: result ? {
            initialAmount,
            durationMonths,
            riskLevel,
            marketPreference,
            monthlyContribution,
            targetStyle,
          } : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setAlertSaveMsg({
        ok:   data.ok,
        text: data.ok ? "Alert preferences saved! We'll notify you when signals fire." : (data.error || "Something went wrong."),
      });
    } catch {
      setAlertSaveMsg({ ok: false, text: "Network error — please try again." });
    } finally {
      setAlertSaving(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  const riskOption     = RISK_OPTIONS.find((r) => r.key === riskLevel);
  const gainLow        = result ? result.projectedLow  - result.totalContributed : 0;
  const gainHigh       = result ? result.projectedHigh - result.totalContributed : 0;
  const gainPctLow     = result ? ((gainLow  / result.totalContributed) * 100).toFixed(1) : 0;
  const gainPctHigh    = result ? ((gainHigh / result.totalContributed) * 100).toFixed(1) : 0;

  // Progress-bar width for the projection range visualisation (relative scale)
  const barWidthLow  = result ? Math.min(100, Math.max(10, (result.projectedLow  / result.projectedHigh) * 100)) : 0;

  // ── Shared class helpers ───────────────────────────────────────────────────
  const inputCls = `w-full px-3 py-2.5 rounded-xl text-sm border outline-none transition-colors focus:ring-1 ${
    isLight
      ? "bg-white border-slate-200 text-slate-800 placeholder-slate-400 focus:border-blue-400 focus:ring-blue-200"
      : "bg-slate-800/70 border-white/10 text-white/90 placeholder-white/30 focus:border-blue-500/60 focus:ring-blue-500/20"
  }`;

  const labelCls = `block text-xs font-semibold mb-1.5 ${isLight ? "text-slate-600" : "text-white/60"}`;
  const errCls   = "text-xs text-rose-400 mt-1";

  const dividerCls = `my-1 h-px ${isLight ? "bg-slate-200" : "bg-white/10"}`;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={pageClass}>
      {isAzula  && <AzulaThemeBackground />}
      {isCherry && <SakuraThemeBackground />}

      <div className="relative z-10 max-w-4xl mx-auto px-4 py-8 md:py-12">

        {/* ── Back nav ──────────────────────────────────────────────────── */}
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/home"
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              isLight ? "text-slate-600 hover:bg-slate-100" : "text-white/60 hover:bg-white/10"
            }`}
          >
            ← Back to Home
          </Link>
        </div>

        {/* ── Page header ───────────────────────────────────────────────── */}
        <div className="mb-8">
          <h1 className={`text-3xl md:text-4xl font-bold tracking-tight mb-2 ${isLight ? "text-slate-900" : "text-white"}`}>
            Investment Goal Planner
          </h1>
          <p className={`text-base ${isLight ? "text-slate-600" : "text-white/55"}`}>
            Enter your details below to see a realistic projection range, suggested allocation, and milestone checkpoints.
          </p>
        </div>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* FORM CARD                                                        */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <Card title="Your Investment Details" className="mb-6">

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Initial Investment */}
            <div>
              <label className={labelCls}>Initial Investment</label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold ${isLight ? "text-slate-500" : "text-white/40"}`}>$</span>
                <input
                  type="number"
                  min="1"
                  placeholder="10,000"
                  value={initialAmount}
                  onChange={(e) => setInitialAmount(e.target.value)}
                  className={`${inputCls} pl-7`}
                />
              </div>
              {errors.initialAmount && <p className={errCls}>{errors.initialAmount}</p>}
            </div>

            {/* Monthly Contribution */}
            <div>
              <label className={labelCls}>Monthly Contribution <span className={`font-normal ${isLight ? "text-slate-400" : "text-white/30"}`}>(optional)</span></label>
              <div className="relative">
                <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold ${isLight ? "text-slate-500" : "text-white/40"}`}>$</span>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  value={monthlyContribution}
                  onChange={(e) => setMonthlyContribution(e.target.value)}
                  className={`${inputCls} pl-7`}
                />
              </div>
              {errors.monthlyContribution && <p className={errCls}>{errors.monthlyContribution}</p>}
            </div>

            {/* Duration */}
            <div className="md:col-span-2">
              <label className={labelCls}>Investment Duration</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    min="1"
                    max="600"
                    value={durationMonths}
                    onChange={(e) => setDurationMonths(Number(e.target.value))}
                    className={inputCls}
                  />
                  <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${isLight ? "text-slate-400" : "text-white/30"}`}>months</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_PRESETS.map(({ label, months }) => (
                    <button
                      key={months}
                      onClick={() => setDurationMonths(months)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                        durationMonths === months
                          ? "bg-blue-600 border-blue-600 text-white"
                          : isLight
                            ? "border-slate-200 text-slate-600 hover:bg-slate-100"
                            : "border-white/10 text-white/60 hover:bg-white/8"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {errors.durationMonths && <p className={errCls}>{errors.durationMonths}</p>}
            </div>
          </div>

          <div className={`${dividerCls} my-5`} />

          {/* Risk Level */}
          <div className="mb-5">
            <label className={labelCls}>Risk Level</label>
            <div className="grid grid-cols-3 gap-2">
              {RISK_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setRiskLevel(opt.key)}
                  className={`py-3 px-3 rounded-xl border text-left transition-all ${
                    riskLevel === opt.key
                      ? opt.activeClass
                      : isLight
                        ? "border-slate-200 text-slate-700 hover:bg-slate-50"
                        : "border-white/10 text-white/70 hover:bg-white/5"
                  }`}
                >
                  <div className="text-xs font-bold">{opt.label}</div>
                  <div className={`text-[10px] mt-0.5 ${riskLevel === opt.key ? "text-white/80" : isLight ? "text-slate-500" : "text-white/40"}`}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Market Preference */}
          <div className="mb-5">
            <label className={labelCls}>Market Preference</label>
            <div className="flex flex-wrap gap-2">
              {MARKET_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setMarketPreference(opt.key)}
                  className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                    marketPreference === opt.key
                      ? "bg-blue-600 border-blue-600 text-white"
                      : isLight
                        ? "border-slate-200 text-slate-700 hover:bg-slate-50"
                        : "border-white/10 text-white/70 hover:bg-white/5"
                  }`}
                >
                  <span>{opt.icon}</span>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target Style */}
          <div>
            <label className={labelCls}>Target Style</label>
            <div className="flex gap-2">
              {[
                { key: "steady", label: "Steady Growth",  desc: "Conservative optimistic ceiling" },
                { key: "growth", label: "Higher Growth",  desc: "Elevated optimistic scenario"    },
              ].map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setTargetStyle(opt.key)}
                  className={`flex-1 py-3 px-4 rounded-xl border text-left transition-all ${
                    targetStyle === opt.key
                      ? "bg-blue-600 border-blue-600 text-white"
                      : isLight
                        ? "border-slate-200 text-slate-700 hover:bg-slate-50"
                        : "border-white/10 text-white/70 hover:bg-white/5"
                  }`}
                >
                  <div className="text-xs font-bold">{opt.label}</div>
                  <div className={`text-[10px] mt-0.5 ${targetStyle === opt.key ? "text-white/80" : isLight ? "text-slate-500" : "text-white/40"}`}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className={`${dividerCls} my-5`} />

          <button
            onClick={handleCalculate}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold tracking-wide transition-colors shadow-lg shadow-blue-500/20"
          >
            Calculate Projection →
          </button>
        </Card>

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* RESULTS (shown after submit)                                     */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {submitted && result && (
          <div id="gp-results">

            {/* ── 1. Projected Value Range ──────────────────────────────── */}
            <Card
              title="Projected Value Range"
              right={
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                  isLight ? "bg-slate-100 text-slate-600" : "bg-white/8 text-white/60"
                }`}>
                  after {durationMonths < 12 ? `${durationMonths} months` : durationMonths % 12 === 0 ? `${durationMonths / 12} year${durationMonths > 12 ? "s" : ""}` : `${(durationMonths / 12).toFixed(1)} years`}
                </span>
              }
              className="mb-4"
            >
              {/* Range display */}
              <div className="flex items-end justify-between mb-4 gap-4">
                <div>
                  <p className={`text-[11px] font-semibold mb-1 ${isLight ? "text-slate-500" : "text-white/45"}`}>Conservative end</p>
                  <p className={`text-2xl font-bold ${isLight ? "text-slate-800" : "text-white"}`}>{fmtDollar(result.projectedLow)}</p>
                  <p className={`text-xs mt-0.5 ${gainLow >= 0 ? "text-emerald-500" : "text-rose-400"}`}>
                    {gainLow >= 0 ? "+" : ""}{fmtDollar(gainLow)} ({gainPctLow}%)
                  </p>
                </div>
                <div className={`text-2xl ${isLight ? "text-slate-300" : "text-white/15"}`}>↔</div>
                <div className="text-right">
                  <p className={`text-[11px] font-semibold mb-1 ${isLight ? "text-slate-500" : "text-white/45"}`}>Optimistic end</p>
                  <p className="text-2xl font-bold text-blue-400">{fmtDollar(result.projectedHigh)}</p>
                  <p className={`text-xs mt-0.5 ${gainHigh >= 0 ? "text-emerald-500" : "text-rose-400"}`}>
                    {gainHigh >= 0 ? "+" : ""}{fmtDollar(gainHigh)} ({gainPctHigh}%)
                  </p>
                </div>
              </div>

              {/* Visual bar */}
              <div className={`relative h-3 rounded-full mb-3 overflow-hidden ${isLight ? "bg-slate-100" : "bg-white/8"}`}>
                <div
                  className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-700"
                  style={{ width: `${barWidthLow}%` }}
                />
                <div className="absolute right-0 top-0 h-full w-full rounded-full bg-blue-500/20" />
              </div>
              <div className="flex justify-between text-[10px] mb-4">
                <span className={isLight ? "text-slate-500" : "text-white/40"}>Low: {fmtCompact(result.projectedLow)}</span>
                <span className={isLight ? "text-slate-500" : "text-white/40"}>High: {fmtCompact(result.projectedHigh)}</span>
              </div>

              {/* Summary row */}
              <div className={`grid grid-cols-3 gap-3 pt-3 border-t ${isLight ? "border-slate-100" : "border-white/8"}`}>
                <div className="text-center">
                  <p className={`text-[10px] mb-1 ${isLight ? "text-slate-500" : "text-white/40"}`}>Total Contributed</p>
                  <p className={`text-sm font-bold ${isLight ? "text-slate-700" : "text-white/85"}`}>{fmtDollar(result.totalContributed)}</p>
                </div>
                <div className="text-center">
                  <p className={`text-[10px] mb-1 ${isLight ? "text-slate-500" : "text-white/40"}`}>Rate Assumption</p>
                  <p className={`text-sm font-bold ${isLight ? "text-slate-700" : "text-white/85"}`}>{result.annualRateLow}% – {result.annualRateHigh}% / yr</p>
                </div>
                <div className="text-center">
                  <p className={`text-[10px] mb-1 ${isLight ? "text-slate-500" : "text-white/40"}`}>Volatility</p>
                  <p className={`text-sm font-bold ${riskOption?.textClass}`}>{result.volatility}</p>
                </div>
              </div>
            </Card>

            {/* ── 2. Allocation + Strategy (side by side on md+) ────────── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">

              {/* Suggested Allocation */}
              <Card title="Suggested Allocation">
                <div className="space-y-3">
                  {result.allocation.map((item) => (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium ${isLight ? "text-slate-700" : "text-white/80"}`}>{item.label}</span>
                        <span className={`text-xs font-bold ${isLight ? "text-slate-600" : "text-white/70"}`}>{item.pct}%</span>
                      </div>
                      <div className={`h-2 rounded-full overflow-hidden ${isLight ? "bg-slate-100" : "bg-white/8"}`}>
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${item.pct}%`, backgroundColor: item.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Colour legend dots */}
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-4 pt-3 border-t border-white/8">
                  {result.allocation.map((item) => (
                    <div key={item.label} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                      <span className={`text-[10px] ${isLight ? "text-slate-500" : "text-white/45"}`}>{item.label}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Strategy Summary */}
              <Card title="Strategy Summary">
                <div className="flex items-start gap-2 mb-4">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${
                    riskLevel === "conservative" ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                    : riskLevel === "moderate"   ? "border-blue-500/40   text-blue-400   bg-blue-500/10"
                    :                              "border-rose-500/40    text-rose-400   bg-rose-500/10"
                  }`}>
                    {riskOption?.label} · {MARKET_OPTIONS.find(m => m.key === marketPreference)?.label}
                  </span>
                </div>
                <p className={`text-sm leading-relaxed ${isLight ? "text-slate-700" : "text-white/75"}`}>
                  {result.strategySummary}
                </p>
                <div className={`mt-4 pt-4 border-t ${isLight ? "border-slate-100" : "border-white/8"}`}>
                  <p className={`text-[11px] font-semibold mb-2 ${isLight ? "text-slate-500" : "text-white/40"}`}>
                    AI-Powered Buy / Sell Signals
                  </p>
                  <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs ${
                    isLight ? "border-slate-200 bg-slate-50 text-slate-500" : "border-white/8 bg-white/4 text-white/45"
                  }`}>
                    <span>🤖</span>
                    <span>Coming soon — real-time AI signals for your allocation.</span>
                  </div>
                </div>
              </Card>
            </div>

            {/* ── 3. Milestone Checkpoints ──────────────────────────────── */}
            <Card
              title="Milestone Checkpoints"
              right={
                <div className={`flex rounded-lg overflow-hidden border text-xs font-semibold ${isLight ? "border-slate-200" : "border-white/10"}`}>
                  {["monthly", "weekly"].map((v) => (
                    <button
                      key={v}
                      onClick={() => setViewMode(v)}
                      className={`px-3 py-1.5 transition-colors capitalize ${
                        viewMode === v
                          ? "bg-blue-600 text-white"
                          : isLight ? "text-slate-600 hover:bg-slate-50" : "text-white/55 hover:bg-white/8"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              }
              className="mb-4"
            >
              {/* Timeline */}
              <div className="relative pt-2 pb-1">
                {/* Connecting line */}
                <div className={`absolute top-5 left-4 right-4 h-0.5 ${isLight ? "bg-slate-200" : "bg-white/10"}`} />

                <div className="flex justify-between relative z-10 overflow-x-auto gap-1 pb-1">
                  {result.milestones.map((m) => (
                    <div key={m.month} className="flex flex-col items-center min-w-[60px] flex-1">
                      {/* Dot */}
                      <div className={`w-3.5 h-3.5 rounded-full border-2 mb-2 shrink-0 transition-all ${
                        m.isFinal
                          ? "bg-blue-500 border-blue-500 shadow-md shadow-blue-500/40"
                          : isLight
                            ? "bg-white border-slate-300"
                            : "bg-slate-800 border-white/25"
                      }`} />
                      {/* Label */}
                      <span className={`text-[10px] font-bold mb-2 ${m.isFinal ? "text-blue-400" : isLight ? "text-slate-600" : "text-white/55"}`}>
                        {m.label}
                      </span>
                      {/* High */}
                      <span className={`text-[10px] font-semibold text-center leading-tight ${isLight ? "text-slate-800" : "text-white/85"}`}>
                        {fmtCompact(m.high)}
                      </span>
                      {/* Low */}
                      <span className={`text-[10px] text-center leading-tight ${isLight ? "text-slate-400" : "text-white/40"}`}>
                        {fmtCompact(m.low)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`flex items-center gap-3 mt-4 pt-3 border-t text-[10px] ${isLight ? "border-slate-100 text-slate-500" : "border-white/8 text-white/40"}`}>
                <span className={`inline-block w-2 h-2 rounded-full ${isLight ? "bg-slate-800" : "bg-white/85"}`} />
                <span>Upper value (optimistic)</span>
                <span className={`inline-block w-2 h-2 rounded-full ml-2 ${isLight ? "bg-slate-400" : "bg-white/40"}`} />
                <span>Lower value (conservative)</span>
              </div>
            </Card>

            {/* ── 4. Email Alerts ───────────────────────────────────────── */}
            <Card title="Email Alerts" right={
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${isLight ? "bg-blue-50 text-blue-600 border border-blue-200" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"}`}>Optional</span>
            } className="mb-4">
              <p className={`text-xs mb-4 ${isLight ? "text-slate-500" : "text-white/45"}`}>
                Get notified when market signals align with your plan. Enable the alerts relevant to you.
              </p>

              {/* Email input */}
              <div className="mb-4">
                <label className={labelCls}>Your Email</label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={alertEmail}
                  onChange={(e) => setAlertEmail(e.target.value)}
                  className={inputCls}
                />
              </div>

              {/* Alert toggles */}
              <div className="space-y-2 mb-5">
                {ALERT_TYPES.map(({ key, label, desc }) => (
                  <div
                    key={key}
                    onClick={() => setEnabledAlerts((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className={`flex items-start justify-between gap-4 px-3 py-3 rounded-xl cursor-pointer border transition-colors select-none ${
                      enabledAlerts[key]
                        ? isLight ? "border-blue-200 bg-blue-50/60" : "border-blue-500/30 bg-blue-500/8"
                        : isLight ? "border-slate-100 hover:bg-slate-50" : "border-white/8 hover:bg-white/4"
                    }`}
                  >
                    <div className="flex-1">
                      <p className={`text-xs font-semibold ${isLight ? "text-slate-700" : "text-white/85"}`}>{label}</p>
                      <p className={`text-[10px] mt-0.5 ${isLight ? "text-slate-400" : "text-white/40"}`}>{desc}</p>
                    </div>
                    {/* Toggle switch */}
                    <div className={`relative w-9 h-5 rounded-full shrink-0 mt-0.5 transition-colors ${enabledAlerts[key] ? "bg-blue-600" : isLight ? "bg-slate-200" : "bg-white/15"}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${enabledAlerts[key] ? "left-[18px]" : "left-0.5"}`} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveAlerts}
                disabled={alertSaving}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {alertSaving ? "Saving…" : "Save Alert Preferences"}
              </button>

              {/* Feedback message */}
              {alertSaveMsg && (
                <div className={`mt-3 text-xs px-3 py-2.5 rounded-xl ${
                  alertSaveMsg.ok
                    ? isLight ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                    : isLight ? "bg-rose-50 text-rose-600 border border-rose-200"          : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                }`}>
                  {alertSaveMsg.text}
                </div>
              )}
            </Card>

          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* WHAT TO BUY                                                      */}
        {/* ════════════════════════════════════════════════════════════════ */}
        {submitted && result && (
          <Card
            title="What to Buy"
            right={
              tickerLoading
                ? <span className={`text-[10px] ${isLight ? "text-slate-400" : "text-white/35"}`}>Fetching prices…</span>
                : <span className={`text-[10px] px-2 py-0.5 rounded-full border ${isLight ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"}`}>Live prices</span>
            }
            className="mb-4"
          >
            <p className={`text-xs mb-5 ${isLight ? "text-slate-500" : "text-white/45"}`}>
              Based on your allocation, here are specific assets to consider. Click <strong>Research →</strong> to open live data and analysis on the home screen.
            </p>

            <div className="space-y-5">
              {result.allocation.map((bucket) => {
                const suggestions = TICKER_SUGGESTIONS[bucket.label];
                // Skip buckets with no tradeable suggestions (cash, stablecoins)
                if (!suggestions?.length) return null;

                const bucketDollars = Math.round((submittedAmt * bucket.pct) / 100);

                return (
                  <div key={bucket.label}>
                    {/* Bucket header */}
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: bucket.color }} />
                      <span className={`text-xs font-bold ${isLight ? "text-slate-700" : "text-white/85"}`}>{bucket.label}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ml-auto ${isLight ? "bg-slate-100 text-slate-500" : "bg-white/8 text-white/40"}`}>
                        {bucket.pct}% · {fmtDollar(bucketDollars)}
                      </span>
                    </div>

                    {/* Ticker rows */}
                    <div className={`rounded-xl border overflow-hidden divide-y ${isLight ? "border-slate-200 divide-slate-100" : "border-white/8 divide-white/5"}`}>
                      {suggestions.map((t) => {
                        const q = tickerPrices[t.sym];
                        const isUp = q?.percentChange != null && q.percentChange >= 0;

                        return (
                          <div key={t.sym} className={`flex items-center gap-3 px-3.5 py-3 ${isLight ? "hover:bg-slate-50" : "hover:bg-white/3"} transition-colors`}>
                            {/* Symbol badge */}
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[10px] font-bold shrink-0 ${isLight ? "bg-slate-100 text-slate-700" : "bg-white/8 text-white/80"}`}>
                              {t.sym.replace("-USD", "").slice(0, 4)}
                            </div>

                            {/* Name + price */}
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-semibold truncate ${isLight ? "text-slate-800" : "text-white/90"}`}>
                                {q?.name || t.name}
                              </p>
                              <p className={`text-[10px] ${isLight ? "text-slate-400" : "text-white/35"}`}>{t.sym}</p>
                            </div>

                            {/* Price */}
                            {tickerLoading ? (
                              <div className={`h-3 w-16 rounded animate-pulse ${isLight ? "bg-slate-200" : "bg-white/10"}`} />
                            ) : q ? (
                              <div className="text-right shrink-0">
                                <p className={`text-xs font-bold ${isLight ? "text-slate-800" : "text-white/90"}`}>
                                  ${q.price?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </p>
                                <p className={`text-[10px] font-semibold ${isUp ? "text-emerald-500" : "text-rose-400"}`}>
                                  {isUp ? "+" : ""}{q.percentChange?.toFixed(2)}%
                                </p>
                              </div>
                            ) : (
                              <p className={`text-[10px] ${isLight ? "text-slate-400" : "text-white/30"}`}>—</p>
                            )}

                            {/* Research link */}
                            <a
                              href={`/home?mode=${t.mode}&company=${t.homeRef}`}
                              className={`shrink-0 text-[10px] font-bold px-2.5 py-1.5 rounded-lg border transition-colors ${
                                isLight
                                  ? "border-blue-200 text-blue-600 hover:bg-blue-50"
                                  : "border-blue-500/25 text-blue-400 hover:bg-blue-500/10"
                              }`}
                            >
                              Research →
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer note */}
            <p className={`mt-4 text-[10px] ${isLight ? "text-slate-400" : "text-white/30"}`}>
              These are examples based on your allocation profile — not personalised financial advice. Always do your own research before investing.
            </p>
          </Card>
        )}

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* HOW THIS WORKS                                                   */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <HowItWorks isLight={isLight} dividerCls={dividerCls} />

        {/* ════════════════════════════════════════════════════════════════ */}
        {/* DISCLAIMER                                                       */}
        {/* ════════════════════════════════════════════════════════════════ */}
        <div className={`mt-6 px-4 py-4 rounded-xl border text-xs leading-relaxed ${
          isLight
            ? "border-amber-200 bg-amber-50 text-amber-800"
            : "border-amber-500/20 bg-amber-500/8 text-amber-300/80"
        }`}>
          <span className="font-bold">⚠️ Disclaimer: </span>
          The projections shown are estimates based on historical average return rates and are provided for{" "}
          <strong>informational and educational purposes only</strong>. They are not financial advice, not a
          guarantee of future performance, and should not be used as the sole basis for any investment decision.
          All investments carry risk, including possible loss of principal. Past performance does not guarantee
          future results. Please consult a licensed financial advisor before making investment decisions.
        </div>

      </div>
    </div>
  );
}

// ── How It Works section (extracted for clarity) ─────────────────────────────
function HowItWorks({ isLight, dividerCls }) {
  const [open, setOpen] = useState(false);
  const steps = [
    { num: "1", title: "Enter your details",        desc: "Fill in your starting amount, timeline, risk appetite, and preferred market." },
    { num: "2", title: "We model the projection",   desc: "Using historical return rate ranges per asset class and risk profile, we calculate a low and high future value using compound growth math." },
    { num: "3", title: "Review your allocation",    desc: "A suggested portfolio split is generated based on your risk level and market preference." },
    { num: "4", title: "Track your milestones",     desc: "Intermediate checkpoints show you what to expect at 1 month, 3 months, 6 months, and beyond." },
    { num: "5", title: "Set up alerts (optional)",  desc: "Enable email notifications so you're informed when buy, sell, hold, or rebalancing signals fire against your plan." },
  ];

  return (
    <div className={`mt-4 rounded-2xl border overflow-hidden ${isLight ? "border-slate-200" : "border-white/10"}`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between px-5 py-4 text-sm font-semibold transition-colors ${
          isLight ? "bg-slate-50 hover:bg-slate-100 text-slate-700" : "bg-white/4 hover:bg-white/6 text-white/75"
        }`}
      >
        <span>How this works</span>
        <svg
          width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="M2 4l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className={`px-5 pb-5 ${isLight ? "bg-slate-50" : "bg-white/2"}`}>
          <div className={`${dividerCls} mb-4`} />
          <div className="space-y-4">
            {steps.map((s) => (
              <div key={s.num} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {s.num}
                </div>
                <div>
                  <p className={`text-xs font-semibold mb-0.5 ${isLight ? "text-slate-700" : "text-white/85"}`}>{s.title}</p>
                  <p className={`text-xs ${isLight ? "text-slate-500" : "text-white/50"}`}>{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className={`mt-4 pt-4 border-t ${isLight ? "border-slate-200 text-slate-500" : "border-white/8 text-white/40"} text-xs`}>
            Rate assumptions are based on broad historical market data. Conservative: ~4–7% / yr. Moderate: ~6–13% / yr. Aggressive: ~9–50% / yr (high variance). These are ranges — actual returns will differ.
          </div>
        </div>
      )}
    </div>
  );
}
