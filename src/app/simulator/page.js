"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

const STARTING_CASH = 100000;
const PROFILE_KEY = "simulator_portfolio_state_v1";
const NAV_SNAPSHOT_KEY = "simulator_nav_snapshot_v1";
const AUTOPILOT_MODE_KEY = "simulator_autopilot_mode_v1";
const LEADERBOARD_FILTERS = [
  { key: "all", label: "All Time" },
  { key: "month", label: "This Month" },
  { key: "week", label: "This Week" },
];
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
    autoPilot: {
      enabled: false,
      lastRunAt: 0,
      lastActionAt: 0,
      nextDecisionAt: 0,
      decisionLog: [],
      watchlist: [],
      outlook: "",
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
      autoPilot: parsed.autoPilot && typeof parsed.autoPilot === "object"
        ? {
            enabled: Boolean(parsed.autoPilot.enabled),
            lastRunAt: Number(parsed.autoPilot.lastRunAt || 0),
            lastActionAt: Number(parsed.autoPilot.lastActionAt || 0),
            nextDecisionAt: Number(parsed.autoPilot.nextDecisionAt || 0),
            decisionLog: Array.isArray(parsed.autoPilot.decisionLog) ? parsed.autoPilot.decisionLog : [],
            watchlist: Array.isArray(parsed.autoPilot.watchlist) ? parsed.autoPilot.watchlist : [],
            outlook: String(parsed.autoPilot.outlook || ""),
          }
        : {
            enabled: false,
            lastRunAt: 0,
            lastActionAt: 0,
            nextDecisionAt: 0,
            decisionLog: [],
            watchlist: [],
            outlook: "",
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

export default function SimulatorPage() {
  const [theme, setTheme] = useState("dark");
  const [profile, setProfile] = useState(createDefaultProfile());
  const [simTab, setSimTab] = useState("manual");
  const [showEnableAutoModal, setShowEnableAutoModal] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [autoMessage, setAutoMessage] = useState("");
  const [expandedDecisionId, setExpandedDecisionId] = useState("");
  const [quotes, setQuotes] = useState({});
  const [selectedTicker, setSelectedTicker] = useState("AAPL");
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

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isLight = theme === "light" || isCherry || isAzula;

  const pageClass = isCherry
    ? "cherry-mode min-h-screen relative overflow-hidden bg-[#fffefc] text-[#3a2530]"
    : isAzula
      ? "azula-mode min-h-screen relative overflow-hidden bg-[#f4f7fb] text-slate-900"
      : isLight
        ? "min-h-screen relative overflow-hidden bg-gradient-to-br from-white via-blue-50 to-cyan-50 text-slate-900"
        : "min-h-screen relative overflow-hidden bg-slate-950 text-white";
  const cardClass = isLight
    ? "rounded-2xl border border-slate-200 bg-white/90 p-5 shadow-[0_10px_28px_rgba(15,23,42,0.08)]"
    : "rounded-2xl border border-white/12 bg-slate-900/55 p-5";

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (saved === "dark" || saved === "light" || saved === "cherry" || saved === "azula") setTheme(saved);
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
  }, []);

  const holdingsArray = useMemo(
    () =>
      Object.values(profile.holdings || {}).map((h) => ({
        ...h,
        shares: Number(h?.shares || 0),
        avgBuy: Number(h?.avgBuy || 0),
      })),
    [profile.holdings]
  );

  const holdingSymbols = useMemo(
    () => holdingsArray.map((h) => String(h.symbol || "").toUpperCase()).filter(Boolean),
    [holdingsArray]
  );

  const holdingsMarketValue = useMemo(
    () =>
      holdingsArray.reduce((sum, h) => {
        const live = Number(quotes[h.symbol]?.price);
        const fallback = Number(h?.avgBuy || 0);
        const px = Number.isFinite(live) && live > 0 ? live : fallback;
        return sum + px * h.shares;
      }, 0),
    [holdingsArray, quotes]
  );

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

  const refreshQuoteFor = useCallback(async (symbol) => {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return null;
    try {
      const [qRes, pRes] = await Promise.all([
        fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" }),
        fetch(`/api/profile?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" }),
      ]);
      const q = await qRes.json().catch(() => ({}));
      const p = await pRes.json().catch(() => ({}));
      const price = toNum(q?.price);
      const row = {
        symbol: sym,
        name: String(p?.name || p?.ticker || sym),
        price: price ?? null,
        percentChange: toNum(q?.percentChange),
        change: toNum(q?.change),
      };
      setQuotes((prev) => ({ ...prev, [sym]: row }));
      return row;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const symbols = Array.from(new Set([...holdingSymbols, selectedTicker.toUpperCase()])).filter(Boolean);
    if (!symbols.length) return;
    let cancelled = false;

    const run = async () => {
      const rows = await Promise.all(symbols.map((sym) => refreshQuoteFor(sym)));
      if (cancelled) return;
      const selected = rows.find((r) => r?.symbol === selectedTicker.toUpperCase()) || null;
      if (selected) {
        setSelectedQuote(selected);
        setSelectedCompany(selected.name || "");
      }
    };

    run();
    const timer = setInterval(run, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [holdingSymbols, refreshQuoteFor, selectedTicker]);

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
        const res = await fetch(`/api/candles?symbol=${encodeURIComponent(sym)}&resolution=5&days=1`, { cache: "no-store" });
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
  }, [selectedTicker]);

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

  const selectedPrice = toNum(selectedQuote?.price);
  const sharesFromInput = useMemo(() => {
    if (tradeInputMode === "shares") return Math.max(0, Number(shareInput || 0));
    if (!Number.isFinite(selectedPrice) || selectedPrice <= 0) return 0;
    return Math.max(0, Number(dollarInput || 0) / selectedPrice);
  }, [tradeInputMode, shareInput, dollarInput, selectedPrice]);
  const estimatedTradeValue = Number.isFinite(selectedPrice) ? selectedPrice * sharesFromInput : 0;
  const ownedForSelected = Number(profile.holdings?.[selectedTicker.toUpperCase()]?.shares || 0);
  const cashAfterTrade = tradeMode === "BUY" ? Number(profile.cash || 0) - estimatedTradeValue : Number(profile.cash || 0) + estimatedTradeValue;

  const tradeError = useMemo(() => {
    if (!selectedTicker.trim()) return "Enter a ticker symbol.";
    if (!Number.isFinite(selectedPrice) || selectedPrice <= 0) return "Live price unavailable for this ticker.";
    if (!Number.isFinite(sharesFromInput) || sharesFromInput <= 0) return "Enter a valid trade size.";
    if (tradeMode === "BUY" && estimatedTradeValue > Number(profile.cash || 0) + 1e-8) return "Insufficient cash for this buy.";
    if (tradeMode === "SELL" && sharesFromInput > ownedForSelected + 1e-8) return "Cannot sell more shares than owned.";
    return "";
  }, [selectedTicker, selectedPrice, sharesFromInput, tradeMode, estimatedTradeValue, profile.cash, ownedForSelected]);

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

  const portfolioRiskScore = useMemo(() => {
    const total = holdingsMarketValue;
    if (!total || holdingsArray.length === 0) return "Conservative";
    const weights = holdingsArray.map((h) => {
      const px = Number(quotes[h.symbol]?.price);
      const value = (Number.isFinite(px) ? px : h.avgBuy) * h.shares;
      return value / total;
    });
    const maxWeight = Math.max(...weights);
    if (maxWeight >= 0.55 || holdingsArray.length <= 2) return "Aggressive";
    if (maxWeight >= 0.3 || holdingsArray.length <= 4) return "Moderate";
    return "Conservative";
  }, [holdingsArray, quotes, holdingsMarketValue]);

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
      { key: "first", label: "First Trade", unlocked: firstTrade },
      { key: "diamond", label: "Diamond Hands", unlocked: diamondHands },
      { key: "ten", label: "10% Club", unlocked: tenClub },
      { key: "diversified", label: "Diversified", unlocked: diversified },
      { key: "bear", label: "Bear Survivor", unlocked: bearSurvivor },
    ];
  }, [profile.transactions.length, holdingsArray, totalReturnPct, spyReturnFor, portfolioReturnFor]);

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

  const runAstraOpinion = useCallback(async (symbol) => {
    try {
      const q = encodeURIComponent(`One sentence only: what's the key risk/reward for ${symbol} today?`);
      const res = await fetch(`/api/ai?mode=chat&market=stock&symbol=${encodeURIComponent(symbol)}&question=${q}`, { cache: "no-store" });
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
    const action = String(trade?.action || "HOLD").toUpperCase();
    const live = Number(quotes[symbol]?.price);
    const price = Number.isFinite(live) && live > 0 ? live : Number(trade?.price || 0);
    const sharesRaw = Math.max(0, Number(trade?.shares || 0));
    if (!symbol || !Number.isFinite(price) || price <= 0) return { profile: baseProfile, executed: null };
    const holdings = { ...(baseProfile.holdings || {}) };
    let cash = Number(baseProfile.cash || 0);
    const holdingsValueBefore = Object.values(holdings).reduce((sum, h) => {
      const hp = Number(quotes[h.symbol]?.price);
      const px = Number.isFinite(hp) && hp > 0 ? hp : Number(h?.avgBuy || 0);
      return sum + px * Number(h?.shares || 0);
    }, 0);
    const totalBefore = cash + holdingsValueBefore;
    const minCashReserve = Math.max(0, totalBefore * 0.1);
    const maxSinglePosition = Math.max(0, totalBefore * 0.2);
    const existing = holdings[symbol] || { symbol, name: symbol, shares: 0, avgBuy: price, firstBuyAt: Date.now() };
    const currentPosVal = Number(existing.shares || 0) * price;

    if (action === "BUY") {
      const spendCap = Math.max(0, cash - minCashReserve);
      const singleCap = Math.max(0, maxSinglePosition - currentPosVal);
      const allowedValue = Math.min(spendCap, singleCap);
      const value = sharesRaw * price;
      const execValue = Math.min(value, allowedValue);
      const execShares = price > 0 ? execValue / price : 0;
      if (execShares <= 0) return { profile: baseProfile, executed: null };
      const totalShares = Number(existing.shares || 0) + execShares;
      const avgBuy = ((Number(existing.avgBuy || 0) * Number(existing.shares || 0)) + execValue) / totalShares;
      holdings[symbol] = { ...existing, symbol, shares: totalShares, avgBuy, firstBuyAt: Number(existing.firstBuyAt || Date.now()) };
      cash -= execValue;
      return {
        profile: { ...baseProfile, cash, holdings },
        executed: { action: "BUY", symbol, shares: execShares, price, totalValue: execValue, realizedPnL: null },
      };
    }

    if (action === "SELL") {
      const owned = Number(existing.shares || 0);
      const execShares = Math.min(owned, sharesRaw);
      if (execShares <= 0) return { profile: baseProfile, executed: null };
      const execValue = execShares * price;
      const realizedPnL = (price - Number(existing.avgBuy || 0)) * execShares;
      const remain = owned - execShares;
      if (remain <= 1e-8) delete holdings[symbol];
      else holdings[symbol] = { ...existing, shares: remain };
      cash += execValue;
      return {
        profile: { ...baseProfile, cash, holdings },
        executed: { action: "SELL", symbol, shares: execShares, price, totalValue: execValue, realizedPnL },
      };
    }

    return {
      profile: baseProfile,
      executed: { action: "HOLD", symbol, shares: 0, price, totalValue: 0, realizedPnL: null },
    };
  }, [quotes]);

  const runAutoPilotCycle = useCallback(async () => {
    if (!autoPilotEnabled || autoRunning) return;
    setAutoRunning(true);
    setAutoMessage("");
    try {
      const holdingsPayload = Object.values(profile.holdings || {}).map((h) => ({
        symbol: h.symbol,
        shares: Number(h.shares || 0),
        avgBuy: Number(h.avgBuy || 0),
        currentPrice: Number(quotes[h.symbol]?.price || h.avgBuy || 0),
        percentChange: Number(quotes[h.symbol]?.percentChange || 0),
      }));
      const res = await fetch("/api/simulator-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          cash: Number(profile.cash || 0),
          holdings: holdingsPayload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const decisions = Array.isArray(data?.decisions) ? data.decisions : [];
      const now = Date.now();
      let draft = { ...profile, autoPilot: { ...(profile.autoPilot || {}) } };
      let didTrade = false;
      const decisionLogEntries = [];

      for (const decision of decisions) {
        const { profile: nextDraft, executed } = applySingleTrade(draft, decision);
        if (!executed) continue;
        draft = nextDraft;
        const logEntry = {
          id: `${now}-${decision?.ticker || executed.symbol}-${decisionLogEntries.length}`,
          ts: now,
          action: executed.action,
          symbol: executed.symbol,
          shares: executed.shares,
          price: executed.price,
          totalValue: executed.totalValue,
          realizedPnL: executed.realizedPnL,
          reasoning: String(decision?.reasoning || "").trim() || "ASTRA adjusted risk based on market context.",
          confidence: Math.max(0, Math.min(100, Number(decision?.confidence || 0))),
          risk: String(decision?.risk || "MEDIUM").toUpperCase(),
          lesson: String(decision?.lesson || "Risk management is the core edge in volatile markets."),
        };
        decisionLogEntries.push(logEntry);
        if (executed.action === "BUY" || executed.action === "SELL") didTrade = true;
      }

      const holdingsValue = Object.values(draft.holdings || {}).reduce((sum, h) => {
        const px = Number(quotes[h.symbol]?.price);
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
        decisionLog: [...decisionLogEntries, ...(Array.isArray(draft.autoPilot?.decisionLog) ? draft.autoPilot.decisionLog : [])].slice(0, 200),
      };
      setProfile(draft);
      if (decisionLogEntries.length) {
        const first = decisionLogEntries[0];
        setAutoMessage(`ASTRA ${first.action} ${first.symbol} (${first.shares.toFixed(3)} shares).`);
      } else if (!didTrade) {
        setAutoMessage("ASTRA reviewed the market and held positions.");
      }
    } catch {
      setAutoMessage("Auto-Pilot run failed. Try again on refresh.");
    } finally {
      setAutoRunning(false);
    }
  }, [appendModeSnapshot, applySingleTrade, autoPilotEnabled, autoRunning, profile, quotes]);

  const enableAutoPilot = () => {
    setProfile((prev) => ({
      ...prev,
      autoPilot: {
        ...(prev.autoPilot || {}),
        enabled: true,
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
    if (!autoPilotEnabled || autoRunning) return;
    const now = Date.now();
    const dueAt = Number(profile?.autoPilot?.nextDecisionAt || 0);
    const lastRunAt = Number(profile?.autoPilot?.lastRunAt || 0);
    const shouldRunOutsideHours = !nyse.open && (!lastRunAt || now - lastRunAt > 6 * 60 * 60 * 1000);
    const shouldRun = !dueAt || now >= dueAt || shouldRunOutsideHours;
    if (shouldRun) runAutoPilotCycle();
  }, [autoPilotEnabled, autoRunning, nyse.open, profile?.autoPilot?.lastRunAt, profile?.autoPilot?.nextDecisionAt, runAutoPilotCycle]);

  const executeTrade = async () => {
    setTradeMessage("");
    setAstraOpinion("");
    if (autoPilotEnabled) {
      setTradeMessage("Manual trading is disabled while ASTRA Auto-Pilot is active.");
      return;
    }
    if (tradeError) {
      setTradeMessage(tradeError);
      return;
    }
    const symbol = selectedTicker.trim().toUpperCase();
    setSubmittingTrade(true);
    try {
      const fresh = await refreshQuoteFor(symbol);
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
        if (value > Number(profile.cash || 0) + 1e-8) {
          setTradeMessage("Insufficient cash for this buy.");
          return;
        }
        const existing = profile.holdings[symbol] || {
          symbol,
          name: fresh?.name || selectedCompany || symbol,
          shares: 0,
          avgBuy: 0,
          firstBuyAt: now,
        };
        const totalShares = Number(existing.shares || 0) + shares;
        const avgBuy = totalShares > 0
          ? ((Number(existing.avgBuy || 0) * Number(existing.shares || 0)) + value) / totalShares
          : px;
        nextProfile = {
          ...profile,
          cash: Number(profile.cash || 0) - value,
          holdings: {
            ...profile.holdings,
            [symbol]: {
              ...existing,
              shares: totalShares,
              avgBuy,
              name: existing.name || fresh?.name || symbol,
              firstBuyAt: Number(existing.firstBuyAt || now),
            },
          },
          transactions: [
            {
              id: `${now}-${symbol}-BUY`,
              ts: now,
              symbol,
              company: fresh?.name || selectedCompany || symbol,
              action: "BUY",
              shares,
              price: px,
              totalValue: value,
              realizedPnL: null,
              marketClosed: !nyse.open,
            },
            ...profile.transactions,
          ],
        };
      } else {
        const existing = profile.holdings[symbol];
        if (!existing || Number(existing.shares || 0) < shares - 1e-8) {
          setTradeMessage("Cannot sell more shares than owned.");
          return;
        }
        const realizedPnL = (px - Number(existing.avgBuy || 0)) * shares;
        const remain = Number(existing.shares || 0) - shares;
        const nextHoldings = { ...profile.holdings };
        if (remain <= 1e-8) delete nextHoldings[symbol];
        else nextHoldings[symbol] = { ...existing, shares: remain };
        nextProfile = {
          ...profile,
          cash: Number(profile.cash || 0) + value,
          holdings: nextHoldings,
          transactions: [
            {
              id: `${now}-${symbol}-SELL`,
              ts: now,
              symbol,
              company: existing.name || symbol,
              action: "SELL",
              shares,
              price: px,
              totalValue: value,
              realizedPnL,
              marketClosed: !nyse.open,
            },
            ...profile.transactions,
          ],
        };
      }

      const recomputedHoldingsValue = Object.values(nextProfile.holdings).reduce((sum, h) => {
        const live = Number((h && quotes[h.symbol]?.price) || (h && fresh?.symbol === h.symbol ? fresh.price : null));
        const fallback = Number(h?.avgBuy || 0);
        const usePx = Number.isFinite(live) && live > 0 ? live : fallback;
        return sum + usePx * Number(h?.shares || 0);
      }, 0);
      const nextTotal = Number(nextProfile.cash || 0) + recomputedHoldingsValue;
      nextProfile = appendModeSnapshot(nextProfile, nextTotal, "manual");

      setProfile(nextProfile);
      setTradeMessage(
        `${tradeMode} ${shares.toFixed(4)} ${symbol} @ ${fmtMoney(px)} (${fmtMoney(value)} total)${nyse.open ? "" : " — Market Closed: using last close price."}`
      );
      const line = await runAstraOpinion(symbol);
      setAstraOpinion(line);
    } finally {
      setSubmittingTrade(false);
    }
  };

  const resetPortfolio = () => {
    const ok = window.confirm("Reset simulator portfolio back to $100,000 and clear all transactions?");
    if (!ok) return;
    const fresh = createDefaultProfile();
    setProfile(fresh);
    setTradeMessage("Portfolio reset to $100,000.");
    setAstraOpinion("");
  };

  return (
    <div className={pageClass}>
      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 py-8 md:py-10">
        <div className="flex items-center justify-between gap-3 mb-6">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-lg border text-xs ${
              isLight ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100" : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
            }`}
          >
            Back Home
          </Link>
          <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Trading Simulator</div>
        </div>

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
                {autoPilotEnabled ? "Disable ASTRA Auto-Pilot" : "Enable ASTRA Auto-Pilot"}
              </button>
            </div>
          </div>
          {autoPilotEnabled && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs flex flex-wrap items-center gap-2 ${isLight ? "border-blue-300 bg-blue-50 text-blue-800" : "border-cyan-400/30 bg-cyan-500/12 text-cyan-100"}`}>
              <span>ASTRA is managing your portfolio • Last action: {relativeTime(profile?.autoPilot?.lastActionAt)}</span>
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
        </section>
        )}

        {simTab === "autopilot" && (
          <section id="autopilot-log" className={`${cardClass} mb-6`}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <h2 className={`text-xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>ASTRA Decision Log</h2>
                  <button
                    onClick={runAutoPilotCycle}
                    disabled={!autoPilotEnabled || autoRunning}
                    className={`px-3 py-1.5 rounded-lg border text-xs disabled:opacity-50 ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}
                  >
                    {autoRunning ? "Running..." : "Run Now"}
                  </button>
                </div>
                <div className="space-y-3">
                  {(profile?.autoPilot?.decisionLog || []).slice(0, 30).map((d) => (
                    <article key={d.id} className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
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
                        <span className="font-semibold">{d.symbol}</span>
                        <span className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>{new Date(Number(d.ts)).toLocaleString()}</span>
                      </div>
                      <div className={`text-sm ${isLight ? "text-slate-700" : "text-white/85"}`}>
                        ASTRA {d.action} {Number(d.shares || 0).toFixed(3)} shares at {fmtMoney(d.price)}.
                      </div>
                      <div className={`mt-1 text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>
                        {d.reasoning}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
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
                        <button
                          onClick={() => setExpandedDecisionId((prev) => (prev === d.id ? "" : d.id))}
                          className={`px-2 py-0.5 rounded-md border ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-white/10 text-white/85"}`}
                        >
                          {expandedDecisionId === d.id ? "Hide" : "Expand"}
                        </button>
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
          <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-3">
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
            </div>
            <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
              <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>ASTRA Risk Score</div>
              <div className="text-lg font-semibold">{portfolioRiskScore}</div>
            </div>
          </div>
          {!nyse.open && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-400/35 bg-amber-500/15 text-amber-200"}`}>
              Market Closed - trades execute at open (using latest close estimate in simulator).
            </div>
          )}
          {lastOvernightDelta != null && (
            <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/80"}`}>
              Daily login bonus: Overnight portfolio change was {fmtMoney(lastOvernightDelta)}.
            </div>
          )}
        </section>

        <section className={`${cardClass} mb-6`}>
          <h2 className={`text-xl font-semibold mb-3 ${isLight ? "text-slate-900" : "text-white"}`}>Portfolio Holdings</h2>
          {holdingsArray.length === 0 ? (
            <div className={`text-sm ${isLight ? "text-slate-600" : "text-white/75"}`}>You have {fmtMoney(profile.cash)} ready to invest.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className={isLight ? "text-slate-500" : "text-white/60"}>
                  <tr className={isLight ? "border-b border-slate-200 text-left" : "border-b border-white/10 text-left"}>
                    <th className="py-2 pr-2">Ticker</th>
                    <th className="py-2 pr-2">Company</th>
                    <th className="py-2 pr-2">Shares</th>
                    <th className="py-2 pr-2">Avg Buy</th>
                    <th className="py-2 pr-2">Current</th>
                    <th className="py-2 pr-2">Total Value</th>
                    <th className="py-2 pr-2">Gain/Loss</th>
                    <th className="py-2 pr-2">Sell</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingsArray.map((h) => {
                    const q = quotes[h.symbol];
                    const px = Number.isFinite(Number(q?.price)) ? Number(q.price) : Number(h.avgBuy || 0);
                    const total = px * h.shares;
                    const cost = Number(h.avgBuy || 0) * h.shares;
                    const pnl = total - cost;
                    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                    return (
                      <tr key={h.symbol} className={isLight ? "border-b border-slate-100" : "border-b border-white/5"}>
                        <td className="py-2 pr-2 font-semibold">{h.symbol}</td>
                        <td className={`py-2 pr-2 ${isLight ? "text-slate-700" : "text-white/80"}`}>{h.name || h.symbol}</td>
                        <td className="py-2 pr-2">{h.shares.toFixed(4)}</td>
                        <td className="py-2 pr-2">{fmtMoney(h.avgBuy)}</td>
                        <td className="py-2 pr-2">{fmtMoney(px)}</td>
                        <td className="py-2 pr-2">{fmtMoney(total)}</td>
                        <td className={`py-2 pr-2 ${pnl >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                          {fmtMoney(pnl)} ({fmtPct(pnlPct)})
                        </td>
                        <td className="py-2 pr-2">
                          <button
                            onClick={() => {
                              setTradeMode("SELL");
                              setSelectedTicker(h.symbol);
                              setShareInput(String(Math.min(1, h.shares)));
                              setTradeInputMode("shares");
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

        <section className={`${cardClass} mb-6`}>
          <h2 className={`text-xl font-semibold mb-3 ${isLight ? "text-slate-900" : "text-white"}`}>Trade</h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <div className="flex flex-wrap gap-2 mb-3">
                <input
                  value={selectedTicker}
                  onChange={(e) => setSelectedTicker(e.target.value.toUpperCase())}
                  placeholder="Ticker (AAPL)"
                  className={`px-3 py-2 rounded-lg border text-sm outline-none ${
                    isLight ? "border-slate-300 bg-white text-slate-800" : "border-white/15 bg-white/10 text-white"
                  }`}
                />
                <button
                  onClick={() => refreshQuoteFor(selectedTicker)}
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
                  <div>{fmtMoney(selectedPrice)}</div>
                  <div className={`${Number(selectedQuote?.percentChange) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtPct(selectedQuote?.percentChange)}</div>
                </div>
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
                    <button onClick={() => setTradeInputMode("shares")} className={`px-2.5 py-1.5 rounded-md text-xs border ${tradeInputMode === "shares" ? "bg-blue-600 text-white border-blue-500" : isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/15 bg-white/10 text-white/85"}`}>Shares</button>
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
            </div>
          </div>
        </section>

        <section className={`${cardClass} mb-6`}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className={`text-xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Performance</h2>
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
            <svg viewBox="0 0 820 240" className="w-full h-[240px]">
              {spyPolyline && <polyline fill="none" stroke="#94a3b8" strokeWidth="2" points={spyPolyline} />}
              {manualPolyline && <polyline fill="none" stroke="#22c55e" strokeWidth="2.5" points={manualPolyline} />}
              {autoPolyline && <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" points={autoPolyline} />}
              {!manualPolyline && !autoPolyline && portfolioPolyline && (
                <polyline fill="none" stroke="#22c55e" strokeWidth="2.5" points={portfolioPolyline} />
              )}
            </svg>
          </div>
          <div className="mt-2 flex gap-3 text-xs">
            <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>Manual portfolio: <span className="text-emerald-500 font-semibold">green</span></span>
            <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>ASTRA Auto-Pilot: <span className="text-blue-500 font-semibold">blue</span></span>
            <span className={`${isLight ? "text-slate-600" : "text-white/70"}`}>S&P 500 benchmark: <span className="text-slate-400 font-semibold">grey</span></span>
          </div>
        </section>

        <section className={`${cardClass} mb-6`}>
          <h2 className={`text-xl font-semibold mb-3 ${isLight ? "text-slate-900" : "text-white"}`}>Transaction History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className={isLight ? "text-slate-500" : "text-white/60"}>
                <tr className={isLight ? "border-b border-slate-200 text-left" : "border-b border-white/10 text-left"}>
                  <th className="py-2 pr-2">Date</th>
                  <th className="py-2 pr-2">Ticker</th>
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
                    <td className={`py-2 pr-2 ${tx.action === "BUY" ? "text-emerald-500" : "text-rose-500"}`}>{tx.action}</td>
                    <td className="py-2 pr-2">{Number(tx.shares || 0).toFixed(4)}</td>
                    <td className="py-2 pr-2">{fmtMoney(tx.price)}</td>
                    <td className="py-2 pr-2">{fmtMoney(tx.totalValue)}</td>
                    <td className={`py-2 pr-2 ${Number(tx.realizedPnL) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                      {tx.realizedPnL == null ? "—" : fmtMoney(tx.realizedPnL)}
                    </td>
                  </tr>
                ))}
                {profile.transactions.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`py-4 text-center ${isLight ? "text-slate-500" : "text-white/60"}`}>
                      No trades yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className={cardClass}>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className={`text-xl font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Leaderboard</h2>
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
                    <td className="py-2 pr-2">{row.user}</td>
                    <td className={`py-2 pr-2 ${row.metric >= 0 ? "text-emerald-500" : "text-rose-500"}`}>{fmtPct(row.metric)}</td>
                    <td className="py-2 pr-2">{fmtMoney(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={`mt-2 text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>Your current rank: #{selfRank}</div>
        </section>
      </div>

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
