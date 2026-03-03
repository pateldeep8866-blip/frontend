"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

const GLOSSARY_TERMS = [
  {
    term: "VIX",
    definition: "A volatility index often called the market fear gauge. Higher VIX usually means bigger expected swings.",
  },
  {
    term: "Earnings",
    definition: "Quarterly company results that show revenue, profit, and guidance. These releases can move stocks quickly.",
  },
  {
    term: "Guidance",
    definition: "Management's outlook for future performance. Markets often react more to guidance than to past results.",
  },
  {
    term: "Volatility",
    definition: "How much prices move up and down over time. Higher volatility means wider swings and higher risk.",
  },
  {
    term: "Liquidity",
    definition: "How easily an asset can be bought or sold without strongly impacting its price.",
  },
  {
    term: "Market Cap",
    definition: "Company size measured by stock price times shares outstanding.",
  },
  {
    term: "P/E Ratio",
    definition: "Price-to-earnings ratio. It compares stock price to earnings per share.",
  },
  {
    term: "Support",
    definition: "A price zone where buyers often step in and slow a decline.",
  },
  {
    term: "Resistance",
    definition: "A price zone where sellers often appear and slow an advance.",
  },
  {
    term: "Fed",
    definition: "The US Federal Reserve. Its rate decisions strongly affect stocks, bonds, and currencies.",
  },
  {
    term: "Inflation",
    definition: "The pace at which prices rise in the economy. Persistent inflation can influence rates and valuations.",
  },
  {
    term: "Yield",
    definition: "Return from a bond or income-generating asset, often shown as a percentage.",
  },
];

const THEME_OPTIONS = ["dark", "light", "cherry", "azula", "alerik"];
const DIFFICULTY_FILTERS = ["All", "Beginner", "Intermediate", "Advanced"];

function toTitleDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toLocaleDateString();
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function normalizeDifficulty(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "advanced") return "Advanced";
  if (raw === "intermediate") return "Intermediate";
  return "Beginner";
}

function difficultyClass(difficulty, isLight) {
  if (difficulty === "Advanced") {
    return isLight
      ? "border-rose-300 bg-rose-50 text-rose-700"
      : "border-rose-400/35 bg-rose-500/20 text-rose-200";
  }
  if (difficulty === "Intermediate") {
    return isLight
      ? "border-amber-300 bg-amber-50 text-amber-700"
      : "border-amber-400/35 bg-amber-500/20 text-amber-200";
  }
  return isLight
    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
    : "border-emerald-400/35 bg-emerald-500/20 text-emerald-200";
}

