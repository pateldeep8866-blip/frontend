"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseClient } from "@/app/api/_lib/supabaseClient";

function Badge({ value }) {
  const v = (value || "").toUpperCase();
  const cls =
    v === "BUY"
      ? "bg-green-500/20 text-green-300 border-green-500/30 shadow-[0_0_20px_rgba(34,197,94,0.22)]"
      : v === "HOLD"
      ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.2)]"
      : v === "AVOID"
      ? "bg-red-500/20 text-red-300 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
      : "bg-white/10 text-white/70 border-white/10";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs transition-all duration-300 animate-[pulse_2.2s_ease-in-out_infinite] ${cls}`}
    >
      {v || "—"}
    </span>
  );
}

function fmt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function fmtLarge(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return `${v.toFixed(2)}`;
}

function normalizeHistoryEntry(value) {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : value && typeof value === "object"
          ? String(value.symbol || value.id || value.name || "")
          : "";
  const out = String(raw || "").trim().toUpperCase();
  if (!out || out === "[OBJECT OBJECT]") return "";
  return out;
}

function safeDomainFromUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function faviconUrlFor(rawUrl) {
  const domain = safeDomainFromUrl(rawUrl);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

const FX_CURRENCY_OPTIONS = [
  { code: "USD", name: "US Dollar", aliases: ["united states", "america", "dollar"] },
  { code: "EUR", name: "Euro", aliases: ["europe", "eurozone"] },
  { code: "GBP", name: "British Pound", aliases: ["uk", "united kingdom", "britain", "england", "pound"] },
  { code: "JPY", name: "Japanese Yen", aliases: ["japan", "yen"] },
  { code: "INR", name: "Indian Rupee", aliases: ["india", "rupee"] },
  { code: "CAD", name: "Canadian Dollar", aliases: ["canada"] },
  { code: "AUD", name: "Australian Dollar", aliases: ["australia"] },
  { code: "CHF", name: "Swiss Franc", aliases: ["switzerland", "franc"] },
  { code: "CNY", name: "Chinese Yuan", aliases: ["china", "yuan", "renminbi", "rmb"] },
  { code: "AED", name: "UAE Dirham", aliases: ["uae", "united arab emirates", "dirham", "dubai"] },
  { code: "MXN", name: "Mexican Peso", aliases: ["mexico", "peso"] },
];

const DEFAULT_QUIZ_ANSWERS = {
  goal: "",
  horizon: "",
  drawdownAction: "",
  riskTolerance: "",
  incomeStability: "",
  experience: "",
  analysisStyle: "",
  reviewFrequency: "",
  assetClasses: [],
  regionFocus: "",
  sectorPreferences: [],
  exclusions: "",
  liquidityNeeds: "",
  ethicalPreference: "",
  ethicalOther: "",
  dayTradingInterest: "",
  dayTradingMarkets: [],
  dayTradingTime: "",
  followupChange: "",
  followupNotes: "",
};

function normalizeQuizAnswers(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_QUIZ_ANSWERS,
    ...raw,
    assetClasses: Array.isArray(raw.assetClasses) ? raw.assetClasses : [],
    sectorPreferences: Array.isArray(raw.sectorPreferences) ? raw.sectorPreferences : [],
    dayTradingMarkets: Array.isArray(raw.dayTradingMarkets) ? raw.dayTradingMarkets : [],
  };
}

function resolveCurrencyInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) {
    const exact = FX_CURRENCY_OPTIONS.find((x) => x.code === upper);
    return exact?.code || "";
  }
  const q = raw.toLowerCase();
  const hit = FX_CURRENCY_OPTIONS.find((x) =>
    x.name.toLowerCase().includes(q) || x.aliases.some((a) => a.includes(q))
  );
  return hit?.code || "";
}

function mapIndustryToSectorETF(industryRaw) {
  const industry = String(industryRaw || "").toLowerCase();
  if (!industry) return { label: "Unknown", etf: "SPY" };
  if (industry.includes("tech") || industry.includes("software") || industry.includes("semiconductor")) {
    return { label: "Technology", etf: "XLK" };
  }
  if (industry.includes("bank") || industry.includes("financial")) return { label: "Financials", etf: "XLF" };
  if (industry.includes("health") || industry.includes("biotech") || industry.includes("pharma")) {
    return { label: "Healthcare", etf: "XLV" };
  }
  if (industry.includes("energy") || industry.includes("oil") || industry.includes("gas")) {
    return { label: "Energy", etf: "XLE" };
  }
  if (industry.includes("consumer") || industry.includes("retail")) return { label: "Consumer", etf: "XLY" };
  if (industry.includes("industrial") || industry.includes("aerospace")) return { label: "Industrials", etf: "XLI" };
  if (industry.includes("communication") || industry.includes("media")) return { label: "Communication", etf: "XLC" };
  if (industry.includes("utility")) return { label: "Utilities", etf: "XLU" };
  if (industry.includes("real estate")) return { label: "Real Estate", etf: "XLRE" };
  return { label: "Broad Market", etf: "SPY" };
}

function canonicalTicker(input) {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw) return "";

  const aliasMap = {
    GOOGLE: "GOOGL",
    ALPHABET: "GOOGL",
    FACEBOOK: "META",
    HONDA: "HMC",
    TOYOTA: "TM",
  };
  if (aliasMap[raw]) return aliasMap[raw];

  // Convert foreign exchange tickers to base ticker when possible (e.g. HMC.AX -> HMC, 7203.T -> 7203)
  const parts = raw.split(".");
  if (parts.length === 2) {
    const [base, suffix] = parts;
    const foreignSuffixes = new Set([
      "AX", "T", "TO", "L", "HK", "AS", "PA", "MI", "SW", "F", "DE", "ST", "OL", "HE", "V", "KS", "KQ",
    ]);
    if (foreignSuffixes.has(suffix) && base) {
      return base;
    }
  }

  return raw;
}

function cleanAiText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function cleanChatAnswer(value) {
  const text = cleanAiText(value)
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s*/gm, "- ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

function parseJsonLike(text) {
  const cleaned = cleanAiText(text);
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function extractQuotedField(text, key) {
  const fieldPattern = new RegExp(
    `"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"(?:ticker|recommendation|why|risks|day_plan|note|risk_level|confidence|ai_score|bull_probability|bear_probability|horizon|risk_explanation|short_summary|long_summary|reasoning_categories|strengths|outlook)"\\s*:|,\\s*}|})`,
    "i"
  );
  const match = text.match(fieldPattern);
  return match?.[1]?.trim() || "";
}

function extractArrayField(text, key) {
  const sectionPattern = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i");
  const section = text.match(sectionPattern)?.[1] || "";
  if (!section) return [];

  const items = [];
  const itemRegex = /"([^"]+)"/g;
  let m;
  while ((m = itemRegex.exec(section)) !== null) {
    const value = String(m[1] || "").trim();
    if (value) items.push(value);
  }
  return items;
}

