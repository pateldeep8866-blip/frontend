"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Cormorant_Garamond, IBM_Plex_Mono, Syne } from "next/font/google";
import AutopilotPanel from "@/components/AutopilotPanel";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";

const simSerif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});
const simMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});
const simSans = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const STARTING_CASH = 100000;
const PROFILE_KEY = "simulator_portfolio_state_v1";
const NAV_SNAPSHOT_KEY = "simulator_nav_snapshot_v1";
const AUTOPILOT_MODE_KEY = "simulator_autopilot_mode_v1";
const LEADERBOARD_FILTERS = [
  { key: "all", label: "All Time" },
  { key: "month", label: "This Month" },
  { key: "week", label: "This Week" },
];
const SHOW_LEADERBOARD = false;
const CHART_FILTERS = [
  { key: "1D", label: "1D" },
  { key: "1W", label: "1W" },
  { key: "1M", label: "1M" },
  { key: "ALL", label: "All Time" },
];
const SIM_TABS = [
  { key: "manual", label: "Manual Trading" },
  { key: "autopilot", label: "Auto-Pilot" },
];
const CRYPTO_SYMBOL_TO_ID = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  AVAX: "avalanche-2",
  DOGE: "dogecoin",
  LINK: "chainlink",
  MATIC: "matic-network",
};
const CRYPTO_OPTIONS = [
  { symbol: "BTC", name: "Bitcoin", id: "bitcoin" },
  { symbol: "ETH", name: "Ethereum", id: "ethereum" },
  { symbol: "SOL", name: "Solana", id: "solana" },
  { symbol: "BNB", name: "Binance Coin", id: "binancecoin" },
  { symbol: "XRP", name: "Ripple", id: "ripple" },
  { symbol: "ADA", name: "Cardano", id: "cardano" },
  { symbol: "AVAX", name: "Avalanche", id: "avalanche-2" },
  { symbol: "DOGE", name: "Dogecoin", id: "dogecoin" },
  { symbol: "LINK", name: "Chainlink", id: "chainlink" },
  { symbol: "MATIC", name: "Polygon", id: "matic-network" },
];

const RESEARCH_ENGINE_API_URL =
  process.env.NEXT_PUBLIC_RESEARCH_ENGINE_URL || "http://localhost:8001/api/research";
const SIM_RISK_LEVEL_KEY = "simulator_risk_level_v1";
const SIM_RISK_CUSTOM_KEY = "simulator_risk_custom_v1";
const SIM_TRADING_STYLE_KEY = "simulator_trading_style_v1";
const SIM_PLAYBOOK_KEY = "simulator_playbook_v1";
const SIM_GUARDRAILS_KEY = "simulator_guardrails_v1";
const ACHIEVEMENTS_KEY = "simulator_achievements_v1";
const ASTRA_CHAT_KEY = "simulator_astra_chat_v1";
const MAX_CHAT_MESSAGES = 30;
const RISK_PRESETS = {
  CONSERVATIVE: { maxPositionPct: 0.05, maxCryptoPct: 0, minCashReservePct: 0.2, allowCrypto: false, target: "8-15%" },
  MODERATE: { maxPositionPct: 0.15, maxCryptoPct: 0.08, minCashReservePct: 0.12, allowCrypto: true, target: "15-25%" },
  AGGRESSIVE: { maxPositionPct: 0.2, maxCryptoPct: 0.2, minCashReservePct: 0.08, allowCrypto: true, target: "25%+" },
};
const RISK_EXECUTION_PRESETS = {
  CONSERVATIVE: { trailingStopPct: 0.04, dailyDrawdownKillPct: 2.5 },
  MODERATE: { trailingStopPct: 0.07, dailyDrawdownKillPct: 4.0 },
  AGGRESSIVE: { trailingStopPct: 0.1, dailyDrawdownKillPct: 6.5 },
};
const PLAYBOOKS = {
  PRESERVE: {
    label: "Capital Preservation",
    riskLevel: "CONSERVATIVE",
    tradingStyle: "swing",
    guardrails: { maxTradesPerDay: 4, maxTurnoverPctPerDay: 20, maxConcurrentPositions: 6 },
  },
  BALANCED: {
    label: "Balanced Growth",
    riskLevel: "MODERATE",
    tradingStyle: "swing",
    guardrails: { maxTradesPerDay: 8, maxTurnoverPctPerDay: 40, maxConcurrentPositions: 10 },
  },
  TREND: {
    label: "Trend Hunter",
    riskLevel: "AGGRESSIVE",
    tradingStyle: "day_trading",
    guardrails: { maxTradesPerDay: 12, maxTurnoverPctPerDay: 70, maxConcurrentPositions: 12 },
  },
  CRYPTO: {
    label: "Crypto Rotation",
    riskLevel: "AGGRESSIVE",
    tradingStyle: "day_trading",
    guardrails: { maxTradesPerDay: 14, maxTurnoverPctPerDay: 85, maxConcurrentPositions: 10 },
  },
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function normalizeAssetType(value) {
  return String(value || "").toLowerCase() === "crypto" ? "crypto" : "stock";
}

function holdingKey(assetType, symbol) {
  const type = normalizeAssetType(assetType);
  return `${type}:${String(symbol || "").toUpperCase().trim()}`;
}

function resolveRiskPolicy(level, custom) {
  const k = String(level || "MODERATE").toUpperCase();
  if (k === "CUSTOM") {
    return {
      level: "CUSTOM",
      maxPositionPct: Math.max(0.01, Math.min(0.3, Number(custom?.maxPositionPct || 0.12))),
      maxCryptoPct: Math.max(0, Math.min(0.3, Number(custom?.maxCryptoPct || 0.1))),
      minCashReservePct: Math.max(0.02, Math.min(0.4, Number(custom?.minCashReservePct || 0.1))),
      allowCrypto: Number(custom?.maxCryptoPct || 0.1) > 0,
      target: String(custom?.target || "Custom"),
    };
  }
  const preset = RISK_PRESETS[k] || RISK_PRESETS.MODERATE;
  return { level: k in RISK_PRESETS ? k : "MODERATE", ...preset };
}

function resolveRiskExecutionPolicy(level, custom) {
  const k = String(level || "MODERATE").toUpperCase();
  if (k === "CUSTOM") {
    const trailingStopPct = Math.max(0.03, Math.min(0.18, Number(custom?.trailingStopPct || 0.08)));
    const dailyDrawdownKillPct = Math.max(1, Math.min(20, Number(custom?.dailyDrawdownKillPct || 4)));
    return { trailingStopPct, dailyDrawdownKillPct };
  }
  return RISK_EXECUTION_PRESETS[k] || RISK_EXECUTION_PRESETS.MODERATE;
}

function createDefaultProfile() {
  const now = Date.now();
  return {
    startingCash: STARTING_CASH,
    cash: STARTING_CASH,
    holdings: {},
    transactions: [],
    snapshots: [{ ts: now, total: STARTING_CASH }],
    manualSnapshots: [{ ts: now, total: STARTING_CASH }],
    autoPilotSnapshots: [{ ts: now, total: STARTING_CASH }],
    priceAlerts: [],
    dcaPlans: [],
    autoPilot: {
      enabled: false,
      lastRunAt: 0,
      lastActionAt: 0,
      nextDecisionAt: 0,
      killSwitchTriggeredAt: 0,
      killSwitchReason: "",
      decisionLog: [],
      watchlist: [],
      outlook: "",
      agentState: null,
      executionPlan: [],
      runSummary: "",
    },
  };
}

function readProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return createDefaultProfile();
    return {
      startingCash: toNum(parsed.startingCash) || STARTING_CASH,
      cash: toNum(parsed.cash) ?? STARTING_CASH,
      holdings: parsed.holdings && typeof parsed.holdings === "object" ? parsed.holdings : {},
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      snapshots: Array.isArray(parsed.snapshots) && parsed.snapshots.length
        ? parsed.snapshots
            .map((x) => ({ ts: Number(x?.ts), total: toNum(x?.total) }))
            .filter((x) => Number.isFinite(x.ts) && x.total != null)
        : [{ ts: Date.now(), total: STARTING_CASH }],
      manualSnapshots: Array.isArray(parsed.manualSnapshots) && parsed.manualSnapshots.length
        ? parsed.manualSnapshots
            .map((x) => ({ ts: Number(x?.ts), total: toNum(x?.total) }))
            .filter((x) => Number.isFinite(x.ts) && x.total != null)
        : [{ ts: Date.now(), total: STARTING_CASH }],
      autoPilotSnapshots: Array.isArray(parsed.autoPilotSnapshots) && parsed.autoPilotSnapshots.length
        ? parsed.autoPilotSnapshots
            .map((x) => ({ ts: Number(x?.ts), total: toNum(x?.total) }))
            .filter((x) => Number.isFinite(x.ts) && x.total != null)
        : [{ ts: Date.now(), total: STARTING_CASH }],
      priceAlerts: Array.isArray(parsed.priceAlerts)
        ? parsed.priceAlerts
            .map((a) => ({
              id: String(a?.id || ""),
              symbol: String(a?.symbol || "").toUpperCase(),
              assetType: normalizeAssetType(a?.assetType),
              direction: String(a?.direction || "above").toLowerCase() === "below" ? "below" : "above",
              target: Number(a?.target || 0),
              active: a?.active !== false,
              triggeredAt: Number(a?.triggeredAt || 0),
              createdAt: Number(a?.createdAt || Date.now()),
            }))
            .filter((a) => a.symbol && Number.isFinite(a.target) && a.target > 0)
        : [],
      dcaPlans: Array.isArray(parsed.dcaPlans)
        ? parsed.dcaPlans
            .map((p) => ({
              id: String(p?.id || ""),
              symbol: String(p?.symbol || "").toUpperCase(),
              assetType: normalizeAssetType(p?.assetType),
              amountUsd: Number(p?.amountUsd || 0),
              interval: String(p?.interval || "weekly"),
              active: p?.active !== false,
              nextRunAt: Number(p?.nextRunAt || Date.now()),
              createdAt: Number(p?.createdAt || Date.now()),
            }))
            .filter((p) => p.symbol && Number.isFinite(p.amountUsd) && p.amountUsd > 0)
        : [],
      autoPilot: parsed.autoPilot && typeof parsed.autoPilot === "object"
        ? {
            enabled: Boolean(parsed.autoPilot.enabled),
            lastRunAt: Number(parsed.autoPilot.lastRunAt || 0),
            lastActionAt: Number(parsed.autoPilot.lastActionAt || 0),
            nextDecisionAt: Number(parsed.autoPilot.nextDecisionAt || 0),
            killSwitchTriggeredAt: Number(parsed.autoPilot.killSwitchTriggeredAt || 0),
            killSwitchReason: String(parsed.autoPilot.killSwitchReason || ""),
            decisionLog: Array.isArray(parsed.autoPilot.decisionLog) ? parsed.autoPilot.decisionLog : [],
            watchlist: Array.isArray(parsed.autoPilot.watchlist) ? parsed.autoPilot.watchlist : [],
            outlook: String(parsed.autoPilot.outlook || ""),
            agentState: parsed.autoPilot.agentState && typeof parsed.autoPilot.agentState === "object" ? parsed.autoPilot.agentState : null,
            executionPlan: Array.isArray(parsed.autoPilot.executionPlan) ? parsed.autoPilot.executionPlan : [],
            runSummary: String(parsed.autoPilot.runSummary || ""),
          }
        : {
            enabled: false,
            lastRunAt: 0,
            lastActionAt: 0,
            nextDecisionAt: 0,
            killSwitchTriggeredAt: 0,
            killSwitchReason: "",
            decisionLog: [],
            watchlist: [],
            outlook: "",
            agentState: null,
            executionPlan: [],
            runSummary: "",
          },
    };
  } catch {
    return createDefaultProfile();
  }
}