function readStore(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function getLast7Days() {
  const out = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function computeStreak(activityDays) {
  const set = new Set((Array.isArray(activityDays) ? activityDays : []).map((d) => String(d || "").slice(0, 10)));
  const now = new Date();
  let streak = 0;
  for (let i = 0; i < 365; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (set.has(key)) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

function readHeadlineFallbackFromOtherPages() {
  const out = [];
  try {
    const raw = localStorage.getItem("headline_impact_cache_v1");
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") {
      Object.keys(parsed).forEach((headline) => {
        const clean = String(headline || "").trim();
        if (clean) out.push({ headline: clean, source: "cached-headline-impact" });
      });
    }
  } catch {}
  return out.slice(0, 5);
}

function readMoversCache() {
  try {
    const raw = localStorage.getItem("market_school_movers_cache_v1");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMoversCache(movers) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const normalized = Array.isArray(movers)
      ? movers
          .map((row) => ({
            symbol: String(row?.symbol || "").toUpperCase(),
            percentChange: Number(row?.percentChange),
            price: Number(row?.price),
            date: String(row?.date || today).slice(0, 10),
          }))
          .filter((row) => row.symbol)
      : [];
    if (normalized.length) localStorage.setItem("market_school_movers_cache_v1", JSON.stringify(normalized));
  } catch {}
}

function writeHeadlinesCache(headlines) {
  try {
    const normalized = Array.isArray(headlines)
      ? headlines
          .map((row) => ({
            headline: String(row?.headline || "").trim(),
            source: String(row?.source || "cached"),
            url: String(row?.url || ""),
          }))
          .filter((row) => row.headline)
      : [];
    if (normalized.length) localStorage.setItem("market_school_headlines_cache_v1", JSON.stringify(normalized.slice(0, 8)));
  } catch {}
}

function readHeadlinesCache() {
  try {
    const raw = localStorage.getItem("market_school_headlines_cache_v1");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function splitWithGlossary(text, termMap, onTermClick, keyPrefix) {
  const source = String(text || "");
  if (!source) return null;
  const escapedTerms = Array.from(termMap.keys())
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (!escapedTerms.length) return source;

  const pattern = new RegExp(`\\b(${escapedTerms.join("|")})\\b`, "gi");
  const nodes = [];
  let lastIndex = 0;
  let match;
  let part = 0;

  while ((match = pattern.exec(source)) !== null) {
    const [rawTerm] = match;
    const start = match.index;
    if (start > lastIndex) {
      nodes.push(
        <span key={`${keyPrefix}-text-${part}`}>{source.slice(lastIndex, start)}</span>
      );
      part += 1;
    }
    const exact = Array.from(termMap.keys()).find((key) => key.toLowerCase() === rawTerm.toLowerCase()) || rawTerm;
    nodes.push(
      <button
        type="button"
        key={`${keyPrefix}-term-${part}`}
        onClick={() => onTermClick(exact)}
        className="underline decoration-dotted underline-offset-2 font-semibold hover:opacity-80"
      >
        {rawTerm}
      </button>
    );
    part += 1;
    lastIndex = start + rawTerm.length;
  }

  if (lastIndex < source.length) {
    nodes.push(<span key={`${keyPrefix}-tail`}>{source.slice(lastIndex)}</span>);
  }

  return nodes;
}

export default function MarketSchoolPage() {
  const [theme, setTheme] = useState("dark");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [snapshotDate, setSnapshotDate] = useState("");
  const [marketSummary, setMarketSummary] = useState("");
  const [lessons, setLessons] = useState([]);
  const [marketContext, setMarketContext] = useState({ vix: null, movers: [], headlines: [], economicEvents: [] });
  const [provider, setProvider] = useState("");
  const [expandedLessonId, setExpandedLessonId] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("All");
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [glossaryQuery, setGlossaryQuery] = useState("");
  const [activeTerm, setActiveTerm] = useState(null);
  const [readLessons, setReadLessons] = useState([]);
  const [activityDays, setActivityDays] = useState([]);

  const loadLessons = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const cachedMovers = readMoversCache();
      const cachedHeadlines = [
        ...readHeadlinesCache(),
        ...readHeadlineFallbackFromOtherPages(),
      ]
        .filter((item) => item?.headline)
        .slice(0, 8);
      const res = await fetch("/api/market-school-lessons", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cachedMovers,
          cachedHeadlines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Failed to load lessons (${res.status})`);
      }
      const nextLessons = Array.isArray(data?.lessons) ? data.lessons : [];
      setLessons(nextLessons);
      setSnapshotDate(String(data?.date || ""));
      setMarketSummary(String(data?.marketSummary || "Today's market offers practical lessons in risk and context."));
      setMarketContext({
        vix: data?.context?.vix || null,
        movers: Array.isArray(data?.context?.movers) ? data.context.movers : [],
        headlines: Array.isArray(data?.context?.headlines) ? data.context.headlines : [],
        economicEvents: Array.isArray(data?.context?.economicEvents) ? data.context.economicEvents : [],
      });
      setProvider(String(data?.provider || ""));
      writeMoversCache(data?.context?.movers);
      writeHeadlinesCache(data?.context?.headlines);
      if (!nextLessons.length) {
        setError("Unable to load today's lessons, try refreshing");
      }
    } catch (err) {
      setError("Unable to load today's lessons, try refreshing");
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (THEME_OPTIONS.includes(saved)) setTheme(saved);
    } catch {}

    setReadLessons(readStore("market_school_read_lessons_v1", []));
    setActivityDays(readStore("market_school_activity_days_v1", []));

    try {
      const term = new URLSearchParams(window.location.search).get("term");
      if (term) setActiveTerm(term);
    } catch {}
  }, []);

  useEffect(() => {
    loadLessons(false);
  }, [loadLessons]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadLessons(true);
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [loadLessons]);

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
        ? "min-h-screen relative overflow-hidden bg-gradient-to-br from-white via-blue-50 to-cyan-50 text-slate-900"
        : "min-h-screen relative overflow-hidden bg-slate-950 text-white";

  const cardClass = isCherry
    ? "rounded-2xl border border-rose-200/60 bg-white/90 backdrop-blur-sm p-5 shadow-[0_10px_34px_rgba(190,24,93,0.1)]"
    : isAzula
      ? "app-card rounded-2xl border border-[#c5a66a]/40 bg-[#111116]/92 backdrop-blur-sm p-5 shadow-[0_14px_34px_rgba(0,0,0,0.42)]"
      : isAlerik
        ? "app-card rounded-2xl border border-[#c9a84c]/26 bg-[#101010]/92 backdrop-blur-sm p-5 shadow-[0_18px_40px_rgba(0,0,0,0.46)]"
        : isLight
        ? "rounded-2xl border border-blue-200/80 bg-white/90 backdrop-blur-sm p-5 shadow-[0_10px_34px_rgba(59,130,246,0.1)]"
        : "rounded-2xl border border-white/12 bg-slate-900/55 p-5";

  const termMap = useMemo(
    () =>
      new Map(
        GLOSSARY_TERMS.map((item) => [item.term, item])
      ),
    []
  );

  const filteredTerms = useMemo(() => {
    const q = glossaryQuery.trim().toLowerCase();
    if (!q) return GLOSSARY_TERMS;
    return GLOSSARY_TERMS.filter((item) => {
      const t = item.term.toLowerCase();
      const d = item.definition.toLowerCase();
      return t.includes(q) || d.includes(q);
    });
  }, [glossaryQuery]);

  const readLessonSet = useMemo(
    () => new Set((Array.isArray(readLessons) ? readLessons : []).map((id) => String(id))),
    [readLessons]
  );
  const lessonsReadThisBatch = useMemo(
    () => lessons.filter((lesson) => readLessonSet.has(String(lesson?.id || ""))).length,
    [lessons, readLessonSet]
  );
  const completionPct = lessons.length ? Math.round((lessonsReadThisBatch / lessons.length) * 100) : 0;
  const visibleLessons = useMemo(
    () =>
      lessons.filter((lesson) => {
        const diff = normalizeDifficulty(lesson?.difficulty);
        if (difficultyFilter !== "All" && diff !== difficultyFilter) return false;
        if (showUnreadOnly && readLessonSet.has(String(lesson?.id || ""))) return false;
        return true;
      }),
    [lessons, difficultyFilter, showUnreadOnly, readLessonSet]
  );

  const streakDays = useMemo(() => getLast7Days(), []);
  const streakSet = useMemo(
    () => new Set((Array.isArray(activityDays) ? activityDays : []).map((d) => String(d).slice(0, 10))),
    [activityDays]
  );
  const currentStreak = useMemo(() => computeStreak(activityDays), [activityDays]);
  const topMover = marketContext.movers?.[0] || null;
  const vixValue = Number(marketContext?.vix?.value);
  const vixChangePct = Number(marketContext?.vix?.changePct);

  const suggestedTopics = useMemo(() => {
    const readTitles = new Set(
      lessons
        .filter((lesson) => readLessonSet.has(lesson.id))
        .map((lesson) => String(lesson.title || ""))
    );

    const pool = [
      "How to size positions during high volatility",
      "Reading earnings guidance without overreacting",
      "Macro headlines and sector rotation",
      "Using volume to validate breakouts",
      "Risk checklist before entering any trade",
    ];

    return pool.filter((topic) => !readTitles.has(topic)).slice(0, 3);
  }, [lessons, readLessonSet]);

  const markLessonRead = (lessonId) => {
    const id = String(lessonId || "");
    if (!id) return;

    setReadLessons((prev) => {
      const next = Array.from(new Set([id, ...(Array.isArray(prev) ? prev : [])]));
      writeStore("market_school_read_lessons_v1", next);
      return next;
    });

    const today = new Date().toISOString().slice(0, 10);
    setActivityDays((prev) => {
      const next = Array.from(new Set([today, ...(Array.isArray(prev) ? prev : [])])).slice(0, 60);
      writeStore("market_school_activity_days_v1", next);
      return next;
    });
  };

  const openLesson = (lessonId) => {
    setExpandedLessonId((prev) => {
      const next = prev === lessonId ? "" : lessonId;
      if (next) markLessonRead(next);
      return next;
    });
  };

  return (
    <div className={pageClass}>
      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-8 md:py-12">
        <div className="flex items-center justify-between gap-3 mb-8">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-lg border text-xs ${
              isLight
                ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
            }`}
          >
            Back Home
          </Link>
          <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>
            {toTitleDate(snapshotDate)}
          </div>
        </div>

        <section className={`${cardClass} mb-6`}>
          <h1 className={`text-3xl md:text-4xl font-bold tracking-tight ${isLight ? "text-slate-900" : "text-cyan-100"}`}>
            Market School
          </h1>
          <p className={`mt-2 text-base ${isLight ? "text-slate-600" : "text-white/75"}`}>
            Today's market is your classroom
          </p>
          <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${isLight ? "border-slate-200 bg-slate-50 text-slate-700" : "border-white/12 bg-white/[0.03] text-white/85"}`}>
            {loading ? "Loading today's market context..." : marketSummary || "Unable to load today's lessons, try refreshing"}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-2 py-1 text-[11px] ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>
              VIX: {Number.isFinite(vixValue) ? vixValue.toFixed(2) : "—"}{" "}
              {Number.isFinite(vixChangePct) ? `(${vixChangePct > 0 ? "+" : ""}${vixChangePct.toFixed(2)}%)` : ""}
            </span>
            <span className={`rounded-full border px-2 py-1 text-[11px] ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>
              Top mover: {topMover?.symbol || "—"}{" "}
              {Number.isFinite(Number(topMover?.percentChange)) ? `${Number(topMover.percentChange) > 0 ? "+" : ""}${Number(topMover.percentChange).toFixed(2)}%` : ""}
            </span>
            <span className={`rounded-full border px-2 py-1 text-[11px] ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>
              Headlines: {marketContext.headlines.length}
            </span>
            <span className={`rounded-full border px-2 py-1 text-[11px] ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>
              Econ events: {marketContext.economicEvents.length}
            </span>
            <span className={`rounded-full border px-2 py-1 text-[11px] ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}>
              Source: {provider || "fallback"}
            </span>
          </div>
        </section>

        <section className={`${cardClass} mb-6`}>
          <div className="flex items-center justify-between gap-2 mb-4">
            <h2 className={`text-xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
              Daily Lessons
            </h2>
            <button
              onClick={() => loadLessons(true)}
              disabled={loading || refreshing}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-50" : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15 disabled:opacity-50"
              }`}
            >
              {refreshing ? "Refreshing..." : "Refresh Lessons"}
            </button>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {DIFFICULTY_FILTERS.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setDifficultyFilter(level)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                  difficultyFilter === level
                    ? isLight ? "border-blue-600 bg-blue-600 text-white" : "border-cyan-300 bg-cyan-500/25 text-cyan-100"
                    : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/80"
                }`}
              >
                {level}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setShowUnreadOnly((v) => !v)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
                showUnreadOnly
                  ? isLight ? "border-emerald-600 bg-emerald-600 text-white" : "border-emerald-300 bg-emerald-500/25 text-emerald-100"
                  : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/80"
              }`}
            >
              Unread Only
            </button>
          </div>

          {error && (
            <div className={`mb-4 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-400/35 bg-rose-500/15 text-rose-200"}`}>
              {error}
            </div>
          )}

          {loading && (
            <div className="grid grid-cols-1 gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={`lesson-skeleton-${i}`} className={`rounded-xl border p-4 animate-pulse ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className={`h-3 w-24 rounded ${isLight ? "bg-slate-200" : "bg-white/10"}`} />
                  <div className={`mt-3 h-5 w-56 rounded ${isLight ? "bg-slate-200" : "bg-white/10"}`} />
                  <div className={`mt-3 h-3 w-full rounded ${isLight ? "bg-slate-200" : "bg-white/10"}`} />
                </div>
              ))}
            </div>
          )}

          {!loading && visibleLessons.length === 0 && (
            <div className={`text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>
              No lessons match the current filters.
            </div>
          )}

          {!loading && visibleLessons.length > 0 && (
            <div className="space-y-3">
              {visibleLessons.map((lesson) => {
                const difficulty = normalizeDifficulty(lesson.difficulty);
                const expanded = expandedLessonId === lesson.id;

                return (
                  <article
                    key={lesson.id}
                    className={`rounded-xl border p-4 transition-all ${isLight ? "border-slate-200 bg-white" : "border-white/12 bg-white/[0.02]"}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${isLight ? "border-sky-300 bg-sky-50 text-sky-700" : "border-sky-400/35 bg-sky-500/20 text-sky-200"}`}>
                        {lesson.trigger || "MARKET CONTEXT"}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${difficultyClass(difficulty, isLight || isAlerik)}`}>
                        {difficulty}
                      </span>
                      <span className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>
                        {Math.max(3, Number(lesson.duration_minutes) || 6)} min read
                      </span>
                      {readLessonSet.has(lesson.id) && (
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isLight ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-400/35 bg-emerald-500/20 text-emerald-200"}`}>
                          Read
                        </span>
                      )}
                    </div>

                    <h3 className={`text-lg font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                      {lesson.title}
                    </h3>
                    <p className={`mt-1 text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>
                      {lesson.hook}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {Array.isArray(lesson.related_tickers) && lesson.related_tickers.map((ticker) => (
                        <Link
                          key={`${lesson.id}-${ticker}`}
                          href={`/?search=${encodeURIComponent(ticker)}`}
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${isLight ? "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100" : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"}`}
                        >
                          {ticker}
                        </Link>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => openLesson(lesson.id)}
                      className={`mt-3 px-3 py-1.5 rounded-lg border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100" : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"}`}
                    >
                      {expanded ? "Hide Lesson" : "Read Lesson"}
                    </button>

                    {expanded && (
                      <div className={`mt-4 rounded-lg border p-3 space-y-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.03]"}`}>
                        {Array.isArray(lesson.paragraphs) && lesson.paragraphs.slice(0, 3).map((paragraph, idx) => (
                          <p key={`${lesson.id}-p-${idx}`} className={`text-sm leading-relaxed ${isLight ? "text-slate-700" : "text-white/85"}`}>
                            {splitWithGlossary(paragraph, termMap, setActiveTerm, `${lesson.id}-para-${idx}`)}
                          </p>
                        ))}

                        <div>
                          <div className={`text-[11px] font-semibold uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/85"}`}>
                            Real Example
                          </div>
                          <p className={`mt-1 text-sm ${isLight ? "text-slate-700" : "text-white/85"}`}>
                            {splitWithGlossary(lesson.example, termMap, setActiveTerm, `${lesson.id}-example`)}
                          </p>
                        </div>

                        <div>
                          <div className={`text-[11px] font-semibold uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/85"}`}>
                            Key Takeaway
                          </div>
                          <p className={`mt-1 text-sm font-medium ${isLight ? "text-slate-800" : "text-white"}`}>
                            {splitWithGlossary(lesson.key_takeaway, termMap, setActiveTerm, `${lesson.id}-takeaway`)}
                          </p>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className={`${cardClass} mb-6`}>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className={`text-xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
              Glossary
            </h2>
            <div className="flex items-center gap-2">
              <input
                value={glossaryQuery}
                onChange={(e) => setGlossaryQuery(e.target.value)}
                placeholder="Search terms"
                className={`w-56 max-w-full px-3 py-1.5 rounded-lg border text-xs outline-none ${
                  isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white placeholder:text-white/45"
                }`}
              />
              {glossaryQuery && (
                <button
                  type="button"
                  onClick={() => setGlossaryQuery("")}
                  className={`px-2.5 py-1.5 rounded-lg border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className={`mb-3 text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>{filteredTerms.length} terms</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredTerms.map((item) => (
              <button
                type="button"
                key={item.term}
                onClick={() => setActiveTerm(item.term)}
                className={`text-left rounded-lg border p-3 transition-colors ${isLight ? "border-slate-200 bg-white hover:bg-slate-50" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}
              >
                <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                  {item.term}
                </div>
                <div className={`mt-1 text-xs ${isLight ? "text-slate-600" : "text-white/72"}`}>
                  {item.definition}
                </div>
              </button>
            ))}
            {filteredTerms.length === 0 && (
              <div className={`col-span-full rounded-lg border px-3 py-2 text-sm ${isLight ? "border-slate-200 bg-slate-50 text-slate-600" : "border-white/10 bg-white/[0.03] text-white/70"}`}>
                No glossary matches found.
              </div>
            )}
          </div>
        </section>

        <section className={cardClass}>
          <h2 className={`text-xl font-semibold mb-3 ${isLight ? "text-slate-900" : "text-white"}`}>
            Learning Progress
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Lessons read</div>
              <div className={`mt-1 text-2xl font-bold ${isLight ? "text-slate-900" : "text-white"}`}>{lessonsReadThisBatch}/{lessons.length || 0}</div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Current streak</div>
              <div className={`mt-1 text-2xl font-bold ${isLight ? "text-slate-900" : "text-white"}`}>{currentStreak} day{currentStreak === 1 ? "" : "s"}</div>
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>7-day tracker</div>
              <div className="mt-2 flex items-center gap-1.5">
                {streakDays.map((day) => (
                  <span
                    key={day}
                    title={day}
                    className={`h-3 w-3 rounded-full border ${
                      streakSet.has(day)
                        ? isLight
                          ? "border-emerald-400 bg-emerald-500"
                          : "border-emerald-300 bg-emerald-400"
                        : isLight
                          ? "border-slate-300 bg-slate-100"
                          : "border-white/20 bg-white/10"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
          <div className={`mb-4 rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className={isLight ? "text-slate-500" : "text-white/60"}>Today's lesson completion</span>
              <span className={`font-semibold ${isLight ? "text-slate-800" : "text-white/90"}`}>{completionPct}%</span>
            </div>
            <div className={`h-2 w-full rounded-full ${isLight ? "bg-slate-200" : "bg-white/10"}`}>
              <div
                className="h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 transition-all"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>

          <div>
            <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-cyan-200/85"}`}>
              Suggested Next Topics
            </div>
            <ul className={`list-disc pl-5 space-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/82"}`}>
              {suggestedTopics.length > 0
                ? suggestedTopics.map((topic) => <li key={topic}>{topic}</li>)
                : <li>Keep reading fresh lessons to unlock new topic suggestions.</li>}
            </ul>
          </div>
        </section>
      </div>

      {activeTerm && termMap.get(activeTerm) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/45"
            onClick={() => setActiveTerm(null)}
            aria-label="Close glossary modal"
          />
          <div className={`relative w-full max-w-md rounded-2xl border p-5 shadow-2xl ${isLight ? "border-slate-300 bg-white" : "border-white/15 bg-slate-900 text-white"}`}>
            <div className={`text-lg font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
              {termMap.get(activeTerm).term}
            </div>
            <p className={`mt-2 text-sm leading-relaxed ${isLight ? "text-slate-700" : "text-white/85"}`}>
              {termMap.get(activeTerm).definition}
            </p>
            <button
              type="button"
              onClick={() => setActiveTerm(null)}
              className={`mt-4 px-3 py-1.5 rounded-lg border text-xs ${isLight ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-100" : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"}`}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
