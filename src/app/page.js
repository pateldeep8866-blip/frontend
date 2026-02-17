"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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
  const [ticker, setTicker] = useState("");
  const [usingTicker, setUsingTicker] = useState("");

  const [result, setResult] = useState(null);
  const [company, setCompany] = useState(null);
  const [news, setNews] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [recommendationHistory, setRecommendationHistory] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [theme, setTheme] = useState("dark");
  const [analysisViewMode, setAnalysisViewMode] = useState("short");
  const [marketNews, setMarketNews] = useState([]);
  const [movers, setMovers] = useState({ gainers: [], losers: [] });
  const [sectorInfo, setSectorInfo] = useState(null);
  const [compareInput, setCompareInput] = useState("AAPL,MSFT,NVDA");
  const [compareRows, setCompareRows] = useState([]);
  const [compareLoading, setCompareLoading] = useState(false);

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
        "I am ASTRA. Ask me anything about a stock, valuation basics, risks, or strategy ideas.",
    },
  ]);

  // Market overview
  const overviewTickers = useMemo(
    () => [
      "SPY",
      "QQQ",
      "DIA",
      "IWM",
      "AAPL",
      "MSFT",
      "NVDA",
      "AMZN",
      "GOOGL",
      "META",
    ],
    []
  );
  const [overview, setOverview] = useState([]);
  const [fundamentals, setFundamentals] = useState(null);

  // Watchlist
  const [watch, setWatch] = useState([]);

  // Chart
  const [chartPoints, setChartPoints] = useState([]);
  const [chartRange, setChartRange] = useState("1M");
  const [chartLoading, setChartLoading] = useState(false);
  const [latestVolume, setLatestVolume] = useState(null);
  const chartRef = useRef(null);

  // Load saved watchlist
  useEffect(() => {
    try {
      const w = JSON.parse(localStorage.getItem("watchlist") || "[]");
      if (Array.isArray(w)) setWatch(w);
    } catch {}
    try {
      const h = JSON.parse(localStorage.getItem("search_history") || "[]");
      if (Array.isArray(h)) setSearchHistory(h.slice(0, 8));
    } catch {}
    try {
      const rh = JSON.parse(localStorage.getItem("recommendation_history") || "[]");
      if (Array.isArray(rh)) setRecommendationHistory(rh.slice(0, 20));
    } catch {}
    try {
      const t = localStorage.getItem("theme_mode");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("watchlist", JSON.stringify(watch));
  }, [watch]);

  useEffect(() => {
    localStorage.setItem("search_history", JSON.stringify(searchHistory.slice(0, 8)));
  }, [searchHistory]);

  useEffect(() => {
    localStorage.setItem("recommendation_history", JSON.stringify(recommendationHistory.slice(0, 20)));
  }, [recommendationHistory]);

  useEffect(() => {
    localStorage.setItem("theme_mode", theme);
  }, [theme]);

  useEffect(() => {
    if (loading) {
      setSuggestionOpen(false);
      return;
    }

    const q = ticker.trim();
    if (q.length < 2) {
      setSearchSuggestions([]);
      setSuggestionOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSuggestionLoading(true);
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
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
          if (!symbol) continue;
          if (!dedup.has(symbol)) dedup.set(symbol, { symbol, description });
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
  }, [ticker]);

  const applySuggestion = (symbol) => {
    const sym = canonicalTicker(symbol);
    if (!sym) return;
    setTicker(sym);
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

  async function fetchDailyPick() {
    try {
      setDailyLoading(true);
      const res = await fetch("/api/ai?mode=daily");
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
    try {
      const res = await fetch("/api/market-news");
      const data = await res.json().catch(() => ({}));
      setMarketNews(Array.isArray(data?.news) ? data.news.slice(0, 8) : []);
    } catch {
      setMarketNews([]);
    }
  }

  async function fetchMovers() {
    try {
      const res = await fetch("/api/movers");
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
            percentChange: q?.percentChange,
            peRatio: m?.peRatio,
            marketCap: p?.marketCapitalization ? Number(p.marketCapitalization) * 1e6 : null,
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

  async function fetchFundamentals(symbol) {
    if (!symbol) return;
    try {
      const res = await fetch(`/api/metrics?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFundamentals(data);
    } catch {}
  }

  async function fetchChart(symbol, range) {
    if (!symbol) return;
    const key = range || "1M";
    const configByRange = {
      "1D": { resolution: "5", days: 1 },
      "1W": { resolution: "30", days: 7 },
      "1M": { resolution: "D", days: 30 },
      "1Y": { resolution: "W", days: 365 },
    };
    const cfg = configByRange[key] || configByRange["1M"];

    try {
      setChartLoading(true);
      const res = await fetch(
        `/api/candles?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(cfg.resolution)}&days=${cfg.days}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data?.c) || !Array.isArray(data?.t)) {
        setChartPoints([]);
        setLatestVolume(null);
        return;
      }

      const points = data.c
        .map((close, i) => ({
          close: Number(close),
          date: data.t[i] ? new Date(Number(data.t[i]) * 1000).toISOString() : "",
          volume: Number(data?.v?.[i]),
        }))
        .filter((p) => Number.isFinite(p.close));

      setChartPoints(points);
      const last = points[points.length - 1];
      setLatestVolume(Number.isFinite(last?.volume) ? last.volume : null);
    } catch {
      setChartPoints([]);
      setLatestVolume(null);
    } finally {
      setChartLoading(false);
    }
  }

  // Initial loads
  useEffect(() => {
    fetchDailyPick();
    fetchOverview();
    fetchMarketNews();
    setTimeout(fetchMovers, 1200);
    const t = setInterval(fetchOverview, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!usingTicker) return;
    fetchChart(usingTicker, chartRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRange, usingTicker]);

  const searchStock = async (forcedInput) => {
    const raw = String(forcedInput ?? ticker).trim();
    if (!raw) return;
    const rawCanonical = canonicalTicker(raw);

    setLoading(true);
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
      const sym = await resolveSymbol(rawCanonical || raw);
      if (!sym) {
        setResult({ symbol: "—", price: "—", info: "Enter a ticker or company name." });
        setLoading(false);
        return;
      }
      setUsingTicker(sym);

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
      setSearchHistory((prev) => [sym, ...prev.filter((x) => x !== sym)].slice(0, 8));

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
          `/api/ai?symbol=${encodeURIComponent(sym)}&price=${encodeURIComponent(quote.price ?? "")}`
        );
        const aiData = await aiRes.json().catch(() => ({}));
        if (!aiRes.ok) {
          setAnalysisObj({ note: aiData?.error || `AI analysis failed (${aiRes.status}).` });
        } else {
          setAnalysisObj(aiData);
          const normalized = normalizeAiPayload(aiData);
          if (normalized?.ticker || sym) {
            setRecommendationHistory((prev) =>
              [
                {
                  ts: Date.now(),
                  ticker: normalized.ticker || sym,
                  recommendation: normalized.recommendation || "HOLD",
                  aiScore: normalized.aiScore || 0,
                  confidence: normalized.confidence || 0,
                },
                ...prev,
              ].slice(0, 20)
            );
          }
        }
      } catch {
        setAnalysisObj({ note: "AI analysis unavailable." });
      } finally {
        setAnalysisLoading(false);
      }
    } catch {
      const msg = "Network error";
      setResult({ symbol: "—", price: "—", info: msg });
      setErrorMsg(msg);
    }

    setLoading(false);
  };

  const addToWatchlist = async () => {
    const sym = canonicalTicker(await resolveSymbol(ticker));
    if (!sym) return;
    setWatch((prev) => (prev.includes(sym) ? prev : [sym, ...prev]));
  };

  const resetAnalysis = () => {
    setTicker("");
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
        await navigator.share({ title: `Arthastra AI: ${analysisView.ticker}`, text });
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
      const res = await fetch(
        `/api/ai?mode=chat&question=${encodeURIComponent(question)}&symbol=${encodeURIComponent(ctxSymbol)}&price=${encodeURIComponent(priceForApi)}`
      );
      const data = await res.json().catch(() => ({}));
      const answer = cleanChatAnswer(data?.answer || data?.raw || data?.error || "I could not generate a reply.");
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network issue. Please try again. Educational only. Not financial advice." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const dailyView = normalizeAiPayload(dailyObj);
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
  const overviewLoop = overview.length ? [...overview, ...overview] : [];

  return (
    <div className={`min-h-screen relative overflow-hidden ${isLight ? "bg-white text-slate-900" : "bg-slate-950 text-white"}`}>
      <div className={isLight ? "invert hue-rotate-180 brightness-110 saturate-75" : ""}>
        <div className="pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full bg-cyan-500/12 blur-3xl" />
        <div className="pointer-events-none absolute top-1/3 -right-28 h-96 w-96 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.07),transparent_35%)]" />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        {/* HEADER */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-slate-900/70 px-4 py-2 text-sm text-white/85 shadow-sm">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            Arthastra AI
          </div>
          <h1 className="text-4xl md:text-6xl font-semibold mt-4 tracking-tight bg-gradient-to-r from-white via-cyan-100 to-sky-200 bg-clip-text text-transparent">
            Arthastra AI
          </h1>
          <p className="text-slate-300/80 mt-3 text-lg">Your intelligent investing assistant</p>
          <p className="text-slate-400/80 text-xs mt-3">Founder: Deep Patel • Co-founder: Juan Ramirez</p>
          <div className="mt-5 inline-flex rounded-xl overflow-hidden border border-white/15 bg-slate-900/60">
            <button
              onClick={() => setTheme("dark")}
              className={`px-3 py-1.5 text-xs font-semibold ${theme === "dark" ? "bg-blue-600 text-white" : "bg-transparent"}`}
            >
              Dark
            </button>
            <button
              onClick={() => setTheme("light")}
              className={`px-3 py-1.5 text-xs font-semibold ${theme === "light" ? "bg-blue-600 text-white" : "bg-transparent"}`}
            >
              Light
            </button>
          </div>
        </div>

        {/* MARKET OVERVIEW */}
        <div className="mb-6">
          <Card
            title="Market Overview"
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
                className="market-ticker-track flex gap-3 w-max"
                style={{ animationDuration: `${Math.max(18, overview.length * 4)}s` }}
              >
                {overviewLoop.map((o, idx) => (
                  <div key={`${o.symbol}-${idx}`} className="w-28 shrink-0 rounded-xl bg-slate-900/70 border border-white/10 p-3 shadow-[0_6px_20px_-16px_rgba(14,165,233,0.7)]">
                  <div className="text-sm font-semibold">{o.symbol}</div>
                  <div className="text-xs text-slate-300/85">
                    {fmt(o.price) != null ? `$${Number(o.price).toFixed(2)}` : "—"}
                  </div>
                  <div
                    className={`text-xs ${
                      fmt(o.percent) != null && o.percent >= 0 ? "text-green-300" : "text-red-300"
                    }`}
                  >
                    {fmt(o.percent) != null ? `${o.percent >= 0 ? "+" : ""}${Number(o.percent).toFixed(2)}%` : "—"}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </Card>
        </div>

        {/* MOVERS + MARKET NEWS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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

          <Card
            title="Market News"
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
              {marketNews.length === 0 && <div className="text-sm text-white/60">No market headlines yet.</div>}
            </div>
          </Card>
        </div>

        {/* DAILY PICK + SEARCH ROW */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card
            title="Today’s AI Pick"
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
            <label className="text-sm text-white/60">Search a company name or stock ticker</label>

            <div className="mt-3 flex gap-2 items-start">
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder='Try "Apple" or "AAPL"'
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value)}
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
                              applySuggestion(s.symbol);
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
                Using ticker: <span className="text-white/70">{usingTicker}</span>
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

        {/* FAVORITES */}
        <div className="mb-6">
          <Card title="Favorite Stocks">
            {watch.length === 0 ? (
              <div className="text-sm text-white/60">No favorites yet.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {watch.map((sym) => (
                  <div
                    key={sym}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"
                  >
                    <span className="text-sm">{sym}</span>
                    <button
                      onClick={() => setWatch((prev) => prev.filter((x) => x !== sym))}
                      className="text-white/50 hover:text-white text-xs"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4">
              <button onClick={addToWatchlist} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm">
                Save current input as favorite
              </button>
            </div>
          </Card>
        </div>

        {/* MULTI-STOCK COMPARISON */}
        <div className="mb-6">
          <Card
            title="Multi-Stock Comparison"
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
                placeholder="AAPL,MSFT,NVDA"
                className="flex-1 px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-white/60">
                  <tr className="text-left border-b border-white/10">
                    <th className="py-2 pr-2">Ticker</th>
                    <th className="py-2 pr-2">Price</th>
                    <th className="py-2 pr-2">Change %</th>
                    <th className="py-2 pr-2">P/E</th>
                    <th className="py-2 pr-2">Market Cap</th>
                    <th className="py-2 pr-2">Sector</th>
                  </tr>
                </thead>
                <tbody>
                  {compareRows.map((r) => (
                    <tr key={r.symbol} className="border-b border-white/5">
                      <td className="py-2 pr-2 font-semibold">{r.symbol}</td>
                      <td className="py-2 pr-2">{fmt(r.price) != null ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                      <td className={`py-2 pr-2 ${Number(r.percentChange) >= 0 ? "text-green-300" : "text-red-300"}`}>
                        {fmt(r.percentChange) != null
                          ? `${Number(r.percentChange) >= 0 ? "+" : ""}${Number(r.percentChange).toFixed(2)}%`
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

        {/* COMPANY */}
        {company?.name && (
          <div className="mb-6">
            <Card title="Company">
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

        {sectorInfo && (
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
        {(result || chartLoading || (chartPoints?.length > 0)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {result && (
              <Card
                title="Quote"
                right={
                  <button
                    onClick={addToWatchlist}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                  >
                    Save Favorite
                  </button>
                }
              >
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

            {(chartLoading || chartPoints?.length > 0) && (
              <Card
                title="Stock Chart"
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
                <canvas ref={chartRef} className="w-full h-[180px] rounded-xl bg-black/30" />
                <div className="text-xs text-white/50 mt-2">Data source: Finnhub candles. Educational view.</div>
                  </>
                )}
              </Card>
            )}
          </div>
        )}

        {/* AI ANALYSIS */}
        {(analysisLoading || analysisObj) && (
          <div className="mb-6">
            <Card
              title="AI Investment Analysis"
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
                          AI Score {analysisView.aiScore}/100
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
                    <div className="text-xs text-white/60 mb-2">AI Reasoning Categories</div>
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

        {recommendationHistory.length > 0 && (
          <div className="mb-6">
            <Card
              title="Recommendation History"
              right={
                <button
                  onClick={() => setRecommendationHistory([])}
                  className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11px]"
                >
                  Clear
                </button>
              }
            >
              <div className="space-y-2">
                {recommendationHistory.slice(0, 10).map((r, idx) => (
                  <div key={`${r.ts}-${idx}`} className="rounded-lg border border-white/10 bg-white/5 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="font-semibold">{r.ticker}</div>
                      <div className="text-white/60">{new Date(r.ts).toLocaleString()}</div>
                    </div>
                    <div className="mt-1 text-white/80">
                      {r.recommendation} • AI Score {r.aiScore}/100 • Confidence {r.confidence}%
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* NEWS */}
        {news.length > 0 && (
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

          <p className="text-center text-xs text-white/40 mt-8">Educational tool only. Not financial advice.</p>
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
                  {usingTicker ? `Context: ${usingTicker}` : "No stock selected"}
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
                placeholder="Ask about any stock..."
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