function toPolyline(points, width = 820, height = 240, pad = 18) {
  if (!Array.isArray(points) || points.length < 2) return "";
  const vals = points.map((p) => Number(p?.value)).filter((v) => Number.isFinite(v));
  if (vals.length < 2) return "";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const minTs = Math.min(...points.map((p) => Number(p.ts)));
  const maxTs = Math.max(...points.map((p) => Number(p.ts)));
  const timeSpan = maxTs - minTs || 1;
  const w = width - pad * 2;
  const h = height - pad * 2;
  return points
    .map((p) => {
      const x = pad + ((Number(p.ts) - minTs) / timeSpan) * w;
      const y = pad + (1 - (Number(p.value) - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function getNyseStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const mins = hour * 60 + minute;
  const open = wd >= 1 && wd <= 5 && mins >= 570 && mins < 960;
  return { open };
}

function getRangeStartMs(rangeKey) {
  const now = Date.now();
  if (rangeKey === "1D") return now - 24 * 60 * 60 * 1000;
  if (rangeKey === "1W") return now - 7 * 24 * 60 * 60 * 1000;
  if (rangeKey === "1M") return now - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

function rankBadge(rank) {
  if (rank <= 3) return "Elite";
  if (rank <= 10) return "Top 10";
  if (rank <= 25) return "Contender";
  return "Challenger";
}

function relativeTime(ts) {
  const t = Number(ts || 0);
  if (!Number.isFinite(t) || t <= 0) return "never";
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return "just now";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function getStrategyBadge(strategy) {
  const key = String(strategy || "").toLowerCase();
  if (key === "momentum") return { label: "📈 MOMENTUM", light: "border-blue-300 bg-blue-50 text-blue-700", dark: "border-blue-400/35 bg-blue-500/20 text-blue-100" };
  if (key === "mean_reversion") return { label: "📊 MEAN REV", light: "border-purple-300 bg-purple-50 text-purple-700", dark: "border-purple-400/35 bg-purple-500/20 text-purple-100" };
  if (key === "regime_rotation") return { label: "🔄 REGIME ROT", light: "border-orange-300 bg-orange-50 text-orange-700", dark: "border-orange-400/35 bg-orange-500/20 text-orange-100" };
  if (key === "pairs_trading") return { label: "⚖️ PAIRS", light: "border-emerald-300 bg-emerald-50 text-emerald-700", dark: "border-emerald-400/35 bg-emerald-500/20 text-emerald-100" };
  if (key === "earnings_momentum") return { label: "📣 EARNINGS", light: "border-amber-300 bg-amber-50 text-amber-700", dark: "border-amber-400/35 bg-amber-500/20 text-amber-100" };
  return { label: "ASTRA", light: "border-slate-300 bg-slate-50 text-slate-700", dark: "border-white/20 bg-white/10 text-white/80" };
}

function nextDcaRun(interval, fromTs = Date.now()) {
  const base = Number(fromTs || Date.now());
  if (interval === "daily") return base + 24 * 60 * 60 * 1000;
  if (interval === "monthly") return base + 30 * 24 * 60 * 60 * 1000;
  return base + 7 * 24 * 60 * 60 * 1000;
}

export default function SimulatorPage() {
  const [theme, setTheme] = useState("dark");
  const [botMode, setBotMode] = useState("quant");
  const [profile, setProfile] = useState(createDefaultProfile());
  const [simTab, setSimTab] = useState("manual");
  const [showEnableAutoModal, setShowEnableAutoModal] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoMessage, setAutoMessage] = useState("");
  const [expandedDecisionId, setExpandedDecisionId] = useState("");
  const [quotes, setQuotes] = useState({});
  const [selectedAssetType, setSelectedAssetType] = useState("stock");
  const [selectedTicker, setSelectedTicker] = useState("AAPL");
  const [selectedCryptoId, setSelectedCryptoId] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [selectedQuote, setSelectedQuote] = useState(null);
  const [miniPoints, setMiniPoints] = useState([]);
  const [tradeMode, setTradeMode] = useState("BUY");
  const [tradeInputMode, setTradeInputMode] = useState("shares");
  const [shareInput, setShareInput] = useState("10");
  const [dollarInput, setDollarInput] = useState("1000");
  const [submittingTrade, setSubmittingTrade] = useState(false);
  const [tradeMessage, setTradeMessage] = useState("");
  const [astraOpinion, setAstraOpinion] = useState("");
  const [chartRange, setChartRange] = useState("1M");
  const [spyHistory, setSpyHistory] = useState([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState("all");
  const [lastOvernightDelta, setLastOvernightDelta] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());
  const [deepResearchOpen, setDeepResearchOpen] = useState(false);
  const [deepResearchTicker, setDeepResearchTicker] = useState("");
  const [deepResearchLoading, setDeepResearchLoading] = useState(false);
  const [deepResearchError, setDeepResearchError] = useState("");
  const [deepResearchData, setDeepResearchData] = useState(null);
  const [cryptoLessonNotice, setCryptoLessonNotice] = useState("");
  const [achievementVault, setAchievementVault] = useState({});
  const [riskLevel, setRiskLevel] = useState("MODERATE");
  const [customRisk, setCustomRisk] = useState({ maxPositionPct: 0.12, maxCryptoPct: 0.1, minCashReservePct: 0.1, target: "Custom" });
  const [tradingStyle, setTradingStyle] = useState("swing");
  const [playbookMode, setPlaybookMode] = useState("BALANCED");
  const [guardrails, setGuardrails] = useState({ maxTradesPerDay: 8, maxTurnoverPctPerDay: 40, maxConcurrentPositions: 10 });
  const [thinkStepIndex, setThinkStepIndex] = useState(0);
  const [tradeFlash, setTradeFlash] = useState(null);
  const [alertSymbolInput, setAlertSymbolInput] = useState("AAPL");
  const [alertTargetInput, setAlertTargetInput] = useState("");
  const [alertDirection, setAlertDirection] = useState("above");
  const [dcaSymbolInput, setDcaSymbolInput] = useState("SPY");
  const [dcaAmountInput, setDcaAmountInput] = useState("250");
  const [dcaInterval, setDcaInterval] = useState("weekly");
  const [askInput, setAskInput] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [askMessages, setAskMessages] = useState([
    { role: "assistant", text: "I am ASTRA. Ask me about a ticker, your risk, or portfolio strategy." },
  ]);
  const [chartHoverIndex, setChartHoverIndex] = useState(null);
  const autoExitLockRef = useRef(false);

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isAlerik = theme === "alerik";
  const isLight = theme === "light" || isCherry || isAzula;

  const pageClass = isCherry
    ? "cherry-mode min-h-screen relative overflow-hidden bg-[#fffefc] text-[#3a2530]"
    : isAzula
      ? "azula-mode min-h-screen relative overflow-hidden bg-[#09090b] text-[#e7e1c5]"
      : isAlerik
        ? "alerik-mode min-h-screen relative overflow-hidden bg-[#050505] text-[#f5f0e8]"
        : isLight
        ? "light-mode min-h-screen relative overflow-hidden bg-[#fbfdff] text-slate-900"
        : "dark-mode min-h-screen relative overflow-hidden bg-slate-950 text-white";
  const cardClass = isLight
    ? "sim-card app-card rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-[0_10px_28px_rgba(15,23,42,0.08)]"
    : "sim-card app-card rounded-2xl border border-white/12 bg-slate-900/55 p-5";
  const riskPolicy = useMemo(() => resolveRiskPolicy(riskLevel, customRisk), [riskLevel, customRisk]);
  const riskExecutionPolicy = useMemo(
    () => resolveRiskExecutionPolicy(riskLevel, customRisk),
    [riskLevel, customRisk]
  );
  const applyPlaybookMode = useCallback((modeKey) => {
    const key = String(modeKey || "BALANCED").toUpperCase();
    const preset = PLAYBOOKS[key] || PLAYBOOKS.BALANCED;
    setPlaybookMode(key);
    setRiskLevel(String(preset.riskLevel || "MODERATE").toUpperCase());
    setTradingStyle(preset.tradingStyle === "day_trading" ? "day_trading" : "swing");
    setGuardrails({
      maxTradesPerDay: Number(preset.guardrails?.maxTradesPerDay || 8),
      maxTurnoverPctPerDay: Number(preset.guardrails?.maxTurnoverPctPerDay || 40),
      maxConcurrentPositions: Number(preset.guardrails?.maxConcurrentPositions || 10),
    });
  }, []);
  const agentProvider = useMemo(() => {
    const raw = String(profile?.autoPilot?.agentState?.provider || "");
    return ["QUANT_LAB", "fallback"].includes(raw) ? raw : "fallback";
  }, [profile?.autoPilot?.agentState?.provider]);
  const scannedInstruments = Number(profile?.autoPilot?.agentState?.scannedInstruments || 0);
  const agentRegime = String(profile?.autoPilot?.agentState?.regime || "unknown").replaceAll("_", " ").toUpperCase();
  const agentConfidence = Number(profile?.autoPilot?.agentState?.confidence || 0);
  const THINK_STEPS = [
    "Fetching prices",
    "Scoring universe",
    "Routing strategies",
    "Sizing positions",
    "Validating risk",
    "Executing plan",
  ];

  useEffect(() => {
    if (!autoRunning) {
      setThinkStepIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setThinkStepIndex((prev) => (prev + 1) % THINK_STEPS.length);
    }, 700);
    return () => clearInterval(timer);
  }, [autoRunning, THINK_STEPS.length]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const bot = String(params.get("bot") || "").toLowerCase().trim();
      if (bot === "arbi" || bot === "quant") setBotMode(bot);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SIM_RISK_LEVEL_KEY, String(riskLevel || "MODERATE").toUpperCase());
    } catch {}
  }, [riskLevel]);

  useEffect(() => {
    try {
      localStorage.setItem(SIM_RISK_CUSTOM_KEY, JSON.stringify(customRisk));
    } catch {}
  }, [customRisk]);

  useEffect(() => {
    try {
      localStorage.setItem(SIM_TRADING_STYLE_KEY, String(tradingStyle || "swing"));
    } catch {}
  }, [tradingStyle]);

  useEffect(() => {
    try {
      localStorage.setItem(SIM_PLAYBOOK_KEY, String(playbookMode || "BALANCED").toUpperCase());
    } catch {}
  }, [playbookMode]);

  useEffect(() => {
    try {
      localStorage.setItem(SIM_GUARDRAILS_KEY, JSON.stringify(guardrails));
    } catch {}
  }, [guardrails]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (saved === "dark" || saved === "light" || saved === "cherry" || saved === "azula" || saved === "alerik") setTheme(saved);
      const savedRisk = localStorage.getItem(SIM_RISK_LEVEL_KEY);
      if (savedRisk) setRiskLevel(String(savedRisk).toUpperCase());
      const savedCustom = localStorage.getItem(SIM_RISK_CUSTOM_KEY);
      if (savedCustom) {
        const parsed = JSON.parse(savedCustom);
        if (parsed && typeof parsed === "object") setCustomRisk((prev) => ({ ...prev, ...parsed }));
      }
      const savedStyle = localStorage.getItem(SIM_TRADING_STYLE_KEY);
      if (savedStyle === "day_trading" || savedStyle === "swing") setTradingStyle(savedStyle);
      const savedPlaybook = localStorage.getItem(SIM_PLAYBOOK_KEY);
      if (savedPlaybook && PLAYBOOKS[String(savedPlaybook).toUpperCase()]) {
        const pb = String(savedPlaybook).toUpperCase();
        setPlaybookMode(pb);
        const preset = PLAYBOOKS[pb];
        setRiskLevel(String(preset.riskLevel || "MODERATE").toUpperCase());
        setTradingStyle(preset.tradingStyle === "day_trading" ? "day_trading" : "swing");
        setGuardrails({
          maxTradesPerDay: Number(preset.guardrails?.maxTradesPerDay || 8),
          maxTurnoverPctPerDay: Number(preset.guardrails?.maxTurnoverPctPerDay || 40),
          maxConcurrentPositions: Number(preset.guardrails?.maxConcurrentPositions || 10),
        });
      }
      const savedGuardrails = localStorage.getItem(SIM_GUARDRAILS_KEY);
      if (savedGuardrails) {
        const parsedGuardrails = JSON.parse(savedGuardrails);
        if (parsedGuardrails && typeof parsedGuardrails === "object") {
          setGuardrails((prev) => ({
            ...prev,
            maxTradesPerDay: Math.max(1, Math.min(40, Number(parsedGuardrails.maxTradesPerDay || prev.maxTradesPerDay))),
            maxTurnoverPctPerDay: Math.max(5, Math.min(200, Number(parsedGuardrails.maxTurnoverPctPerDay || prev.maxTurnoverPctPerDay))),
            maxConcurrentPositions: Math.max(1, Math.min(30, Number(parsedGuardrails.maxConcurrentPositions || prev.maxConcurrentPositions))),
          }));
        }
      }
      const savedChat = localStorage.getItem(ASTRA_CHAT_KEY);
      if (savedChat) {
        const parsed = JSON.parse(savedChat);
        if (Array.isArray(parsed) && parsed.length) {
          const cleaned = parsed
            .map((m) => ({ role: String(m?.role || "assistant"), text: String(m?.text || "") }))
            .filter((m) => m.text);
          if (cleaned.length) setAskMessages(cleaned.slice(-MAX_CHAT_MESSAGES));
        }
      }
    } catch {}
    const loaded = readProfile();
    try {
      const modeRaw = localStorage.getItem(AUTOPILOT_MODE_KEY);
      const enabled = modeRaw ? JSON.parse(modeRaw) : Boolean(loaded?.autoPilot?.enabled);
      loaded.autoPilot = {
        ...(loaded.autoPilot || {}),
        enabled: Boolean(enabled),
      };
    } catch {}
    setProfile(loaded);
    try {
      const savedAchievements = localStorage.getItem(ACHIEVEMENTS_KEY);
      if (savedAchievements) {
        const parsed = JSON.parse(savedAchievements);
        if (parsed && typeof parsed === "object") setAchievementVault(parsed);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ASTRA_CHAT_KEY, JSON.stringify(askMessages.slice(-MAX_CHAT_MESSAGES)));
    } catch {}
  }, [askMessages]);

  const setThemeMode = useCallback((mode) => {
    const next = String(mode || "").toLowerCase();
    if (!["dark", "light", "cherry", "azula", "alerik"].includes(next)) return;
    setTheme(next);
    try {
      localStorage.setItem("theme_mode", next);
      window.dispatchEvent(new Event("theme-updated"));
    } catch {}
  }, []);

  const holdingsArray = useMemo(
    () =>
      Object.values(profile.holdings || {}).map((h) => {
        const symbol = String(h?.symbol || "").toUpperCase();
        const assetType = normalizeAssetType(h?.assetType);
        return {
          ...h,
          symbol,
          assetType,
          cryptoId: assetType === "crypto" ? String(h?.cryptoId || CRYPTO_SYMBOL_TO_ID[symbol] || "").trim() : "",
          shares: Number(h?.shares || 0),
          avgBuy: Number(h?.avgBuy || 0),
        };
      }),
    [profile.holdings]
  );

  const holdingTargets = useMemo(
    () =>
      holdingsArray
        .map((h) => ({
          symbol: h.symbol,
          assetType: h.assetType,
          cryptoId: h.cryptoId || CRYPTO_SYMBOL_TO_ID[h.symbol] || "",
        }))
        .filter((h) => h.symbol),
    [holdingsArray]
  );

  const quoteFor = useCallback(
    (assetType, symbol) => quotes[holdingKey(assetType, symbol)] || null,
    [quotes]
  );

  const holdingsBreakdown = useMemo(() => {
    let stocks = 0;
    let crypto = 0;
    for (const h of holdingsArray) {
      const q = quoteFor(h.assetType, h.symbol);
      const live = Number(q?.price);
      const fallback = Number(h?.avgBuy || 0);
      const px = Number.isFinite(live) && live > 0 ? live : fallback;
      const value = px * h.shares;
      if (h.assetType === "crypto") crypto += value;
      else stocks += value;
    }
    return { stocks, crypto };
  }, [holdingsArray, quoteFor]);

  const holdingsMarketValue = holdingsBreakdown.stocks + holdingsBreakdown.crypto;
  const unrealizedPnL = useMemo(() => {
    return holdingsArray.reduce((sum, h) => {
      const live = Number(quoteFor(h.assetType, h.symbol)?.price);
      const px = Number.isFinite(live) && live > 0 ? live : Number(h.avgBuy || 0);
      return sum + (px - Number(h.avgBuy || 0)) * Number(h.shares || 0);
    }, 0);
  }, [holdingsArray, quoteFor]);

  const portfolioTotal = Number(profile.cash || 0) + holdingsMarketValue;
  const totalReturnDollar = portfolioTotal - Number(profile.startingCash || STARTING_CASH);
  const totalReturnPct = Number(profile.startingCash || STARTING_CASH) > 0
    ? (totalReturnDollar / Number(profile.startingCash || STARTING_CASH)) * 100
    : 0;

  const latestSnapshot = profile.snapshots[profile.snapshots.length - 1];
  const previousSnapshot = profile.snapshots.length > 1 ? profile.snapshots[profile.snapshots.length - 2] : null;
  const dailyChangeDollar = previousSnapshot ? portfolioTotal - Number(previousSnapshot.total || portfolioTotal) : 0;
  const dailyChangePct = previousSnapshot && Number(previousSnapshot.total) > 0
    ? (dailyChangeDollar / Number(previousSnapshot.total)) * 100
    : 0;
  const dailyBaselineValue = useMemo(() => {
    const dayStart = new Date(nowTick);
    dayStart.setHours(0, 0, 0, 0);
    const startTs = dayStart.getTime();
    const snaps = Array.isArray(profile?.snapshots) ? profile.snapshots : [];
    const base = [...snaps].reverse().find((s) => Number(s?.ts) <= startTs);
    return Math.max(1, Number(base?.total || profile?.startingCash || STARTING_CASH));
  }, [nowTick, profile?.snapshots, profile?.startingCash]);
  const dailyDrawdownPct = useMemo(() => {
    if (!Number.isFinite(dailyBaselineValue) || dailyBaselineValue <= 0) return 0;
    return ((portfolioTotal - dailyBaselineValue) / dailyBaselineValue) * 100;
  }, [portfolioTotal, dailyBaselineValue]);

  useEffect(() => {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      localStorage.setItem(
        NAV_SNAPSHOT_KEY,
        JSON.stringify({
          returnPct: totalReturnPct,
          total: portfolioTotal,
          updatedAt: Date.now(),
          autoPilotActive: Boolean(profile?.autoPilot?.enabled),
        })
      );
      localStorage.setItem(AUTOPILOT_MODE_KEY, JSON.stringify(Boolean(profile?.autoPilot?.enabled)));
      window.dispatchEvent(new Event("simulator-updated"));
    } catch {}
  }, [profile, totalReturnPct, portfolioTotal]);

  const refreshQuoteFor = useCallback(async (symbol, assetType = "stock", cryptoId = "") => {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return null;
    const type = normalizeAssetType(assetType);
    try {
      let row = null;
      if (type === "crypto") {
        const id = String(cryptoId || CRYPTO_SYMBOL_TO_ID[sym] || "").trim();
        const qRes = await fetch(
          `/api/crypto-quote?${id ? `id=${encodeURIComponent(id)}` : `symbol=${encodeURIComponent(sym)}`}`,
          { cache: "no-store" }
        );
        const q = await qRes.json().catch(() => ({}));
        const price = toNum(q?.price);
        row = {
          symbol: sym,
          assetType: "crypto",
          cryptoId: String(q?.id || id || "").trim(),
          name: String(q?.name || sym),
          price: price ?? null,
          percentChange: toNum(q?.percentChange),
          change: toNum(q?.change),
          high: toNum(q?.high),
          low: toNum(q?.low),
          volume: toNum(q?.volume),
          marketCap: toNum(q?.marketCap),
        };
      } else {
        const [qRes, pRes] = await Promise.all([
          fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" }),
          fetch(`/api/profile?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" }),
        ]);
        const q = await qRes.json().catch(() => ({}));
        const p = await pRes.json().catch(() => ({}));
        const price = toNum(q?.price);
        row = {
          symbol: sym,
          assetType: "stock",
          cryptoId: "",
          name: String(p?.name || p?.ticker || sym),
          price: price ?? null,
          percentChange: toNum(q?.percentChange),
          change: toNum(q?.change),
          high: toNum(q?.high),
          low: toNum(q?.low),
          volume: toNum(q?.volume),
          marketCap: toNum(q?.marketCap),
        };
      }
      setQuotes((prev) => ({ ...prev, [holdingKey(type, sym)]: row }));
      return row;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const targets = [...holdingTargets];
    const selectedSym = selectedTicker.toUpperCase();
    if (selectedSym) {
      targets.push({
        symbol: selectedSym,
        assetType: selectedAssetType,
        cryptoId: selectedCryptoId || CRYPTO_SYMBOL_TO_ID[selectedSym] || "",
      });
    }
    const unique = [];
    const seen = new Set();
    for (const t of targets) {
      const key = holdingKey(t.assetType, t.symbol);
      if (!t.symbol || seen.has(key)) continue;
      seen.add(key);
      unique.push(t);
    }
    if (!unique.length) return;
    let cancelled = false;

    const run = async () => {
      const rows = await Promise.all(unique.map((t) => refreshQuoteFor(t.symbol, t.assetType, t.cryptoId)));
      if (cancelled) return;
      const selected = rows.find(
        (r) => r?.symbol === selectedTicker.toUpperCase() && normalizeAssetType(r?.assetType) === normalizeAssetType(selectedAssetType)
      ) || null;
      if (selected) {
        setSelectedQuote(selected);
        setSelectedCompany(selected.name || "");
        if (selected.assetType === "crypto" && selected.cryptoId) setSelectedCryptoId(selected.cryptoId);
      }
    };

    run();
    const hasCrypto = unique.some((t) => normalizeAssetType(t.assetType) === "crypto") || selectedAssetType === "crypto";
    const timer = setInterval(run, hasCrypto ? 30000 : 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [holdingTargets, refreshQuoteFor, selectedTicker, selectedAssetType, selectedCryptoId]);

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const fetchMini = async () => {
      const sym = String(selectedTicker || "").trim().toUpperCase();
      if (!sym) {
        setMiniPoints([]);
        return;
      }
      try {
        const isCrypto = selectedAssetType === "crypto";
        const cryptoId = String(selectedCryptoId || CRYPTO_SYMBOL_TO_ID[sym] || "").trim();
        const url = isCrypto
          ? `/api/crypto-candles?id=${encodeURIComponent(cryptoId)}&days=1`
          : `/api/candles?symbol=${encodeURIComponent(sym)}&resolution=5&days=1`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const points = Array.isArray(data?.c)
          ? data.c.map((x, i) => ({ value: Number(x), ts: Number(data?.t?.[i] || Date.now()) * 1000 })).filter((p) => Number.isFinite(p.value))
          : [];
        setMiniPoints(points.slice(-64));
      } catch {
        setMiniPoints([]);
      }
    };
    fetchMini();
  }, [selectedTicker, selectedAssetType, selectedCryptoId]);

  useEffect(() => {
    const fetchSpy = async () => {
      try {
        const res = await fetch("/api/history?symbol=SPY", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const points = Array.isArray(data?.points)
          ? data.points.map((p) => ({ ts: Date.parse(`${p.date}T00:00:00Z`), close: Number(p.close) })).filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.close))
          : [];
        setSpyHistory(points);
      } catch {
        setSpyHistory([]);
      }
    };
    fetchSpy();
  }, []);

  useEffect(() => {
    if (!latestSnapshot) return;
    const dayKey = new Date(latestSnapshot.ts).toISOString().slice(0, 10);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey = yesterday.toISOString().slice(0, 10);
    const ySnapshot = [...profile.snapshots].reverse().find((s) => new Date(Number(s.ts)).toISOString().slice(0, 10) === yKey);
    if (ySnapshot) {
      setLastOvernightDelta(Number(latestSnapshot.total || 0) - Number(ySnapshot.total || 0));
    } else if (dayKey) {
      setLastOvernightDelta(null);
    }
  }, [profile.snapshots, latestSnapshot]);

  const nyse = useMemo(() => getNyseStatus(new Date(nowTick)), [nowTick]);
  const autoPilotEnabled = Boolean(profile?.autoPilot?.enabled);
  const latestDecision = profile?.autoPilot?.decisionLog?.[0] || null;
  const selectedHoldingMapKey = holdingKey(selectedAssetType, selectedTicker);
  const isCryptoTrade = selectedAssetType === "crypto";

  const selectedPrice = toNum(selectedQuote?.price);
  const sharesFromInput = useMemo(() => {
    if (tradeInputMode === "shares") return Math.max(0, Number(shareInput || 0));
    if (!Number.isFinite(selectedPrice) || selectedPrice <= 0) return 0;
    return Math.max(0, Number(dollarInput || 0) / selectedPrice);
  }, [tradeInputMode, shareInput, dollarInput, selectedPrice]);
  const estimatedTradeValue = Number.isFinite(selectedPrice) ? selectedPrice * sharesFromInput : 0;
  const ownedForSelected = Number(profile.holdings?.[selectedHoldingMapKey]?.shares || 0);
  const cashAfterTrade = tradeMode === "BUY" ? Number(profile.cash || 0) - estimatedTradeValue : Number(profile.cash || 0) + estimatedTradeValue;

  const tradeError = useMemo(() => {
    if (!selectedTicker.trim()) return isCryptoTrade ? "Enter a crypto symbol." : "Enter a ticker symbol.";
    if (!Number.isFinite(selectedPrice) || selectedPrice <= 0) return "Live price unavailable for this asset.";
    if (!Number.isFinite(sharesFromInput) || sharesFromInput <= 0) return "Enter a valid trade size.";
    if (tradeMode === "BUY" && estimatedTradeValue > Number(profile.cash || 0) + 1e-8) return "Insufficient cash for this buy.";
    if (tradeMode === "SELL" && sharesFromInput > ownedForSelected + 1e-8) return "Cannot sell more shares than owned.";
    return "";
  }, [selectedTicker, selectedPrice, sharesFromInput, tradeMode, estimatedTradeValue, profile.cash, ownedForSelected, isCryptoTrade]);

  const autopilotPanelPortfolio = useMemo(() => {
    const holdings = holdingsArray.map((h) => {
      const px = Number(quoteFor(h?.assetType, h?.symbol)?.price);
      const currentPrice = Number.isFinite(px) && px > 0 ? px : Number(h?.avgBuy || 0);
      return {
        symbol: String(h?.symbol || "").toUpperCase(),
        ticker: String(h?.symbol || "").toUpperCase(),
        assetType: normalizeAssetType(h?.assetType),
        shares: Number(h?.shares || 0),
        avgBuy: Number(h?.avgBuy || 0),
        currentPrice,
        stopLoss: Number(h?.stopLoss || 0),
        takeProfit: Number(h?.takeProfit || 0),
        strategy: String(h?.strategy || "momentum"),
        buyDate: h?.firstBuyAt ? new Date(Number(h.firstBuyAt)).toISOString() : null,
      };
    });
    return {
      cash: Number(profile?.cash || 0),
      startingValue: Number(profile?.startingCash || STARTING_CASH),
      holdings,
    };
  }, [holdingsArray, profile?.cash, profile?.startingCash, quoteFor]);

  const tickerTapeItems = useMemo(() => {
    const map = new Map();
    for (const q of Object.values(quotes || {})) {
      const symbol = String(q?.symbol || "").toUpperCase();
      if (!symbol) continue;
      map.set(symbol, {
        symbol,
        price: Number(q?.price || 0),
        pct: Number(q?.percentChange || 0),
      });
    }
    if (selectedTicker) {
      const sym = String(selectedTicker).toUpperCase();
      if (!map.has(sym) && Number.isFinite(Number(selectedQuote?.price))) {
        map.set(sym, { symbol: sym, price: Number(selectedQuote?.price || 0), pct: Number(selectedQuote?.percentChange || 0) });
      }
    }
    if (!map.has("SPY")) map.set("SPY", { symbol: "SPY", price: 0, pct: 0 });
    return Array.from(map.values()).slice(0, 16);
  }, [quotes, selectedTicker, selectedQuote]);

  const latestDecisionResearch = useMemo(() => {
    if (!latestDecision) return null;
    const confidence = Number(latestDecision.confidence || 0);
    const score = Number(latestDecision.score || 0);
    return {
      summary:
        String(latestDecision.reasoning || "").trim() ||
        "ASTRA is balancing regime context, momentum, and portfolio risk constraints.",
      bull:
        String(latestDecision.bullThesis || "") ||
        `Momentum + regime alignment support ${latestDecision.symbol} while respecting ${riskPolicy.level} risk limits.`,
      bear:
        String(latestDecision.bearThesis || "") ||
        `Volatility or macro reversal can invalidate this setup quickly; stop-loss discipline remains mandatory.`,
      riskScore: Math.max(1, Math.min(100, Math.round((100 - confidence) * 0.45 + (100 - score) * 0.55))),
    };
  }, [latestDecision, riskPolicy.level]);

  useEffect(() => {
    if (!tradeFlash) return;
    const t = setTimeout(() => setTradeFlash(null), 2800);
    return () => clearTimeout(t);
  }, [tradeFlash]);

  useEffect(() => {
    if (!holdingsArray.length) return;
    const trailingPct = Math.max(0.03, Math.min(0.18, Number(riskExecutionPolicy?.trailingStopPct || 0.07)));
    setProfile((prev) => {
      let changed = false;
      const holdings = { ...(prev.holdings || {}) };
      for (const h of Object.values(holdings)) {
        const key = holdingKey(h?.assetType, h?.symbol);
        const px = Number(quotes[key]?.price);
        if (!Number.isFinite(px) || px <= 0 || Number(h?.shares || 0) <= 0) continue;
        const priorHigh = Math.max(Number(h?.highestPrice || 0), Number(h?.avgBuy || 0));
        const nextHigh = Math.max(priorHigh, px);
        const priorStop = Number(h?.stopLoss || 0);
        const candidateStop = nextHigh * (1 - trailingPct);
        const nextStop = Math.max(priorStop, candidateStop);
        const moveEnough = nextStop > priorStop + 0.005;
        if (nextHigh > priorHigh || moveEnough) {
          holdings[key] = {
            ...h,
            highestPrice: nextHigh,
            trailingStopPct: trailingPct,
            stopLoss: nextStop < px ? nextStop : priorStop,
          };
          changed = true;
        }
      }
      return changed ? { ...prev, holdings } : prev;
    });
  }, [holdingsArray, quotes, riskExecutionPolicy]);

  useEffect(() => {
    if (autoExitLockRef.current) return;
    const now = Date.now();
    const triggers = [];
    for (const h of holdingsArray) {
      const q = quoteFor(h.assetType, h.symbol);
      const px = Number(q?.price);
      if (!Number.isFinite(px) || px <= 0) continue;
      const stop = Number(h?.stopLoss || 0);
      const take = Number(h?.takeProfit || 0);
      if (stop > 0 && px <= stop) {
        triggers.push({ kind: "stop", symbol: h.symbol, assetType: h.assetType, mapKey: holdingKey(h.assetType, h.symbol), shares: Number(h.shares || 0), price: px });
      } else if (take > 0 && px >= take && Number(h.shares || 0) > 0) {
        triggers.push({ kind: "take", symbol: h.symbol, assetType: h.assetType, mapKey: holdingKey(h.assetType, h.symbol), shares: Number(h.shares || 0) * 0.5, price: px });
      }
    }
    if (!triggers.length) return;
    autoExitLockRef.current = true;
    setProfile((prev) => {
      let cash = Number(prev.cash || 0);
      const holdings = { ...(prev.holdings || {}) };
      const txs = [...(prev.transactions || [])];
      const auto = { ...(prev.autoPilot || {}) };
      const log = [...(Array.isArray(auto.decisionLog) ? auto.decisionLog : [])];
      for (const t of triggers) {
        const existing = holdings[t.mapKey];
        if (!existing) continue;
        const owned = Number(existing.shares || 0);
        const qty = t.kind === "stop" ? owned : Math.min(owned, Number(t.shares || 0));
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const value = qty * t.price;
        cash += value;
        const remain = owned - qty;
        if (remain <= 1e-8) {
          delete holdings[t.mapKey];
        } else {
          holdings[t.mapKey] = { ...existing, shares: remain, takeProfit: t.kind === "take" ? 0 : Number(existing.takeProfit || 0) };
        }
        const stamp = `${now}-${t.symbol}-${t.kind}-${Math.random().toString(36).slice(2, 7)}`;
        txs.unshift({
          id: stamp,
          ts: now,
          symbol: t.symbol,
          assetType: t.assetType,
          action: "SELL",
          shares: qty,
          price: t.price,
          totalValue: value,
          realizedPnL: (t.price - Number(existing.avgBuy || 0)) * qty,
          marketClosed: false,
        });
        log.unshift({
          id: `autoexit-${stamp}`,
          ts: now,
          action: "SELL",
          symbol: t.symbol,
          assetType: t.assetType,
          shares: qty,
          price: t.price,
          totalValue: value,
          reasoning:
            t.kind === "stop"
              ? `ASTRA triggered stop loss on ${t.symbol} at ${fmtMoney(t.price)}. Protected capital from further loss.`
              : `ASTRA took partial profits on ${t.symbol} at ${fmtMoney(t.price)}. Locking in gains.`,
          confidence: 84,
          risk: "LOW",
          lesson:
            t.kind === "stop"
              ? "Stop-loss discipline controls downside risk."
              : "Taking partial profits reduces risk while keeping upside exposure.",
        });
      }
      if (cash === Number(prev.cash || 0) && Object.keys(holdings).length === Object.keys(prev.holdings || {}).length) {
        return prev;
      }
      auto.decisionLog = log.slice(0, 200);
      auto.lastActionAt = now;
      return { ...prev, cash, holdings, transactions: txs.slice(0, 500), autoPilot: auto };
    });
    const timer = setTimeout(() => {
      autoExitLockRef.current = false;
    }, 800);
    return () => clearTimeout(timer);
  }, [holdingsArray, quoteFor]);

  useEffect(() => {
    const alerts = Array.isArray(profile?.priceAlerts) ? profile.priceAlerts : [];
    if (!alerts.length) return;
    let fired = [];
    for (const alert of alerts) {
      if (!alert?.active || Number(alert?.triggeredAt || 0) > 0) continue;
      const symbol = String(alert.symbol || "").toUpperCase();
      const key = holdingKey(alert.assetType || "stock", symbol);
      const px = Number(quotes[key]?.price);
      const target = Number(alert.target || 0);
      if (!Number.isFinite(px) || !Number.isFinite(target) || target <= 0) continue;
      const hit =
        String(alert.direction || "above") === "below"
          ? px <= target
          : px >= target;
      if (hit) fired.push({ id: alert.id, symbol, px, target, direction: alert.direction || "above" });
    }
    if (!fired.length) return;
    const stamp = Date.now();
    setProfile((prev) => {
      const nextAlerts = (prev.priceAlerts || []).map((a) =>
        fired.some((f) => f.id === a.id) ? { ...a, triggeredAt: stamp } : a
      );
      return { ...prev, priceAlerts: nextAlerts };
    });
    const first = fired[0];
    setTradeFlash({
      tone: "amber",
      title: "Price Alert Triggered",
      body: `${first.symbol} ${first.direction === "below" ? "fell to" : "reached"} ${fmtMoney(first.px)} (target ${fmtMoney(first.target)}).`,
    });
  }, [quotes, profile?.priceAlerts]);

  const addPriceAlert = () => {
    const symbol = String(alertSymbolInput || "").trim().toUpperCase();
    const target = Number(alertTargetInput || 0);
    if (!symbol || !Number.isFinite(target) || target <= 0) return;
    const assetType = CRYPTO_SYMBOL_TO_ID[symbol] ? "crypto" : "stock";
    const row = {
      id: `alert-${Date.now()}-${symbol}`,
      symbol,
      assetType,
      direction: alertDirection === "below" ? "below" : "above",
      target,
      active: true,
      triggeredAt: 0,
      createdAt: Date.now(),
    };
    setProfile((prev) => ({ ...prev, priceAlerts: [row, ...(prev.priceAlerts || [])].slice(0, 50) }));
    setAlertTargetInput("");
  };

  const addDcaPlan = () => {
    const symbol = String(dcaSymbolInput || "").trim().toUpperCase();
    const amount = Number(dcaAmountInput || 0);
    if (!symbol || !Number.isFinite(amount) || amount <= 0) return;
    const assetType = CRYPTO_SYMBOL_TO_ID[symbol] ? "crypto" : "stock";
    const row = {
      id: `dca-${Date.now()}-${symbol}`,
      symbol,
      assetType,
      amountUsd: amount,
      interval: dcaInterval,
      active: true,
      nextRunAt: nextDcaRun(dcaInterval, Date.now()),
      createdAt: Date.now(),
    };
    setProfile((prev) => ({ ...prev, dcaPlans: [row, ...(prev.dcaPlans || [])].slice(0, 30) }));
  };

  const askAstra = async (question) => {
    const q = String(question || askInput || "").trim();
    if (!q || askLoading) return;
    setAskInput("");
    setAskMessages((prev) => [...prev, { role: "user", text: q }].slice(-MAX_CHAT_MESSAGES));
    setAskLoading(true);
    try {
      const market = selectedAssetType === "crypto" ? "crypto" : "stock";
      const res = await fetch(
        `/api/ai?mode=chat&market=${market}&symbol=${encodeURIComponent(selectedTicker || "SPY")}&question=${encodeURIComponent(q)}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));
      const answer = String(data?.answer || data?.raw || data?.message || "No answer right now. Try again.");
      setAskMessages((prev) => [...prev, { role: "assistant", text: answer }].slice(-MAX_CHAT_MESSAGES));
    } catch {
      setAskMessages((prev) => [...prev, { role: "assistant", text: "Connection issue while reaching ASTRA. Please retry." }].slice(-MAX_CHAT_MESSAGES));
    } finally {
      setAskLoading(false);
    }
  };

  const getSpyCloseAt = useCallback(
    (ts) => {
      if (!spyHistory.length) return null;
      const day = new Date(ts).toISOString().slice(0, 10);
      const match = spyHistory.find((p) => new Date(p.ts).toISOString().slice(0, 10) === day);
      if (match) return match.close;
      const prev = [...spyHistory].reverse().find((p) => p.ts <= ts);
      return prev?.close ?? spyHistory[spyHistory.length - 1]?.close ?? null;
    },
    [spyHistory]
  );

  const filteredSnapshots = useMemo(() => {
    const start = getRangeStartMs(chartRange);
    const points = profile.snapshots.filter((p) => Number(p.ts) >= start);
    return points.length ? points : profile.snapshots.slice(-2);
  }, [profile.snapshots, chartRange]);
  const filteredManualSnapshots = useMemo(() => {
    const start = getRangeStartMs(chartRange);
    const points = (profile.manualSnapshots || []).filter((p) => Number(p.ts) >= start);
    return points.length ? points : (profile.manualSnapshots || []).slice(-2);
  }, [profile.manualSnapshots, chartRange]);
  const filteredAutoSnapshots = useMemo(() => {
    const start = getRangeStartMs(chartRange);
    const points = (profile.autoPilotSnapshots || []).filter((p) => Number(p.ts) >= start);
    return points.length ? points : (profile.autoPilotSnapshots || []).slice(-2);
  }, [profile.autoPilotSnapshots, chartRange]);

  const portfolioLinePoints = useMemo(
    () => filteredSnapshots.map((p) => ({ ts: Number(p.ts), value: Number(p.total || 0) })).filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value)),
    [filteredSnapshots]
  );
  const manualLinePoints = useMemo(
    () => filteredManualSnapshots.map((p) => ({ ts: Number(p.ts), value: Number(p.total || 0) })).filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value)),
    [filteredManualSnapshots]
  );
  const autoLinePoints = useMemo(
    () => filteredAutoSnapshots.map((p) => ({ ts: Number(p.ts), value: Number(p.total || 0) })).filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value)),
    [filteredAutoSnapshots]
  );

  const spyLinePoints = useMemo(() => {
    if (!portfolioLinePoints.length) return [];
    const startSpy = getSpyCloseAt(portfolioLinePoints[0].ts);
    if (!Number.isFinite(startSpy) || startSpy <= 0) return [];
    return portfolioLinePoints.map((p) => {
      const spy = getSpyCloseAt(p.ts);
      const value = Number.isFinite(spy) ? STARTING_CASH * (spy / startSpy) : STARTING_CASH;
      return { ts: p.ts, value };
    });
  }, [portfolioLinePoints, getSpyCloseAt]);

  const portfolioPolyline = toPolyline(portfolioLinePoints);
  const manualPolyline = toPolyline(manualLinePoints);
  const autoPolyline = toPolyline(autoLinePoints);
  const spyPolyline = toPolyline(spyLinePoints);
  const chartSeriesValues = useMemo(
    () =>
      [...portfolioLinePoints, ...manualLinePoints, ...autoLinePoints, ...spyLinePoints]
        .map((p) => Number(p.value))
        .filter((v) => Number.isFinite(v)),
    [portfolioLinePoints, manualLinePoints, autoLinePoints, spyLinePoints]
  );
  const chartMin = chartSeriesValues.length ? Math.min(...chartSeriesValues) : 0;
  const chartMax = chartSeriesValues.length ? Math.max(...chartSeriesValues) : 1;
  const chartPad = 18;
  const chartW = 820;
  const chartH = 240;
  const hoverPoint = useMemo(() => {
    if (!Number.isInteger(chartHoverIndex) || chartHoverIndex < 0 || chartHoverIndex >= portfolioLinePoints.length) return null;
    const p = portfolioLinePoints[chartHoverIndex];
    if (!p) return null;
    const minTs = Math.min(...portfolioLinePoints.map((x) => Number(x.ts)));
    const maxTs = Math.max(...portfolioLinePoints.map((x) => Number(x.ts)));
    const tSpan = Math.max(1, maxTs - minTs);
    const ySpan = Math.max(1, chartMax - chartMin);
    const x = chartPad + ((Number(p.ts) - minTs) / tSpan) * (chartW - chartPad * 2);
    const y = chartPad + (1 - (Number(p.value) - chartMin) / ySpan) * (chartH - chartPad * 2);
    return {
      ...p,
      x,
      y,
      label: new Date(Number(p.ts)).toLocaleDateString(),
    };
  }, [chartHoverIndex, portfolioLinePoints, chartMax, chartMin]);

  const portfolioRiskScore = useMemo(() => {
    const total = holdingsMarketValue;
    if (!total || holdingsArray.length === 0) return "Conservative";
    const weights = holdingsArray.map((h) => {
      const px = Number(quoteFor(h.assetType, h.symbol)?.price);
      const value = (Number.isFinite(px) ? px : h.avgBuy) * h.shares;
      return value / total;
    });
    const maxWeight = Math.max(...weights);
    if (maxWeight >= 0.55 || holdingsArray.length <= 2) return "Aggressive";
    if (maxWeight >= 0.3 || holdingsArray.length <= 4) return "Moderate";
    return "Conservative";
  }, [holdingsArray, quoteFor, holdingsMarketValue]);

  const portfolioReturnFor = useCallback(
    (days) => {
      if (!profile.snapshots.length) return 0;
      const now = Date.now();
      const start = now - days * 24 * 60 * 60 * 1000;
      const recent = [...profile.snapshots].reverse().find((p) => Number(p.ts) <= start) || profile.snapshots[0];
      const base = Number(recent?.total || STARTING_CASH);
      if (!Number.isFinite(base) || base <= 0) return 0;
      return ((portfolioTotal - base) / base) * 100;
    },
    [profile.snapshots, portfolioTotal]
  );

  const spyReturnFor = useCallback(
    (days) => {
      if (!spyHistory.length) return 0;
      const now = Date.now();
      const start = now - days * 24 * 60 * 60 * 1000;
      const end = getSpyCloseAt(now);
      const begin = getSpyCloseAt(start);
      if (!Number.isFinite(begin) || !Number.isFinite(end) || begin <= 0) return 0;
      return ((end - begin) / begin) * 100;
    },
    [spyHistory, getSpyCloseAt]
  );

  const achievements = useMemo(() => {
    const firstTrade = profile.transactions.length > 0;
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const diamondHands = holdingsArray.some((h) => Number(h?.firstBuyAt) > 0 && Number(h.firstBuyAt) <= thirtyDaysAgo);
    const tenClub = totalReturnPct >= 10;
    const diversified = holdingsArray.length >= 5;
    const bearSurvivor = spyReturnFor(7) < 0 && portfolioReturnFor(7) > 0;
    return [
      { key: "first", label: "First Trade", unlocked: Boolean(achievementVault.first || firstTrade) },
      { key: "diamond", label: "Diamond Hands", unlocked: Boolean(achievementVault.diamond || diamondHands) },
      { key: "ten", label: "10% Club", unlocked: Boolean(achievementVault.ten || tenClub) },
      { key: "diversified", label: "Diversified", unlocked: Boolean(achievementVault.diversified || diversified) },
      { key: "bear", label: "Bear Survivor", unlocked: Boolean(achievementVault.bear || bearSurvivor) },
    ];
  }, [achievementVault, profile.transactions.length, holdingsArray, totalReturnPct, spyReturnFor, portfolioReturnFor]);

  const transactionStats = useMemo(() => {
    const tx = Array.isArray(profile.transactions) ? profile.transactions : [];
    const sells = tx.filter((x) => String(x?.action || "").toUpperCase() === "SELL");
    const realized = sells
      .map((x) => Number(x?.realizedPnL))
      .filter((x) => Number.isFinite(x));
    const wins = realized.filter((x) => x > 0).length;
    const totalRealized = realized.reduce((sum, v) => sum + v, 0);
    const winRate = realized.length ? (wins / realized.length) * 100 : 0;
    return {
      trades: tx.length,
      sells: sells.length,
      winRate,
      realizedPnL: totalRealized,
    };
  }, [profile.transactions]);

  useEffect(() => {
    setAchievementVault((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const item of achievements) {
        if (item.unlocked && !next[item.key]) {
          next[item.key] = true;
          changed = true;
        }
      }
      if (!changed) return prev;
      try {
        localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [achievements]);

  const isCryptoTrader = useMemo(() => {
    if (!holdingsArray.length) return false;
    const ranked = holdingsArray
      .map((h) => {
        const q = quoteFor(h.assetType, h.symbol);
        const px = Number(q?.price);
        const current = Number.isFinite(px) && px > 0 ? px : Number(h.avgBuy || 0);
        const cost = Number(h.avgBuy || 0) * Number(h.shares || 0);
        const pnlPct = cost > 0 ? ((current * Number(h.shares || 0) - cost) / cost) * 100 : -9999;
        return { assetType: h.assetType, pnlPct };
      })
      .sort((a, b) => b.pnlPct - a.pnlPct);
    return normalizeAssetType(ranked[0]?.assetType) === "crypto";
  }, [holdingsArray, quoteFor]);

  const leaderboardRows = useMemo(() => {
    const currentReturnAll = totalReturnPct;
    const currentReturnMonth = portfolioReturnFor(30);
    const currentReturnWeek = portfolioReturnFor(7);
    const users = [
      { user: "MacroHawk", all: 14.3, month: 3.2, week: 1.1, value: 114300 },
      { user: "ThetaPilot", all: 11.9, month: 2.4, week: -0.5, value: 111900 },
      { user: "DeltaNorth", all: 9.7, month: 1.8, week: 0.8, value: 109700 },
      { user: "VolMint", all: 8.4, month: 1.1, week: 1.4, value: 108400 },
      { user: "PivotLine", all: 7.2, month: 0.9, week: 0.2, value: 107200 },
      { user: "OpenRange", all: 5.8, month: 0.4, week: -0.2, value: 105800 },
      { user: "TrendStack", all: 4.6, month: 0.6, week: 0.7, value: 104600 },
      { user: "GammaWatch", all: 3.7, month: 0.2, week: 0.1, value: 103700 },
      { user: "ValueLane", all: 2.9, month: -0.4, week: -0.7, value: 102900 },
      { user: "RiskFrame", all: 2.1, month: 0.1, week: 0.3, value: 102100 },
      { user: "You", all: currentReturnAll, month: currentReturnMonth, week: currentReturnWeek, value: portfolioTotal, self: true },
    ];
    const key = leaderboardFilter === "week" ? "week" : leaderboardFilter === "month" ? "month" : "all";
    const sorted = [...users].sort((a, b) => b[key] - a[key]).slice(0, 10);
    return sorted.map((row, idx) => ({ ...row, rank: idx + 1, metric: row[key] }));
  }, [leaderboardFilter, totalReturnPct, portfolioReturnFor, portfolioTotal]);

  const selfRank = useMemo(() => {
    const key = leaderboardFilter === "week" ? "week" : leaderboardFilter === "month" ? "month" : "all";
    const users = [
      ...leaderboardRows.map((row) => ({ user: row.user, metric: row.metric })),
      { user: "You", metric: key === "week" ? portfolioReturnFor(7) : key === "month" ? portfolioReturnFor(30) : totalReturnPct },
    ];
    const sorted = [...users]
      .sort((a, b) => b.metric - a.metric)
      .map((row, idx) => ({ ...row, rank: idx + 1 }));
    return sorted.find((row) => row.user === "You")?.rank || 1;
  }, [leaderboardRows, leaderboardFilter, portfolioReturnFor, totalReturnPct]);

  const runAstraOpinion = useCallback(async (symbol, assetType = "stock") => {
    try {
      const market = normalizeAssetType(assetType) === "crypto" ? "crypto" : "stock";
      const q = encodeURIComponent(`One sentence only: what's the key risk/reward for ${symbol} today?`);
      const res = await fetch(`/api/ai?mode=chat&market=${market}&symbol=${encodeURIComponent(symbol)}&question=${q}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const raw = String(data?.answer || data?.raw || "").trim();
      if (!raw) return "No immediate red flag, but keep risk controls tight.";
      const first = raw.split("\n").map((x) => x.trim()).find(Boolean) || raw;
      return first.replace(/^Summary:\s*/i, "");
    } catch {
      return "No immediate red flag, but keep risk controls tight.";
    }
  }, []);

  const appendModeSnapshot = useCallback((draftProfile, totalValue, mode) => {
    const row = { ts: Date.now(), total: Number(totalValue || 0) };
    const out = { ...draftProfile };
    out.snapshots = [...(draftProfile.snapshots || []), row].slice(-1200);
    if (mode === "autopilot") out.autoPilotSnapshots = [...(draftProfile.autoPilotSnapshots || []), row].slice(-1200);
    else out.manualSnapshots = [...(draftProfile.manualSnapshots || []), row].slice(-1200);
    return out;
  }, []);

  const applySingleTrade = useCallback((baseProfile, trade) => {
    const symbol = String(trade?.ticker || "").toUpperCase().trim();
    const assetType = normalizeAssetType(trade?.assetType);
    const action = String(trade?.action || "HOLD").toUpperCase();
    const key = holdingKey(assetType, symbol);
    const live = Number(quotes[key]?.price);
    const price = Number.isFinite(live) && live > 0 ? live : Number(trade?.price || 0);
    const sharesRaw = Math.max(0, Number(trade?.shares || 0));
    if (!symbol || !Number.isFinite(price) || price <= 0) return { profile: baseProfile, executed: null };
    const holdings = { ...(baseProfile.holdings || {}) };
    let cash = Number(baseProfile.cash || 0);
    const holdingsValueBefore = Object.values(holdings).reduce((sum, h) => {
      const hp = Number(quotes[holdingKey(h?.assetType, h?.symbol)]?.price);
      const px = Number.isFinite(hp) && hp > 0 ? hp : Number(h?.avgBuy || 0);
      return sum + px * Number(h?.shares || 0);
    }, 0);
    const cryptoValueBefore = Object.values(holdings).reduce((sum, h) => {
      if (normalizeAssetType(h?.assetType) !== "crypto") return sum;
      const hp = Number(quotes[holdingKey(h?.assetType, h?.symbol)]?.price);
      const px = Number.isFinite(hp) && hp > 0 ? hp : Number(h?.avgBuy || 0);
      return sum + px * Number(h?.shares || 0);
    }, 0);
    const totalBefore = cash + holdingsValueBefore;
    const minCashReserve = Math.max(0, totalBefore * Number(riskPolicy?.minCashReservePct || 0.1));
    const maxSinglePosition = Math.max(0, totalBefore * Number(riskPolicy?.maxPositionPct || 0.2));
    const maxCryptoAllocation = Math.max(0, totalBefore * Number(riskPolicy?.maxCryptoPct || 0.2));
    const maxAssetClass = Math.max(0, totalBefore * 0.5);
    const existing = holdings[key] || {
      symbol,
      assetType,
      cryptoId: assetType === "crypto" ? String(trade?.cryptoId || CRYPTO_SYMBOL_TO_ID[symbol] || "") : "",
      name: symbol,
      shares: 0,
      avgBuy: price,
      firstBuyAt: Date.now(),
    };
    const currentPosVal = Number(existing.shares || 0) * price;

    if (action === "BUY") {
      if (assetType === "crypto" && !riskPolicy.allowCrypto) return { profile: baseProfile, executed: null };
      const spendCap = Math.max(0, cash - minCashReserve);
      const singleCap = Math.max(0, maxSinglePosition - currentPosVal);
      const cryptoCap =
        assetType === "crypto" ? Math.max(0, maxCryptoAllocation - cryptoValueBefore) : Number.POSITIVE_INFINITY;
      const assetClassValue = Object.values(holdings).reduce((sum, h) => {
        if (normalizeAssetType(h?.assetType) !== assetType) return sum;
        const hp = Number(quotes[holdingKey(h?.assetType, h?.symbol)]?.price);
        const px = Number.isFinite(hp) && hp > 0 ? hp : Number(h?.avgBuy || 0);
        return sum + px * Number(h?.shares || 0);
      }, 0);
      const assetClassCap = Math.max(0, maxAssetClass - assetClassValue);
      const allowedValue = Math.min(spendCap, singleCap, cryptoCap, assetClassCap);
      const value = sharesRaw * price;
      const execValue = Math.min(value, allowedValue);
      const execShares = price > 0 ? execValue / price : 0;
      if (execShares <= 0) return { profile: baseProfile, executed: null };
      const totalShares = Number(existing.shares || 0) + execShares;
      const avgBuy = ((Number(existing.avgBuy || 0) * Number(existing.shares || 0)) + execValue) / totalShares;
      const stopPct = riskPolicy.level === "CONSERVATIVE" ? 0.05 : riskPolicy.level === "AGGRESSIVE" ? 0.12 : 0.08;
      const computedStop = price * (1 - stopPct);
      const computedTarget = price + (price - computedStop) * 2;
      const incomingStop = Number(trade?.stop_loss || trade?.stopLoss || 0);
      const incomingTarget = Number(trade?.take_profit || trade?.takeProfit || 0);
      const stopRatio = price > 0 ? incomingStop / price : 0;
      const targetRatio = price > 0 ? incomingTarget / price : 0;
      const stopLoss = Number.isFinite(incomingStop) && incomingStop > 0 && stopRatio > 0.4 && stopRatio < 1
        ? incomingStop
        : computedStop;
      const takeProfit = Number.isFinite(incomingTarget) && incomingTarget > 0 && targetRatio > 1 && targetRatio < 3
        ? incomingTarget
        : computedTarget;
      holdings[key] = {
        ...existing,
        symbol,
        assetType,
        cryptoId: assetType === "crypto" ? String(existing.cryptoId || trade?.cryptoId || CRYPTO_SYMBOL_TO_ID[symbol] || "") : "",
        shares: totalShares,
        avgBuy,
        stopLoss,
        takeProfit,
        trailingStopPct: Number(riskExecutionPolicy?.trailingStopPct || 0.07),
        highestPrice: Math.max(Number(existing?.highestPrice || 0), price),
        firstBuyAt: Number(existing.firstBuyAt || Date.now()),
      };
      cash -= execValue;
      return {
        profile: { ...baseProfile, cash, holdings },
        executed: { action: "BUY", symbol, assetType, shares: execShares, price, totalValue: execValue, realizedPnL: null },
      };
    }

    if (action === "SELL") {
      const owned = Number(existing.shares || 0);
      const execShares = Math.min(owned, sharesRaw);
      if (execShares <= 0) return { profile: baseProfile, executed: null };
      const execValue = execShares * price;
      const realizedPnL = (price - Number(existing.avgBuy || 0)) * execShares;
      const remain = owned - execShares;
      if (remain <= 1e-8) delete holdings[key];
      else holdings[key] = { ...existing, shares: remain };
      cash += execValue;
      return {
        profile: { ...baseProfile, cash, holdings },
        executed: { action: "SELL", symbol, assetType, shares: execShares, price, totalValue: execValue, realizedPnL },
      };
    }

    return {
      profile: baseProfile,
      executed: { action: "HOLD", symbol, assetType, shares: 0, price, totalValue: 0, realizedPnL: null },
    };
  }, [quotes, riskPolicy, riskExecutionPolicy]);

  useEffect(() => {
    const plans = Array.isArray(profile?.dcaPlans) ? profile.dcaPlans : [];
    if (!plans.length) return;
    const now = Date.now();
    const due = plans.filter((p) => p?.active && Number(p?.nextRunAt || 0) <= now);
    if (!due.length) return;
    let message = "";
    setProfile((prev) => {
      let draft = { ...prev };
      let executedCount = 0;
      const nextPlans = (prev.dcaPlans || []).map((plan) => {
        const dueNow = due.find((d) => d.id === plan.id);
        if (!dueNow) return plan;
        const symbol = String(plan.symbol || "").toUpperCase();
        const assetType = normalizeAssetType(plan.assetType);
        const px = Number(quotes[holdingKey(assetType, symbol)]?.price);
        const amount = Number(plan.amountUsd || 0);
        if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(amount) || amount <= 0) {
          return { ...plan, nextRunAt: nextDcaRun(plan.interval, now) };
        }
        const allocationPct = portfolioTotal > 0 ? (amount / portfolioTotal) * 100 : 1;
        const decision = {
          action: "BUY",
          ticker: symbol,
          assetType,
          confidence: 72,
          strategy: "momentum",
          entry_price: px,
          allocation_pct: Math.max(0.2, allocationPct),
          reasoning: `DCA recurring buy (${plan.interval}) for ${symbol}.`,
          lesson: "Dollar-cost averaging builds exposure gradually and reduces timing risk.",
        };
        const applied = applySingleTrade(draft, decision);
        if (applied?.executed?.action === "BUY") {
          draft = applied.profile;
          executedCount += 1;
        }
        return { ...plan, nextRunAt: nextDcaRun(plan.interval, now) };
      });
      if (executedCount > 0) {
        const holdingsValue = Object.values(draft.holdings || {}).reduce((sum, h) => {
          const live = Number(quotes[holdingKey(h?.assetType, h?.symbol)]?.price);
          const usePx = Number.isFinite(live) && live > 0 ? live : Number(h?.avgBuy || 0);
          return sum + usePx * Number(h?.shares || 0);
        }, 0);
        draft = appendModeSnapshot(draft, Number(draft.cash || 0) + holdingsValue, "manual");
      }
      draft.dcaPlans = nextPlans;
      message = executedCount > 0 ? `DCA executed ${executedCount} recurring buy${executedCount > 1 ? "s" : ""}.` : "";
      return draft;
    });
    if (message) {
      setTradeMessage(message);
      setTradeFlash({ tone: "green", title: "DCA Executed", body: message });
    }
  }, [nowTick, profile?.dcaPlans, quotes, applySingleTrade, appendModeSnapshot, portfolioTotal]);

  const runAutoPilotCycle = useCallback(async () => {
    if (!autoPilotEnabled || autoRunning) return;
    setAutoRunning(true);
    setAutoMessage("");
    try {
      const holdingsPayload = Object.values(profile.holdings || {}).map((h) => {
        const key = holdingKey(h?.assetType, h?.symbol);
        const q = quotes[key] || {};
        return {
          symbol: h.symbol,
          assetType: normalizeAssetType(h?.assetType),
          cryptoId: String(h?.cryptoId || ""),
          shares: Number(h.shares || 0),
          avgBuy: Number(h.avgBuy || 0),
          currentPrice: Number(q?.price || h.avgBuy || 0),
          percentChange: Number(q?.percentChange || 0),
          stopLoss: Number(h?.stopLoss || 0),
          takeProfit: Number(h?.takeProfit || 0),
          buyDate: h?.firstBuyAt ? new Date(Number(h.firstBuyAt)).toISOString() : null,
        };
      });
      const res = await fetch("/api/simulator-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          cash: Number(profile.cash || 0),
          totalValue: Number(portfolioTotal || 0),
          startingCash: Number(profile.startingCash || STARTING_CASH),
          dailyDrawdownPct: Number(dailyDrawdownPct || 0),
          dailyKillLimitPct: Number(riskExecutionPolicy?.dailyDrawdownKillPct || 4),
          holdings: holdingsPayload,
          riskLevel,
          customRisk,
          tradingStyle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const decisions = Array.isArray(data?.decisions) ? data.decisions : [];
      const now = Date.now();
      const todayKey = new Date(now).toISOString().slice(0, 10);
      let draft = { ...profile, autoPilot: { ...(profile.autoPilot || {}) } };
      let didTrade = false;
      const decisionLogEntries = [];
      let tradesToday = (Array.isArray(draft.transactions) ? draft.transactions : []).filter((t) => {
        const ts = Number(t?.ts || 0);
        if (!ts) return false;
        return new Date(ts).toISOString().slice(0, 10) === todayKey && ["BUY", "SELL"].includes(String(t?.action || "").toUpperCase());
      }).length;
      let turnoverToday = (Array.isArray(draft.transactions) ? draft.transactions : []).reduce((sum, t) => {
        const ts = Number(t?.ts || 0);
        if (!ts) return sum;
        if (new Date(ts).toISOString().slice(0, 10) !== todayKey) return sum;
        return sum + Math.max(0, Number(t?.totalValue || 0));
      }, 0);
      const maxTradesPerDay = Math.max(1, Number(guardrails?.maxTradesPerDay || 8));
      const maxTurnoverValue = Math.max(1000, Number(portfolioTotal || 0) * (Math.max(5, Number(guardrails?.maxTurnoverPctPerDay || 40)) / 100));
      const maxConcurrentPositions = Math.max(1, Number(guardrails?.maxConcurrentPositions || 10));

      for (const decision of decisions) {
        const rawAction = String(decision?.action || "HOLD").toUpperCase();
        const symbol = String(decision?.ticker || "").toUpperCase();
        const assetType = normalizeAssetType(decision?.assetType);
        const key = holdingKey(assetType, symbol);
        const isOpeningBuy = rawAction === "BUY" && !draft.holdings?.[key];
        const estimatedTurnover = Math.max(0, Number(decision?.shares || 0) * Number(decision?.entry_price || decision?.price || 0));
        let guardedDecision = decision;
        let guardrailReason = "";
        if (rawAction === "BUY" || rawAction === "SELL") {
          if (tradesToday >= maxTradesPerDay) {
            guardrailReason = `Guardrail active: max trades/day (${maxTradesPerDay}) reached.`;
          } else if (turnoverToday + estimatedTurnover > maxTurnoverValue) {
            guardrailReason = `Guardrail active: max turnover/day (${Math.round((Number(guardrails?.maxTurnoverPctPerDay || 40)))}%) reached.`;
          } else if (isOpeningBuy && Object.keys(draft.holdings || {}).length >= maxConcurrentPositions) {
            guardrailReason = `Guardrail active: max concurrent positions (${maxConcurrentPositions}) reached.`;
          }
        }
        if (guardrailReason) {
          guardedDecision = {
            ...decision,
            action: "HOLD",
            shares: 0,
            reasoning: guardrailReason,
            confidence: Math.max(55, Number(decision?.confidence || 0)),
            risk: "LOW",
            lesson: "Guardrails reduce overtrading and keep risk within your selected profile.",
          };
        }

        const { profile: nextDraft, executed } = applySingleTrade(draft, guardedDecision);
        if (!executed) continue;
        draft = nextDraft;
        const logEntry = {
          id: `${now}-${decision?.ticker || executed.symbol}-${decisionLogEntries.length}`,
          ts: now,
          action: executed.action,
          symbol: executed.symbol,
          assetType: executed.assetType || normalizeAssetType(decision?.assetType),
          shares: executed.shares,
          price: executed.price,
          totalValue: executed.totalValue,
          realizedPnL: executed.realizedPnL,
          reasoning: String(guardedDecision?.reasoning || "").trim() || "ASTRA adjusted risk based on market context.",
          confidence: Math.max(0, Math.min(100, Number(guardedDecision?.confidence || 0))),
          risk: String(guardedDecision?.risk || "MEDIUM").toUpperCase(),
          lesson: String(guardedDecision?.lesson || "Risk management is the core edge in volatile markets."),
          entryPrice: Number(guardedDecision?.entry_price || guardedDecision?.entryPrice || executed.price || 0),
          stopLoss: Number(guardedDecision?.stop_loss || guardedDecision?.stopLoss || 0),
          takeProfit: Number(guardedDecision?.take_profit || guardedDecision?.takeProfit || 0),
          strategy: String(guardedDecision?.strategy || "").toLowerCase(),
          holdDays: Number(guardedDecision?.holdDays || 0),
          score: Number(guardedDecision?.composite_score || guardedDecision?.score || 0),
          whyNow: String(guardedDecision?.reasoning || "").trim() || "Signal and regime alignment crossed execution threshold now.",
          sizeWhy: `Position sized under ${riskPolicy.level} policy and guardrails (max ${Math.round((riskPolicy.maxPositionPct || 0.2) * 100)}% per position).`,
          invalidation: Number(guardedDecision?.stop_loss || guardedDecision?.stopLoss || 0) > 0
            ? `Trade invalidates below ${fmtMoney(Number(guardedDecision?.stop_loss || guardedDecision?.stopLoss || 0))}.`
            : "Trade invalidates if signal confidence and regime alignment deteriorate.",
          expectedHold: Number(guardedDecision?.holdDays || 0) > 0
            ? `${Number(guardedDecision?.holdDays || 0)} days target hold.`
            : tradingStyle === "day_trading" ? "Intraday tactical hold." : "Monitor daily until thesis changes.",
          bullThesis: String(guardedDecision?.bull_thesis || guardedDecision?.bullThesis || ""),
          bearThesis: String(guardedDecision?.bear_thesis || guardedDecision?.bearThesis || ""),
          researchSummary: String(guardedDecision?.research_summary || guardedDecision?.researchSummary || ""),
        };
        decisionLogEntries.push(logEntry);
        if (executed.action === "BUY" || executed.action === "SELL") {
          didTrade = true;
          tradesToday += 1;
          turnoverToday += Math.max(0, Number(executed.totalValue || 0));
        }
      }

      const holdingsValue = Object.values(draft.holdings || {}).reduce((sum, h) => {
        const px = Number(quotes[holdingKey(h?.assetType, h?.symbol)]?.price);
        const usePx = Number.isFinite(px) && px > 0 ? px : Number(h.avgBuy || 0);
        return sum + usePx * Number(h.shares || 0);
      }, 0);
      const total = Number(draft.cash || 0) + holdingsValue;
      draft = appendModeSnapshot(draft, total, "autopilot");
      draft.autoPilot = {
        ...(draft.autoPilot || {}),
        enabled: true,
        lastRunAt: now,
        lastActionAt: decisionLogEntries.length ? now : Number(draft.autoPilot?.lastActionAt || 0),
        nextDecisionAt: Number(data?.nextDecisionAt || (now + 24 * 60 * 60 * 1000)),
        watchlist: Array.isArray(data?.watchlist) ? data.watchlist : [],
        outlook: String(data?.outlook || ""),
        runSummary: String(data?.runSummary || ""),
        agentState: data?.agentState && typeof data.agentState === "object" ? data.agentState : null,
        executionPlan: Array.isArray(data?.executionPlan) ? data.executionPlan : [],
        decisionLog: [...decisionLogEntries, ...(Array.isArray(draft.autoPilot?.decisionLog) ? draft.autoPilot.decisionLog : [])].slice(0, 200),
        guardrails: {
          maxTradesPerDay,
          maxTurnoverPctPerDay: Number(guardrails?.maxTurnoverPctPerDay || 40),
          maxConcurrentPositions,
          tradesToday,
          turnoverToday,
        },
      };
      setProfile(draft);
      if (decisionLogEntries.length) {
        const first = decisionLogEntries[0];
        const units = normalizeAssetType(first.assetType) === "crypto" ? first.symbol : "shares";
        setAutoMessage(`ASTRA ${first.action} ${first.symbol} (${first.shares.toFixed(normalizeAssetType(first.assetType) === "crypto" ? 6 : 3)} ${units}).`);
        setTradeFlash({
          tone: first.action === "BUY" ? "green" : first.action === "SELL" ? "red" : "amber",
          title: `ASTRA ${first.action}`,
          body: `${first.symbol} • ${first.confidence || 0}% confidence • ${first.risk || "MEDIUM"} risk`,
        });
      } else if (!didTrade) {
        setAutoMessage("ASTRA reviewed the market and held positions.");
      }
    } catch {
      setAutoMessage("Auto-Pilot run failed. Try again on refresh.");
    } finally {
      setAutoRunning(false);
    }
  }, [appendModeSnapshot, applySingleTrade, autoPilotEnabled, autoRunning, profile, quotes, riskLevel, customRisk, tradingStyle, portfolioTotal, dailyDrawdownPct, riskExecutionPolicy, guardrails, riskPolicy.level, riskPolicy.maxPositionPct]);

  const enableAutoPilot = () => {
    setProfile((prev) => ({
      ...prev,
      autoPilot: {
        ...(prev.autoPilot || {}),
        enabled: true,
        killSwitchTriggeredAt: 0,
        killSwitchReason: "",
        nextDecisionAt: Number(prev.autoPilot?.nextDecisionAt || Date.now()),
      },
    }));
    setShowEnableAutoModal(false);
    setSimTab("autopilot");
  };

  const disableAutoPilot = () => {
    setProfile((prev) => ({
      ...prev,
      autoPilot: {
        ...(prev.autoPilot || {}),
        enabled: false,
      },
    }));
    setAutoMessage("Auto-Pilot paused. Manual mode restored.");
    setSimTab("manual");
  };

  useEffect(() => {
    if (!autoPilotEnabled) return;
    const limit = Number(riskExecutionPolicy?.dailyDrawdownKillPct || 4);
    if (Number(dailyDrawdownPct || 0) > -limit) return;
    const now = Date.now();
    const killReason = `Hard daily drawdown kill-switch hit (${fmtPct(dailyDrawdownPct)} <= -${limit.toFixed(1)}%). Auto-Pilot stopped to protect capital.`;
    setProfile((prev) => ({
      ...prev,
      autoPilot: {
        ...(prev.autoPilot || {}),
        enabled: false,
        killSwitchTriggeredAt: now,
        killSwitchReason: killReason,
      },
    }));
    setAutoMessage(killReason);
    setTradeFlash({ tone: "red", title: "Kill-Switch Triggered", body: killReason });
  }, [autoPilotEnabled, dailyDrawdownPct, riskExecutionPolicy]);

  useEffect(() => {
    if (!autoPilotEnabled) return;
    const intervalMs = tradingStyle === "day_trading" ? 5 * 60 * 1000 : 20 * 60 * 1000;
    const lastRunAt = Number(profile?.autoPilot?.lastRunAt || 0);
    if (!lastRunAt || Date.now() - lastRunAt >= intervalMs) {
      runAutoPilotCycle();
    }
    const timer = setInterval(() => {
      runAutoPilotCycle();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [autoPilotEnabled, tradingStyle, profile?.autoPilot?.lastRunAt, runAutoPilotCycle]);

  const runDeepResearch = async (symbol, type = "full") => {
    const target = String(symbol || "").toUpperCase().trim();
    if (!target) return;
    setDeepResearchOpen(true);
    setDeepResearchTicker(target);
    setDeepResearchLoading(true);
    setDeepResearchError("");
    setDeepResearchData(null);

    try {
      const res = await fetch(RESEARCH_ENGINE_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: target, type: type === "quick" ? "quick" : "full" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(data?.error || `Deep research failed (${res.status})`));
      }
      setDeepResearchData(data);
    } catch (err) {
      setDeepResearchError(err instanceof Error ? err.message : "Unable to run deep research right now.");
    } finally {
      setDeepResearchLoading(false);
    }
  };

  const executeTrade = async () => {
    setTradeMessage("");
    setAstraOpinion("");
    setCryptoLessonNotice("");
    if (autoPilotEnabled) {
      setTradeMessage("Manual trading is disabled while ASTRA Auto-Pilot is active.");
      return;
    }
    if (tradeError) {
      setTradeMessage(tradeError);
      return;
    }
    const symbol = selectedTicker.trim().toUpperCase();
    const assetType = normalizeAssetType(selectedAssetType);
    const mapKey = holdingKey(assetType, symbol);
    setSubmittingTrade(true);
    try {
      const fresh = await refreshQuoteFor(symbol, assetType, selectedCryptoId);
      const px = Number(fresh?.price ?? selectedPrice);
      if (!Number.isFinite(px) || px <= 0) {
        setTradeMessage("Unable to execute trade: live price unavailable.");
        return;
      }
      const shares = Math.max(0, sharesFromInput);
      const value = shares * px;
      const now = Date.now();

      let nextProfile = profile;
      if (tradeMode === "BUY") {
        if (assetType === "crypto" && !riskPolicy.allowCrypto) {
          setTradeMessage("Crypto is disabled for the current risk profile.");
          return;
        }
        if (value > Number(profile.cash || 0) + 1e-8) {
          setTradeMessage("Insufficient cash for this buy.");
          return;
        }
        const totalBefore = Number(profile.cash || 0) + holdingsMarketValue;
        const maxPosValue = totalBefore * Number(riskPolicy.maxPositionPct || 0.2);
        const samePositionValue = (Number(profile.holdings?.[mapKey]?.shares || 0) * Number(profile.holdings?.[mapKey]?.avgBuy || px));
        if (samePositionValue + value > maxPosValue + 1e-8) {
          setTradeMessage(`Position exceeds ${Math.round((riskPolicy.maxPositionPct || 0.2) * 100)}% max for ${riskPolicy.level} risk.`);
          return;
        }
        const assetClassValue = Object.values(profile.holdings || {}).reduce((sum, h) => {
          if (normalizeAssetType(h?.assetType) !== assetType) return sum;
          const q = Number(quotes[holdingKey(h?.assetType, h?.symbol)]?.price);
          const pxUse = Number.isFinite(q) && q > 0 ? q : Number(h?.avgBuy || 0);
          return sum + pxUse * Number(h?.shares || 0);
        }, 0);
        if (assetClassValue + value > totalBefore * 0.5 + 1e-8) {
          setTradeMessage("Trade exceeds 50% asset-class concentration cap.");
          return;
        }
        if (assetType === "crypto") {
          const totalCrypto = holdingsBreakdown.crypto;
          const maxCrypto = totalBefore * Number(riskPolicy.maxCryptoPct || 0);
          if (totalCrypto + value > maxCrypto + 1e-8) {
            setTradeMessage(`Crypto allocation exceeds ${Math.round((riskPolicy.maxCryptoPct || 0) * 100)}% cap for ${riskPolicy.level} risk.`);
            return;
          }
        }
        const minCash = totalBefore * Number(riskPolicy.minCashReservePct || 0.1);
        if (Number(profile.cash || 0) - value < minCash - 1e-8) {
          setTradeMessage(`Trade breaks minimum cash reserve (${Math.round((riskPolicy.minCashReservePct || 0.1) * 100)}%).`);
          return;
        }
        const existing = profile.holdings[mapKey] || {
          symbol,
          assetType,
          cryptoId: assetType === "crypto" ? String(fresh?.cryptoId || selectedCryptoId || CRYPTO_SYMBOL_TO_ID[symbol] || "") : "",
          name: fresh?.name || selectedCompany || symbol,
          shares: 0,
          avgBuy: 0,
          firstBuyAt: now,
        };
        const totalShares = Number(existing.shares || 0) + shares;
        const avgBuy = totalShares > 0
          ? ((Number(existing.avgBuy || 0) * Number(existing.shares || 0)) + value) / totalShares
          : px;
        const stopPct = riskPolicy.level === "CONSERVATIVE" ? 0.05 : riskPolicy.level === "AGGRESSIVE" ? 0.12 : 0.08;
        const stopLoss = px * (1 - stopPct);
        const takeProfit = px + (px - stopLoss) * 2;
        nextProfile = {
          ...profile,
          cash: Number(profile.cash || 0) - value,
          holdings: {
            ...profile.holdings,
            [mapKey]: {
              ...existing,
              shares: totalShares,
              avgBuy,
              assetType,
              cryptoId: assetType === "crypto" ? String(existing.cryptoId || fresh?.cryptoId || selectedCryptoId || CRYPTO_SYMBOL_TO_ID[symbol] || "") : "",
              name: existing.name || fresh?.name || symbol,
              firstBuyAt: Number(existing.firstBuyAt || now),
              stopLoss,
              takeProfit,
              trailingStopPct: Number(riskExecutionPolicy?.trailingStopPct || 0.07),
              highestPrice: Math.max(Number(existing?.highestPrice || 0), px),
            },
          },
          transactions: [
            {
              id: `${now}-${assetType}-${symbol}-BUY`,
              ts: now,
              symbol,
              assetType,
              cryptoId: assetType === "crypto" ? String(fresh?.cryptoId || selectedCryptoId || CRYPTO_SYMBOL_TO_ID[symbol] || "") : "",
              company: fresh?.name || selectedCompany || symbol,
              action: "BUY",
              shares,
              price: px,
              totalValue: value,
              realizedPnL: null,
              marketClosed: assetType === "stock" ? !nyse.open : false,
            },
            ...profile.transactions,
          ],
        };
      } else {
        const existing = profile.holdings[mapKey];
        if (!existing || Number(existing.shares || 0) < shares - 1e-8) {
          setTradeMessage("Cannot sell more shares than owned.");
          return;
        }
        const realizedPnL = (px - Number(existing.avgBuy || 0)) * shares;
        const remain = Number(existing.shares || 0) - shares;
        const nextHoldings = { ...profile.holdings };
        if (remain <= 1e-8) delete nextHoldings[mapKey];
        else nextHoldings[mapKey] = { ...existing, shares: remain };
        nextProfile = {
          ...profile,
          cash: Number(profile.cash || 0) + value,
          holdings: nextHoldings,
          transactions: [
            {
              id: `${now}-${assetType}-${symbol}-SELL`,
              ts: now,
              symbol,
              assetType,
              cryptoId: assetType === "crypto" ? String(existing.cryptoId || selectedCryptoId || CRYPTO_SYMBOL_TO_ID[symbol] || "") : "",
              company: existing.name || symbol,
              action: "SELL",
              shares,
              price: px,
              totalValue: value,
              realizedPnL,
              marketClosed: assetType === "stock" ? !nyse.open : false,
            },
            ...profile.transactions,
          ],
        };
      }

      const recomputedHoldingsValue = Object.values(nextProfile.holdings).reduce((sum, h) => {
        const live = Number((h && quotes[holdingKey(h.assetType, h.symbol)]?.price) || (h && fresh?.symbol === h.symbol ? fresh.price : null));
        const fallback = Number(h?.avgBuy || 0);
        const usePx = Number.isFinite(live) && live > 0 ? live : fallback;
        return sum + usePx * Number(h?.shares || 0);
      }, 0);
      const nextTotal = Number(nextProfile.cash || 0) + recomputedHoldingsValue;
      nextProfile = appendModeSnapshot(nextProfile, nextTotal, "manual");

      setProfile(nextProfile);
      setTradeMessage(
        `${tradeMode} ${shares.toFixed(assetType === "crypto" ? 6 : 4)} ${symbol} @ ${fmtMoney(px)} (${fmtMoney(value)} total)${
          assetType === "stock" && !nyse.open ? " — Market Closed: using last close price." : ""
        }`
      );
      setTradeFlash({
        tone: tradeMode === "BUY" ? "green" : "red",
        title: `${tradeMode} Executed`,
        body: `${tradeMode} ${symbol} at ${fmtMoney(px)} (${fmtMoney(value)}).`,
      });
      try {
        const [vixRes, dxyRes] = await Promise.all([
          fetch("/api/quote?symbol=%5EVIX", { cache: "no-store" }),
          fetch("/api/quote?symbol=DX-Y.NYB", { cache: "no-store" }),
        ]);
        const [vixData, dxyData] = await Promise.all([
          vixRes.json().catch(() => ({})),
          dxyRes.json().catch(() => ({})),
        ]);
        await fetch("/api/trades/log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "manual",
            ticker: symbol,
            action: tradeMode,
            shares,
            entry_price: px,
            total_value: value,
            quant_composite_score: null,
            quant_signal: null,
            quant_momentum: null,
            quant_mean_reversion: null,
            market_regime: null,
            vix_at_entry: Number(vixData?.price ?? NaN),
            dxy_at_entry: Number(dxyData?.price ?? NaN),
            sector_performance: [],
            weight_momentum: 0.55,
            weight_mean_reversion: 0.35,
            weight_volatility: 0.07,
            weight_range: 0.03,
            user_risk_level: riskPolicy.level,
            strategy_name: "manual",
            strategy_conviction: 0,
            hold_days_target: 0,
            reasoning: "Manual simulator trade",
            confidence: 0,
            stop_loss: tradeMode === "BUY" ? Number(nextProfile?.holdings?.[mapKey]?.stopLoss || null) : null,
            take_profit: tradeMode === "BUY" ? Number(nextProfile?.holdings?.[mapKey]?.takeProfit || null) : null,
          }),
        });
      } catch (error) {
        console.warn("[simulator] manual trade log failed", String(error?.message || error));
      }
      if (assetType === "crypto") {
        const hadCryptoTrade = profile.transactions.some((tx) => normalizeAssetType(tx?.assetType) === "crypto");
        if (!hadCryptoTrade && tradeMode === "BUY") {
          setCryptoLessonNotice(
            "Market School: What is blockchain and why does it matter? • Why is crypto so volatile? • How to size a crypto position responsibly."
          );
        }
      }
      const line = await runAstraOpinion(symbol, assetType);
      setAstraOpinion(line);
    } finally {
      setSubmittingTrade(false);
    }
  };

  const resetPortfolio = async () => {
    const ok = window.confirm(
      "Reset portfolio to $100,000?\nThis will clear all trade history and start fresh."
    );
    if (!ok) return;
    const fresh = createDefaultProfile();
    try {
      await fetch("/api/trades/reset", { method: "POST" });
    } catch {}
    setProfile(fresh);
    setTradeMessage("Portfolio reset to $100,000.");
    setAstraOpinion("");
    setAutoMessage("");
    setExpandedDecisionId("");
  };

  return (
    <div className={`${pageClass} sim-pro ${simMono.className}`}>
      {isCherry && <SakuraThemeBackground />}
      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
        <div className={`sticky top-2 z-40 mb-4 rounded-xl border px-3 py-2 backdrop-blur ${isLight ? "border-slate-200 bg-white/95" : "border-white/12 bg-[#0d1117]/90"}`}>
          <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Link
              href="/home"
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100" : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              Back Home
            </Link>
            <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"} ${simSans.className}`}>Bots</div>
          </div>
          <div className="flex items-center gap-2">
            <details className="relative">
              <summary
                className={`list-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer [&::-webkit-details-marker]:hidden ${
                  isAlerik ? "border-[#c9a84c]/30 bg-[#0b0b0b]/90 text-[#f5f0e8]" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/5 text-white/85"
                }`}
              >
                Theme: {theme === "cherry" ? "Sakura" : theme === "azula" ? "Azula" : theme === "alerik" ? "Alerik" : theme === "light" ? "Light" : "Dark"}
                <span className="text-[10px]">▼</span>
              </summary>
              <div
                className={`absolute right-0 top-full mt-2 w-40 rounded-xl border p-1.5 shadow-2xl z-40 ${
                  isAlerik ? "border-[#c9a84c]/30 bg-[#0b0b0b]" : isLight ? "border-slate-300 bg-white" : "border-white/15 bg-slate-900"
                }`}
              >
                {[
                  { key: "dark", label: "Dark" },
                  { key: "light", label: "Light" },
                  { key: "cherry", label: "Sakura" },
                  { key: "azula", label: "Azula" },
                  { key: "alerik", label: "Alerik" },
                ].map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setThemeMode(m.key)}
                    className={`mt-1 first:mt-0 w-full rounded-lg px-3 py-2 text-left text-xs font-semibold ${
                      theme === m.key
                        ? (m.key === "alerik" ? "bg-[#c9a84c] text-[#050505]" : "bg-blue-600 text-white")
                        : isAlerik
                          ? "text-[#f5f0e8] hover:bg-[#15120d]"
                          : isLight
                            ? "text-slate-700 hover:bg-slate-100"
                            : "text-white/85 hover:bg-white/10"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </details>
            <div className={`text-[11px] ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/55"}`}>Learn before you risk capital.</div>
          </div>
          </div>
        </div>

        <section className={`${cardClass} mb-4`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={`text-xs uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Bots Tab</div>
              <div className={`text-sm ${isLight ? "text-slate-700" : "text-white/85"}`}>
                Use QUANT for portfolio simulation and ARBI for arbitrage intelligence.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBotMode("quant")}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                  botMode === "quant"
                    ? "bg-blue-600 text-white border-blue-500"
                    : isLight
                      ? "border-slate-300 bg-white text-slate-700"
                      : "border-white/15 bg-white/10 text-white/85"
                }`}
              >
                QUANT
              </button>
              <button
                onClick={() => setBotMode("arbi")}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                  botMode === "arbi"
                    ? "bg-blue-600 text-white border-blue-500"
                    : isLight
                      ? "border-slate-300 bg-white text-slate-700"
                      : "border-white/15 bg-white/10 text-white/85"
                }`}
              >
                ARBI
              </button>
            </div>
          </div>
        </section>

        {botMode === "arbi" && (
          <section className={`${cardClass} mb-6`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className={`text-xs uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>ARBI Bot</div>
                <h2 className={`text-2xl font-semibold ${isLight ? "text-slate-900" : "text-cyan-100"} ${simSerif.className}`}>Arbitrage Intelligence</h2>
                <p className={`mt-1 text-sm ${isLight ? "text-slate-700" : "text-white/80"}`}>
                  ARBI scans cross-market dislocations and highlights potential spread opportunities.
                </p>
              </div>
              <Link
                href="/arbi-dashboard.html"
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                  isLight ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-blue-500/40 bg-blue-600/20 text-blue-300 hover:bg-blue-600/30"
                }`}
              >
                Open ARBI Dashboard →
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/12 bg-white/[0.03]"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Status</div>
                <div className={`mt-1 text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Online</div>
                <div className={`mt-1 text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>Ready to monitor spreads.</div>
              </div>
              <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/12 bg-white/[0.03]"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Universe</div>
                <div className={`mt-1 text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Stocks, ETFs, FX, Crypto</div>
                <div className={`mt-1 text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>Cross-asset dislocation search.</div>
              </div>
              <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/12 bg-white/[0.03]"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Mode</div>
                <div className={`mt-1 text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Watchlist</div>
                <div className={`mt-1 text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>Signal-only, no auto-execution.</div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Link
                href="/home"
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                  isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100" : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"
                }`}
              >
                Back Home
              </Link>
              <Link
                href="/arbi-dashboard.html"
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                  isLight ? "border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100" : "border-blue-500/40 bg-blue-600/20 text-blue-300 hover:bg-blue-600/30"
                }`}
              >
                Open ARBI Dashboard →
              </Link>
            </div>
          </section>
        )}

        {botMode === "quant" && (
        <>
        <div className={`mb-4 rounded-xl border overflow-hidden ${isAlerik ? "border-[#c9a84c]/24 bg-[#0c0b09]/92" : isLight ? "border-slate-200 bg-white/90" : "border-white/12 bg-[#0d1117]/90"}`}>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-black/5">
            <div className={`px-3 py-2 ${isLight ? "bg-white" : "bg-[#121821]"}`}>
              <div className={`text-[9px] tracking-[0.16em] uppercase ${isLight ? "text-slate-500" : "text-white/45"}`}>Portfolio</div>
              <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fmtMoney(portfolioTotal)}</div>
            </div>
            <div className={`px-3 py-2 ${isLight ? "bg-white" : "bg-[#121821]"}`}>
              <div className={`text-[9px] tracking-[0.16em] uppercase ${isLight ? "text-slate-500" : "text-white/45"}`}>Return</div>
              <div className={`text-sm font-semibold ${totalReturnPct >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtPct(totalReturnPct)}</div>
            </div>
            <div className={`px-3 py-2 ${isLight ? "bg-white" : "bg-[#121821]"}`}>
              <div className={`text-[9px] tracking-[0.16em] uppercase ${isLight ? "text-slate-500" : "text-white/45"}`}>Provider</div>
              <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-[#f0a500]"}`}>{agentProvider}</div>
            </div>
            <div className={`px-3 py-2 ${isLight ? "bg-white" : "bg-[#121821]"}`}>
              <div className={`text-[9px] tracking-[0.16em] uppercase ${isLight ? "text-slate-500" : "text-white/45"}`}>Scanned</div>
              <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{scannedInstruments}</div>
            </div>
            <div className={`px-3 py-2 ${isLight ? "bg-white" : "bg-[#121821]"}`}>
              <div className={`text-[9px] tracking-[0.16em] uppercase ${isLight ? "text-slate-500" : "text-white/45"}`}>Regime</div>
              <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-[#f0a500]"}`}>{agentRegime}</div>
            </div>
            <div className={`px-3 py-2 flex items-end justify-between ${isLight ? "bg-white" : "bg-[#121821]"}`}>
              <div>
                <div className={`text-[9px] tracking-[0.16em] uppercase ${isLight ? "text-slate-500" : "text-white/45"}`}>Confidence</div>
                <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{agentConfidence}%</div>
              </div>
              <span className={`h-2 w-2 rounded-full ${autoRunning ? "bg-amber-500 animate-pulse" : autoPilotEnabled ? "bg-emerald-500" : "bg-rose-500"}`} />
            </div>
          </div>
          {autoRunning && (
            <div className={`px-3 py-1.5 text-[10px] tracking-[0.12em] uppercase border-t ${isLight ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-[#f0a500]/10 text-[#f0a500] border-[#f0a500]/25"}`}>
              <div className="flex flex-wrap gap-3">
                <span>ASTRA analyzing</span>
                {THINK_STEPS.map((step, idx) => (
                  <span
                    key={step}
                    className={
                      idx < thinkStepIndex
                        ? isLight
                          ? "text-emerald-700"
                          : "text-emerald-400"
                        : idx === thinkStepIndex
                          ? isLight
                            ? "text-amber-800"
                            : "text-[#ffd277]"
                          : ""
                    }
                  >
                    {idx < thinkStepIndex ? "✓" : idx === thinkStepIndex ? "→" : "·"} {step}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={`mb-4 rounded-xl border overflow-hidden ${isAlerik ? "border-[#c9a84c]/24 bg-[#0c0b09]/92" : isLight ? "border-slate-200 bg-white/90" : "border-white/12 bg-[#0d1117]/90"}`}>
          <div className={`px-3 py-1 text-[10px] uppercase tracking-[0.18em] border-b ${isLight ? "text-slate-500 border-slate-200 bg-slate-50" : "text-white/60 border-white/10 bg-white/[0.03]"}`}>
            Live Ticker Tape
          </div>
          <div className="sim-ticker-tape">
            <div className="sim-ticker-track">
              {[...tickerTapeItems, ...tickerTapeItems].map((item, idx) => (
                <span key={`${item.symbol}-${idx}`} className="sim-ticker-chip">
                  <span className="font-semibold">{item.symbol}</span>
                  <span>{Number.isFinite(item.price) && item.price > 0 ? fmtMoney(item.price) : "—"}</span>
                  <span className={Number(item.pct || 0) >= 0 ? "text-emerald-500" : "text-rose-500"}>{fmtPct(item.pct)}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <section className={`${cardClass} mb-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={`text-xs uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Risk Profile</div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                  riskPolicy.level === "CONSERVATIVE"
                    ? isLight ? "border-blue-300 bg-blue-50 text-blue-700" : "border-blue-400/35 bg-blue-500/20 text-blue-200"
                    : riskPolicy.level === "AGGRESSIVE"
                      ? isLight ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-400/35 bg-rose-500/20 text-rose-200"
                      : isLight ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-400/35 bg-amber-500/20 text-amber-200"
                }`}>
                  {riskPolicy.level}
                </span>
                <span className={`text-xs ${isLight ? "text-slate-600" : "text-white/75"}`}>Target: {riskPolicy.target}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {["CONSERVATIVE", "MODERATE", "AGGRESSIVE", "CUSTOM"].map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setRiskLevel(lvl)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                    riskLevel === lvl ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"
                  }`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={`text-xs uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Trading Style</div>
              <div className={`text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>
                {tradingStyle === "day_trading" ? "Intraday active mode (5 min cycle)" : "Swing mode (session-to-session)"}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTradingStyle("day_trading")}
                className={`px-2.5 py-1.5 rounded-lg border text-xs ${tradingStyle === "day_trading" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
              >
                Day Trading
              </button>
              <button
                onClick={() => setTradingStyle("swing")}
                className={`px-2.5 py-1.5 rounded-lg border text-xs ${tradingStyle === "swing" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
              >
                Swing
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className={`text-xs uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Auto-Pilot Playbook</div>
              <div className={`text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>
                Preset strategy pack for risk, style, and execution guardrails.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(PLAYBOOKS).map(([key, pb]) => (
                <button
                  key={key}
                  onClick={() => applyPlaybookMode(key)}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs ${playbookMode === key ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                >
                  {pb.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="text-xs">
              <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Max Trades / Day</span>
              <input
                type="number"
                min="1"
                max="40"
                value={Number(guardrails.maxTradesPerDay || 8)}
                onChange={(e) => setGuardrails((prev) => ({ ...prev, maxTradesPerDay: Math.max(1, Math.min(40, Number(e.target.value || 8))) }))}
                className={`mt-1 w-full px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`}
              />
            </label>
            <label className="text-xs">
              <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Max Turnover / Day %</span>
              <input
                type="number"
                min="5"
                max="200"
                value={Number(guardrails.maxTurnoverPctPerDay || 40)}
                onChange={(e) => setGuardrails((prev) => ({ ...prev, maxTurnoverPctPerDay: Math.max(5, Math.min(200, Number(e.target.value || 40))) }))}
                className={`mt-1 w-full px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`}
              />
            </label>
            <label className="text-xs">
              <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Max Open Positions</span>
              <input
                type="number"
                min="1"
                max="30"
                value={Number(guardrails.maxConcurrentPositions || 10)}
                onChange={(e) => setGuardrails((prev) => ({ ...prev, maxConcurrentPositions: Math.max(1, Math.min(30, Number(e.target.value || 10))) }))}
                className={`mt-1 w-full px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`}
              />
            </label>
          </div>

          {riskLevel === "CUSTOM" && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
              <label className="text-xs">
                <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Max Position %</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={Math.round(Number(customRisk.maxPositionPct || 0.12) * 100)}
                  onChange={(e) => setCustomRisk((prev) => ({ ...prev, maxPositionPct: Number(e.target.value || 12) / 100 }))}
                  className={`mt-1 w-full px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`}
                />
              </label>
              <label className="text-xs">
                <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Max Crypto %</span>
                <input
                  type="number"
                  min="0"
                  max="30"
                  value={Math.round(Number(customRisk.maxCryptoPct || 0.1) * 100)}
                  onChange={(e) => setCustomRisk((prev) => ({ ...prev, maxCryptoPct: Number(e.target.value || 0) / 100 }))}
                  className={`mt-1 w-full px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`}
                />
              </label>
              <label className="text-xs">
                <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Min Cash %</span>
                <input
                  type="number"
                  min="2"
                  max="40"
                  value={Math.round(Number(customRisk.minCashReservePct || 0.1) * 100)}
                  onChange={(e) => setCustomRisk((prev) => ({ ...prev, minCashReservePct: Number(e.target.value || 10) / 100 }))}
                  className={`mt-1 w-full px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`}
                />
              </label>
              <label className="text-xs">
                <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Target Label</span>
                <input
                  value={String(customRisk.target || "Custom")}
                  onChange={(e) => setCustomRisk((prev) => ({ ...prev, target: e.target.value }))}
                  className={`mt-1 w-full px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`}
                />
              </label>
            </div>
          )}
        </section>

        {simTab === "manual" && (
        <section className={`${cardClass} mb-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className={`text-sm font-semibold ${isLight ? "text-slate-800" : "text-white/90"}`}>
              Manual Trading | ASTRA Auto-Pilot
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSimTab("manual")}
                className={`px-3 py-1.5 rounded-lg border text-xs ${simTab === "manual" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
              >
                Manual
              </button>
              <button
                onClick={() => setSimTab("autopilot")}
                className={`px-3 py-1.5 rounded-lg border text-xs ${simTab === "autopilot" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
              >
                Auto-Pilot
              </button>
              <button
                onClick={() => (autoPilotEnabled ? disableAutoPilot() : setShowEnableAutoModal(true))}
                className={`px-3 py-1.5 rounded-lg border text-xs font-semibold ${
                  autoPilotEnabled
                    ? isLight ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-400/35 bg-emerald-500/20 text-emerald-200"
                    : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"
                }`}
              >
                {autoPilotEnabled ? "Stop ASTRA Auto-Pilot" : "Start ASTRA Auto-Pilot"}
              </button>
            </div>
          </div>
          {autoPilotEnabled && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-2 ${isLight ? "border-blue-300 bg-blue-50 text-blue-800" : "border-cyan-400/30 bg-cyan-500/12 text-cyan-100"}`}>
              <span>ASTRA is managing your portfolio • Last action: {relativeTime(profile?.autoPilot?.lastActionAt)}</span>
              <span className={`rounded-full border px-2 py-0.5 ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>Risk: {riskPolicy.level}</span>
              <span className={`rounded-full border px-2 py-0.5 ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>Style: {tradingStyle === "day_trading" ? "DAY" : "SWING"}</span>
              <span className={`rounded-full border px-2 py-0.5 ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>Playbook: {PLAYBOOKS[playbookMode]?.label || "Balanced Growth"}</span>
              <span className={`rounded-full border px-2 py-0.5 ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>Daily kill: -{Number(riskExecutionPolicy?.dailyDrawdownKillPct || 4).toFixed(1)}%</span>
              <span className={`rounded-full border px-2 py-0.5 ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>Trailing stop: {(Number(riskExecutionPolicy?.trailingStopPct || 0.07) * 100).toFixed(1)}%</span>
              <button
                onClick={() => {
                  setSimTab("autopilot");
                  const el = document.getElementById("autopilot-log");
                  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={`px-2 py-1 rounded-md border ${isLight ? "border-blue-300 bg-white text-blue-700" : "border-cyan-300/35 bg-slate-900/40 text-cyan-100"}`}
              >
                View Latest Decision
              </button>
              {autoRunning && <span className="animate-pulse">Running now...</span>}
            </div>
          )}
          {autoMessage && (
            <div className={`mt-2 text-xs ${isLight ? "text-slate-700" : "text-white/80"}`}>{autoMessage}</div>
          )}
          {!autoPilotEnabled && profile?.autoPilot?.killSwitchReason && (
            <div className={`mt-2 text-xs ${isLight ? "text-rose-700" : "text-rose-200"}`}>{profile.autoPilot.killSwitchReason}</div>
          )}
        </section>
        )}

        {simTab === "autopilot" && (
          <section id="autopilot-log" className={`${cardClass} mb-6`}>
            <div className="mb-4">
              <AutopilotPanel
                portfolio={autopilotPanelPortfolio}
                riskProfile={String(riskLevel || "MODERATE").toLowerCase()}
                onUpdate={(snap) => {
                  if (!snap) return;
                  const total = Number(snap.totalValue || 0);
                  if (Number.isFinite(total) && total > 0) {
                    setAutoMessage(`V2 Autopilot update • Value: ${fmtMoney(total)} • Return: ${fmtPct(Number(snap.totalReturn || 0))}`);
                  }
                }}
              />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h2 className={`text-2xl font-semibold ${isLight ? "text-slate-900" : "text-white"} ${simSerif.className}`}>ASTRA Decision Log</h2>
                  <button
                    onClick={runAutoPilotCycle}
                    disabled={!autoPilotEnabled || autoRunning}
                    className={`px-3 py-1.5 rounded-lg border text-xs disabled:opacity-50 ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                  >
                    {autoRunning ? "Running..." : "Run Now"}
                  </button>
                </div>
                <div className="space-y-3">
                  <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className={`text-xs uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Agent Control Center</div>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/80"}`}>
                        {String(profile?.autoPilot?.agentState?.cycleStatus || "monitoring").toUpperCase()}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Regime: <span className="font-semibold">{profile?.autoPilot?.agentState?.regime || "unknown"}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Provider: <span className="font-semibold">{["QUANT_LAB", "fallback"].includes(String(profile?.autoPilot?.agentState?.provider || "")) ? String(profile?.autoPilot?.agentState?.provider) : "fallback"}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Scanned: <span className="font-semibold">{Number(profile?.autoPilot?.agentState?.scannedInstruments || 0)}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Confidence: <span className="font-semibold">{Number(profile?.autoPilot?.agentState?.confidence || 0)}%</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Buys: <span className="font-semibold">{Number(profile?.autoPilot?.agentState?.buyCount || 0)}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Sells: <span className="font-semibold">{Number(profile?.autoPilot?.agentState?.sellCount || 0)}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Holds: <span className="font-semibold">{Number(profile?.autoPilot?.agentState?.holdCount || 0)}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>High Risk: <span className="font-semibold">{Number(profile?.autoPilot?.agentState?.highRiskCount || 0)}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Daily DD: <span className={`font-semibold ${dailyDrawdownPct <= 0 ? "text-rose-500" : "text-emerald-500"}`}>{fmtPct(dailyDrawdownPct)}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Kill Limit: <span className="font-semibold">-{Number(riskExecutionPolicy?.dailyDrawdownKillPct || 4).toFixed(1)}%</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Trades Today: <span className="font-semibold">{Number(profile?.autoPilot?.guardrails?.tradesToday || 0)}/{Number(guardrails?.maxTradesPerDay || 8)}</span></div>
                      <div className={`${isLight ? "text-slate-700" : "text-white/80"}`}>Turnover Today: <span className="font-semibold">{fmtMoney(Number(profile?.autoPilot?.guardrails?.turnoverToday || 0))}</span></div>
                    </div>
                    <div className={`mt-2 text-xs ${isLight ? "text-slate-700" : "text-white/80"}`}>{profile?.autoPilot?.runSummary || "ASTRA will generate a mission summary after the next run."}</div>
                    <div className="mt-2">
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Execution Plan</div>
                      <div className="mt-1 space-y-1.5">
                        {(profile?.autoPilot?.executionPlan || []).slice(0, 4).map((step, idx) => (
                          <div key={`${step?.task || "task"}-${idx}`} className={`rounded-md border px-2 py-2 text-xs ${isLight ? "border-slate-200 bg-white text-slate-700" : "border-white/10 bg-white/5 text-white/80"}`}>
                            <div className="flex items-start gap-2">
                              <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                                isLight ? "border border-slate-300 bg-slate-50 text-slate-700" : "border border-[#f0a500]/35 bg-[#f0a500]/15 text-[#f0a500]"
                              }`}>
                                {Number(step?.step || idx + 1)}
                              </span>
                              <div className="min-w-0">
                                <div className="font-semibold tracking-wide">{step?.task || "Monitor market"}</div>
                                <div className={`${isLight ? "text-slate-600" : "text-white/70"}`}>{step?.reason || "No reason provided."}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                        {(profile?.autoPilot?.executionPlan || []).length === 0 && (
                          <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Execution plan will appear after the next run.</div>
                        )}
                      </div>
                    </div>
                  </div>
                  {(profile?.autoPilot?.decisionLog || []).slice(0, 30).map((d) => (
                    <article key={d.id} className={`sim-decision sim-decision-${String(d.action || "HOLD").toLowerCase()} rounded-lg border p-3 ${
                      d.action === "BUY"
                        ? isLight ? "border-emerald-200 bg-white" : "border-emerald-400/20 bg-white/[0.03]"
                        : d.action === "SELL"
                          ? isLight ? "border-rose-200 bg-white" : "border-rose-400/20 bg-white/[0.03]"
                          : isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"
                    }`}>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                          d.action === "BUY"
                            ? isLight ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-400/35 bg-emerald-500/20 text-emerald-200"
                            : d.action === "SELL"
                              ? isLight ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-400/35 bg-rose-500/20 text-rose-200"
                              : isLight ? "border-slate-300 bg-slate-100 text-slate-700" : "border-white/20 bg-white/10 text-white/80"
                        }`}>
                          {d.action}
                        </span>
                        <span className={`font-semibold text-lg leading-none ${simSerif.className}`}>{d.symbol}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold border ${isLight ? getStrategyBadge(d.strategy).light : getStrategyBadge(d.strategy).dark}`}>{getStrategyBadge(d.strategy).label}</span>
                        <span className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>{new Date(Number(d.ts)).toLocaleString()}</span>
                      </div>
                      <div className={`text-sm ${isLight ? "text-slate-700" : "text-white/85"}`}>
                        ASTRA {d.action} {Number(d.shares || 0).toFixed(normalizeAssetType(d.assetType) === "crypto" ? 6 : 3)} {normalizeAssetType(d.assetType) === "crypto" ? d.symbol : "shares"} at {fmtMoney(d.price)}.
                      </div>
                      {(d.entryPrice || d.stopLoss || d.takeProfit || d.holdDays) && (
                        <div className={`mt-1 text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>
                          Stop: {fmtMoney(d.stopLoss)} | Target: {fmtMoney(d.takeProfit)} | Hold: {Number(d.holdDays || 0)} days
                        </div>
                      )}
                      {Number.isFinite(Number(d.score)) && (
                        <div className="mt-2">
                          <div className={`flex items-center justify-between text-[11px] ${isLight ? "text-slate-600" : "text-white/65"}`}>
                            <span>QUANT score</span>
                            <span className={`font-semibold ${isLight ? "text-slate-800" : "text-white"}`}>{Number(d.score)}/100</span>
                          </div>
                          <div className={`mt-1 h-1.5 rounded-full overflow-hidden ${isLight ? "bg-slate-200" : "bg-white/10"}`}>
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${Math.max(2, Math.min(100, Number(d.score)))}%`,
                                background:
                                  Number(d.score) >= 80
                                    ? "#f0a500"
                                    : Number(d.score) >= 65
                                      ? "#22c55e"
                                      : Number(d.score) >= 45
                                        ? "#f59e0b"
                                        : "#ef4444",
                              }}
                            />
                          </div>
                        </div>
                      )}
                      <div className={`mt-1 text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>
                        {d.reasoning}
                      </div>
                      <div className={`mt-2 grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[11px] ${isLight ? "text-slate-700" : "text-white/75"}`}>
                        <div className={`rounded-md border px-2 py-1 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/5"}`}>
                          <div className={`text-[10px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/55"}`}>Why Now</div>
                          <div>{d.whyNow || d.reasoning}</div>
                        </div>
                        <div className={`rounded-md border px-2 py-1 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/5"}`}>
                          <div className={`text-[10px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/55"}`}>Sizing Logic</div>
                          <div>{d.sizeWhy || "Sized under active risk profile and guardrails."}</div>
                        </div>
                        <div className={`rounded-md border px-2 py-1 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/5"}`}>
                          <div className={`text-[10px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/55"}`}>Invalidation</div>
                          <div>{d.invalidation || "Invalidates if thesis weakens materially."}</div>
                        </div>
                        <div className={`rounded-md border px-2 py-1 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/5"}`}>
                          <div className={`text-[10px] uppercase tracking-wide ${isAlerik ? "text-[#c9a84c]/70" : isLight ? "text-slate-500" : "text-white/55"}`}>Expected Hold</div>
                          <div>{d.expectedHold || "Monitor until risk/reward shifts."}</div>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-1.5 text-[11px]">
                        <span className={`rounded-full border px-2 py-0.5 ${isLight ? "border-slate-300 bg-slate-50 text-slate-700" : "border-white/20 bg-white/10 text-white/80"}`}>
                          Confidence: {Number(d.confidence || 0)}%
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 ${
                          d.risk === "LOW"
                            ? isLight ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-400/30 bg-emerald-500/20 text-emerald-200"
                            : d.risk === "HIGH"
                              ? isLight ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-400/30 bg-rose-500/20 text-rose-200"
                              : isLight ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-400/30 bg-amber-500/20 text-amber-200"
                        }`}>
                          Risk: {d.risk}
                        </span>
                        <div>
                          <button
                            onClick={() => setExpandedDecisionId((prev) => (prev === d.id ? "" : d.id))}
                            className={`px-2 py-0.5 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}
                          >
                            {expandedDecisionId === d.id ? "Hide" : "Expand"}
                          </button>
                        </div>
                      </div>
                      <div className="mt-2">
                        <div className={`flex items-center justify-between text-[11px] ${isLight ? "text-slate-600" : "text-white/65"}`}>
                          <span>Confidence Breakdown</span>
                          <span className="font-semibold">
                            Q {Math.round((Number(d.score || 0) * 0.5))}% · R {Math.round((Number(d.confidence || 0) * 0.3))}% · G {Math.round((Number(d.confidence || 0) * 0.2))}%
                          </span>
                        </div>
                        <div className={`mt-1 h-1.5 rounded-full overflow-hidden ${isLight ? "bg-slate-200" : "bg-white/10"}`}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(4, Math.min(100, Math.round(Number(d.confidence || 0))))}%`,
                              background: Number(d.confidence || 0) >= 75 ? "#22c55e" : Number(d.confidence || 0) >= 55 ? "#f59e0b" : "#ef4444",
                            }}
                          />
                        </div>
                      </div>
                      <div className={`mt-2 text-xs ${isLight ? "text-indigo-700" : "text-cyan-100"}`}>💡 Lesson: {d.lesson}</div>
                      {expandedDecisionId === d.id && (
                        <div className={`mt-2 rounded-md border px-2.5 py-2 text-xs ${isLight ? "border-slate-200 bg-slate-50 text-slate-700" : "border-white/10 bg-white/[0.02] text-white/75"}`}>
                          ASTRA applied position sizing, volatility-aware risk limits, and thesis validation before this action.
                          <div className="mt-1">
                            ASTRA just used a concept you can learn more about →{" "}
                            <Link href="/market-school" className="underline font-semibold">Market School</Link>
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                  {(profile?.autoPilot?.decisionLog || []).length === 0 && (
                    <div className={`text-sm ${isLight ? "text-slate-600" : "text-white/70"}`}>
                      No auto-pilot decisions yet. Enable Auto-Pilot to start ASTRA-managed trading.
                    </div>
                  )}
                </div>
              </div>
              <aside className={`rounded-lg border p-3 h-fit ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.03]"}`}>
                <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>What ASTRA is watching</div>
                <div className="mt-2 space-y-2">
                  {(profile?.autoPilot?.watchlist || []).slice(0, 3).map((w) => (
                    <div key={w.symbol} className={`rounded-md border px-2 py-1.5 text-xs ${isLight ? "border-slate-200 bg-white text-slate-700" : "border-white/10 bg-white/5 text-white/80"}`}>
                      <div className="font-semibold">{w.symbol}</div>
                      <div className={`${Number(w.percentChange) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtPct(w.percentChange)}</div>
                    </div>
                  ))}
                  {(!profile?.autoPilot?.watchlist || profile.autoPilot.watchlist.length === 0) && (
                    <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Watchlist will update after next decision cycle.</div>
                  )}
                </div>
                <div className={`mt-3 text-xs ${isLight ? "text-slate-700" : "text-white/80"}`}>Portfolio risk score: <span className="font-semibold">{portfolioRiskScore}</span></div>
                <div className={`mt-2 text-xs ${isLight ? "text-slate-700" : "text-white/80"}`}>{profile?.autoPilot?.outlook || "ASTRA outlook will populate after first decision run."}</div>
                <div className={`mt-2 text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Next scheduled decision: {profile?.autoPilot?.nextDecisionAt ? new Date(Number(profile.autoPilot.nextDecisionAt)).toLocaleString() : "Not scheduled"}</div>

                <div className={`mt-3 rounded-md border p-2.5 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.02]"}`}>
                  <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>ASTRA Analysis Panel</div>
                  {latestDecisionResearch ? (
                    <div className="mt-2 space-y-2 text-xs">
                      <div className={isLight ? "text-slate-700" : "text-white/80"}>{latestDecisionResearch.summary}</div>
                      <div className="rounded-md border border-emerald-300/40 bg-emerald-500/10 px-2 py-1.5">
                        <div className="font-semibold text-emerald-500">Bull Thesis</div>
                        <div className={isLight ? "text-slate-700" : "text-white/80"}>{latestDecisionResearch.bull}</div>
                      </div>
                      <div className="rounded-md border border-rose-300/40 bg-rose-500/10 px-2 py-1.5">
                        <div className="font-semibold text-rose-500">Bear Thesis</div>
                        <div className={isLight ? "text-slate-700" : "text-white/80"}>{latestDecisionResearch.bear}</div>
                      </div>
                      <div>
                        <div className={`flex items-center justify-between text-[11px] ${isLight ? "text-slate-600" : "text-white/65"}`}>
                          <span>Risk score</span>
                          <span className="font-semibold">{latestDecisionResearch.riskScore}/100</span>
                        </div>
                        <div className={`mt-1 h-1.5 rounded-full overflow-hidden ${isLight ? "bg-slate-200" : "bg-white/10"}`}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(3, Math.min(100, latestDecisionResearch.riskScore))}%`,
                              background: latestDecisionResearch.riskScore >= 70 ? "#ef4444" : latestDecisionResearch.riskScore >= 45 ? "#f59e0b" : "#22c55e",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={`mt-2 text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Run Auto-Pilot to generate ASTRA research context.</div>
                  )}
                </div>

                <div className={`mt-3 rounded-md border p-2.5 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.02]"}`}>
                  <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-white/60"}`}>Ask ASTRA</div>
                  <div className="mt-2 max-h-44 overflow-y-auto space-y-1 pr-1">
                    {askMessages.slice(-8).map((m, idx) => (
                      <div
                        key={`ask-${idx}`}
                        className={`rounded-md border px-2 py-1.5 text-xs ${
                          m.role === "user"
                            ? isLight
                              ? "border-blue-300 bg-blue-50 text-blue-800"
                              : "border-blue-400/35 bg-blue-500/15 text-blue-100"
                            : isLight
                              ? "border-slate-200 bg-slate-50 text-slate-700"
                              : "border-white/10 bg-white/[0.03] text-white/80"
                        }`}
                      >
                        {m.text}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[
                      `What is the key risk in ${selectedTicker || "SPY"} today?`,
                      "Should I reduce concentration risk?",
                      "Summarize my current portfolio in 3 bullets.",
                    ].map((q) => (
                      <button
                        key={q}
                        onClick={() => askAstra(q)}
                        className={`rounded-md border px-2 py-1 text-[10px] ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/80"}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-1.5">
                    <input
                      value={askInput}
                      onChange={(e) => setAskInput(e.target.value)}
                      placeholder="Ask ASTRA..."
                      className={`w-full rounded-md border px-2 py-1.5 text-xs ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`}
                    />
                    <button
                      onClick={() => askAstra(askInput)}
                      disabled={askLoading}
                      className="rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-2.5 py-1.5 disabled:opacity-50"
                    >
                      {askLoading ? "..." : "Ask"}
                    </button>
                  </div>
                </div>
              </aside>
            </div>
          </section>
        )}

        <section className={`${cardClass} mb-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className={`text-3xl font-bold ${isLight ? "text-slate-900" : "text-cyan-100"}`}>Simulator Portfolio</h1>
              <p className={`text-sm mt-1 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                Virtual cash only. Execute trades at live/last-close prices.
              </p>
            </div>
            <button
              onClick={resetPortfolio}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight ? "border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100" : "border-rose-400/35 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
              }`}
            >
              Reset Portfolio
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-8 gap-3">
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Total Value</div>
              <div className="text-lg font-semibold">{fmtMoney(portfolioTotal)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Starting Value</div>
              <div className="text-lg font-semibold">{fmtMoney(profile.startingCash || STARTING_CASH)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Total Return</div>
              <div className={`text-lg font-semibold ${totalReturnDollar >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                {fmtMoney(totalReturnDollar)} ({fmtPct(totalReturnPct)})
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Daily Change</div>
              <div className={`text-lg font-semibold ${dailyChangeDollar >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                {fmtMoney(dailyChangeDollar)} ({fmtPct(dailyChangePct)})
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Rank Badge</div>
              <div className="text-lg font-semibold">{rankBadge(selfRank)} #{selfRank}</div>
              {isCryptoTrader && <div className="text-[11px] mt-1 text-violet-500 font-semibold">Crypto Trader</div>}
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Unrealized P&L</div>
              <div className={`text-lg font-semibold ${unrealizedPnL >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                {fmtMoney(unrealizedPnL)}
              </div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>ASTRA Risk Score</div>
              <div className="text-lg font-semibold">{portfolioRiskScore}</div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Stocks Value</div>
              <div className="text-lg font-semibold">{fmtMoney(holdingsBreakdown.stocks)}</div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Crypto Value</div>
              <div className="text-lg font-semibold">{fmtMoney(holdingsBreakdown.crypto)}</div>
            </div>
          </div>
          {!nyse.open && selectedAssetType === "stock" && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-400/35 bg-amber-500/15 text-amber-200"}`}>
              Market Closed - trades execute at open (using latest close estimate in simulator).
            </div>
          )}
          {selectedAssetType === "crypto" && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-cyan-300 bg-cyan-50 text-cyan-700" : "border-cyan-400/35 bg-cyan-500/15 text-cyan-200"}`}>
              Crypto markets never close. Quotes refresh every 30 seconds.
            </div>
          )}
          {lastOvernightDelta != null && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/80"}`}>
              Daily login bonus: Overnight portfolio change was {fmtMoney(lastOvernightDelta)}.
            </div>
          )}
        </section>

        <section className={`${cardClass} mb-6`}>
          <h2 className={`text-2xl font-semibold mb-3 ${isLight ? "text-slate-900" : "text-white"} ${simSerif.className}`}>Portfolio Holdings</h2>
          {holdingsArray.length === 0 ? (
            <div className={`text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>You have {fmtMoney(profile.cash)} ready to invest.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className={isLight ? "text-slate-500" : "text-white/60"}>
                  <tr className={isLight ? "border-b border-slate-200 text-left" : "border-b border-white/10 text-left"}>
                    <th className="py-2 pr-2">Ticker</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Company</th>
                    <th className="py-2 pr-2">Shares</th>
                    <th className="py-2 pr-2">Avg Buy</th>
                    <th className="py-2 pr-2">Current</th>
                    <th className="py-2 pr-2">Total Value</th>
                    <th className="py-2 pr-2">Gain/Loss</th>
                    <th className="py-2 pr-2">Risk Meter</th>
                    <th className="py-2 pr-2">Deep Research</th>
                    <th className="py-2 pr-2">Sell</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingsArray.map((h) => {
                    const q = quoteFor(h.assetType, h.symbol);
                    const px = Number.isFinite(Number(q?.price)) ? Number(q.price) : Number(h.avgBuy || 0);
                    const total = px * h.shares;
                    const cost = Number(h.avgBuy || 0) * h.shares;
                    const pnl = total - cost;
                    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                    const weightPct = portfolioTotal > 0 ? (total / portfolioTotal) * 100 : 0;
                    const stopLoss = Number(h?.stopLoss || 0);
                    const stopDistancePct = Number.isFinite(stopLoss) && stopLoss > 0 && px > 0 ? Math.max(0, (1 - stopLoss / px) * 100) : 8;
                    const positionRisk = Math.max(4, Math.min(100, Math.round(stopDistancePct * 5 + weightPct * 1.2)));
                    return (
                      <tr key={holdingKey(h.assetType, h.symbol)} className={isLight ? "border-b border-slate-100" : "border-b border-white/5"}>
                        <td className="py-2 pr-2 font-semibold">{h.symbol}</td>
                        <td className="py-2 pr-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              h.assetType === "crypto"
                                ? isLight
                                  ? "border-violet-300 bg-violet-50 text-violet-700"
                                  : "border-violet-400/35 bg-violet-500/20 text-violet-200"
                                : isLight
                                  ? "border-blue-300 bg-blue-50 text-blue-700"
                                  : "border-blue-400/35 bg-blue-500/20 text-blue-200"
                            }`}
                          >
                            {h.assetType === "crypto" ? "CRYPTO" : "STOCK"}
                          </span>
                        </td>
                        <td className={`py-2 pr-2 ${isLight ? "text-slate-700" : "text-white/80"}`}>{h.name || h.symbol}</td>
                        <td className="py-2 pr-2">
                          {h.assetType === "crypto" ? `${h.shares.toFixed(6)} ${h.symbol}` : h.shares.toFixed(4)}
                        </td>
                        <td className="py-2 pr-2">{fmtMoney(h.avgBuy)}</td>
                        <td className="py-2 pr-2">{fmtMoney(px)}</td>
                        <td className="py-2 pr-2">{fmtMoney(total)}</td>
                        <td className={`py-2 pr-2 ${pnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          {fmtMoney(pnl)} ({fmtPct(pnlPct)})
                        </td>
                        <td className="py-2 pr-2 min-w-[160px]">
                          <div className={`text-[10px] mb-1 ${isLight ? "text-slate-600" : "text-white/65"}`}>
                            {positionRisk}/100 • wt {weightPct.toFixed(1)}%
                          </div>
                          <div className={`h-1.5 rounded-full overflow-hidden ${isLight ? "bg-slate-200" : "bg-white/10"}`}>
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${positionRisk}%`,
                                background: positionRisk >= 70 ? "#ef4444" : positionRisk >= 45 ? "#f59e0b" : "#22c55e",
                              }}
                            />
                          </div>
                        </td>
                        <td className="py-2 pr-2">
                          <button
                            onClick={() => runDeepResearch(h.symbol, "full")}
                            className={isLight ? "px-2 py-1 rounded-md text-[11px] border border-indigo-300 bg-indigo-50 text-indigo-700" : "px-2 py-1 rounded-md text-[11px] border border-indigo-400/35 bg-indigo-500/20 text-indigo-200"}
                          >
                            {deepResearchLoading && deepResearchTicker === h.symbol ? "Researching..." : "Deep Research"}
                          </button>
                        </td>
                        <td className="py-2 pr-2">
                          <button
                            onClick={() => {
                              setTradeMode("SELL");
                              setSelectedAssetType(h.assetType === "crypto" ? "crypto" : "stock");
                              setSelectedTicker(h.symbol);
                              setSelectedCryptoId(String(h.cryptoId || CRYPTO_SYMBOL_TO_ID[h.symbol] || ""));
                              setShareInput(String(Math.min(1, h.shares)));
                              setTradeInputMode(h.assetType === "crypto" ? "dollars" : "shares");
                            }}
                            className={`px-2 py-1 rounded-md text-[11px] border ${
                              isLight ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-400/35 bg-rose-500/20 text-rose-200"
                            }`}
                          >
                            Sell
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className={`mt-3 text-sm ${isLight ? "text-slate-700" : "text-white/85"}`}>Cash Remaining: <span className="font-semibold">{fmtMoney(profile.cash)}</span></div>
        </section>

        <section className={`${cardClass} mb-6 sim-trade-shell`}>
          <h2 className={`text-2xl font-semibold mb-3 ${isLight ? "text-slate-900" : "text-white"} ${simSerif.className}`}>Trade</h2>
          <div className={`mb-2 text-[11px] ${isLight ? "text-slate-600" : "text-white/65"}`}>
            Manual execution desk • Live quote, order sizing, and risk checks before submit.
          </div>
          <div className={`mb-3 inline-flex rounded-lg overflow-hidden border ${isLight ? "border-slate-300" : "border-white/15"}`}>
            <button
              onClick={() => {
                setSelectedAssetType("stock");
                setSelectedTicker("AAPL");
                setSelectedCryptoId("");
                setTradeInputMode("shares");
              }}
              className={`px-3 py-1.5 text-xs ${selectedAssetType === "stock" ? "bg-blue-600 text-white" : isLight ? "bg-white text-slate-700" : "bg-white/10 text-white/85"}`}
            >
              Stocks
            </button>
            <button
              onClick={() => {
                setSelectedAssetType("crypto");
                setSelectedTicker("BTC");
                setSelectedCryptoId("bitcoin");
                setTradeInputMode("dollars");
              }}
              disabled={!riskPolicy.allowCrypto}
              className={`px-3 py-1.5 text-xs ${selectedAssetType === "crypto" ? "bg-blue-600 text-white" : isLight ? "bg-white text-slate-700" : "bg-white/10 text-white/85"}`}
            >
              Crypto
            </button>
          </div>
          <div className={`mb-3 rounded-lg border px-3 py-2 text-[11px] ${isLight ? "border-slate-200 bg-slate-50 text-slate-600" : "border-white/10 bg-white/[0.03] text-white/70"}`}>
            Cash: <span className="font-semibold">{fmtMoney(profile.cash)}</span> • Asset: <span className="font-semibold uppercase">{selectedAssetType}</span> • Mode: <span className="font-semibold uppercase">{tradeInputMode === "dollars" ? "Dollar Notional" : "Units"}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  value={selectedTicker}
                  onChange={(e) => setSelectedTicker(e.target.value.toUpperCase())}
                  placeholder={selectedAssetType === "crypto" ? "Crypto (BTC, ETH, SOL...)" : "Ticker (AAPL)"}
                  className={`px-3 py-2 rounded-lg border text-sm outline-none ${
                    isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"
                  }`}
                />
                {selectedAssetType === "crypto" && (
                  <select
                    value={selectedCryptoId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedCryptoId(id);
                      const match = CRYPTO_OPTIONS.find((c) => c.id === id);
                      if (match) setSelectedTicker(match.symbol);
                    }}
                    className={`px-3 py-2 rounded-lg border text-xs ${
                      isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"
                    }`}
                  >
                    <option value="">Popular crypto</option>
                    {CRYPTO_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.symbol} - {opt.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => refreshQuoteFor(selectedTicker, selectedAssetType, selectedCryptoId)}
                  className={`px-3 py-2 rounded-lg border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                >
                  Refresh Price
                </button>
                <button
                  onClick={() => setTradeMode("BUY")}
                  className={`px-3 py-2 rounded-lg border text-xs ${tradeMode === "BUY" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                >
                  Buy
                </button>
                <button
                  onClick={() => setTradeMode("SELL")}
                  className={`px-3 py-2 rounded-lg border text-xs ${tradeMode === "SELL" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                >
                  Sell
                </button>
              </div>
              <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.03]"}`}>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <div className="font-semibold">{selectedTicker || "—"} {selectedCompany ? `• ${selectedCompany}` : ""}</div>
                  <div className={`${simSerif.className} text-lg`}>{fmtMoney(selectedPrice)}</div>
                  <div className={`${Number(selectedQuote?.percentChange) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtPct(selectedQuote?.percentChange)}</div>
                </div>
                {selectedAssetType === "crypto" && (
                  <div className={`mb-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs ${isLight ? "text-slate-600" : "text-white/75"}`}>
                    <div>24h High: <span className="font-semibold">{fmtMoney(selectedQuote?.high)}</span></div>
                    <div>24h Low: <span className="font-semibold">{fmtMoney(selectedQuote?.low)}</span></div>
                    <div>24h Vol: <span className="font-semibold">{fmtMoney(selectedQuote?.volume)}</span></div>
                    <div>Mkt Cap: <span className="font-semibold">{fmtMoney(selectedQuote?.marketCap)}</span></div>
                  </div>
                )}
                <div className={`h-[72px] rounded-md border p-1 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-slate-900/50"}`}>
                  {miniPoints.length >= 2 ? (
                    <svg viewBox="0 0 260 70" className="h-full w-full">
                      <polyline
                        fill="none"
                        stroke={miniPoints[miniPoints.length - 1]?.value >= miniPoints[0]?.value ? "#22c55e" : "#ef4444"}
                        strokeWidth="2"
                        strokeLinecap="round"
                        points={toPolyline(miniPoints.map((p) => ({ ts: p.ts, value: p.value })), 260, 70, 3)}
                      />
                    </svg>
                  ) : (
                    <div className={`h-full w-full text-xs flex items-center justify-center ${isLight ? "text-slate-500" : "text-white/60"}`}>1D chart unavailable</div>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className={`text-[11px] mb-1 ${isLight ? "text-slate-500" : "text-white/60"}`}>Input Mode</div>
                  <div className="flex gap-2">
                    <button onClick={() => setTradeInputMode("shares")} className={`px-2.5 py-1.5 rounded-md text-xs border ${tradeInputMode === "shares" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}>{selectedAssetType === "crypto" ? "Coin Units" : "Shares"}</button>
                    <button onClick={() => setTradeInputMode("dollars")} className={`px-2.5 py-1.5 rounded-md text-xs border ${tradeInputMode === "dollars" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}>Dollar Amount</button>
                  </div>
                  {tradeInputMode === "shares" ? (
                    <input value={shareInput} onChange={(e) => setShareInput(e.target.value)} className={`mt-2 w-full px-3 py-2 rounded-lg border text-sm ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`} />
                  ) : (
                    <input value={dollarInput} onChange={(e) => setDollarInput(e.target.value)} className={`mt-2 w-full px-3 py-2 rounded-lg border text-sm ${isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"}`} />
                  )}
                </div>
                <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Estimated Cost</div>
                  <div className="text-lg font-semibold">{fmtMoney(estimatedTradeValue)}</div>
                  {selectedAssetType === "crypto" && (
                    <div className={`text-[11px] mt-1 ${isLight ? "text-slate-500" : "text-white/60"}`}>
                      {sharesFromInput.toFixed(6)} {selectedTicker || "COIN"} = {fmtMoney(estimatedTradeValue)}
                    </div>
                  )}
                  <div className={`text-[11px] mt-1 ${isLight ? "text-slate-500" : "text-white/60"}`}>Cash After Trade</div>
                  <div className={`text-sm font-semibold ${cashAfterTrade >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtMoney(cashAfterTrade)}</div>
                  <button
                    onClick={executeTrade}
                    disabled={submittingTrade || Boolean(tradeError)}
                    className="mt-3 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {submittingTrade ? "Executing..." : `Confirm ${tradeMode}`}
                  </button>
                </div>
              </div>
              {tradeError && <div className={`mt-2 text-xs ${isLight ? "text-rose-600" : "text-rose-300"}`}>{tradeError}</div>}
              {tradeMessage && <div className={`mt-2 text-xs ${isLight ? "text-slate-700" : "text-white/80"}`}>{tradeMessage}</div>}
              {astraOpinion && (
                <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-cyan-400/30 bg-cyan-500/10 text-cyan-100"}`}>
                  ASTRA says: {astraOpinion}
                </div>
              )}
              {cryptoLessonNotice && (
                <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-violet-300 bg-violet-50 text-violet-700" : "border-violet-400/35 bg-violet-500/15 text-violet-200"}`}>
                  {cryptoLessonNotice}
                </div>
              )}
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-white/60"}`}>Achievement Badges</div>
              <div className="space-y-2">
                {achievements.map((a) => (
                  <div key={a.key} className={`rounded-md border px-2.5 py-2 text-xs flex items-center justify-between ${
                    a.unlocked
                      ? isLight ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-400/30 bg-emerald-500/15 text-emerald-200"
                      : isLight ? "border-slate-200 bg-white text-slate-500" : "border-white/10 bg-white/5 text-white/50"
                  }`}>
                    <span>{a.label}</span>
                    <span>{a.unlocked ? "Unlocked" : "Locked"}</span>
                  </div>
                ))}
              </div>
              <div className={`mt-3 text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>
                Weekly summary: Portfolio {fmtPct(portfolioReturnFor(7))} vs S&P 500 {fmtPct(spyReturnFor(7))}.
              </div>

              <div className={`mt-3 rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
                <div className={`text-[11px] uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-white/60"}`}>Price Alerts</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  <input
                    value={alertSymbolInput}
                    onChange={(e) => setAlertSymbolInput(e.target.value.toUpperCase())}
                    placeholder="Ticker"
                    className={`px-2 py-1.5 rounded-md border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white"}`}
                  />
                  <select
                    value={alertDirection}
                    onChange={(e) => setAlertDirection(e.target.value)}
                    className={`px-2 py-1.5 rounded-md border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white"}`}
                  >
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                  </select>
                  <input
                    value={alertTargetInput}
                    onChange={(e) => setAlertTargetInput(e.target.value)}
                    placeholder="Target price"
                    className={`px-2 py-1.5 rounded-md border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white"}`}
                  />
                </div>
                <button onClick={addPriceAlert} className="mt-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-2.5 py-1.5">
                  Add Alert
                </button>
                <div className="mt-2 space-y-1 max-h-28 overflow-y-auto pr-1">
                  {(profile.priceAlerts || []).slice(0, 8).map((a) => (
                    <div key={a.id} className={`rounded-md border px-2 py-1 text-[11px] flex items-center justify-between ${isLight ? "border-slate-200 bg-slate-50 text-slate-700" : "border-white/10 bg-white/[0.02] text-white/80"}`}>
                      <span>{a.symbol} {a.direction === "below" ? "≤" : "≥"} {fmtMoney(a.target)}</span>
                      <span className={a.triggeredAt ? "text-amber-500" : a.active ? "text-emerald-500" : "text-slate-500"}>
                        {a.triggeredAt ? "hit" : a.active ? "active" : "off"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className={`mt-3 rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
                <div className={`text-[11px] uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-white/60"}`}>Dollar-Cost Averaging</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  <input
                    value={dcaSymbolInput}
                    onChange={(e) => setDcaSymbolInput(e.target.value.toUpperCase())}
                    placeholder="Ticker"
                    className={`px-2 py-1.5 rounded-md border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white"}`}
                  />
                  <input
                    value={dcaAmountInput}
                    onChange={(e) => setDcaAmountInput(e.target.value)}
                    placeholder="USD amount"
                    className={`px-2 py-1.5 rounded-md border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white"}`}
                  />
                  <select
                    value={dcaInterval}
                    onChange={(e) => setDcaInterval(e.target.value)}
                    className={`px-2 py-1.5 rounded-md border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white"}`}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <button onClick={addDcaPlan} className="mt-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold px-2.5 py-1.5">
                  Add DCA Plan
                </button>
                <div className="mt-2 space-y-1 max-h-28 overflow-y-auto pr-1">
                  {(profile.dcaPlans || []).slice(0, 8).map((p) => (
                    <div key={p.id} className={`rounded-md border px-2 py-1 text-[11px] flex items-center justify-between ${isLight ? "border-slate-200 bg-slate-50 text-slate-700" : "border-white/10 bg-white/[0.02] text-white/80"}`}>
                      <span>{p.symbol} • {fmtMoney(p.amountUsd)} • {p.interval}</span>
                      <span className={p.active ? "text-emerald-500" : "text-slate-500"}>
                        {p.active ? "active" : "off"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={`${cardClass} mb-6`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className={`text-2xl font-semibold ${isLight ? "text-slate-900" : "text-white"} ${simSerif.className}`}>Performance</h2>
            <div className="flex gap-2">
              {CHART_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setChartRange(f.key)}
                  className={`px-2.5 py-1 rounded-md text-xs border ${chartRange === f.key ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className={`rounded-lg border p-2 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-slate-900/50"}`}>
            <svg
              viewBox="0 0 820 240"
              className="w-full h-[240px]"
              onMouseMove={(e) => {
                if (!portfolioLinePoints.length) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * chartW;
                const minTs = Math.min(...portfolioLinePoints.map((x) => Number(x.ts)));
                const maxTs = Math.max(...portfolioLinePoints.map((x) => Number(x.ts)));
                const tSpan = Math.max(1, maxTs - minTs);
                const ts = minTs + ((relX - chartPad) / Math.max(1, chartW - chartPad * 2)) * tSpan;
                let nearest = 0;
                let best = Number.POSITIVE_INFINITY;
                for (let i = 0; i < portfolioLinePoints.length; i += 1) {
                  const d = Math.abs(Number(portfolioLinePoints[i].ts) - ts);
                  if (d < best) {
                    best = d;
                    nearest = i;
                  }
                }
                setChartHoverIndex(nearest);
              }}
              onMouseLeave={() => setChartHoverIndex(null)}
            >
              {[0, 1, 2, 3, 4].map((tick) => {
                const y = chartPad + ((chartH - chartPad * 2) * tick) / 4;
                const val = chartMax - ((chartMax - chartMin) * tick) / 4;
                return (
                  <g key={`y-${tick}`}>
                    <line x1={chartPad} x2={chartW - chartPad} y1={y} y2={y} stroke={isLight ? "#e2e8f0" : "rgba(255,255,255,0.08)"} strokeWidth="1" />
                    <text x={4} y={y + 3} fontSize="10" fill={isLight ? "#64748b" : "rgba(255,255,255,0.55)"}>{Math.round(val).toLocaleString()}</text>
                  </g>
                );
              })}
              {spyPolyline && <polyline fill="none" stroke="#94a3b8" strokeWidth="2" points={spyPolyline} />}
              {manualPolyline && <polyline fill="none" stroke="#22c55e" strokeWidth="2.5" points={manualPolyline} />}
              {autoPolyline && <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" points={autoPolyline} />}
              {!manualPolyline && !autoPolyline && portfolioPolyline && (
                <polyline fill="none" stroke="#22c55e" strokeWidth="2.5" points={portfolioPolyline} />
              )}
              {hoverPoint && (
                <g>
                  <line x1={hoverPoint.x} x2={hoverPoint.x} y1={chartPad} y2={chartH - chartPad} stroke={isLight ? "#1e293b" : "rgba(255,255,255,0.35)"} strokeDasharray="4 3" />
                  <line x1={chartPad} x2={chartW - chartPad} y1={hoverPoint.y} y2={hoverPoint.y} stroke={isLight ? "#1e293b" : "rgba(255,255,255,0.2)"} strokeDasharray="4 3" />
                  <circle cx={hoverPoint.x} cy={hoverPoint.y} r="4" fill="#f0a500" />
                  <g transform={`translate(${Math.min(chartW - 220, hoverPoint.x + 10)},${Math.max(12, hoverPoint.y - 34)})`}>
                    <rect width="205" height="30" rx="6" fill={isLight ? "rgba(15,23,42,0.92)" : "rgba(2,6,23,0.9)"} />
                    <text x="8" y="12" fontSize="10" fill="#e2e8f0">{hoverPoint.label}</text>
                    <text x="8" y="24" fontSize="11" fill="#f0a500">Portfolio: {fmtMoney(hoverPoint.value)}</text>
                    <text x="140" y="24" fontSize="10" fill="#94a3b8">Vol: n/a</text>
                  </g>
                </g>
              )}
            </svg>
          </div>
          <div className="mt-2 flex gap-3 text-xs">
            <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Manual portfolio: <span className="text-emerald-500 font-semibold">green</span></span>
            <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>ASTRA Auto-Pilot: <span className="text-blue-500 font-semibold">blue</span></span>
            <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>S&P 500 benchmark: <span className="text-slate-400 font-semibold">grey</span></span>
          </div>
        </section>

        <section className={`${cardClass} mb-6 sim-tx-shell`}>
          <h2 className={`text-2xl font-semibold mb-3 ${isLight ? "text-slate-900" : "text-white"} ${simSerif.className}`}>Transaction History</h2>
          <div className={`mb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs`}>
            <div className={`rounded-md border px-2.5 py-2 ${isLight ? "border-slate-200 bg-slate-50 text-slate-700" : "border-white/10 bg-white/[0.03] text-white/80"}`}>Trades: <span className="font-semibold">{transactionStats.trades}</span></div>
            <div className={`rounded-md border px-2.5 py-2 ${isLight ? "border-slate-200 bg-slate-50 text-slate-700" : "border-white/10 bg-white/[0.03] text-white/80"}`}>Closed Sells: <span className="font-semibold">{transactionStats.sells}</span></div>
            <div className={`rounded-md border px-2.5 py-2 ${isLight ? "border-slate-200 bg-slate-50 text-slate-700" : "border-white/10 bg-white/[0.03] text-white/80"}`}>Win Rate: <span className="font-semibold">{transactionStats.sells ? `${transactionStats.winRate.toFixed(0)}%` : "—"}</span></div>
            <div className={`rounded-md border px-2.5 py-2 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.03]"} ${transactionStats.realizedPnL >= 0 ? "text-emerald-500" : "text-rose-500"}`}>Realized: <span className="font-semibold">{fmtMoney(transactionStats.realizedPnL)}</span></div>
          </div>
          <div className="overflow-x-auto sim-tx-table-wrap">
            <table className="w-full text-xs sim-tx-table">
              <thead className={isLight ? "text-slate-500" : "text-white/60"}>
                <tr className={isLight ? "border-b border-slate-200 text-left" : "border-b border-white/10 text-left"}>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Ticker</th>
                  <th className="py-2 pr-2">Type</th>
                  <th className="py-2 pr-2">Action</th>
                  <th className="py-2 pr-2">Shares</th>
                  <th className="py-2 pr-2">Price</th>
                  <th className="py-2 pr-2">Total</th>
                  <th className="py-2 pr-2">Closed P/L</th>
                </tr>
              </thead>
              <tbody>
                {profile.transactions.map((tx) => (
                  <tr key={tx.id} className={isLight ? "border-b border-slate-100" : "border-b border-white/5"}>
                    <td className="py-2 pr-2">{new Date(Number(tx.ts)).toLocaleString()}</td>
                    <td className="py-2 pr-2 font-semibold">{tx.symbol}</td>
                    <td className="py-2 pr-2">
                      <span className={`text-[10px] rounded-full border px-2 py-0.5 ${
                        normalizeAssetType(tx.assetType) === "crypto"
                          ? isLight ? "border-violet-300 bg-violet-50 text-violet-700" : "border-violet-400/35 bg-violet-500/20 text-violet-200"
                          : isLight ? "border-blue-300 bg-blue-50 text-blue-700" : "border-blue-400/35 bg-blue-500/20 text-blue-200"
                      }`}>
                        {normalizeAssetType(tx.assetType) === "crypto" ? "CRYPTO" : "STOCK"}
                      </span>
                    </td>
                    <td className={`py-2 pr-2 ${tx.action === "BUY" ? "text-emerald-500" : "text-rose-500"}`}>{tx.action}</td>
                    <td className="py-2 pr-2">{Number(tx.shares || 0).toFixed(normalizeAssetType(tx.assetType) === "crypto" ? 6 : 4)}</td>
                    <td className="py-2 pr-2">{fmtMoney(tx.price)}</td>
                    <td className="py-2 pr-2">{fmtMoney(tx.totalValue)}</td>
                    <td className={`py-2 pr-2 ${Number(tx.realizedPnL) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {tx.realizedPnL == null ? "—" : fmtMoney(tx.realizedPnL)}
                    </td>
                  </tr>
                ))}
                {profile.transactions.length === 0 && (
                  <tr>
                    <td colSpan={8} className={`py-4 text-center ${isLight ? "text-slate-500" : "text-white/60"}`}>
                      No trades yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {SHOW_LEADERBOARD && (
        <section className={cardClass}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className={`text-2xl font-semibold ${isLight ? "text-slate-900" : "text-white"} ${simSerif.className}`}>Leaderboard</h2>
            <div className="flex gap-2">
              {LEADERBOARD_FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setLeaderboardFilter(f.key)}
                  className={`px-2.5 py-1 rounded-md text-xs border ${leaderboardFilter === f.key ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={isLight ? "text-slate-500" : "text-white/60"}>
                <tr className={isLight ? "border-b border-slate-200 text-left" : "border-b border-white/10 text-left"}>
                  <th className="py-2 pr-2">Rank</th>
                  <th className="py-2 pr-2">User</th>
                  <th className="py-2 pr-2">Return %</th>
                  <th className="py-2 pr-2">Portfolio Value</th>
                </tr>
              </thead>
              <tbody>
                {leaderboardRows.map((row) => (
                  <tr key={`${row.user}-${row.rank}`} className={`${isLight ? "border-b border-slate-100" : "border-b border-white/5"} ${row.user === "You" ? isLight ? "bg-blue-50/80" : "bg-blue-500/10" : ""}`}>
                    <td className="py-2 pr-2 font-semibold">#{row.rank}</td>
                    <td className="py-2 pr-2">
                      {row.user}
                      {row.user === "You" && isCryptoTrader && (
                        <span className={`ml-2 text-[10px] rounded-full border px-1.5 py-0.5 ${
                          isLight ? "border-violet-300 bg-violet-50 text-violet-700" : "border-violet-400/35 bg-violet-500/20 text-violet-200"
                        }`}>
                          Crypto Trader
                        </span>
                      )}
                    </td>
                    <td className={`py-2 pr-2 ${row.metric >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtPct(row.metric)}</td>
                    <td className="py-2 pr-2">{fmtMoney(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`mt-2 text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>Your current rank: #{selfRank}</div>
        </section>
        )}
        </>
        )}
      </div>

      <style jsx global>{`
        .sim-pro {
          --sim-gold: #f0a500;
          --sim-border: rgba(255, 255, 255, 0.08);
        }
        .sim-pro:not(.light-mode):not(.cherry-mode):not(.azula-mode) {
          background-image:
            linear-gradient(rgba(240, 165, 0, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(240, 165, 0, 0.03) 1px, transparent 1px);
          background-size: 48px 48px;
        }
        .sim-pro .sim-card {
          position: relative;
          overflow: hidden;
        }
        .sim-pro:not(.light-mode):not(.cherry-mode):not(.azula-mode) .sim-card {
          background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.015), rgba(255, 255, 255, 0));
        }
        .sim-pro .sim-card::before {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(240, 165, 0, 0.45), transparent);
          pointer-events: none;
        }
        .sim-pro .sim-card table thead th {
          letter-spacing: 0.12em;
        }
        .sim-pro .sim-card article {
          transition: transform 0.16s ease, border-color 0.16s ease;
        }
        .sim-pro .sim-card article:hover {
          transform: translateY(-1px);
        }
        .sim-pro .sim-decision {
          position: relative;
          overflow: hidden;
        }
        .sim-pro .sim-decision::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 2px;
          background: linear-gradient(180deg, rgba(240, 165, 0, 0.65), rgba(240, 165, 0, 0.08));
        }
        .sim-pro .sim-decision-buy {
          box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.12), 0 0 22px rgba(34, 197, 94, 0.08);
        }
        .sim-pro .sim-decision-sell {
          box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.12), 0 0 22px rgba(239, 68, 68, 0.08);
        }
        .sim-pro .sim-decision-hold {
          box-shadow: inset 0 0 0 1px rgba(245, 158, 11, 0.12), 0 0 22px rgba(245, 158, 11, 0.06);
        }
        .sim-pro .sim-card button {
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }
        .sim-pro .sim-card button:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        .sim-pro .sim-card input:focus,
        .sim-pro .sim-card select:focus {
          outline: none;
          box-shadow: 0 0 0 2px rgba(240, 165, 0, 0.18);
          border-color: rgba(240, 165, 0, 0.55) !important;
        }
        .sim-pro .sim-card h1,
        .sim-pro .sim-card h2 {
          letter-spacing: 0.01em;
        }
        .sim-pro .sim-card .text-xs.uppercase {
          letter-spacing: 0.14em;
        }
        .sim-pro .sim-ticker-tape {
          overflow: hidden;
          white-space: nowrap;
        }
        .sim-pro .sim-ticker-track {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          animation: simTickerScroll 30s linear infinite;
          min-width: max-content;
        }
        .sim-pro .sim-ticker-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border-radius: 999px;
          padding: 4px 10px;
          border: 1px solid rgba(148, 163, 184, 0.35);
          background: rgba(255, 255, 255, 0.03);
          font-size: 11px;
        }
        .sim-pro .sim-trade-shell,
        .sim-pro .sim-tx-shell {
          backdrop-filter: blur(6px);
        }
        .sim-pro .sim-trade-shell input,
        .sim-pro .sim-trade-shell select {
          letter-spacing: 0.01em;
        }
        .sim-pro .sim-tx-table-wrap {
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 10px;
          overflow: auto;
        }
        .sim-pro.light-mode .sim-tx-table-wrap,
        .sim-pro.cherry-mode .sim-tx-table-wrap,
        .sim-pro.azula-mode .sim-tx-table-wrap {
          border-color: rgba(148, 163, 184, 0.35);
        }
        .sim-pro .sim-tx-table thead th {
          position: sticky;
          top: 0;
          z-index: 1;
          background: rgba(2, 6, 23, 0.92);
        }
        .sim-pro.light-mode .sim-tx-table thead th,
        .sim-pro.cherry-mode .sim-tx-table thead th,
        .sim-pro.azula-mode .sim-tx-table thead th {
          background: rgba(248, 250, 252, 0.96);
        }
        .sim-pro .sim-tx-table tbody tr {
          transition: background 0.12s ease;
        }
        .sim-pro .sim-tx-table tbody tr:hover {
          background: rgba(240, 165, 0, 0.08);
        }
        .sim-pro .sim-flash {
          position: fixed;
          right: 18px;
          bottom: 18px;
          z-index: 80;
          min-width: 260px;
          border-radius: 12px;
          padding: 10px 12px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(2, 6, 23, 0.92);
          color: #f8fafc;
          box-shadow: 0 12px 30px rgba(2, 6, 23, 0.4);
          animation: simPopIn 0.35s ease;
        }
        .sim-pro .sim-flash.green {
          border-color: rgba(34, 197, 94, 0.45);
        }
        .sim-pro .sim-flash.red {
          border-color: rgba(239, 68, 68, 0.45);
        }
        .sim-pro .sim-flash.amber {
          border-color: rgba(245, 158, 11, 0.45);
        }
        @keyframes simTickerScroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes simPopIn {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {tradeFlash && (
        <div className={`sim-flash ${tradeFlash.tone || "amber"}`}>
          <div className="text-[11px] uppercase tracking-[0.14em] opacity-80">{tradeFlash.title || "Update"}</div>
          <div className="mt-1 text-sm">{tradeFlash.body || ""}</div>
        </div>
      )}


      {deepResearchOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            onClick={() => setDeepResearchOpen(false)}
            aria-label="Close deep research"
          />
          <div className={isLight ? "relative w-full max-w-4xl max-h-[86vh] overflow-y-auto rounded-2xl border border-slate-300 bg-white text-slate-900 p-5 shadow-2xl" : "relative w-full max-w-4xl max-h-[86vh] overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 text-white p-5 shadow-2xl"}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={isLight ? "text-lg font-semibold text-slate-900" : "text-lg font-semibold text-white"}>ASTRA Deep Research</div>
                <div className={isLight ? "text-xs text-slate-500" : "text-xs text-white/60"}>{deepResearchTicker || "—"}</div>
              </div>
              <button
                onClick={() => setDeepResearchOpen(false)}
                className={isLight ? "h-8 w-8 rounded-full border border-slate-300 bg-slate-100 text-slate-700" : "h-8 w-8 rounded-full border border-white/15 bg-white/10 text-white/80"}
                aria-label="Close"
              >
                x
              </button>
            </div>

            {deepResearchLoading ? (
              <div className={isLight ? "mt-4 text-sm text-slate-700" : "mt-4 text-sm text-white/85"}>ASTRA is researching {deepResearchTicker}...</div>
            ) : deepResearchError ? (
              <div className={isLight ? "mt-4 rounded-lg border border-rose-300 bg-rose-50 text-rose-700 px-3 py-2 text-sm" : "mt-4 rounded-lg border border-rose-400/35 bg-rose-500/15 text-rose-200 px-3 py-2 text-sm"}>
                {deepResearchError}
              </div>
            ) : deepResearchData ? (
              <div className="mt-4 space-y-4">
                <div className={isLight ? "rounded-xl border border-slate-200 bg-slate-50 p-3" : "rounded-xl border border-white/12 bg-white/[0.03] p-3"}>
                  <div className="text-xs uppercase tracking-wide mb-2 text-cyan-500 font-semibold">Summary</div>
                  <p className="text-sm">{String(deepResearchData.summary || "No summary available.")}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className={isLight ? "rounded-xl border border-slate-200 bg-slate-50 p-3" : "rounded-xl border border-white/12 bg-white/[0.03] p-3"}>
                    <div className="text-xs uppercase tracking-wide mb-2 text-emerald-500 font-semibold">Bull Case</div>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {Array.isArray(deepResearchData.bull_case) && deepResearchData.bull_case.length
                        ? deepResearchData.bull_case.map((x, i) => <li key={`bull-${i}`}>{String(x)}</li>)
                        : <li>No bull case items available.</li>}
                    </ul>
                  </div>
                  <div className={isLight ? "rounded-xl border border-slate-200 bg-slate-50 p-3" : "rounded-xl border border-white/12 bg-white/[0.03] p-3"}>
                    <div className="text-xs uppercase tracking-wide mb-2 text-rose-500 font-semibold">Bear Case</div>
                    <ul className="list-disc pl-5 space-y-1 text-sm">
                      {Array.isArray(deepResearchData.bear_case) && deepResearchData.bear_case.length
                        ? deepResearchData.bear_case.map((x, i) => <li key={`bear-${i}`}>{String(x)}</li>)
                        : <li>No bear case items available.</li>}
                    </ul>
                  </div>
                </div>
                <div className={isLight ? "rounded-xl border border-slate-200 bg-slate-50 p-3" : "rounded-xl border border-white/12 bg-white/[0.03] p-3"}>
                  <div className="text-xs uppercase tracking-wide mb-2 text-blue-500 font-semibold">Sources</div>
                  <div className="space-y-1 text-sm">
                    {Array.isArray(deepResearchData.sources) && deepResearchData.sources.length ? (
                      deepResearchData.sources.map((src, i) => (
                        <a
                          key={`src-${i}`}
                          href={String(src?.url || "#")}
                          target="_blank"
                          rel="noreferrer"
                          className={isLight ? "block underline text-blue-700" : "block underline text-blue-300"}
                        >
                          {String(src?.name || src?.url || "Source")}
                        </a>
                      ))
                    ) : (
                      <div>No source links available.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

        {showEnableAutoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => setShowEnableAutoModal(false)}
            aria-label="Close enable auto-pilot modal"
          />
          <div className={`relative w-full max-w-lg rounded-2xl border p-5 shadow-2xl ${isLight ? "border-slate-300 bg-white" : "border-white/15 bg-slate-900 text-white"}`}>
            <div className={`text-lg font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Enable ASTRA Auto-Pilot?</div>
            <p className={`mt-2 text-sm ${isLight ? "text-slate-700" : "text-white/85"}`}>
              ASTRA will now manage your portfolio. You can watch every decision and the reasoning behind it. Switch back to manual at any time.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={enableAutoPilot}
                className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
              >
                Enable Auto-Pilot
              </button>
              <button
                type="button"
                onClick={() => setShowEnableAutoModal(false)}
                className={`px-3 py-1.5 rounded-lg border text-sm ${isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100" : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"}`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