function extractNumericField(text, key) {
  const numericPattern = new RegExp(`"${key}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i");
  const matched = text.match(numericPattern)?.[1];
  const value = Number(matched);
  return Number.isFinite(value) ? value : NaN;
}

function parseLooseAnalysisText(text) {
  const cleaned = cleanAiText(text);
  if (!cleaned) return null;

  const ticker = extractQuotedField(cleaned, "ticker").toUpperCase();
  const recommendation = extractQuotedField(cleaned, "recommendation").toUpperCase();
  const why = extractArrayField(cleaned, "why");
  const risks = extractArrayField(cleaned, "risks");
  const day_plan = extractQuotedField(cleaned, "day_plan");
  const note = extractQuotedField(cleaned, "note");
  const risk_level = extractQuotedField(cleaned, "risk_level").toUpperCase();
  const horizon = extractQuotedField(cleaned, "horizon").toUpperCase();
  const risk_explanation = extractQuotedField(cleaned, "risk_explanation");
  const short_summary = extractQuotedField(cleaned, "short_summary");
  const long_summary = extractQuotedField(cleaned, "long_summary");
  const outlook = extractQuotedField(cleaned, "outlook");
  const strengths = extractArrayField(cleaned, "strengths");
  const confidenceText = extractQuotedField(cleaned, "confidence");
  const confidenceQuoted = Number(confidenceText.replace(/[^0-9.]/g, ""));
  const confidenceNumeric = extractNumericField(cleaned, "confidence");
  const confidence = Number.isFinite(confidenceQuoted) && confidenceQuoted > 0 ? confidenceQuoted : confidenceNumeric;
  const ai_score = extractNumericField(cleaned, "ai_score");
  const bull_probability = extractNumericField(cleaned, "bull_probability");
  const bear_probability = extractNumericField(cleaned, "bear_probability");
  const fundamental = extractNumericField(cleaned, "fundamental");
  const technical = extractNumericField(cleaned, "technical");
  const sentiment = extractNumericField(cleaned, "sentiment");
  const reasoning_categories =
    Number.isFinite(fundamental) || Number.isFinite(technical) || Number.isFinite(sentiment)
      ? {
          fundamental: Number.isFinite(fundamental) ? fundamental : 0,
          technical: Number.isFinite(technical) ? technical : 0,
          sentiment: Number.isFinite(sentiment) ? sentiment : 0,
        }
      : undefined;

  if (!ticker && !recommendation && !why.length && !risks.length && !day_plan && !note && !risk_level && !short_summary) {
    return null;
  }

  return {
    ticker,
    recommendation,
    why,
    risks,
    day_plan,
    note,
    risk_level,
    confidence,
    ai_score,
    bull_probability,
    bear_probability,
    horizon,
    risk_explanation,
    short_summary,
    long_summary,
    reasoning_categories,
    strengths,
    outlook,
  };
}

function listOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || "").trim()).filter(Boolean);
}

function normalizeAiPayload(payload) {
  const sourceText = payload?.raw || payload?.note;
  const parsed = parseJsonLike(sourceText) || parseLooseAnalysisText(sourceText);
  const merged = { ...(parsed || {}), ...(payload || {}) };

  const ticker = String(merged?.ticker || "").trim().toUpperCase();
  const recommendation = String(merged?.recommendation || "").trim().toUpperCase();
  const why = listOfStrings(merged?.why);
  const risks = listOfStrings(merged?.risks);
  const strengths = listOfStrings(merged?.strengths);
  const dayPlan = String(merged?.day_plan || merged?.dayPlan || "").trim();
  const note = cleanAiText(merged?.note);
  const shortSummary = cleanAiText(merged?.short_summary || merged?.shortSummary);
  const longSummary = cleanAiText(merged?.long_summary || merged?.longSummary);
  const riskExplanation = cleanAiText(merged?.risk_explanation || merged?.riskExplanation);
  const outlook = cleanAiText(merged?.outlook);
  const confidenceRaw = Number(String(merged?.confidence ?? "").replace(/[^0-9.]/g, ""));
  const confidence = Number.isFinite(confidenceRaw) && confidenceRaw > 0
    ? Math.min(100, Math.round(confidenceRaw))
    : recommendation === "BUY"
      ? 74
      : recommendation === "HOLD"
        ? 61
        : recommendation === "AVOID"
          ? 57
          : 0;
  const riskLevelRaw = String(merged?.risk_level || merged?.riskLevel || "").trim().toUpperCase();
  const riskLevel = riskLevelRaw || (risks.length >= 3 ? "HIGH" : risks.length === 2 ? "MEDIUM" : "LOW");
  const aiScoreRaw = Number(String(merged?.ai_score ?? "").replace(/[^0-9.]/g, ""));
  const aiScore = Number.isFinite(aiScoreRaw) && aiScoreRaw > 0 ? Math.min(100, Math.round(aiScoreRaw)) : confidence;
  const bullRaw = Number(String(merged?.bull_probability ?? "").replace(/[^0-9.]/g, ""));
  const bearRaw = Number(String(merged?.bear_probability ?? "").replace(/[^0-9.]/g, ""));
  const bullProbability = Number.isFinite(bullRaw) ? Math.min(100, Math.max(0, Math.round(bullRaw))) : Math.min(95, Math.max(5, aiScore));
  const bearProbability = Number.isFinite(bearRaw) ? Math.min(100, Math.max(0, Math.round(bearRaw))) : 100 - bullProbability;
  const horizon = String(merged?.horizon || "").trim().toUpperCase() || (recommendation === "BUY" ? "LONG_TERM" : "SHORT_TERM");
  const rc = merged?.reasoning_categories || {};
  const reasoningCategories = {
    fundamental: Math.min(100, Math.max(0, Number(rc?.fundamental ?? 55) || 55)),
    technical: Math.min(100, Math.max(0, Number(rc?.technical ?? 50) || 50)),
    sentiment: Math.min(100, Math.max(0, Number(rc?.sentiment ?? 52) || 52)),
  };

  let fallbackText = "";
  if (!why.length && !risks.length && !dayPlan) {
    fallbackText = cleanAiText(merged?.raw || merged?.note);
    if (parsed) fallbackText = "";
  }

  return {
    ticker,
    recommendation,
    why,
    risks,
    strengths,
    dayPlan,
    shortSummary,
    longSummary,
    riskExplanation,
    outlook,
    note,
    confidence,
    aiScore,
    bullProbability,
    bearProbability,
    horizon,
    reasoningCategories,
    riskLevel,
    fallbackText,
  };
}

function drawLineChart(canvas, points) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (!points?.length) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "12px system-ui";
    ctx.fillText("No chart data", 10, 20);
    return;
  }

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pad = 10;

  const xStep = (w - pad * 2) / (points.length - 1 || 1);

  const y = (val) => {
    if (max === min) return h / 2;
    const t = (val - min) / (max - min);
    return h - pad - t * (h - pad * 2);
  };

  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const gy = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // line
  ctx.strokeStyle = "rgba(59,130,246,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = pad + i * xStep;
    const py = y(p.close);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // last value label
  const last = points[points.length - 1]?.close;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "12px system-ui";
  ctx.fillText(`Last: $${last?.toFixed?.(2) ?? last}`, 10, 18);
}

function Card({ title, right, children }) {
  return (
    <div className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-5 md:p-6 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="app-card-title text-sm font-semibold text-slate-100 tracking-wide">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function Home() {
  const [assetMode, setAssetMode] = useState("stock");
  const [ticker, setTicker] = useState("");
  const [usingTicker, setUsingTicker] = useState("");
  const [usingAssetId, setUsingAssetId] = useState("");

  const [result, setResult] = useState(null);
  const [company, setCompany] = useState(null);
  const [news, setNews] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suppressSuggestions, setSuppressSuggestions] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [theme, setTheme] = useState("dark");
  const [analysisViewMode, setAnalysisViewMode] = useState("short");
  const [marketNews, setMarketNews] = useState([]);
  const [movers, setMovers] = useState({ gainers: [], losers: [] });
  const [sectorInfo, setSectorInfo] = useState(null);
  const [compareInput, setCompareInput] = useState("AAPL,MSFT,NVDA");
  const [compareRows, setCompareRows] = useState([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [fxFrom, setFxFrom] = useState("USD");
  const [fxTo, setFxTo] = useState("INR");
  const [fxAmount, setFxAmount] = useState("1");
  const [fxResult, setFxResult] = useState(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState("");

  const [loading, setLoading] = useState(false);

  // AI
  const [analysisObj, setAnalysisObj] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [dailyObj, setDailyObj] = useState(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      content:
        "I am ASTRA. Ask me about the current tab market (stocks, crypto, metals, FX, or world news).",
    },
  ]);
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState("signin");
  const [authFirstName, setAuthFirstName] = useState("");
  const [authLastName, setAuthLastName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [welcomeBanner, setWelcomeBanner] = useState({ show: false, text: "" });
  const [quizAnswers, setQuizAnswers] = useState(DEFAULT_QUIZ_ANSWERS);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [quizPanelOpen, setQuizPanelOpen] = useState(false);
  const [quizDismissed, setQuizDismissed] = useState(false);
  const [quizSaving, setQuizSaving] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [quizCompletedAt, setQuizCompletedAt] = useState("");
  const [quizFollowupMode, setQuizFollowupMode] = useState(false);
  const [quizFollowupDue, setQuizFollowupDue] = useState(false);
  const [dayTraderObj, setDayTraderObj] = useState(null);
  const [dayTraderLoading, setDayTraderLoading] = useState(false);
  const quizPromptTimerRef = useRef(null);
  const initialQuizPromptedRef = useRef(false);
  const followupQuizPromptedRef = useRef(false);

  // Market overview
  const overviewStockTickers = useMemo(() => ["SPY", "QQQ", "DIA", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META"], []);
  const overviewCryptoIds = useMemo(
    () => ["bitcoin", "ethereum", "solana", "binancecoin", "ripple", "dogecoin", "cardano", "avalanche-2", "chainlink", "tron"],
    []
  );
  const overviewMetalsIds = useMemo(
    () => ["XAU", "XAG", "XPT", "XPD"],
    []
  );
  const metalNameBySymbol = useMemo(
    () => ({
      XAU: "Gold",
      XAG: "Silver",
      XPT: "Platinum",
      XPD: "Palladium",
    }),
    []
  );
  const overviewTickers =
    assetMode === "crypto" ? overviewCryptoIds : assetMode === "metals" ? overviewMetalsIds : assetMode === "fx" ? ["USD/EUR", "USD/GBP", "USD/JPY"] : overviewStockTickers;
  const [overview, setOverview] = useState([]);
  const [fundamentals, setFundamentals] = useState(null);

  // Chart
  const [chartPoints, setChartPoints] = useState([]);
  const [chartRange, setChartRange] = useState("1M");
  const [chartLoading, setChartLoading] = useState(false);
  const [latestVolume, setLatestVolume] = useState(null);
  const chartRef = useRef(null);

  const addToSearchHistory = (value) => {
    const item = normalizeHistoryEntry(value);
    if (!item) return;
    setSearchHistory((prev) => {
      const cleanPrev = prev.map(normalizeHistoryEntry).filter(Boolean);
      return [item, ...cleanPrev.filter((x) => x !== item)].slice(0, 8);
    });
  };

  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem("search_history") || "[]");
      if (Array.isArray(h)) setSearchHistory(h.map(normalizeHistoryEntry).filter(Boolean).slice(0, 8));
    } catch {}
    try {
      const t = localStorage.getItem("theme_mode");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("search_history", JSON.stringify(searchHistory.slice(0, 8)));
  }, [searchHistory]);

  useEffect(() => {
    localStorage.setItem("theme_mode", theme);
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    const inRecoveryFlow =
      (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) ||
      (typeof window !== "undefined" && window.location.search.includes("type=recovery"));
    if (inRecoveryFlow) {
      setAuthPanelOpen(true);
      setAuthMode("reset");
      setAuthNotice("Reset flow detected. Enter and confirm your new password.");
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setAuthUser(data?.session?.user || null);
        setAuthReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setAuthUser(null);
        setAuthReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user || null);
      if (event === "PASSWORD_RECOVERY") {
        setAuthPanelOpen(true);
        setAuthMode("reset");
        setAuthNotice("Recovery confirmed. Set your new password.");
      }
    });

    return () => {
      mounted = false;
      data?.subscription?.unsubscribe();
    };
  }, []);

  const displayName = useMemo(() => {
    const md = authUser?.user_metadata || {};
    const full = String(md?.full_name || "").trim();
    const first = String(md?.first_name || "").trim();
    const last = String(md?.last_name || "").trim();
    const email = String(authUser?.email || "").trim();
    if (full) return full;
    if (first || last) return `${first} ${last}`.trim();
    if (email.includes("@")) return email.split("@")[0];
    return "Investor";
  }, [authUser]);

  const userInitials = useMemo(() => {
    const name = String(displayName || "").trim();
    if (!name) return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }, [displayName]);

  useEffect(() => {
    if (!authUser?.id) {
      setWelcomeBanner({ show: false, text: "" });
      return;
    }

    try {
      const key = `auth_welcome_seen_${authUser.id}`;
      const hasSeen = localStorage.getItem(key) === "true";
      const msg = hasSeen ? `Welcome back, ${displayName}.` : `Welcome, ${displayName}.`;
      setWelcomeBanner({ show: true, text: msg });
      localStorage.setItem(key, "true");
      const t = setTimeout(() => setWelcomeBanner({ show: false, text: "" }), 60000);
      return () => clearTimeout(t);
    } catch {
      setWelcomeBanner({ show: true, text: `Welcome, ${displayName}.` });
      const t = setTimeout(() => setWelcomeBanner({ show: false, text: "" }), 60000);
      return () => clearTimeout(t);
    }
  }, [authUser?.id, displayName]);

  useEffect(() => {
    if (!authUser) return;
    const md = authUser.user_metadata || {};
    setProfileFirstName(String(md.first_name || ""));
    setProfileLastName(String(md.last_name || ""));
  }, [authUser]);

  useEffect(() => {
    initialQuizPromptedRef.current = false;
    followupQuizPromptedRef.current = false;
    if (quizPromptTimerRef.current) {
      clearTimeout(quizPromptTimerRef.current);
      quizPromptTimerRef.current = null;
    }

    if (!authUser?.id) {
      setQuizCompleted(false);
      setQuizAnswers(DEFAULT_QUIZ_ANSWERS);
      setQuizPanelOpen(false);
      setQuizFollowupMode(false);
      setQuizFollowupDue(false);
      setQuizCompletedAt("");
      setQuizDismissed(false);
      return;
    }

    const metaQuiz = normalizeQuizAnswers(authUser?.user_metadata?.profile_quiz);
    const metaCompleted = Boolean(authUser?.user_metadata?.profile_quiz_completed);

    let localQuiz = DEFAULT_QUIZ_ANSWERS;
    let localCompleted = false;
    let localCompletedAt = "";
    try {
      const q = localStorage.getItem(`profile_quiz_answers_${authUser.id}`);
      const c = localStorage.getItem(`profile_quiz_completed_${authUser.id}`);
      const at = localStorage.getItem(`profile_quiz_completed_at_${authUser.id}`);
      if (q) localQuiz = normalizeQuizAnswers(JSON.parse(q));
      localCompleted = c === "true";
      localCompletedAt = at || "";
    } catch {}

    const useMeta = metaCompleted || Object.values(metaQuiz).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
    const mergedQuiz = useMeta ? metaQuiz : localQuiz;
    const completed = useMeta ? metaCompleted : localCompleted;
    const metaCompletedAt = String(authUser?.user_metadata?.profile_quiz_completed_at || "");
    const completedAt = metaCompletedAt || localCompletedAt || "";

    setQuizAnswers(mergedQuiz);
    setQuizCompleted(completed);
    setQuizDismissed(false);
    setQuizCompletedAt(completedAt);

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const due = Boolean(completedAt) && Date.now() - new Date(completedAt).getTime() >= THIRTY_DAYS_MS;
    setQuizFollowupDue(due);
    setQuizFollowupMode(due);
  }, [authUser]);

  useEffect(() => {
    if (!authUser?.id) return;
    try {
      localStorage.setItem(`profile_quiz_answers_${authUser.id}`, JSON.stringify(quizAnswers));
      localStorage.setItem(`profile_quiz_completed_${authUser.id}`, String(quizCompleted));
      localStorage.setItem(`profile_quiz_completed_at_${authUser.id}`, String(quizCompletedAt || ""));
    } catch {}
  }, [authUser, quizAnswers, quizCompleted, quizCompletedAt]);

  useEffect(() => {
    if (!authUser?.id) return;
    if (quizPanelOpen) return;

    if (!quizCompleted && !quizDismissed && !initialQuizPromptedRef.current) {
      initialQuizPromptedRef.current = true;
      if (quizPromptTimerRef.current) clearTimeout(quizPromptTimerRef.current);
      quizPromptTimerRef.current = setTimeout(() => {
        setQuizPanelOpen(true);
        setQuizDismissed(false);
      }, 30000);
      return () => {
        if (quizPromptTimerRef.current) clearTimeout(quizPromptTimerRef.current);
      };
    }

    if (quizCompleted && quizFollowupDue && !quizDismissed && !followupQuizPromptedRef.current) {
      followupQuizPromptedRef.current = true;
      if (quizPromptTimerRef.current) clearTimeout(quizPromptTimerRef.current);
      quizPromptTimerRef.current = setTimeout(() => {
        setQuizFollowupMode(true);
        setQuizPanelOpen(true);
        setQuizDismissed(false);
      }, 30000);
      return () => {
        if (quizPromptTimerRef.current) clearTimeout(quizPromptTimerRef.current);
      };
    }
  }, [authUser, quizCompleted, quizFollowupDue, quizPanelOpen, quizDismissed]);

  useEffect(() => {
    setTicker("");
    setUsingTicker("");
    setUsingAssetId("");
    setResult(null);
    setCompany(null);
    setFundamentals(null);
    setSectorInfo(null);
    setNews([]);
    setAnalysisObj(null);
    setChartPoints([]);
    setCompareRows([]);
    setCompareInput(assetMode === "crypto" ? "BTC,ETH,SOL" : assetMode === "metals" ? "XAU,XAG,XPT" : "AAPL,MSFT,NVDA");
    setFxResult(null);
    setFxError("");
    setErrorMsg("");
  }, [assetMode]);

  useEffect(() => {
    if (loading) {
      setSuggestionOpen(false);
      return;
    }

    if (suppressSuggestions) {
      setSuggestionOpen(false);
      return;
    }

    const q = ticker.trim();
    if (q.length < 1) {
      setSearchSuggestions([]);
      setSuggestionOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSuggestionLoading(true);
        const endpoint =
          assetMode === "crypto" ? "/api/crypto-search" : assetMode === "metals" ? "/api/metals-search" : "/api/search";
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        const matchesRaw = Array.isArray(data?.matches)
          ? data.matches
          : data?.best
            ? [data.best]
            : [];

        const dedup = new Map();
        for (const m of matchesRaw) {
          const symbol = String(m?.symbol || "").toUpperCase();
          const description = String(m?.description || "").trim();
          const id = String(m?.id || "").trim();
          if (!symbol) continue;
          if (!dedup.has(symbol)) dedup.set(symbol, { symbol, description, id });
        }
        const suggestions = Array.from(dedup.values()).slice(0, 6);
        setSearchSuggestions(suggestions);
        setSuggestionOpen(suggestions.length > 0);
      } catch (e) {
        if (e?.name !== "AbortError") {
          setSearchSuggestions([]);
          setSuggestionOpen(false);
        }
      } finally {
        setSuggestionLoading(false);
      }
    }, 280);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [ticker, assetMode, loading, suppressSuggestions]);

  const applySuggestion = (suggestion) => {
    const rawSymbol = String(suggestion?.symbol || "");
    const sym = assetMode === "crypto" || assetMode === "metals" ? rawSymbol.toUpperCase() : canonicalTicker(rawSymbol);
    if (!sym) return;
    setTicker(sym);
    setSuppressSuggestions(true);
    if (assetMode === "crypto" || assetMode === "metals") {
      setUsingAssetId(String(suggestion?.id || ""));
    }
    setSearchSuggestions([]);
    setSuggestionOpen(false);
    searchStock(sym);
  };

  // Draw chart when points change
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.width = 640;
    c.height = 180;
    drawLineChart(c, chartPoints);
  }, [chartPoints]);

  async function resolveSymbol(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    const fallback = canonicalTicker(raw);

    try {
      let res = await fetch(`/api/search?query=${encodeURIComponent(raw)}`);
      if (!res.ok) res = await fetch(`/api/search?q=${encodeURIComponent(raw)}`);
      if (!res.ok) return fallback;

      const data = await res.json();
      const sym = canonicalTicker(data?.symbol || data?.result?.symbol || "");
      return sym || fallback;
    } catch {
      return fallback;
    }
  }

  async function resolveCryptoAsset(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;
    try {
      const res = await fetch(`/api/crypto-search?q=${encodeURIComponent(raw)}`);
      const data = await res.json().catch(() => ({}));
      const best = data?.best || data?.result || data;
      if (best?.id) {
        return {
          id: String(best.id),
          symbol: String(best.symbol || raw).toUpperCase(),
          name: String(best.name || best.description || raw),
        };
      }
      return {
        id: "",
        symbol: String(raw).toUpperCase(),
        name: String(raw),
      };
    } catch {
      return {
        id: "",
        symbol: String(raw).toUpperCase(),
        name: String(raw),
      };
    }
  }

  async function resolveMetalAsset(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;
    try {
      const res = await fetch(`/api/metals-search?q=${encodeURIComponent(raw)}`);
      const data = await res.json().catch(() => ({}));
      const best = data?.best || data?.result || data;
      if (best?.id) {
        return {
          id: String(best.id),
          symbol: String(best.symbol || raw).toUpperCase(),
          name: String(best.name || best.description || raw),
        };
      }
      return {
        id: "",
        symbol: String(raw).toUpperCase(),
        name: String(raw),
      };
    } catch {
      return {
        id: "",
        symbol: String(raw).toUpperCase(),
        name: String(raw),
      };
    }
  }

  async function fetchDailyPick() {
    if (assetMode === "fx" || assetMode === "news") {
      setDailyObj(null);
      return;
    }
    try {
      setDailyLoading(true);
      const res = await fetch(`/api/ai?mode=daily&market=${assetMode}`);
      const data = await res.json().catch(() => ({}));
      setDailyObj(data);
    } catch {
      setDailyObj({ note: "Daily pick unavailable." });
    } finally {
      setDailyLoading(false);
    }
  }

  async function fetchOverview() {
    try {
      if (assetMode === "news") {
        setOverview([]);
        return;
      }

      if (assetMode === "fx") {
        const r = await fetch("/api/fx-overview");
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d?.rows)) {
          setOverview([]);
          return;
        }
        setOverview(d.rows.map((x) => ({ symbol: x?.symbol, name: x?.name, price: x?.price, percent: x?.percent })));
        return;
      }

      if (assetMode === "crypto") {
        const ids = overviewTickers.join(",");
        const r = await fetch(`/api/crypto-overview?ids=${encodeURIComponent(ids)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d?.rows)) {
          setOverview([]);
          return;
        }
        setOverview(
          d.rows.map((x) => ({
            symbol: x?.symbol,
            price: x?.price,
            percent: x?.percent,
          }))
        );
        return;
      }

      if (assetMode === "metals") {
        const r = await fetch("/api/metals-overview");
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d?.rows)) {
          setOverview([]);
          return;
        }
        setOverview(d.rows.map((x) => ({ symbol: x?.symbol, name: x?.name, price: x?.price, percent: x?.percent })));
        return;
      }

      const rows = await Promise.all(
        overviewTickers.map(async (sym) => {
          const r = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return { symbol: sym, error: true };
          return {
            symbol: sym,
            price: d?.price,
            percent: d?.percentChange,
          };
        })
      );
      setOverview(rows);
    } catch {
      setOverview([]);
    }
  }

  async function fetchMarketNews() {
    if (assetMode === "fx") {
      setMarketNews([]);
      return;
    }
    try {
      const res = await fetch(
        assetMode === "news"
          ? "/api/global-impact-news"
          : assetMode === "crypto"
            ? "/api/crypto-market-news"
            : assetMode === "metals"
              ? "/api/metals-market-news"
              : "/api/market-news"
      );
      const data = await res.json().catch(() => ({}));
      setMarketNews(Array.isArray(data?.news) ? data.news.slice(0, 8) : []);
    } catch {
      setMarketNews([]);
    }
  }

  async function fetchMovers() {
    if (assetMode === "fx" || assetMode === "news") {
      setMovers({ gainers: [], losers: [] });
      return;
    }
    try {
      const res = await fetch(
        assetMode === "crypto" ? "/api/crypto-movers" : assetMode === "metals" ? "/api/metals-movers" : "/api/movers"
      );
      const data = await res.json().catch(() => ({}));
      setMovers({
        gainers: Array.isArray(data?.gainers) ? data.gainers : [],
        losers: Array.isArray(data?.losers) ? data.losers : [],
      });
    } catch {
      setMovers({ gainers: [], losers: [] });
    }
  }

  async function fetchSectorAnalysis(industry) {
    const mapped = mapIndustryToSectorETF(industry);
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(mapped.etf)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setSectorInfo({
        sector: mapped.label,
        benchmark: mapped.etf,
        change: data?.change,
        percentChange: data?.percentChange,
        price: data?.price,
      });
    } catch {}
  }

  async function runComparison() {
    if (assetMode === "fx" || assetMode === "news") {
      setCompareRows([]);
      return;
    }
    const syms = compareInput
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 5);
    if (!syms.length) return;

    try {
      setCompareLoading(true);
      const rows = await Promise.all(
        syms.map(async (symbol) => {
          if (assetMode === "crypto") {
            const qRes = await fetch(`/api/crypto-quote?symbol=${encodeURIComponent(symbol)}`);
            const q = await qRes.json().catch(() => ({}));
            const price = Number(q?.price);
            const percentChange = Number(q?.percentChange);
            const change = Number.isFinite(Number(q?.change))
              ? Number(q?.change)
              : Number.isFinite(price) && Number.isFinite(percentChange)
                ? (price * percentChange) / 100
                : null;
            return {
              symbol: q?.symbol || symbol,
              name: q?.name || symbol,
              price,
              change,
              percentChange,
              peRatio: null,
              marketCap: q?.marketCap,
              volume: q?.volume,
              week52High: null,
              week52Low: null,
              sector: "Crypto",
            };
          }

          if (assetMode === "metals") {
            const qRes = await fetch(`/api/metals-quote?symbol=${encodeURIComponent(symbol)}`);
            const q = await qRes.json().catch(() => ({}));
            return {
              symbol: q?.symbol || symbol,
              name: q?.name || symbol,
              price: q?.price,
              change: q?.change,
              percentChange: q?.percentChange,
              peRatio: null,
              marketCap: q?.marketCap,
              volume: q?.volume,
              week52High: q?.high,
              week52Low: q?.low,
              sector: "Precious Metal",
            };
          }

          const [quoteRes, metricRes, profileRes] = await Promise.all([
            fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
            fetch(`/api/metrics?symbol=${encodeURIComponent(symbol)}`),
            fetch(`/api/profile?symbol=${encodeURIComponent(symbol)}`),
          ]);
          const q = await quoteRes.json().catch(() => ({}));
          const m = await metricRes.json().catch(() => ({}));
          const p = await profileRes.json().catch(() => ({}));

          return {
            symbol,
            name: p?.name || symbol,
            price: q?.price,
            change: q?.change,
            percentChange: q?.percentChange,
            peRatio: m?.peRatio,
            marketCap: p?.marketCapitalization ? Number(p.marketCapitalization) * 1e6 : null,
            volume: null,
            week52High: m?.week52High,
            week52Low: m?.week52Low,
            sector: p?.sector || p?.finnhubIndustry || "—",
          };
        })
      );
      setCompareRows(rows);
    } catch {
      setCompareRows([]);
    } finally {
      setCompareLoading(false);
    }
  }

  async function convertFx() {
    const from = resolveCurrencyInput(fxFrom);
    const to = resolveCurrencyInput(fxTo);
    const amount = Number(fxAmount);
    if (!from || !to) {
      setFxResult(null);
      setFxError("Use a valid currency code or country name (ex: INR, India, Japan, UK).");
      return;
    }

    try {
      setFxLoading(true);
      setFxError("");
      const res = await fetch(
        `/api/fx-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${encodeURIComponent(
          Number.isFinite(amount) && amount > 0 ? amount : 1
        )}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFxResult(null);
        setFxError(data?.error || `FX conversion failed (${res.status})`);
        return;
      }
      setFxResult(data);
      setFxFrom(from);
      setFxTo(to);
    } catch {
      setFxResult(null);
      setFxError("FX conversion failed");
    } finally {
      setFxLoading(false);
    }
  }

  async function fetchFundamentals(symbol) {
    if (!symbol) return;
    try {
      const res = await fetch(`/api/metrics?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFundamentals(data);
    } catch {}
  }

  async function fetchChart(symbol, range, assetIdOverride = "") {
    if (!symbol) return;
    const key = range || "1M";
    const configByRange = {
      "1D": { resolution: "5", days: 1, historyPoints: 1 },
      "1W": { resolution: "D", days: 7, historyPoints: 7 },
      "1M": { resolution: "D", days: 30, historyPoints: 30 },
      "1Y": { resolution: "D", days: 365, historyPoints: 252 },
    };
    const cfg = configByRange[key] || configByRange["1M"];

    try {
      setChartLoading(true);
      const url =
        assetMode === "crypto"
          ? `/api/crypto-candles?id=${encodeURIComponent(assetIdOverride || usingAssetId || symbol)}&days=${cfg.days}`
          : assetMode === "metals"
            ? `/api/metals-candles?id=${encodeURIComponent(assetIdOverride || usingAssetId || symbol)}&symbol=${encodeURIComponent(symbol)}&days=${cfg.days}`
          : `/api/candles?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(cfg.resolution)}&days=${cfg.days}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data?.c) || !Array.isArray(data?.t)) {
        if (assetMode === "stock") {
          const histRes = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`);
          const histData = await histRes.json().catch(() => ({}));
          if (histRes.ok && Array.isArray(histData?.points) && histData.points.length > 1) {
            const points = histData.points
              .slice(-cfg.historyPoints)
              .map((p) => ({ close: Number(p?.close), date: String(p?.date || ""), volume: null }))
              .filter((p) => Number.isFinite(p.close));
            setChartPoints(points);
            setLatestVolume(null);
            return;
          }
        }
        return;
      }

      const points = data.c
        .map((close, i) => ({
          close: Number(close),
          date: data.t[i] ? new Date(Number(data.t[i]) * 1000).toISOString() : "",
          volume: Number(data?.v?.[i]),
        }))
        .filter((p) => Number.isFinite(p.close));

      if (!points.length && assetMode === "stock") {
        const histRes = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`);
        const histData = await histRes.json().catch(() => ({}));
        if (histRes.ok && Array.isArray(histData?.points) && histData.points.length > 1) {
          const histPoints = histData.points
            .slice(-cfg.historyPoints)
            .map((p) => ({ close: Number(p?.close), date: String(p?.date || ""), volume: null }))
            .filter((p) => Number.isFinite(p.close));
          setChartPoints(histPoints);
          setLatestVolume(null);
          return;
        }
      }

      setChartPoints(points);
      const last = points[points.length - 1];
      setLatestVolume(Number.isFinite(last?.volume) ? last.volume : null);
    } catch {
      if (assetMode === "stock") {
        try {
          const histRes = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`);
          const histData = await histRes.json().catch(() => ({}));
          if (histRes.ok && Array.isArray(histData?.points) && histData.points.length > 1) {
            const points = histData.points
              .slice(-cfg.historyPoints)
              .map((p) => ({ close: Number(p?.close), date: String(p?.date || ""), volume: null }))
              .filter((p) => Number.isFinite(p.close));
            setChartPoints(points);
            setLatestVolume(null);
            return;
          }
        } catch {}
      }
    } finally {
      setChartLoading(false);
    }
  }

  // Initial loads
  useEffect(() => {
    fetchDailyPick();
    fetchDayTraderPick();
    fetchOverview();
    fetchMarketNews();
    setTimeout(fetchMovers, 1200);
    const t = setInterval(fetchOverview, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMode]);

  useEffect(() => {
    fetchDayTraderPick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, quizCompleted, quizAnswers.dayTradingInterest, quizAnswers.dayTradingMarkets, quizAnswers.dayTradingTime, assetMode]);

  useEffect(() => {
    if (assetMode !== "fx") return;
    convertFx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMode]);

  useEffect(() => {
    if (!usingTicker) return;
    fetchChart(usingTicker, chartRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRange, usingTicker, usingAssetId, assetMode]);

  const searchStock = async (forcedInput) => {
    const raw = String(forcedInput ?? ticker).trim();
    if (!raw) return;
    const rawCanonical = assetMode === "crypto" || assetMode === "metals" ? raw.toUpperCase() : canonicalTicker(raw);

    setLoading(true);
    setSuppressSuggestions(true);
    setSuggestionOpen(false);
    setErrorMsg("");
    setCompany(null);
    setFundamentals(null);
    setSectorInfo(null);
    setNews([]);
    setAnalysisObj(null);
    setChartPoints([]);

    setResult({ symbol: rawCanonical || raw.toUpperCase(), price: "Loading...", info: "Resolving ticker..." });

    try {
      if (assetMode === "crypto") {
        const resolved = await resolveCryptoAsset(rawCanonical || raw);
        const assetId = String(resolved?.id || "").trim();
        const sym = (resolved?.symbol || rawCanonical || raw).toUpperCase();
        const name = resolved?.name || sym;
        if (!sym) {
          setResult({ symbol: "—", price: "—", info: "Enter a crypto name or symbol." });
          setLoading(false);
          return;
        }

        setUsingTicker(sym);
        setUsingAssetId(assetId);

        const quoteRes = await fetch(
          `/api/crypto-quote?${assetId ? `id=${encodeURIComponent(assetId)}` : `symbol=${encodeURIComponent(sym)}`}`
        );
        const quote = await quoteRes.json().catch(() => ({}));

        if (!quoteRes.ok) {
          const msg = quote?.error || `Crypto quote API failed (${quoteRes.status})`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const priceNum = Number(quote?.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
          const msg = `Unavailable quote for ${sym}.`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const pct = Number(quote?.percentChange);
        const chg = Number(quote?.change);
        setResult({
          symbol: quote.symbol || sym,
          price: `$${priceNum.toFixed(2)}`,
          change: Number.isFinite(chg) && Number.isFinite(pct) ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${pct.toFixed(2)}%)` : "",
          high: quote.high,
          low: quote.low,
          open: null,
          previousClose: null,
          info: "Live crypto market data",
        });

        setCompany({
          name: quote?.name || name,
          logo: quote?.logo || "",
          exchange: "Crypto",
          finnhubIndustry: quote?.category || "Digital Asset",
          marketCapitalization: Number(quote?.marketCap) / 1e6,
          weburl: quote?.homepage || "",
        });
        setFundamentals({
          marketCap: Number(quote?.marketCap) || null,
          peRatio: null,
          week52High: null,
          week52Low: null,
        });
        setLatestVolume(Number(quote?.volume) || null);
        setSectorInfo(null);
        addToSearchHistory(sym);

        try {
          const newsRes = await fetch(`/api/crypto-market-news?symbol=${encodeURIComponent(sym)}`);
          const newsData = await newsRes.json().catch(() => ({}));
          const items = Array.isArray(newsData?.news) ? newsData.news : [];
          const cleaned = items.filter((n) => n?.url && typeof n.url === "string" && n.url.startsWith("http")).slice(0, 5);
          setNews(cleaned);
        } catch {}

        fetchChart(sym, chartRange, assetId);

        try {
          setAnalysisLoading(true);
          const aiRes = await fetch(
            `/api/ai?market=crypto&symbol=${encodeURIComponent(sym)}&price=${encodeURIComponent(quote.price ?? "")}`
          );
          const aiData = await aiRes.json().catch(() => ({}));
          if (!aiRes.ok) {
            setAnalysisObj({ note: aiData?.error || `Analytical information failed (${aiRes.status}).` });
          } else {
            setAnalysisObj(aiData);
          }
        } catch {
          setAnalysisObj({ note: "Analytical information unavailable." });
        } finally {
          setAnalysisLoading(false);
        }
      } else if (assetMode === "metals") {
        const resolved = await resolveMetalAsset(rawCanonical || raw);
        const assetId = String(resolved?.id || "").trim();
        const sym = (resolved?.symbol || rawCanonical || raw).toUpperCase();
        const name = resolved?.name || sym;
        if (!sym) {
          setResult({ symbol: "—", price: "—", info: "Enter a metal name or symbol." });
          setLoading(false);
          return;
        }

        setUsingTicker(sym);
        setUsingAssetId(assetId);

        const quoteRes = await fetch(
          `/api/metals-quote?${assetId ? `id=${encodeURIComponent(assetId)}` : `symbol=${encodeURIComponent(sym)}`}`
        );
        const quote = await quoteRes.json().catch(() => ({}));

        if (!quoteRes.ok) {
          const msg = quote?.error || `Metals quote API failed (${quoteRes.status})`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const priceNum = Number(quote?.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
          const msg = `Unavailable quote for ${sym}.`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const pct = Number(quote?.percentChange);
        const chg = Number(quote?.change);
        setResult({
          symbol: quote.symbol || sym,
          price: `$${priceNum.toFixed(2)}`,
          change: Number.isFinite(chg) && Number.isFinite(pct) ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${pct.toFixed(2)}%)` : "",
          high: quote.high,
          low: quote.low,
          open: null,
          previousClose: null,
          info: "Live precious metals market data",
        });

        setCompany({
          name: quote?.name || name,
          logo: quote?.logo || "",
          exchange: "Metals",
          finnhubIndustry: "Precious Metal",
          marketCapitalization: Number(quote?.marketCap) / 1e6,
          weburl: "",
        });
        setFundamentals({
          marketCap: Number(quote?.marketCap) || null,
          peRatio: null,
          week52High: null,
          week52Low: null,
        });
        setLatestVolume(Number(quote?.volume) || null);
        setSectorInfo(null);
        addToSearchHistory(sym);

        try {
          const newsRes = await fetch(`/api/metals-market-news?symbol=${encodeURIComponent(sym)}`);
          const newsData = await newsRes.json().catch(() => ({}));
          const items = Array.isArray(newsData?.news) ? newsData.news : [];
          const cleaned = items.filter((n) => n?.url && typeof n.url === "string" && n.url.startsWith("http")).slice(0, 5);
          setNews(cleaned);
        } catch {}

        fetchChart(sym, chartRange, assetId);

        try {
          setAnalysisLoading(true);
          const aiRes = await fetch(
            `/api/ai?market=metals&symbol=${encodeURIComponent(sym)}&price=${encodeURIComponent(quote.price ?? "")}`
          );
          const aiData = await aiRes.json().catch(() => ({}));
          if (!aiRes.ok) {
            setAnalysisObj({ note: aiData?.error || `Analytical information failed (${aiRes.status}).` });
          } else {
            setAnalysisObj(aiData);
          }
        } catch {
          setAnalysisObj({ note: "Analytical information unavailable." });
        } finally {
          setAnalysisLoading(false);
        }
      } else {
        const sym = await resolveSymbol(rawCanonical || raw);
        if (!sym) {
          setResult({ symbol: "—", price: "—", info: "Enter a ticker or company name." });
          setLoading(false);
          return;
        }
        setUsingTicker(sym);
        setUsingAssetId("");

        // QUOTE
        const quoteRes = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
        const quote = await quoteRes.json().catch(() => ({}));

        if (!quoteRes.ok) {
          const msg = quote?.error || `Quote API failed (${quoteRes.status})`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const livePrice = Number(quote?.price);
        const prevClose = Number(quote?.previousClose);
        const hasPrice = Number.isFinite(livePrice) && livePrice > 0;
        const hasPrevClose = Number.isFinite(prevClose) && prevClose > 0;

        if (!hasPrice && !hasPrevClose) {
          const msg = `Invalid ticker or unavailable quote for ${sym}.`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const displayPrice = hasPrice ? livePrice : prevClose;
        const fallbackChange = hasPrice && hasPrevClose ? livePrice - prevClose : null;
        const fallbackPercent = hasPrice && hasPrevClose && prevClose > 0 ? (fallbackChange / prevClose) * 100 : null;

        const priceTxt = Number.isFinite(displayPrice) ? `$${displayPrice.toFixed(2)}` : "—";
        const changeTxt =
          typeof quote.change === "number" && typeof quote.percentChange === "number"
            ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)} (${quote.percentChange.toFixed(2)}%)`
            : Number.isFinite(fallbackChange) && Number.isFinite(fallbackPercent)
              ? `${fallbackChange >= 0 ? "+" : ""}${fallbackChange.toFixed(2)} (${fallbackPercent.toFixed(2)}%)`
              : "";

        setResult({
          symbol: quote.symbol || sym,
          price: priceTxt,
          change: changeTxt,
          high: quote.high,
          low: quote.low,
          open: quote.open,
          previousClose: quote.previousClose,
          info: quote.priceSource === "previousClose" ? "Using previous close (live quote unavailable)" : "Live market data",
        });
        addToSearchHistory(sym);

        // PROFILE
        try {
          const profileRes = await fetch(`/api/profile?symbol=${encodeURIComponent(sym)}`);
          const profileData = await profileRes.json().catch(() => ({}));
          if (profileRes.ok) {
            setCompany(profileData);
            fetchSectorAnalysis(profileData?.sector || profileData?.finnhubIndustry);
          }
        } catch {}
        fetchFundamentals(sym);

        // NEWS
        try {
          const newsRes = await fetch(`/api/news?symbol=${encodeURIComponent(sym)}`);
          const newsData = await newsRes.json().catch(() => ({}));
          const items = Array.isArray(newsData?.news) ? newsData.news : [];
          const cleaned = items.filter((n) => n?.url && typeof n.url === "string" && n.url.startsWith("http")).slice(0, 5);
          setNews(cleaned);
        } catch {}

        fetchChart(sym, chartRange);

        // AI ANALYSIS
        try {
          setAnalysisLoading(true);
          const aiRes = await fetch(
            `/api/ai?market=stock&symbol=${encodeURIComponent(sym)}&price=${encodeURIComponent(quote.price ?? "")}`
          );
          const aiData = await aiRes.json().catch(() => ({}));
          if (!aiRes.ok) {
            setAnalysisObj({ note: aiData?.error || `Analytical information failed (${aiRes.status}).` });
          } else {
            setAnalysisObj(aiData);
          }
        } catch {
          setAnalysisObj({ note: "Analytical information unavailable." });
        } finally {
          setAnalysisLoading(false);
        }
      }
    } catch {
      const msg = "Network error";
      setResult({ symbol: "—", price: "—", info: msg });
      setErrorMsg(msg);
    }

    setLoading(false);
  };

  const resetAnalysis = () => {
    setTicker("");
    setSuppressSuggestions(false);
    setSearchSuggestions([]);
    setSuggestionOpen(false);
    setUsingTicker("");
    setResult(null);
    setCompany(null);
    setSectorInfo(null);
    setNews([]);
    setAnalysisObj(null);
    setChartPoints([]);
    setErrorMsg("");
  };

  const handleAuthSubmit = async () => {
    const email = authEmail.trim();
    const password = authPassword;
    const confirmPassword = authConfirmPassword;
    const firstName = authFirstName.trim();
    const lastName = authLastName.trim();

    if (authMode === "forgot") return;

    if (authMode === "reset") {
      if (!password || !confirmPassword) {
        setAuthError("New password and confirm password are required.");
        return;
      }
      if (password !== confirmPassword) {
        setAuthError("Passwords do not match.");
        return;
      }
      if (password.length < 8) {
        setAuthError("Password must be at least 8 characters.");
        return;
      }
    } else {
      if (!email || !password) {
        setAuthError("Email and password are required.");
        return;
      }
    }

    if (authMode === "signup" && (!firstName || !lastName)) {
      setAuthError("First name and last name are required for sign up.");
      return;
    }
    if (authMode !== "forgot" && authMode !== "reset" && password.length < 8) {
      setAuthError("Password must be at least 8 characters.");
      return;
    }
    if (authMode === "signup" && password !== confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError("Authentication is not configured. Add Supabase env vars.");
      return;
    }

    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthNotice("");

      if (authMode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          setAuthError(error.message || "Password reset failed.");
          return;
        }
        setAuthNotice("Password updated successfully. You can now continue.");
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthMode("signin");
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", window.location.pathname);
        }
      } else if (authMode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName,
              last_name: lastName,
              full_name: `${firstName} ${lastName}`.trim(),
            },
            emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
          },
        });
        if (error) {
          setAuthError(error.message || "Sign up failed.");
          return;
        }
        setAuthNotice("Account created. You can now sign in.");
        setAuthMode("signin");
        setAuthFirstName("");
        setAuthLastName("");
        setAuthPassword("");
        setAuthConfirmPassword("");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setAuthError(error.message || "Sign in failed.");
          return;
        }
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthPanelOpen(false);
      }
    } catch {
      setAuthError("Authentication failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const email = authEmail.trim();
    if (!email) {
      setAuthError("Enter your email first.");
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError("Authentication is not configured. Add Supabase env vars.");
      return;
    }
    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthNotice("");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      });
      if (error) {
        setAuthError(error.message || "Could not send reset email.");
        return;
      }
      setAuthNotice("Reset email sent. Open the email link, then set your new password.");
    } catch {
      setAuthError("Could not send reset email. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUser(null);
    setUserMenuOpen(false);
    setProfilePanelOpen(false);
  };

  const handleSaveProfileName = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !authUser) {
      setProfileError("Profile update is unavailable.");
      return;
    }
    const first = profileFirstName.trim();
    const last = profileLastName.trim();
    if (!first || !last) {
      setProfileError("First name and last name are required.");
      return;
    }
    try {
      setProfileLoading(true);
      setProfileError("");
      setProfileNotice("");
      const { error } = await supabase.auth.updateUser({
        data: {
          first_name: first,
          last_name: last,
          full_name: `${first} ${last}`.trim(),
        },
      });
      if (error) {
        setProfileError(error.message || "Could not update profile.");
        return;
      }
      setProfileNotice("Profile updated.");
    } catch {
      setProfileError("Could not update profile.");
    } finally {
      setProfileLoading(false);
    }
  };

  const updateQuizField = (field, value) => {
    setQuizAnswers((prev) => ({ ...prev, [field]: value }));
  };

  const toggleQuizArrayValue = (field, value) => {
    setQuizAnswers((prev) => {
      const current = Array.isArray(prev[field]) ? prev[field] : [];
      const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
      return { ...prev, [field]: next };
    });
  };

  const validateQuiz = () => {
    if (quizFollowupMode) {
      if (!quizAnswers.followupChange) return "Please answer the follow-up question.";
      return "";
    }

    const required = [
      ["goal", "Goal"],
      ["horizon", "Investment horizon"],
      ["drawdownAction", "Drawdown behavior"],
      ["riskTolerance", "Risk tolerance"],
      ["incomeStability", "Income stability"],
      ["experience", "Experience"],
      ["analysisStyle", "Analysis style"],
      ["reviewFrequency", "Review frequency"],
      ["regionFocus", "Region focus"],
      ["liquidityNeeds", "Liquidity needs"],
      ["ethicalPreference", "Ethical preference"],
      ["dayTradingInterest", "Day trading interest"],
    ];
    for (const [key, label] of required) {
      if (!String(quizAnswers[key] || "").trim()) return `${label} is required.`;
    }
    if (!Array.isArray(quizAnswers.assetClasses) || quizAnswers.assetClasses.length === 0) {
      return "Select at least one preferred asset class.";
    }
    if (quizAnswers.dayTradingInterest.startsWith("yes") && quizAnswers.dayTradingMarkets.length === 0) {
      return "Select at least one day-trading market.";
    }
    if (quizAnswers.dayTradingInterest.startsWith("yes") && !quizAnswers.dayTradingTime) {
      return "Select time available per day for day trading.";
    }
    return "";
  };

  const submitQuiz = async () => {
    const err = validateQuiz();
    if (err) {
      setQuizError(err);
      return;
    }
    setQuizError("");
    setQuizSaving(true);
    setQuizCompleted(true);
    setQuizDismissed(false);
    setQuizPanelOpen(false);
    const completedAtIso = new Date().toISOString();
    setQuizCompletedAt(completedAtIso);
    setQuizFollowupDue(false);
    setQuizFollowupMode(false);

    const supabase = getSupabaseClient();
    if (supabase && authUser) {
      try {
        await supabase.auth.updateUser({
          data: {
            profile_quiz: quizAnswers,
            profile_quiz_completed: true,
            profile_quiz_completed_at: completedAtIso,
            profile_quiz_last_followup_change: quizAnswers.followupChange || "",
            profile_quiz_last_followup_notes: quizAnswers.followupNotes || "",
          },
        });
      } catch {}
    }
    setQuizSaving(false);
  };

  const fetchDayTraderPick = async () => {
    const enabled = Boolean(authUser && quizCompleted && String(quizAnswers.dayTradingInterest || "").startsWith("yes"));
    if (!enabled || assetMode === "fx" || assetMode === "news") {
      setDayTraderObj(null);
      return;
    }
    try {
      setDayTraderLoading(true);
      const profileHint = encodeURIComponent(
        JSON.stringify({
          riskTolerance: quizAnswers.riskTolerance,
          horizon: quizAnswers.horizon,
          dayTradingInterest: quizAnswers.dayTradingInterest,
          dayTradingMarkets: quizAnswers.dayTradingMarkets,
          dayTradingTime: quizAnswers.dayTradingTime,
          analysisStyle: quizAnswers.analysisStyle,
          experience: quizAnswers.experience,
        })
      );
      const res = await fetch(`/api/ai?mode=day_trader&market=${assetMode}&profile=${profileHint}`);
      const data = await res.json().catch(() => ({}));
      setDayTraderObj(data);
    } catch {
      setDayTraderObj({ note: "Day trader pick unavailable." });
    } finally {
      setDayTraderLoading(false);
    }
  };

  const analysisSummaryText = () => {
    if (!analysisView?.ticker) return "";
    const whyText = analysisView.why.slice(0, 4).map((x) => `- ${x}`).join("\n");
    const risksText = analysisView.risks.slice(0, 3).map((x) => `- ${x}`).join("\n");
    return [
      `Ticker: ${analysisView.ticker}`,
      `Recommendation: ${analysisView.recommendation || "N/A"}`,
      `Confidence: ${analysisView.confidence || 0}%`,
      `Risk Level: ${analysisView.riskLevel || "N/A"}`,
      "",
      "Why:",
      whyText || "- N/A",
      "",
      "Risks:",
      risksText || "- N/A",
      "",
      `Day Plan: ${analysisView.dayPlan || "N/A"}`,
      `Note: ${analysisView.note || "Educational only. Not financial advice."}`,
    ].join("\n");
  };

  const copyAnalysis = async () => {
    const text = analysisSummaryText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const shareAnalysis = async () => {
    const text = analysisSummaryText();
    if (!text) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Arthastra Analytical Information: ${analysisView.ticker}`, text });
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch {}
  };

  const sendChatMessage = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;

    const ctxSymbol = usingTicker || result?.symbol || "";
    const priceNum =
      typeof result?.price === "string" ? Number(result.price.replace(/[^0-9.-]/g, "")) : null;
    const priceForApi = Number.isFinite(priceNum) ? String(priceNum) : "";

    setChatMessages((prev) => [...prev, { role: "user", content: question }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const profileHint =
        authUser && quizCompleted
          ? encodeURIComponent(
              JSON.stringify({
                goal: quizAnswers.goal,
                horizon: quizAnswers.horizon,
                riskTolerance: quizAnswers.riskTolerance,
                experience: quizAnswers.experience,
                analysisStyle: quizAnswers.analysisStyle,
                dayTradingInterest: quizAnswers.dayTradingInterest,
                dayTradingMarkets: quizAnswers.dayTradingMarkets,
              })
            )
          : "";
      const res = await fetch(
        `/api/ai?mode=chat&market=${assetMode}&question=${encodeURIComponent(question)}&symbol=${encodeURIComponent(ctxSymbol)}&price=${encodeURIComponent(priceForApi)}${profileHint ? `&profile=${profileHint}` : ""}`
      );
      const data = await res.json().catch(() => ({}));
      const answer = cleanChatAnswer(data?.answer || data?.raw || data?.error || "I could not generate a reply.");
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network issue. Please try again. For informational purposes only. Not financial advice." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const dailyView = normalizeAiPayload(dailyObj);
  const dayTraderView = normalizeAiPayload(dayTraderObj);
  const analysisView = normalizeAiPayload(analysisObj);
  const isLight = theme === "light";
  const trendDelta =
    chartPoints.length > 1 ? Number(chartPoints[chartPoints.length - 1].close) - Number(chartPoints[0].close) : 0;
  const trendPct =
    chartPoints.length > 1 && Number(chartPoints[0].close) > 0
      ? (trendDelta / Number(chartPoints[0].close)) * 100
      : 0;
  const trendLabel =
    chartPoints.length > 1 ? (trendDelta >= 0 ? "Uptrend" : "Downtrend") : "No trend";
  const isFxMode = assetMode === "fx";
  const currentTabLabel =
    assetMode === "crypto"
      ? "crypto"
      : assetMode === "metals"
        ? "metals"
        : assetMode === "fx"
          ? "FX"
          : assetMode === "news"
            ? "world news"
            : "stock";
  const chatInputPlaceholder =
    assetMode === "crypto"
      ? "Ask anything (crypto, stocks, metals, FX, news)..."
      : assetMode === "metals"
        ? "Ask anything (metals, crypto, stocks, FX, news)..."
        : assetMode === "fx"
          ? "Ask anything (FX, stocks, crypto, metals, news)..."
          : assetMode === "news"
            ? "Ask anything (world news, markets, crypto, FX, metals)..."
            : "Ask anything (stocks, crypto, metals, FX, news)...";
  const isNewsMode = assetMode === "news";
  const isMetalsMode = assetMode === "metals";
  const overviewLoop = overview.length ? [...overview, ...overview] : [];
  const supabaseConfigured = Boolean(getSupabaseClient());
  const dayTraderEligible = Boolean(authUser && quizCompleted && String(quizAnswers.dayTradingInterest || "").startsWith("yes"));

  return (
    <div className={`min-h-screen relative overflow-hidden ${isLight ? "bg-[#f8fbff] text-slate-900" : "bg-slate-950 text-white"}`}>
      <div className={isLight ? "invert hue-rotate-180 brightness-102 saturate-62 contrast-95" : ""}>
        <div className={`pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full blur-3xl ${isLight ? "bg-sky-200/25" : "bg-cyan-500/12"}`} />
        <div className={`pointer-events-none absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl ${isLight ? "bg-blue-200/25" : "bg-blue-500/10"}`} />
        <div className={`pointer-events-none absolute inset-0 ${isLight ? "bg-[radial-gradient(circle_at_20%_10%,rgba(56,189,248,0.10),transparent_38%),radial-gradient(circle_at_80%_70%,rgba(147,197,253,0.12),transparent_40%)]" : "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.07),transparent_35%)]"}`}/>

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        {/* HEADER */}
        <div className="text-center mb-10">
          <div className="absolute left-6 top-0">
            <div className="inline-flex rounded-xl overflow-hidden border border-white/15 bg-slate-900/60">
              <button
                onClick={() => setTheme("dark")}
                className={`px-3 py-1.5 text-xs font-semibold ${theme === "dark" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-800" : "bg-transparent text-white/85"}`}
              >
                Dark
              </button>
              <button
                onClick={() => setTheme("light")}
                className={`px-3 py-1.5 text-xs font-semibold ${theme === "light" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-800" : "bg-transparent text-white/85"}`}
              >
                Light
              </button>
            </div>
          </div>
          <div className="absolute right-6 top-0 z-40 flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setSupportOpen((v) => !v)}
                className="px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/60 text-xs text-white/85 hover:bg-slate-800/70"
              >
                Help
              </button>
              {supportOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-white/15 bg-slate-900/95 p-3 shadow-2xl z-30">
                  <div className="text-xs text-white/70">Support Email</div>
                  <a href="mailto:support@arthastraai.com" className="block text-sm text-white mt-1 underline">
                    support@arthastraai.com
                  </a>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText("support@arthastraai.com");
                      } catch {}
                    }}
                    className="mt-2 px-2.5 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-xs text-white/90"
                  >
                    Copy email
                  </button>
                </div>
              )}
            </div>
            {authUser ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="h-8 min-w-8 px-2 rounded-full border border-white/20 bg-slate-900/70 text-xs font-semibold text-white shadow"
                  title={displayName}
                >
                  {userInitials}
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-white/15 bg-slate-900/95 p-2 shadow-2xl z-30">
                    <button
                      onClick={() => {
                        setProfilePanelOpen(true);
                        setUserMenuOpen(false);
                        setProfileError("");
                        setProfileNotice("");
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-white/90"
                    >
                      Profile
                    </button>
                    <button
                      onClick={() => {
                        setQuizPanelOpen(true);
                        setQuizFollowupMode(false);
                        setQuizDismissed(false);
                        setUserMenuOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-white/90"
                    >
                      Change preferences
                    </button>
                    <button
                      onClick={handleSignOut}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10 text-sm text-red-200"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => {
                  setAuthPanelOpen((v) => !v);
                  setAuthError("");
                  setAuthNotice("");
                }}
                className="px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/60 text-xs text-white/85 hover:bg-slate-800/70"
              >
                Login / Signup
              </button>
            )}
          </div>
          <div className="mt-4 flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/arthastra-premium-logo-alt2.svg"
              alt="Arthastra Analytical Information emblem"
              className="h-20 w-20 md:h-24 md:w-24 rounded-2xl border border-white/20 shadow-[0_10px_30px_-18px_rgba(34,211,238,0.8)] bg-slate-900/60 p-2"
            />
          </div>
          <h1 className="text-3xl md:text-5xl font-semibold mt-4 tracking-tight bg-gradient-to-r from-white via-cyan-100 to-sky-200 bg-clip-text text-transparent">
            Arthastra Analytical Information
          </h1>
          <p className="text-slate-300/80 mt-3 text-lg">Clarity in Every Market.</p>
          <p className="text-slate-400/80 text-xs mt-3">Founder: Deep Patel • Co-founder: Juan Ramirez</p>
          <div className="mt-5 inline-flex rounded-xl overflow-hidden border border-white/15 bg-slate-900/60">
            <button
              onClick={() => setAssetMode("stock")}
              className={`px-3 py-1.5 text-xs font-semibold ${assetMode === "stock" ? "bg-blue-600 text-white" : "bg-transparent text-white/80"}`}
            >
              Stock
            </button>
            <button
              onClick={() => setAssetMode("crypto")}
              className={`px-3 py-1.5 text-xs font-semibold ${assetMode === "crypto" ? "bg-blue-600 text-white" : "bg-transparent text-white/80"}`}
            >
              Crypto
            </button>
            <button
              onClick={() => setAssetMode("metals")}
              className={`px-3 py-1.5 text-xs font-semibold ${assetMode === "metals" ? "bg-blue-600 text-white" : "bg-transparent text-white/80"}`}
            >
              Metals
            </button>
            <button
              onClick={() => setAssetMode("fx")}
              className={`px-3 py-1.5 text-xs font-semibold ${assetMode === "fx" ? "bg-blue-600 text-white" : "bg-transparent text-white/80"}`}
            >
              FX
            </button>
            <button
              onClick={() => setAssetMode("news")}
              className={`px-3 py-1.5 text-xs font-semibold ${assetMode === "news" ? "bg-blue-600 text-white" : "bg-transparent text-white/80"}`}
            >
              News
            </button>
          </div>
        </div>

        {welcomeBanner.show && (
          <div className="mb-6">
            <Card title="Welcome">
              <div className="text-sm text-white/90">{welcomeBanner.text}</div>
            </Card>
          </div>
        )}

        {!authUser && authPanelOpen && (
          <div className="mb-6">
            <Card
              title="Account Access"
              right={
                <button
                  onClick={() => setAuthPanelOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                >
                  Close
                </button>
              }
            >
              <div className="text-sm text-white/80">
                Optional now. Required later for advanced member-only features.
              </div>
              {!supabaseConfigured ? (
                <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 text-amber-200 px-3 py-2 text-sm">
                  Auth is not configured yet. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
                </div>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {authMode === "signup" && (
                      <>
                        <input
                          type="text"
                          value={authFirstName}
                          onChange={(e) => setAuthFirstName(e.target.value)}
                          placeholder="First name"
                          className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                        />
                        <input
                          type="text"
                          value={authLastName}
                          onChange={(e) => setAuthLastName(e.target.value)}
                          placeholder="Last name"
                          className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                        />
                      </>
                    )}
                    {authMode !== "reset" && (
                      <input
                        type="email"
                        value={authEmail}
                        onChange={(e) => setAuthEmail(e.target.value)}
                        placeholder="Email"
                        className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                      />
                    )}
                    {(authMode === "signin" || authMode === "signup" || authMode === "reset") && (
                      <input
                        type="password"
                        value={authPassword}
                        onChange={(e) => setAuthPassword(e.target.value)}
                        placeholder={authMode === "reset" ? "New password (min 8 chars)" : "Password (min 8 chars)"}
                        className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                      />
                    )}
                    {(authMode === "signup" || authMode === "reset") && (
                      <input
                        type="password"
                        value={authConfirmPassword}
                        onChange={(e) => setAuthConfirmPassword(e.target.value)}
                        placeholder="Confirm password"
                        className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                      />
                    )}
                  </div>

                  {authError && (
                    <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
                      {authError}
                    </div>
                  )}
                  {authNotice && (
                    <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 px-3 py-2 text-sm">
                      {authNotice}
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {authMode !== "forgot" && (
                      <button
                        onClick={handleAuthSubmit}
                        disabled={authLoading || !authReady}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-60"
                      >
                        {authLoading
                          ? "Please wait..."
                          : authMode === "signup"
                            ? "Create Account"
                            : authMode === "reset"
                              ? "Update Password"
                              : "Sign In"}
                      </button>
                    )}
                    {authMode === "signin" && (
                      <button
                        onClick={() => {
                          setAuthMode("forgot");
                          setAuthError("");
                          setAuthNotice("");
                        }}
                        className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 text-sm"
                      >
                        Forgot Password
                      </button>
                    )}
                    {authMode === "forgot" && (
                      <>
                        <button
                          onClick={handleForgotPassword}
                          disabled={authLoading || !authReady}
                          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-60"
                        >
                          Send Reset Email
                        </button>
                        <button
                          onClick={() => {
                            setAuthMode("signin");
                            setAuthError("");
                            setAuthNotice("");
                          }}
                          className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 text-sm"
                        >
                          Back to Sign in
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setAuthMode((prev) => (prev === "signin" ? "signup" : "signin"));
                        setAuthError("");
                        setAuthNotice("");
                        setAuthFirstName("");
                        setAuthLastName("");
                        setAuthConfirmPassword("");
                      }}
                      disabled={authMode === "forgot" || authMode === "reset"}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/90 text-sm"
                    >
                      {authMode === "signin" ? "Switch to Sign up" : "Switch to Sign in"}
                    </button>
                    <span className="text-xs text-white/60">
                      {authReady ? (authUser?.email ? `Signed in as ${authUser.email}` : "Guest mode active") : "Checking session..."}
                    </span>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {authUser && profilePanelOpen && (
          <div className="mb-6">
            <Card
              title="Profile"
              right={
                <button
                  onClick={() => setProfilePanelOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                >
                  Close
                </button>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={profileFirstName}
                  onChange={(e) => setProfileFirstName(e.target.value)}
                  placeholder="First name"
                  className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  value={profileLastName}
                  onChange={(e) => setProfileLastName(e.target.value)}
                  placeholder="Last name"
                  className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleSaveProfileName}
                  disabled={profileLoading}
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold disabled:opacity-60"
                >
                  Save name
                </button>
              </div>

              {profileError && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
                  {profileError}
                </div>
              )}
              {profileNotice && (
                <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 px-3 py-2 text-sm">
                  {profileNotice}
                </div>
              )}
            </Card>
          </div>
        )}

        {authUser && !quizDismissed && (!quizCompleted || quizFollowupDue) && (
          <div className="mb-6">
            <Card
              title={quizFollowupDue ? "30-Day Profile Follow-up" : "Personalization Quiz"}
              right={
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setQuizPanelOpen(true);
                      if (quizFollowupDue) setQuizFollowupMode(true);
                      setQuizDismissed(false);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs"
                  >
                    {quizFollowupDue ? "Take follow-up" : "Take quiz"}
                  </button>
                  <button
                    onClick={() => {
                      setQuizPanelOpen(false);
                      setQuizDismissed(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                  >
                    Do it later
                  </button>
                </div>
              }
            >
              <div className="text-sm text-white/85">
                {quizFollowupDue
                  ? "It has been 30 days since your last profile update. Complete a quick follow-up for better analytical picks and ASTRA support."
                  : "Complete this optional quiz for better analytical picks and more personalized ASTRA responses."}
              </div>
              {!quizPanelOpen && (
                <div className="mt-2 text-xs text-amber-200/90">
                  Reminder: {quizFollowupDue ? "please confirm if your preferences changed." : "your profile is not complete yet, so analytical guidance is less personalized."}
                </div>
              )}
            </Card>
          </div>
        )}

        {authUser && quizPanelOpen && (
          <div className="mb-6">
            <Card
              title={quizFollowupMode ? "30-Day Profile Follow-up" : "Investor Profile Quiz"}
              right={
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setQuizPanelOpen(false);
                      setQuizDismissed(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                  >
                    Do it later
                  </button>
                  <button
                    onClick={submitQuiz}
                    disabled={quizSaving}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs disabled:opacity-60"
                  >
                    {quizSaving ? "Saving..." : "Save Quiz"}
                  </button>
                </div>
              }
            >
              {quizFollowupMode && (
                <div className="mb-4 rounded-lg border border-indigo-400/30 bg-indigo-500/10 p-3">
                  <div className="text-sm text-indigo-100 mb-2">Any preference changes since your last quiz?</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => updateQuizField("followupChange", "no_change")}
                      className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.followupChange === "no_change" ? "border-indigo-300 bg-indigo-400/25 text-indigo-100" : "border-white/15 bg-white/5 text-white/75"}`}
                    >
                      No, same preferences
                    </button>
                    <button
                      onClick={() => updateQuizField("followupChange", "changed")}
                      className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.followupChange === "changed" ? "border-indigo-300 bg-indigo-400/25 text-indigo-100" : "border-white/15 bg-white/5 text-white/75"}`}
                    >
                      Yes, preferences changed
                    </button>
                  </div>
                  {quizAnswers.followupChange === "changed" && (
                    <input
                      value={quizAnswers.followupNotes}
                      onChange={(e) => updateQuizField("followupNotes", e.target.value)}
                      placeholder="What changed? (optional notes)"
                      className="mt-3 w-full px-3 py-2 rounded-lg bg-white text-black"
                    />
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <label className="space-y-1">
                  <span className="text-white/70">Primary goal</span>
                  <select value={quizAnswers.goal} onChange={(e) => updateQuizField("goal", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="long_term_wealth">Long-term wealth</option>
                    <option value="passive_income">Passive income</option>
                    <option value="active_trading">Active trading</option>
                    <option value="capital_preservation">Capital preservation</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Investment horizon</span>
                  <select value={quizAnswers.horizon} onChange={(e) => updateQuizField("horizon", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="under_6m">Less than 6 months</option>
                    <option value="6m_24m">6 to 24 months</option>
                    <option value="2y_5y">2 to 5 years</option>
                    <option value="5y_plus">5+ years</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">If portfolio drops 20%</span>
                  <select value={quizAnswers.drawdownAction} onChange={(e) => updateQuizField("drawdownAction", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="sell_most">Sell most positions</option>
                    <option value="reduce_risk">Reduce some risk</option>
                    <option value="hold">Hold</option>
                    <option value="buy_more">Buy more</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Risk tolerance</span>
                  <select value={quizAnswers.riskTolerance} onChange={(e) => updateQuizField("riskTolerance", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Income stability / emergency fund</span>
                  <select value={quizAnswers.incomeStability} onChange={(e) => updateQuizField("incomeStability", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="not_stable">Not stable</option>
                    <option value="somewhat_stable">Somewhat stable</option>
                    <option value="stable">Stable</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Experience</span>
                  <select value={quizAnswers.experience} onChange={(e) => updateQuizField("experience", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Analysis style</span>
                  <select value={quizAnswers.analysisStyle} onChange={(e) => updateQuizField("analysisStyle", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="fundamental">Fundamental</option>
                    <option value="technical">Technical</option>
                    <option value="balanced">Balanced</option>
                    <option value="sentiment">News / Sentiment</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Review frequency</span>
                  <select value={quizAnswers.reviewFrequency} onChange={(e) => updateQuizField("reviewFrequency", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly_plus">Quarterly+</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Region focus</span>
                  <select value={quizAnswers.regionFocus} onChange={(e) => updateQuizField("regionFocus", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="us">US</option>
                    <option value="global_developed">Global developed</option>
                    <option value="emerging">Emerging markets</option>
                    <option value="none">No preference</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Liquidity needs</span>
                  <select value={quizAnswers.liquidityNeeds} onChange={(e) => updateQuizField("liquidityNeeds", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="high">Need frequent access</option>
                    <option value="medium">Moderate</option>
                    <option value="low">Long lock-up okay</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Ethical preference</span>
                  <select value={quizAnswers.ethicalPreference} onChange={(e) => updateQuizField("ethicalPreference", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="esg">ESG</option>
                    <option value="shariah">Shariah</option>
                    <option value="none">No preference</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                {quizAnswers.ethicalPreference === "other" && (
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-white/70">Ethical preference details (optional)</span>
                    <input value={quizAnswers.ethicalOther} onChange={(e) => updateQuizField("ethicalOther", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black" placeholder="Enter details" />
                  </label>
                )}
                <label className="space-y-1 md:col-span-2">
                  <span className="text-white/70">Day trading interest</span>
                  <select value={quizAnswers.dayTradingInterest} onChange={(e) => updateQuizField("dayTradingInterest", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="no">No</option>
                    <option value="yes_beginner">Yes (beginner)</option>
                    <option value="yes_experienced">Yes (experienced)</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-white/70 mb-2">Preferred asset classes</div>
                  <div className="flex flex-wrap gap-2">
                    {["stocks", "crypto", "metals", "fx"].map((v) => (
                      <button key={v} onClick={() => toggleQuizArrayValue("assetClasses", v)} className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.assetClasses.includes(v) ? "border-blue-400 bg-blue-500/20 text-blue-200" : "border-white/15 bg-white/5 text-white/75"}`}>
                        {v.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-white/70 mb-2">Sector preferences</div>
                  <div className="flex flex-wrap gap-2">
                    {["tech", "healthcare", "financials", "energy", "consumer", "industrial", "none"].map((v) => (
                      <button key={v} onClick={() => toggleQuizArrayValue("sectorPreferences", v)} className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.sectorPreferences.includes(v) ? "border-blue-400 bg-blue-500/20 text-blue-200" : "border-white/15 bg-white/5 text-white/75"}`}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-white/70">Exclude sectors/themes (optional)</span>
                  <input value={quizAnswers.exclusions} onChange={(e) => updateQuizField("exclusions", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black" placeholder="Example: tobacco, leverage, meme coins" />
                </label>
              </div>

              {String(quizAnswers.dayTradingInterest || "").startsWith("yes") && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-white/70 mb-2">Day-trading markets</div>
                    <div className="flex flex-wrap gap-2">
                      {["stocks", "crypto", "fx"].map((v) => (
                        <button key={v} onClick={() => toggleQuizArrayValue("dayTradingMarkets", v)} className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.dayTradingMarkets.includes(v) ? "border-indigo-400 bg-indigo-500/20 text-indigo-200" : "border-white/15 bg-white/5 text-white/75"}`}>
                          {v.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="space-y-1">
                    <span className="text-white/70">Time available per day</span>
                    <select value={quizAnswers.dayTradingTime} onChange={(e) => updateQuizField("dayTradingTime", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                      <option value="">Select</option>
                      <option value="lt_1h">Less than 1 hour</option>
                      <option value="1_3h">1 to 3 hours</option>
                      <option value="3h_plus">3+ hours</option>
                    </select>
                  </label>
                </div>
              )}

              {quizError && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{quizError}</div>}
            </Card>
          </div>
        )}

        {/* MARKET OVERVIEW */}
        {!isNewsMode && (
        <div className="mb-6">
          <Card
            title={isFxMode ? "FX Market Overview" : "Market Overview"}
            right={
              <button
                onClick={fetchOverview}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                Refresh
              </button>
            }
          >
            <div className="overflow-hidden pb-1">
              <div
                className={`${
                  isMetalsMode
                    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
                    : "market-ticker-track flex gap-3 w-max"
                }`}
                style={isMetalsMode ? undefined : { animationDuration: `${Math.max(18, overview.length * 4)}s` }}
              >
                {(isMetalsMode ? overview : overviewLoop).map((o, idx) => (
                  <div key={`${o.symbol}-${idx}`} className={`${isMetalsMode ? "w-full min-h-[180px] md:min-h-[200px] p-5" : isFxMode ? "w-36 p-3" : "w-28 p-3"} shrink-0 rounded-xl bg-slate-900/70 border border-white/10 shadow-[0_6px_20px_-16px_rgba(14,165,233,0.7)]`}>
                  <div className={`${isMetalsMode ? "text-3xl" : isFxMode ? "text-lg" : "text-sm"} font-semibold leading-tight`}>{isMetalsMode ? (o.name || metalNameBySymbol[o.symbol] || o.symbol) : o.symbol}</div>
                  {isMetalsMode && (
                    <div className="text-base text-slate-400 mt-1">{o.symbol}</div>
                  )}
                  {isFxMode && (
                    <div className="text-[11px] text-slate-400 mt-1">{o.name || ""}</div>
                  )}
                  <div className={`${isMetalsMode ? "text-2xl mt-5" : isFxMode ? "text-sm mt-2" : "text-xs"} text-slate-300/85`}>
                    {fmt(o.price) != null ? `${isFxMode ? Number(o.price).toFixed(4) : `$${Number(o.price).toFixed(2)}`}` : "—"}
                  </div>
                  {!isMetalsMode && (
                    <div
                      className={`${isFxMode ? "text-xs" : "text-xs"} ${
                        fmt(o.percent) == null ? "text-slate-400" : o.percent >= 0 ? "text-green-300" : "text-red-300"
                      }`}
                    >
                      {fmt(o.percent) != null ? `${o.percent >= 0 ? "+" : ""}${Number(o.percent).toFixed(2)}%` : (isFxMode ? "Live FX" : "—")}
                    </div>
                  )}
                </div>
              ))}
              </div>
            </div>
          </Card>
        </div>
        )}

        {isFxMode && !isNewsMode && (
          <div className="mb-6">
            <Card
              title="Exchange Rate Converter"
              right={
                <button
                  onClick={convertFx}
                  disabled={fxLoading}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs disabled:opacity-50"
                >
                  {fxLoading ? "Converting..." : "Convert"}
                </button>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  value={fxAmount}
                  onChange={(e) => setFxAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && convertFx()}
                  placeholder="Amount (ex: 1)"
                  className="px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
                <input
                  value={fxFrom}
                  onChange={(e) => setFxFrom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && convertFx()}
                  placeholder="From (USD or India)"
                  list="fx-currency-options"
                  className="px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
                <input
                  value={fxTo}
                  onChange={(e) => setFxTo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && convertFx()}
                  placeholder="To (INR or Japan)"
                  list="fx-currency-options"
                  className="px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
                <button
                  onClick={() => {
                    const a = fxFrom;
                    setFxFrom(fxTo);
                    setFxTo(a);
                  }}
                  className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-sm"
                >
                  Swap
                </button>
              </div>
              <datalist id="fx-currency-options">
                {FX_CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code} label={`${c.name} (${c.code})`} />
                ))}
                {FX_CURRENCY_OPTIONS.map((c) => (
                  <option key={`${c.code}-name`} value={c.name} />
                ))}
              </datalist>

              <div className="mt-2 text-xs text-white/60">
                Tip: use code (`INR`) or country/currency name (`India`, `Japanese Yen`, `UK`).
              </div>

              {fxError && (
                <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {fxError}
                </div>
              )}

              {fxResult && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/60 mb-1">Rate</div>
                    <div className="text-lg font-semibold">
                      1 {fxResult.from} = {Number(fxResult.rate).toFixed(6)} {fxResult.to}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/60 mb-1">Converted</div>
                    <div className="text-lg font-semibold">
                      {Number(fxResult.amount).toFixed(2)} {fxResult.from} = {Number(fxResult.converted).toFixed(4)} {fxResult.to}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/60 mb-1">As Of</div>
                    <div className="text-lg font-semibold">{fxResult.asOf || "—"}</div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* MOVERS + MARKET NEWS */}
        {!isFxMode && !isNewsMode && (
        <div className={`grid grid-cols-1 ${isMetalsMode ? "" : "lg:grid-cols-2"} gap-6 mb-6`}>
          {!isMetalsMode && (
            <Card
              title="Top Gainers / Losers"
              right={
                <button onClick={fetchMovers} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs">
                  Refresh
                </button>
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-green-300 mb-2">Top Gainers</div>
                  <div className="space-y-2">
                    {movers.gainers.slice(0, 5).map((m) => (
                      <div key={`g-${m.symbol}`} className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs">
                        <div className="font-semibold">{m.symbol}</div>
                        <div className="text-white/70">${Number(m.price || 0).toFixed(2)}</div>
                        <div className="text-green-300">
                          {Number(m.percentChange) >= 0 ? "+" : ""}
                          {Number(m.percentChange || 0).toFixed(2)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-red-300 mb-2">Top Losers</div>
                  <div className="space-y-2">
                    {movers.losers.slice(0, 5).map((m) => (
                      <div key={`l-${m.symbol}`} className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs">
                        <div className="font-semibold">{m.symbol}</div>
                        <div className="text-white/70">${Number(m.price || 0).toFixed(2)}</div>
                        <div className="text-red-300">
                          {Number(m.percentChange) >= 0 ? "+" : ""}
                          {Number(m.percentChange || 0).toFixed(2)}%
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card
            title={isMetalsMode ? "Metals News" : "Market News"}
            right={
              <button
                onClick={fetchMarketNews}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                Refresh
              </button>
            }
          >
            <div className="space-y-2">
              {marketNews.slice(0, 6).map((n, idx) => (
                <a
                  key={`${n.url}-${idx}`}
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-sm text-blue-300 hover:underline"
                >
                  • {n.headline}
                </a>
              ))}
              {marketNews.length === 0 && (
                <div className="text-sm text-white/60">{isMetalsMode ? "No metals headlines yet." : "No market headlines yet."}</div>
              )}
            </div>
          </Card>
        </div>
        )}

        {/* DAILY PICK + SEARCH ROW */}
        {!isFxMode && !isNewsMode && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="space-y-6">
          <Card
            title="ASTRA Today Pick"
            right={
              <button
                onClick={fetchDailyPick}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                {dailyLoading ? "Loading..." : "Refresh"}
              </button>
            }
          >
            {(dailyView.recommendation || dailyView.ticker) && (
              <div className="mb-3 flex items-center gap-2">
                <Badge value={dailyView.recommendation} />
                <span className="text-white/80 text-sm">{dailyView.ticker || "—"}</span>
                {dailyView.confidence > 0 && (
                  <span className="text-[11px] rounded-full border border-blue-400/30 bg-blue-500/15 text-blue-200 px-2 py-0.5">
                    Confidence {dailyView.confidence}%
                  </span>
                )}
                {dailyView.riskLevel && (
                  <span
                    className={`text-[11px] rounded-full border px-2 py-0.5 ${
                      dailyView.riskLevel === "LOW"
                        ? "border-green-400/30 bg-green-500/15 text-green-200"
                        : dailyView.riskLevel === "MEDIUM"
                          ? "border-yellow-400/30 bg-yellow-500/15 text-yellow-200"
                          : "border-red-400/30 bg-red-500/15 text-red-200"
                    }`}
                  >
                    Risk {dailyView.riskLevel}
                  </span>
                )}
              </div>
            )}

            {dailyLoading ? (
              <div className="text-sm text-white/60 animate-pulse">Loading today’s pick...</div>
            ) : (
              <div className="space-y-3">
                {dailyView.why.length > 0 && (
                  <div>
                    <div className="text-xs text-white/60 mb-1">Why</div>
                    <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                      {dailyView.why.slice(0, 4).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {dailyView.risks.length > 0 && (
                  <div>
                    <div className="text-xs text-white/60 mb-1">Risks</div>
                    <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                      {dailyView.risks.slice(0, 3).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {dailyView.dayPlan && (
                  <div>
                    <div className="text-xs text-white/60 mb-1">Day plan</div>
                    <div className="text-sm text-white/90">{dailyView.dayPlan}</div>
                  </div>
                )}

                {dailyView.note && <div className="text-xs text-white/55">{dailyView.note}</div>}

                {dailyView.fallbackText && (
                  <div className="text-sm text-white/90 whitespace-pre-line">{dailyView.fallbackText}</div>
                )}
              </div>
            )}
          </Card>
          {dayTraderEligible && (
            <Card
              title="ASTRA Day Trader Pick"
              right={
                <button
                  onClick={fetchDayTraderPick}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                >
                  {dayTraderLoading ? "Loading..." : "Refresh"}
                </button>
              }
            >
              {(dayTraderView.recommendation || dayTraderView.ticker) && (
                <div className="mb-3 flex items-center gap-2">
                  <Badge value={dayTraderView.recommendation} />
                  <span className="text-white/80 text-sm">{dayTraderView.ticker || "—"}</span>
                  {dayTraderView.confidence > 0 && (
                    <span className="text-[11px] rounded-full border border-blue-400/30 bg-blue-500/15 text-blue-200 px-2 py-0.5">
                      Confidence {dayTraderView.confidence}%
                    </span>
                  )}
                </div>
              )}
              {dayTraderLoading ? (
                <div className="text-sm text-white/60 animate-pulse">Loading day-trader pick...</div>
              ) : (
                <div className="space-y-3">
                  {dayTraderView.why.length > 0 && (
                    <div>
                      <div className="text-xs text-white/60 mb-1">Setup rationale</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {dayTraderView.why.slice(0, 4).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {dayTraderView.dayPlan && (
                    <div>
                      <div className="text-xs text-white/60 mb-1">Trade plan</div>
                      <div className="text-sm text-white/90">{dayTraderView.dayPlan}</div>
                    </div>
                  )}
                  {dayTraderView.note && <div className="text-xs text-white/55">{dayTraderView.note}</div>}
                  {dayTraderView.fallbackText && (
                    <div className="text-sm text-white/90 whitespace-pre-line">{dayTraderView.fallbackText}</div>
                  )}
                </div>
              )}
            </Card>
          )}
          </div>

          <Card
            title={`Multi-${assetMode === "crypto" ? "Crypto" : assetMode === "metals" ? "Metals" : "Stock"} Comparison`}
            right={
              <button
                onClick={runComparison}
                disabled={compareLoading}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs disabled:opacity-50"
              >
                {compareLoading ? "Comparing..." : "Compare"}
              </button>
            }
          >
            <div className="flex gap-2 mb-3">
              <input
                value={compareInput}
                onChange={(e) => setCompareInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runComparison()}
                placeholder={assetMode === "crypto" ? "BTC,ETH,SOL" : assetMode === "metals" ? "XAU,XAG,XPT" : "AAPL,MSFT,NVDA"}
                className="flex-1 px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-white/60">
                  <tr className="text-left border-b border-white/10">
                    <th className="py-2 pr-2">Ticker</th>
                    <th className="py-2 pr-2">Name</th>
                    <th className="py-2 pr-2">Price</th>
                    <th className="py-2 pr-2">Day $</th>
                    <th className="py-2 pr-2">Change %</th>
                    <th className="py-2 pr-2">Volume</th>
                    <th className="py-2 pr-2">52W High/Low</th>
                    <th className="py-2 pr-2">P/E</th>
                    <th className="py-2 pr-2">Market Cap</th>
                    <th className="py-2 pr-2">Sector</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((r) => (
                    <tr key={r.symbol} className="border-b border-white/5">
                      <td className="py-2 pr-2 font-semibold">{r.symbol}</td>
                      <td className="py-2 pr-2 text-white/80">{r.name || "—"}</td>
                      <td className="py-2 pr-2">{fmt(r.price) != null ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                      <td className={`py-2 pr-2 ${Number(r.change) >= 0 ? "text-green-300" : "text-red-300"}`}>
                        {fmt(r.change) != null ? `${Number(r.change) >= 0 ? "+" : ""}${Number(r.change).toFixed(2)}` : "—"}
                      </td>
                      <td className={`py-2 pr-2 ${Number(r.percentChange) >= 0 ? "text-green-300" : "text-red-300"}`}>
                        {fmt(r.percentChange) != null
                          ? `${Number(r.percentChange) >= 0 ? "+" : ""}${Number(r.percentChange).toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="py-2 pr-2">{fmt(r.volume) != null ? fmtLarge(r.volume) : "—"}</td>
                      <td className="py-2 pr-2">
                        {fmt(r.week52High) != null || fmt(r.week52Low) != null
                          ? `${fmt(r.week52Low) != null ? Number(r.week52Low).toFixed(2) : "—"} / ${fmt(r.week52High) != null ? Number(r.week52High).toFixed(2) : "—"}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-2">{fmt(r.peRatio) != null ? Number(r.peRatio).toFixed(2) : "—"}</td>
                      <td className="py-2 pr-2">{fmt(r.marketCap) != null ? `$${fmtLarge(r.marketCap)}` : "—"}</td>
                      <td className="py-2 pr-2">{r.sector || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        )}

        {/* SEARCH */}
        {!isFxMode && !isNewsMode && (
        <div className="mb-6">
          <Card
            title="Search"
            right={
              <button
                onClick={resetAnalysis}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                Clear
              </button>
            }
          >
            <label className="text-sm text-white/60">
              {assetMode === "crypto"
                ? "Search a crypto name or symbol"
                : assetMode === "metals"
                  ? "Search a metal symbol (XAU, XAG, XPT, XPD)"
                  : "Search a company name or stock ticker"}
            </label>

            <div className="mt-3 flex gap-2 items-start">
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder={
                    assetMode === "crypto"
                      ? 'Try "Bitcoin" or "BTC"'
                      : assetMode === "metals"
                        ? 'Try "XAU" or "XAG"'
                        : 'Try "Apple" or "AAPL"'
                  }
                  value={ticker}
                  onChange={(e) => {
                    setSuppressSuggestions(false);
                    setTicker(e.target.value);
                  }}
                  onFocus={() => searchSuggestions.length > 0 && setSuggestionOpen(true)}
                  onKeyDown={(e) => e.key === "Enter" && searchStock()}
                  className="w-full px-4 py-3 rounded-xl bg-white text-black text-lg
                             border-2 border-white/20 outline-none
                             focus:border-blue-500 focus:ring-4 focus:ring-blue-500/30
                             placeholder:text-gray-500 shadow-lg"
                />

                {suggestionOpen && (
                  <div className="absolute z-30 mt-2 w-full rounded-xl border border-white/10 bg-slate-950/95 backdrop-blur-md shadow-2xl overflow-hidden">
                    {suggestionLoading ? (
                      <div className="px-3 py-2 text-xs text-white/60">Finding matches...</div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto">
                        {searchSuggestions.map((s) => (
                          <button
                            key={s.symbol}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applySuggestion(s);
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-white/10 border-b border-white/5 last:border-b-0"
                          >
                            <div className="text-sm font-semibold text-white">{s.symbol}</div>
                            <div className="text-xs text-white/60 truncate">{s.description || "Company"}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={searchStock}
                disabled={loading}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors
                           font-semibold shadow-lg disabled:opacity-50"
              >
                {loading ? "Loading..." : "Search"}
              </button>
            </div>

            {errorMsg && (
              <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {errorMsg}
              </div>
            )}

            {usingTicker && (
              <div className="text-xs text-white/50 mt-2">
                Using {assetMode === "stock" ? "ticker" : "asset"}: <span className="text-white/70">{usingTicker}</span>
              </div>
            )}

            {searchHistory.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-white/50 mb-2">Recent</div>
                <div className="flex flex-wrap gap-2">
                  {searchHistory.map((sym) => (
                    <button
                      key={sym}
                      onClick={() => {
                        setTicker(sym);
                        searchStock(sym);
                      }}
                      className="px-2.5 py-1 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-xs"
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
        )}

        {isNewsMode && (
          <div className="mb-6">
            <Card
              title="World Market Impact News"
              right={
                <button
                  onClick={fetchMarketNews}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                >
                  Refresh
                </button>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {marketNews.slice(0, 24).map((n, idx) => (
                  <a
                    key={`${n.url}-${idx}`}
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10 transition-all"
                  >
                    <div className="flex gap-3">
                      <div className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden border border-white/10">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/35 via-cyan-500/20 to-slate-800/30" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          {faviconUrlFor(n.url) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={faviconUrlFor(n.url)}
                              alt="Source"
                              className="h-9 w-9 rounded-full bg-white/90 p-1.5 ring-1 ring-white/30"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-full bg-white/20" />
                          )}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-blue-300 group-hover:underline line-clamp-3">{n.headline}</div>
                        <div className="mt-2 text-[11px] text-white/50">
                          {[n.source || safeDomainFromUrl(n.url), n.datetime].filter(Boolean).join(" • ") || "Global feed"}
                        </div>
                        <div className="mt-1 text-[11px] text-white/40 truncate">{safeDomainFromUrl(n.url)}</div>
                      </div>
                    </div>
                  </a>
                ))}
                {marketNews.length === 0 && <div className="text-sm text-white/60">No world-impact headlines yet.</div>}
              </div>
            </Card>
          </div>
        )}

        {/* COMPANY */}
        {!isNewsMode && company?.name && (
          <div className="mb-6">
            <Card title={assetMode === "stock" ? "Company" : "Market Asset"}>
              <div className="flex items-center gap-3">
                {company.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.logo} alt={`${company.name} logo`} className="h-10 w-10 rounded bg-white p-1" />
                )}
                <div>
                  <div className="text-lg font-semibold">{company.name}</div>
                  <div className="text-sm text-white/60 mt-1">
                    {company.exchange ? `${company.exchange}` : ""}{" "}
                    {company.finnhubIndustry ? `• ${company.finnhubIndustry}` : ""}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs text-white/70">
                    <div>Sector: {company.sector || company.finnhubIndustry || "—"}</div>
                    <div>Industry: {company.finnhubIndustry || "—"}</div>
                    <div>
                      Market Cap: $
                      {fmt(company.marketCapitalization) != null
                        ? `${fmtLarge(Number(company.marketCapitalization) * 1e6)}`
                        : fmt(fundamentals?.marketCap) != null
                          ? fmtLarge(fundamentals.marketCap)
                          : "—"}
                    </div>
                    <div>IPO: {company.ipo || "—"}</div>
                  </div>
                </div>
              </div>

              {company.weburl && (
                <a
                  href={company.weburl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-3 text-sm text-blue-300 hover:underline"
                >
                  Company website
                </a>
              )}
            </Card>
          </div>
        )}

        {assetMode === "stock" && !isNewsMode && sectorInfo && (
          <div className="mb-6">
            <Card title="Sector Analysis">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="text-white/60 text-xs mb-1">Detected Sector</div>
                  <div className="font-semibold">{sectorInfo.sector}</div>
                  <div className="text-white/70 text-xs mt-1">Benchmark ETF: {sectorInfo.benchmark}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="text-white/60 text-xs mb-1">Sector Daily Move</div>
                  <div className={`font-semibold ${Number(sectorInfo.percentChange) >= 0 ? "text-green-300" : "text-red-300"}`}>
                    {fmt(sectorInfo.percentChange) != null
                      ? `${Number(sectorInfo.percentChange) >= 0 ? "+" : ""}${Number(sectorInfo.percentChange).toFixed(2)}%`
                      : "—"}
                  </div>
                  <div className="text-white/70 text-xs mt-1">
                    ETF Price: {fmt(sectorInfo.price) != null ? `$${Number(sectorInfo.price).toFixed(2)}` : "—"}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* QUOTE + CHART */}
        {!isNewsMode && (result || chartLoading || (chartPoints?.length > 0)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {result && (
              <Card title="Quote">
                <div className="text-xl font-semibold">{result.symbol}</div>
                <div className="text-3xl font-bold mt-1">{result.price}</div>

                {result.change && (
                  <div className={`text-sm mt-1 ${result.change.startsWith("+") ? "text-green-400" : "text-red-400"}`}>
                    {result.change}
                  </div>
                )}

                <div className="mt-3 space-y-1">
                  {fmt(result.high) != null && <div className="text-white/70 text-sm">High: ${result.high}</div>}
                  {fmt(result.low) != null && <div className="text-white/70 text-sm">Low: ${result.low}</div>}
                  {fmt(result.open) != null && <div className="text-white/70 text-sm">Open: ${result.open}</div>}
                  {fmt(result.previousClose) != null && <div className="text-white/70 text-sm">Prev Close: ${result.previousClose}</div>}
                  <div className="text-white/70 text-sm">
                    Volume: {fmt(latestVolume) != null ? fmtLarge(latestVolume) : "—"}
                  </div>
                  <div className="text-white/70 text-sm">
                    P/E Ratio: {fmt(fundamentals?.peRatio) != null ? Number(fundamentals.peRatio).toFixed(2) : "—"}
                  </div>
                  <div className="text-white/70 text-sm">
                    52W Range:{" "}
                    {fmt(fundamentals?.week52Low) != null && fmt(fundamentals?.week52High) != null
                      ? `$${Number(fundamentals.week52Low).toFixed(2)} - $${Number(fundamentals.week52High).toFixed(2)}`
                      : "—"}
                  </div>
                  <div className={`text-sm ${trendDelta >= 0 ? "text-green-300" : "text-red-300"}`}>
                    Trend: {trendLabel} {chartPoints.length > 1 ? `(${trendDelta >= 0 ? "+" : ""}${trendPct.toFixed(2)}%)` : ""}
                  </div>
                </div>

                <div className="text-white/50 text-xs pt-3">{result.info}</div>
              </Card>
            )}

            {(result || chartLoading || chartPoints?.length > 0) && (
              <Card
                title={`${assetMode === "crypto" ? "Crypto" : assetMode === "metals" ? "Metals" : "Stock"} Chart`}
                right={
                  <div className="inline-flex rounded-lg overflow-hidden border border-white/10">
                    {["1D", "1W", "1M", "1Y"].map((r) => (
                      <button
                        key={r}
                        onClick={() => setChartRange(r)}
                        className={`px-2 py-1 text-[11px] ${chartRange === r ? "bg-blue-600 text-white" : "bg-white/5 text-white/80"}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                }
              >
                {chartLoading ? (
                  <div className="text-sm text-white/60 animate-pulse">Loading chart...</div>
                ) : (
                  <>
                    {chartPoints?.length > 0 ? (
                      <>
                        <canvas ref={chartRef} className="w-full h-[180px] rounded-xl bg-black/30" />
                        <div className="text-xs text-white/50 mt-2">
                          Data source: {assetMode === "stock" ? "Finnhub/Stooq" : assetMode === "metals" ? "Yahoo/Alpha Vantage" : "CoinGecko"} candles. Educational view.
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-white/60">No chart data for this range. Try another range.</div>
                    )}
                  </>
                )}
              </Card>
            )}
          </div>
        )}

        {/* ANALYTICAL INFORMATION */}
        {!isNewsMode && (analysisLoading || analysisObj) && (
          <div className="mb-6">
            <Card
              title="ASTRA Analysis"
              right={
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyAnalysis}
                    className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11px]"
                  >
                    Copy
                  </button>
                  <button
                    onClick={shareAnalysis}
                    className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11px]"
                  >
                    Share
                  </button>
                  <Badge value={analysisView.recommendation} />
                </div>
              }
            >
              {analysisLoading ? (
                <div className="text-white/50 text-sm animate-pulse">Analyzing...</div>
              ) : (
                <>
                  {analysisView.ticker && (
                    <div className="text-sm text-white/80 mb-3 flex flex-wrap items-center gap-2">
                      <span>Ticker: {analysisView.ticker}</span>
                      {analysisView.aiScore > 0 && (
                        <span className="text-[11px] rounded-full border border-cyan-400/30 bg-cyan-500/15 text-cyan-200 px-2 py-0.5">
                          Analytical Score {analysisView.aiScore}/100
                        </span>
                      )}
                      {analysisView.confidence > 0 && (
                        <span className="text-[11px] rounded-full border border-blue-400/30 bg-blue-500/15 text-blue-200 px-2 py-0.5">
                          Confidence {analysisView.confidence}%
                        </span>
                      )}
                      {analysisView.horizon && (
                        <span className="text-[11px] rounded-full border border-indigo-400/30 bg-indigo-500/15 text-indigo-200 px-2 py-0.5">
                          Horizon {analysisView.horizon === "LONG_TERM" ? "Long Term" : "Short Term"}
                        </span>
                      )}
                      {analysisView.riskLevel && (
                        <span
                          className={`text-[11px] rounded-full border px-2 py-0.5 ${
                            analysisView.riskLevel === "LOW"
                              ? "border-green-400/30 bg-green-500/15 text-green-200"
                              : analysisView.riskLevel === "MEDIUM"
                                ? "border-yellow-400/30 bg-yellow-500/15 text-yellow-200"
                                : "border-red-400/30 bg-red-500/15 text-red-200"
                          }`}
                        >
                          Risk {analysisView.riskLevel}
                        </span>
                      )}
                    </div>
                  )}

                  {(analysisView.shortSummary || analysisView.longSummary) && (
                    <div className="mb-4">
                      <div className="inline-flex rounded-lg overflow-hidden border border-white/10 mb-2">
                        <button
                          onClick={() => setAnalysisViewMode("short")}
                          className={`px-2.5 py-1 text-[11px] ${analysisViewMode === "short" ? "bg-blue-600 text-white" : "bg-white/5 text-white/80"}`}
                        >
                          Short
                        </button>
                        <button
                          onClick={() => setAnalysisViewMode("long")}
                          className={`px-2.5 py-1 text-[11px] ${analysisViewMode === "long" ? "bg-blue-600 text-white" : "bg-white/5 text-white/80"}`}
                        >
                          Detailed
                        </button>
                      </div>
                      <div className="text-sm text-white/90 whitespace-pre-line">
                        {analysisViewMode === "long"
                          ? analysisView.longSummary || analysisView.shortSummary
                          : analysisView.shortSummary || analysisView.longSummary}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="text-xs text-white/60 mb-1">Bull vs Bear Probability</div>
                      <div className="text-sm text-green-300">Bull: {analysisView.bullProbability}%</div>
                      <div className="text-sm text-red-300">Bear: {analysisView.bearProbability}%</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="text-xs text-white/60 mb-1">Risk Assessment</div>
                      <div className="text-sm text-white/90">
                        {analysisView.riskExplanation || "Risk reflects volatility, valuation, and event exposure."}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-4">
                    <div className="text-xs text-white/60 mb-2">Analytical Reasoning Categories</div>
                    <div className="space-y-2 text-sm">
                      {[
                        ["Fundamental", analysisView.reasoningCategories.fundamental],
                        ["Technical", analysisView.reasoningCategories.technical],
                        ["Sentiment", analysisView.reasoningCategories.sentiment],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <div className="flex justify-between text-xs text-white/70">
                            <span>{label}</span>
                            <span>{Number(value).toFixed(0)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/10 mt-1">
                            <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${value}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {analysisView.strengths.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">Strengths</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {analysisView.strengths.slice(0, 4).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysisView.why.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">Why</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {analysisView.why.slice(0, 6).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysisView.risks.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">Risks</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {analysisView.risks.slice(0, 3).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysisView.dayPlan && (
                    <div className="mb-2">
                      <div className="text-xs text-white/60 mb-2">Day plan</div>
                      <div className="text-sm text-white/90">{analysisView.dayPlan}</div>
                    </div>
                  )}

                  {analysisView.outlook && (
                    <div className="mb-2">
                      <div className="text-xs text-white/60 mb-2">Outlook</div>
                      <div className="text-sm text-white/90">{analysisView.outlook}</div>
                    </div>
                  )}

                  {analysisView.note && <div className="text-xs text-white/55 mt-4">{analysisView.note}</div>}

                  {analysisView.fallbackText && (
                    <div className="text-xs text-white/50 mt-4 whitespace-pre-line">{analysisView.fallbackText}</div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}

        {/* NEWS */}
        {!isNewsMode && news.length > 0 && (
          <div className="mb-6">
            <Card title="Latest News">
              <div className="space-y-2">
                {news.map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noreferrer" className="block text-blue-300 hover:underline text-sm">
                    • {n.headline}
                  </a>
                ))}
              </div>
            </Card>
          </div>
        )}

          <p className="text-center text-[11px] text-white/40 mt-8">
            For informational purposes only. This platform does not provide financial, investment, legal, tax, or accounting advice. All decisions and outcomes are solely your responsibility.
          </p>
        </div>
      </div>

      {/* FLOATING ASTRA CHAT */}
      <div className="fixed bottom-5 right-5 z-50">
        {chatOpen ? (
          <div
            className={`w-[92vw] max-w-sm sm:max-w-md rounded-2xl shadow-2xl overflow-hidden ${
              isLight ? "border border-slate-300 bg-white" : "border border-white/15 bg-[#0e1015]"
            }`}
          >
            <div className={`flex items-center justify-between px-4 py-3 ${isLight ? "border-b border-slate-200 bg-slate-50" : "border-b border-white/10 bg-white/[0.04]"}`}>
              <div>
                <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>ASTRA Virtual Assistant</div>
                <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/55"}`}>
                  {usingTicker ? `Context (${currentTabLabel}): ${usingTicker}` : "Context optional. Ask anything."}
                </div>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className={`h-8 w-8 rounded-full ${isLight ? "bg-slate-200 hover:bg-slate-300 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white/80"}`}
                aria-label="Close chat"
              >
                x
              </button>
            </div>

            <div className="h-80 overflow-y-auto p-3 space-y-3">
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line leading-relaxed ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : isLight
                          ? "bg-slate-100 text-slate-900 border border-slate-200"
                          : "bg-white/10 text-white/90 border border-white/10"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div
                    className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                      isLight ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-white/10 text-white/75 border border-white/10"
                    }`}
                  >
                    ASTRA is thinking...
                  </div>
                </div>
              )}
            </div>

            <div className={`p-3 flex gap-2 ${isLight ? "border-t border-slate-200" : "border-t border-white/10"}`}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
                placeholder={chatInputPlaceholder}
                className="flex-1 px-3 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              />
              <button
                onClick={sendChatMessage}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold disabled:opacity-50"
              >
                Send
              </button>
            </div>
            <div className={`px-3 pb-3 text-[10px] leading-relaxed ${isLight ? "text-slate-500" : "text-white/45"}`}>
              For informational purposes only. This platform does not provide financial, investment, legal, tax, or accounting advice. All decisions and outcomes are solely your responsibility.
            </div>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="rounded-full bg-blue-600 hover:bg-blue-500 text-white px-5 py-3 font-semibold shadow-xl border border-blue-400/40"
          >
            ASTRA Assistant
          </button>
        )}
      </div>
    </div>
  );
}
