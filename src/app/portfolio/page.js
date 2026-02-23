"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/app/api/_lib/supabaseClient";

function canonicalTicker(input) {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "");
}

const PORTFOLIO_SYMBOL_ALIASES = {
  BRKB: "BRK.B",
  "BRK B": "BRK.B",
  "BRK.B": "BRK.B",
  WALMART: "WMT",
  WLAMART: "WMT",
  GOOGLE: "GOOGL",
  ALPHABET: "GOOGL",
  FACEBOOK: "META",
  META: "META",
};

function resolvePortfolioAlias(input) {
  const raw = String(input || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return PORTFOLIO_SYMBOL_ALIASES[raw] || "";
}

function isPlainTickerInput(input) {
  const clean = canonicalTicker(input);
  if (!clean) return false;
  if (clean.includes(".") || clean.includes(":") || clean.includes("-")) return false;
  return /^[A-Z]{1,6}X?$/.test(clean);
}

function fmt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 8 });
}

function parseOptionalNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

function cleanChatAnswer(value) {
  const text = String(value || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s*/gm, "- ")
    .replace(/\bEducational only\. Not financial advice\.\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

function inferSectorFromSymbol(symbol = "") {
  const s = canonicalTicker(symbol);
  const cryptoLike = new Set([
    "BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "DOT", "LINK", "BNB", "TRX", "LTC", "BCH", "XLM", "ATOM", "ETC", "HBAR", "UNI", "APT", "SUI",
  ]);
  const fixedIncome = new Set(["BND", "AGG", "TLT", "IEF", "SHY", "TIP", "LQD", "HYG", "GOVT", "SPHY", "BSV", "BIV", "VGIT", "VGSH", "SCHZ", "FXNAX", "FIPDX"]);
  const broadFunds = new Set(["SPY", "VOO", "VTI", "QQQ", "DIA", "IWM", "FXAIX", "VTSAX", "VFIAX"]);
  if (cryptoLike.has(s)) return "Cryptocurrency";
  if (fixedIncome.has(s)) return "Fixed Income";
  if (broadFunds.has(s)) return "Fund / ETF";
  return "Unclassified";
}

function buildSectorAllocation(rows) {
  const buckets = new Map();
  for (const row of rows || []) {
    const rawSector = String(row?.sector || "").trim();
    const sector = rawSector || inferSectorFromSymbol(row?.symbol);
    const value =
      Number.isFinite(Number(row?.marketValue)) && Number(row?.marketValue) > 0
        ? Number(row.marketValue)
        : Number.isFinite(Number(row?.costBasis)) && Number(row?.costBasis) > 0
        ? Number(row.costBasis)
        : 0;
    if (!Number.isFinite(value) || value <= 0) continue;
    buckets.set(sector, (buckets.get(sector) || 0) + value);
  }

  const entries = Array.from(buckets.entries())
    .map(([sector, value]) => ({ sector, value }))
    .sort((a, b) => b.value - a.value);
  const total = entries.reduce((sum, x) => sum + x.value, 0);
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ef4444", "#8b5cf6", "#14b8a6"];
  const items = entries.map((x, i) => ({
    ...x,
    pct: total > 0 ? x.value / total : 0,
    color: colors[i % colors.length],
  }));

  const n = items.length;
  const hhi = items.reduce((sum, x) => sum + x.pct * x.pct, 0);
  const effectiveSectors = hhi > 0 ? 1 / hhi : 0;
  const breadthScore = n > 0 ? Math.min(100, (n / 5) * 100) : 0;
  const balanceScore = n > 1 ? Math.max(0, Math.min(100, ((effectiveSectors - 1) / (n - 1)) * 100)) : 0;
  const diversificationScore = Math.round((breadthScore + balanceScore) / 2);

  return {
    total,
    items,
    sectorCount: n,
    topSector: items[0]?.sector || "—",
    topWeightPct: items[0] ? items[0].pct * 100 : 0,
    diversificationScore,
  };
}

function AllocationPie({ items = [], size = 208, stroke = 26 }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let acc = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-[0_0_12px_rgba(59,130,246,0.25)]">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      {items.map((item, idx) => {
        const dash = Math.max(0, Math.min(circumference, item.pct * circumference));
        const offset = -acc * circumference;
        acc += item.pct;
        return (
          <circle
            key={`${item.sector}-${idx}`}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={item.color}
            strokeWidth={stroke}
            strokeLinecap="butt"
            strokeDasharray={`${dash} ${Math.max(0, circumference - dash)}`}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        );
      })}
      <circle cx={size / 2} cy={size / 2} r={radius - stroke / 2 + 1} fill="rgba(2,6,23,0.82)" />
    </svg>
  );
}

function Card({ title, right, children }) {
  return (
    <div className="rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-5 md:p-6 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)]">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-slate-100 tracking-wide">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function PortfolioPage() {
  const [theme, setTheme] = useState("dark");
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(null);

  const [portfolioSymbolInput, setPortfolioSymbolInput] = useState("");
  const [portfolioQtyInput, setPortfolioQtyInput] = useState("1");
  const [portfolioBuyPriceInput, setPortfolioBuyPriceInput] = useState("");
  const [portfolioHoldings, setPortfolioHoldings] = useState([]);
  const [portfolioRows, setPortfolioRows] = useState([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolioNotice, setPortfolioNotice] = useState("");
  const [portfolioAnalysis, setPortfolioAnalysis] = useState(null);
  const [portfolioSuggestions, setPortfolioSuggestions] = useState([]);
  const [portfolioSuggestionLoading, setPortfolioSuggestionLoading] = useState(false);
  const [portfolioSuggestionOpen, setPortfolioSuggestionOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      content:
        "I am ASTRA. Ask me about your portfolio, diversification, risk, or any market idea.",
    },
  ]);

  useEffect(() => {
    try {
      const t = localStorage.getItem("theme_mode");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("theme_mode", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthReady(true);
      return;
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
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user || null);
    });
    return () => {
      mounted = false;
      data?.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUser?.id) {
      setPortfolioHoldings([]);
      setPortfolioRows([]);
      setPortfolioAnalysis(null);
      setPortfolioError("");
      return;
    }
    try {
      const key = `portfolio_holdings_${authUser.id}`;
      const saved = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(saved)) {
        const clean = saved
          .map((x, idx) => {
            const sym = canonicalTicker(x?.symbol || x || "");
            if (!sym) return null;
            return {
              id: String(x?.id || `h-${sym}-${idx}`),
              symbol: sym,
              quantity: Number(x?.quantity) > 0 ? Number(x.quantity) : 1,
              buyPrice: Number(x?.buyPrice) >= 0 ? Number(x.buyPrice) : null,
            };
          })
          .filter(Boolean)
          .slice(0, 50);
        setPortfolioHoldings(clean);
      }
    } catch {}
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser?.id) return;
    try {
      const key = `portfolio_holdings_${authUser.id}`;
      localStorage.setItem(key, JSON.stringify(portfolioHoldings.slice(0, 50)));
    } catch {}
  }, [authUser?.id, portfolioHoldings]);

  useEffect(() => {
    if (!authUser) {
      setPortfolioSuggestions([]);
      setPortfolioSuggestionOpen(false);
      return;
    }
    const q = String(portfolioSymbolInput || "").trim();
    if (q.length < 1) {
      setPortfolioSuggestions([]);
      setPortfolioSuggestionOpen(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setPortfolioSuggestionLoading(true);
        const [stockResult, cryptoResult] = await Promise.allSettled([
          fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal }),
          fetch(`/api/crypto-search?q=${encodeURIComponent(q)}`, { signal: controller.signal }),
        ]);
        const stockData =
          stockResult.status === "fulfilled"
            ? await stockResult.value.json().catch(() => ({}))
            : {};
        const cryptoData =
          cryptoResult.status === "fulfilled"
            ? await cryptoResult.value.json().catch(() => ({}))
            : {};
        const matchesRaw = [];
        const stockMatches = Array.isArray(stockData?.matches) ? stockData.matches : stockData?.best ? [stockData.best] : [];
        const cryptoMatches = Array.isArray(cryptoData?.matches) ? cryptoData.matches : cryptoData?.best ? [cryptoData.best] : [];
        matchesRaw.push(...stockMatches);
        matchesRaw.push(...cryptoMatches);
        const dedup = new Map();

        const aliasSymbol = resolvePortfolioAlias(q);
        const fallbackSymbol = canonicalTicker(q);
        if (aliasSymbol) dedup.set(aliasSymbol, { symbol: aliasSymbol, description: "Matched by company name" });
        else if (isPlainTickerInput(q)) dedup.set(fallbackSymbol, { symbol: fallbackSymbol, description: "Direct ticker" });

        for (const m of matchesRaw) {
          const symbol = String(m?.symbol || "").toUpperCase();
          const rawDescription = String(m?.description || m?.name || "").trim();
          const isCrypto = Boolean(m?.id) || /crypto|coin/i.test(rawDescription);
          const description = rawDescription ? `${rawDescription}${isCrypto ? " • Crypto" : ""}` : isCrypto ? "Crypto asset" : "";
          if (!symbol) continue;
          if (!dedup.has(symbol)) dedup.set(symbol, { symbol, description });
        }
        const suggestions = Array.from(dedup.values()).slice(0, 8);
        setPortfolioSuggestions(suggestions);
        setPortfolioSuggestionOpen(suggestions.length > 0);
      } catch (e) {
        if (e?.name !== "AbortError") {
          setPortfolioSuggestions([]);
          setPortfolioSuggestionOpen(false);
        }
      } finally {
        setPortfolioSuggestionLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [portfolioSymbolInput, authUser]);

  const resolveSymbol = async (input) => {
    const raw = String(input || "").trim();
    if (!raw) return "";
    const aliasSymbol = resolvePortfolioAlias(raw);
    if (aliasSymbol) return aliasSymbol;
    const fallback = canonicalTicker(raw);
    if (isPlainTickerInput(raw)) return fallback;
    try {
      let res = await fetch(`/api/search?query=${encodeURIComponent(raw)}`);
      if (!res.ok) res = await fetch(`/api/search?q=${encodeURIComponent(raw)}`);
      const stockData = res.ok ? await res.json().catch(() => ({})) : {};
      const matches = Array.isArray(stockData?.matches) ? stockData.matches : [];
      const exactSymbol = matches.find((m) => canonicalTicker(m?.symbol || "") === fallback);
      if (exactSymbol) return canonicalTicker(exactSymbol.symbol);
      const exactDisplay = matches.find((m) => canonicalTicker(m?.displaySymbol || "") === fallback);
      if (exactDisplay) return canonicalTicker(exactDisplay.symbol || exactDisplay.displaySymbol);

      if (fallback && !raw.includes(".") && !raw.includes(":")) {
        const undotted = matches.find((m) => {
          const s = canonicalTicker(m?.symbol || "");
          return s && !s.includes(".");
        });
        if (undotted) return canonicalTicker(undotted.symbol);
      }

      const stockSym = canonicalTicker(stockData?.symbol || stockData?.result?.symbol || "");
      if (stockSym) return stockSym;

      const cryptoRes = await fetch(`/api/crypto-search?query=${encodeURIComponent(raw)}`);
      if (cryptoRes.ok) {
        const cryptoData = await cryptoRes.json().catch(() => ({}));
        const cryptoMatches = Array.isArray(cryptoData?.matches) ? cryptoData.matches : [];
        const firstSym = canonicalTicker(cryptoData?.symbol || cryptoData?.best?.symbol || cryptoMatches?.[0]?.symbol || "");
        if (firstSym) return firstSym;
      }
      return fallback;
    } catch {
      return fallback;
    }
  };

  const applyPortfolioSuggestion = (suggestion) => {
    const symbol = canonicalTicker(suggestion?.symbol || "");
    if (!symbol) return;
    setPortfolioSymbolInput(symbol);
    setPortfolioSuggestionOpen(false);
  };

  const addPortfolioHolding = async (symbolOverride = "") => {
    const rawSymbol = String(symbolOverride || portfolioSymbolInput || "").trim();
    const symbol = rawSymbol ? await resolveSymbol(rawSymbol) : "";
    const quantity = Number(portfolioQtyInput);
    const buyPriceParsed = parseOptionalNumber(portfolioBuyPriceInput);

    if (!symbol) return setPortfolioError("Enter a valid symbol (stock, ETF, mutual fund, bond ETF, or crypto).");
    if (!Number.isFinite(quantity) || quantity <= 0) return setPortfolioError("Quantity must be greater than 0.");
    if (Number.isNaN(buyPriceParsed) || (buyPriceParsed != null && buyPriceParsed < 0)) {
      return setPortfolioError("Buy cost must be blank or 0+.");
    }
    const buyPrice = buyPriceParsed;

    setPortfolioError("");
    setPortfolioNotice("");
    const cleanSymbol = canonicalTicker(symbol);
    setPortfolioHoldings((prev) => {
      const idx = prev.findIndex((h) => canonicalTicker(h.symbol) === cleanSymbol);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], symbol: cleanSymbol, quantity, buyPrice };
        return next;
      }
      const id = `${cleanSymbol}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return [...prev, { id, symbol: cleanSymbol, quantity, buyPrice }].slice(0, 50);
    });
    setPortfolioSymbolInput("");
    setPortfolioQtyInput("1");
    setPortfolioBuyPriceInput("");
    setPortfolioSuggestionOpen(false);
    setPortfolioNotice(`${cleanSymbol} saved in portfolio.`);
  };

  const removePortfolioHolding = (id) => {
    setPortfolioHoldings((prev) => prev.filter((x) => x.id !== id));
    setPortfolioRows((prev) => prev.filter((x) => x.id !== id));
    setPortfolioNotice("Holding removed from portfolio.");
  };

  const updatePortfolioHoldingField = (id, field, rawValue) => {
    setPortfolioHoldings((prev) =>
      prev.map((h) => {
        if (h.id !== id) return h;
        if (field === "quantity") return { ...h, quantity: rawValue };
        if (field === "buyPrice") return { ...h, buyPrice: rawValue };
        return h;
      })
    );
  };

  const savePortfolioHolding = (id) => {
    let savedSymbol = "";
    let valid = true;
    setPortfolioHoldings((prev) =>
      prev.map((h) => {
        if (h.id !== id) return h;
        const qty = Number(h.quantity);
        const buyPxParsed = parseOptionalNumber(h.buyPrice);
        if (!Number.isFinite(qty) || qty <= 0 || Number.isNaN(buyPxParsed) || (buyPxParsed != null && buyPxParsed < 0)) {
          valid = false;
          return h;
        }
        savedSymbol = h.symbol;
        return { ...h, quantity: qty, buyPrice: buyPxParsed };
      })
    );
    if (!valid) return setPortfolioError("Quantity must be > 0 and buy cost must be blank or 0+.");
    setPortfolioError("");
    setPortfolioNotice(`${savedSymbol || "Holding"} updated.`);
  };

  const fetchPortfolioRows = async (holdings) => {
    if (!Array.isArray(holdings) || holdings.length === 0) return [];
    return Promise.all(
      holdings.map(async (h) => {
        const sym = canonicalTicker(h?.symbol || "");
        const qty = Number(h?.quantity || 0);
        const buyPriceRaw = parseOptionalNumber(h?.buyPrice);
        const buyPrice = Number.isNaN(buyPriceRaw) ? null : buyPriceRaw;
        try {
          let quoteData = {};
          let quoteOk = false;
          let isCrypto = false;

          const stockRes = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
          const stockData = await stockRes.json().catch(() => ({}));
          if (stockRes.ok) {
            quoteData = stockData;
            quoteOk = true;
          } else {
            const cryptoRes = await fetch(`/api/crypto-quote?symbol=${encodeURIComponent(sym)}`);
            const cryptoData = await cryptoRes.json().catch(() => ({}));
            if (cryptoRes.ok) {
              quoteData = cryptoData;
              quoteOk = true;
              isCrypto = true;
            }
          }

          if (!quoteOk) {
            return { id: h.id, symbol: sym, quantity: qty, buyPrice, error: "Quote unavailable" };
          }
          const livePrice = Number(quoteData?.price);
          const dayChange = Number(quoteData?.change);
          const pct = Number(quoteData?.percentChange);
          const marketValue = Number.isFinite(qty) && Number.isFinite(livePrice) ? qty * livePrice : null;
          const hasUserCost = Number.isFinite(buyPrice);
          // If buy cost is missing, use current market value as baseline.
          const costBasis = hasUserCost ? buyPrice : marketValue;
          const buyPricePerShare = hasUserCost && Number.isFinite(qty) && qty > 0 ? buyPrice / qty : null;
          const unrealizedPnL = Number.isFinite(marketValue) && Number.isFinite(costBasis) ? marketValue - costBasis : null;
          const unrealizedPct = Number.isFinite(costBasis) && costBasis > 0 && Number.isFinite(unrealizedPnL) ? (unrealizedPnL / costBasis) * 100 : null;
          let sector = isCrypto ? "Cryptocurrency" : inferSectorFromSymbol(sym);
          if (!isCrypto) {
            try {
              const profileRes = await fetch(`/api/profile?symbol=${encodeURIComponent(sym)}`);
              const profile = await profileRes.json().catch(() => ({}));
              if (profileRes.ok) {
                const profileSector = String(profile?.finnhubIndustry || profile?.sector || profile?.gicsSector || "").trim();
                if (profileSector) sector = profileSector;
              }
            } catch {}
          }
          return {
            id: h.id,
            symbol: canonicalTicker(quoteData?.symbol || sym),
            quantity: qty,
            buyPrice,
            buyPricePerShare,
            price: livePrice,
            change: dayChange,
            percentChange: pct,
            dayPnL: Number.isFinite(dayChange) && Number.isFinite(qty) ? dayChange * qty : null,
            costBasis,
            marketValue,
            unrealizedPnL,
            unrealizedPct,
            sector,
          };
        } catch {
          return { id: h.id, symbol: sym, quantity: qty, buyPrice, error: "Network issue" };
        }
      })
    );
  };

  useEffect(() => {
    if (!authUser || portfolioHoldings.length === 0) {
      setPortfolioRows([]);
      return;
    }
    let active = true;
    const refreshRows = async () => {
      const rows = await fetchPortfolioRows(portfolioHoldings);
      if (active) setPortfolioRows(rows);
    };
    refreshRows();
    return () => {
      active = false;
    };
  }, [authUser, portfolioHoldings]);

  const computePortfolioAnalysis = (rows) => {
    const valid = rows.filter((r) => Number.isFinite(r?.percentChange) && Number.isFinite(r?.marketValue));
    const greenFlags = [];
    const redFlags = [];
    let score = 65;

    if (!valid.length) {
      return { score: 35, greenFlags, redFlags: ["No valid holdings data yet. Add holdings and run analysis."] };
    }

    const totalValue = valid.reduce((a, r) => a + Number(r.marketValue || 0), 0);
    const avgChange = valid.reduce((a, r) => a + Number(r.percentChange || 0), 0) / valid.length;
    const weightedDaily =
      totalValue > 0
        ? valid.reduce((a, r) => a + Number(r.percentChange || 0) * (Number(r.marketValue || 0) / totalValue), 0)
        : avgChange;
    if (avgChange >= 0) {
      score += 12;
      greenFlags.push(`Portfolio daily momentum is positive (${avgChange.toFixed(2)}%).`);
    } else {
      score -= 12;
      redFlags.push(`Portfolio daily momentum is negative (${avgChange.toFixed(2)}%).`);
    }

    const deepRed = valid.filter((r) => Number(r.percentChange) <= -4 || Number(r.unrealizedPct) <= -15);
    if (deepRed.length) {
      score -= Math.min(20, deepRed.length * 5);
      redFlags.push(`High drawdown risk: ${deepRed.map((r) => r.symbol).join(", ")} show elevated downside.`);
    } else {
      score += 6;
      greenFlags.push("No holdings are showing severe drawdown risk right now.");
    }

    const strongGreen = valid.filter((r) => Number(r.percentChange) >= 2);
    if (strongGreen.length >= 2) {
      score += 8;
      greenFlags.push(`Multiple strong movers: ${strongGreen.map((r) => r.symbol).join(", ")}.`);
    }
    if (valid.length >= 5) {
      score += 8;
      greenFlags.push(`Diversification: ${valid.length} holdings tracked.`);
    } else {
      score -= 8;
      redFlags.push("Low diversification: consider 5+ holdings to reduce concentration risk.");
    }
    const variance = valid.reduce((a, r) => a + Math.pow(Number(r.percentChange) - weightedDaily, 2), 0) / valid.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 3.5) {
      score -= 8;
      redFlags.push("Volatility is elevated across holdings.");
    } else {
      score += 5;
      greenFlags.push("Volatility profile is relatively stable.");
    }

    const totalCost = valid.reduce((a, r) => a + Number(r.costBasis || 0), 0);
    const totalUnrealized = valid.reduce((a, r) => a + Number(r.unrealizedPnL || 0), 0);
    const totalReturnPct = totalCost > 0 ? (totalUnrealized / totalCost) * 100 : 0;
    if (totalReturnPct >= 0) greenFlags.push(`Overall unrealized return is positive (${totalReturnPct.toFixed(2)}%).`);
    else redFlags.push(`Overall unrealized return is negative (${totalReturnPct.toFixed(2)}%).`);

    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score, greenFlags, redFlags, totalCost, totalValue, totalUnrealized, totalReturnPct };
  };

  const runPortfolioAnalysis = async () => {
    if (!authUser) return setPortfolioError("Login required to use portfolio tools.");
    const holdings = portfolioHoldings.filter((h) => canonicalTicker(h?.symbol || ""));
    if (!holdings.length) return setPortfolioError("Add at least one holding (stock, ETF, fund, bond ETF, or crypto) to analyze.");
    setPortfolioError("");
    setPortfolioLoading(true);
    try {
      const rows = await fetchPortfolioRows(holdings);
      setPortfolioRows(rows);
      setPortfolioAnalysis(computePortfolioAnalysis(rows));
    } catch {
      setPortfolioError("Portfolio analysis failed. Try again.");
    } finally {
      setPortfolioLoading(false);
    }
  };

  const isLight = theme === "light";
  const summary = useMemo(() => {
    const count = portfolioHoldings.length;
    return count ? `${count} holding${count === 1 ? "" : "s"} saved` : "No holdings saved yet";
  }, [portfolioHoldings.length]);
  const sectorAllocation = useMemo(() => buildSectorAllocation(portfolioRows), [portfolioRows]);
  const chatContextSymbols = useMemo(
    () =>
      portfolioHoldings
        .map((h) => canonicalTicker(h?.symbol || ""))
        .filter(Boolean)
        .slice(0, 8),
    [portfolioHoldings]
  );

  const sendChatMessage = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;

    setChatMessages((prev) => [...prev, { role: "user", content: question }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const q = question.toLowerCase();
      const asksFounder =
        /\b(founder|owner|creator|made you|who built you|who created you|who made this|who made the site)\b/.test(q) ||
        /\bdeep patel\b/.test(q) ||
        /\bjuan m\. ramirez\b/.test(q);
      if (asksFounder) {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Arthastra was founded by Deep Patel with Juan M. Ramirez as Co-founder. They are the creators and owners of this platform.",
          },
        ]);
        setChatLoading(false);
        return;
      }

      const primarySymbol = chatContextSymbols[0] || "";
      const portfolioContext = [
        `Holdings: ${chatContextSymbols.join(", ") || "none"}`,
        `Sectors: ${sectorAllocation.items.map((x) => `${x.sector} ${Math.round(x.pct * 100)}%`).join(", ") || "none"}`,
        `Diversification Score: ${sectorAllocation.diversificationScore}/100`,
        `Total Value: ${Number(sectorAllocation.total || 0).toFixed(2)}`,
      ].join(" | ");

      const enrichedQuestion = `${question}\n\nPortfolio context: ${portfolioContext}`;
      const res = await fetch(
        `/api/ai?mode=chat&market=stock&question=${encodeURIComponent(enrichedQuestion)}&symbol=${encodeURIComponent(primarySymbol)}`
      );
      const data = await res.json().catch(() => ({}));
      const answer = cleanChatAnswer(data?.answer || data?.raw || data?.error || "I could not generate a reply.");
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Network issue. Please try again. For informational purposes only.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className={`min-h-screen relative overflow-hidden ${isLight ? "bg-[#fbfdff] text-slate-900" : "bg-slate-950 text-white"}`}>
      <div className={`pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full blur-3xl ${isLight ? "bg-sky-200/35" : "bg-cyan-500/12"}`} />
      <div className={`pointer-events-none absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl ${isLight ? "bg-blue-200/30" : "bg-blue-500/10"}`} />
      <div className={`pointer-events-none absolute inset-0 ${isLight ? "bg-[radial-gradient(circle_at_15%_10%,rgba(125,211,252,0.18),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(147,197,253,0.14),transparent_42%),radial-gradient(circle_at_55%_18%,rgba(59,130,246,0.09),transparent_35%)]" : "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.07),transparent_35%)]"}`} />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-lg border text-xs ${
              isLight ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100" : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
            }`}
          >
            Back Home
          </Link>
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

        <div className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Portfolio</h1>
          <p className={`mt-2 text-sm ${isLight ? "text-slate-600" : "text-white/70"}`}>{summary}</p>
        </div>

        {!authReady ? (
          <Card title="Loading">
            <div className="text-sm text-white/70">Checking account...</div>
          </Card>
        ) : !authUser ? (
          <Card title="Login Required">
            <div className="text-sm text-white/80">Please sign in from the home page to manage portfolio holdings (stocks, ETFs, funds, bonds, and crypto).</div>
          </Card>
        ) : (
          <>
            <div className="mb-6">
              <Card
                title="Add / Edit Portfolio"
                right={
                  <button
                    onClick={runPortfolioAnalysis}
                    disabled={portfolioLoading}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs disabled:opacity-50"
                  >
                    {portfolioLoading ? "Analyzing..." : "ASTRA Portfolio Analysis"}
                  </button>
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
                  <div className="relative">
                    <input
                      value={portfolioSymbolInput}
                      onChange={(e) => setPortfolioSymbolInput(e.target.value)}
                      onFocus={() => portfolioSuggestions.length > 0 && setPortfolioSuggestionOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        if (portfolioSuggestionOpen && portfolioSuggestions.length > 0) {
                          e.preventDefault();
                          applyPortfolioSuggestion(portfolioSuggestions[0]);
                          return;
                        }
                        addPortfolioHolding();
                      }}
                      placeholder="Symbol or name (AAPL, VOO, FXAIX, BND...)"
                      className="w-full px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                    />
                    {portfolioSuggestionOpen && (
                      <div className="absolute z-30 mt-1 w-full rounded-xl border border-white/10 bg-slate-950/95 backdrop-blur-md shadow-2xl overflow-hidden">
                        {portfolioSuggestionLoading ? (
                          <div className="px-3 py-2 text-xs text-white/60">Finding matches...</div>
                        ) : (
                          <div className="max-h-56 overflow-y-auto">
                            {portfolioSuggestions.map((s) => (
                              <button
                                key={`ps-${s.symbol}`}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  applyPortfolioSuggestion(s);
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
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    min="0"
                    value={portfolioQtyInput}
                    onChange={(e) => setPortfolioQtyInput(e.target.value)}
                    placeholder="Quantity"
                    className="px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={portfolioBuyPriceInput}
                    onChange={(e) => setPortfolioBuyPriceInput(e.target.value)}
                    placeholder="Buy cost (total, optional)"
                    className="px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                  />
                  <button
                    onClick={() => addPortfolioHolding()}
                    className="h-[42px] px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold"
                  >
                    Add Holding
                  </button>
                </div>

                {portfolioError && (
                  <div className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {portfolioError}
                  </div>
                )}
                {portfolioNotice && (
                  <div className="mb-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    {portfolioNotice}
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-white/60">
                      <tr className="text-left border-b border-white/10">
                        <th className="py-2 pr-2">Symbol</th>
                        <th className="py-2 pr-2">Qty</th>
                        <th className="py-2 pr-2">Buy Cost (Total)</th>
                        <th className="py-2 pr-2">Buy Price / Share</th>
                        <th className="py-2 pr-2">Current Price</th>
                        <th className="py-2 pr-2">Current Value</th>
                        <th className="py-2 pr-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioHoldings.map((h) => (
                        <tr key={h.id} className="border-b border-white/5">
                          <td className="py-2 pr-2 font-semibold">{h.symbol}</td>
                          <td className="py-2 pr-2 w-28">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              inputMode="decimal"
                              value={h.quantity}
                              onChange={(e) => updatePortfolioHoldingField(h.id, "quantity", e.target.value)}
                              className="w-full px-2 py-1 rounded-md bg-white text-black border border-white/20"
                            />
                          </td>
                          <td className="py-2 pr-2 w-32">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={h.buyPrice ?? ""}
                              onChange={(e) => updatePortfolioHoldingField(h.id, "buyPrice", e.target.value)}
                              placeholder="optional"
                              className="w-full px-2 py-1 rounded-md bg-white text-black border border-white/20"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            {(() => {
                              const row = portfolioRows.find((r) => r.id === h.id);
                              const perShare = row?.buyPricePerShare;
                              return fmt(perShare) != null ? `$${perShare.toFixed(2)}` : "—";
                            })()}
                          </td>
                          <td className="py-2 pr-2">
                            {(() => {
                              const row = portfolioRows.find((r) => r.id === h.id);
                              return fmt(row?.price) != null ? `$${Number(row.price).toFixed(2)}` : "—";
                            })()}
                          </td>
                          <td className="py-2 pr-2">
                            {(() => {
                              const row = portfolioRows.find((r) => r.id === h.id);
                              return fmt(row?.marketValue) != null ? `$${Number(row.marketValue).toFixed(2)}` : "—";
                            })()}
                          </td>
                          <td className="py-2 pr-2">
                            <div className="flex gap-2">
                              <button onClick={() => savePortfolioHolding(h.id)} className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500">
                                Save
                              </button>
                              <button onClick={() => removePortfolioHolding(h.id)} className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15">
                                Sold / Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {portfolioHoldings.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-3 text-white/60">
                            No holdings added yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>

            <div className="mb-6">
              <Card title="Sector Allocation & Diversification">
                {sectorAllocation.items.length === 0 ? (
                  <div className="text-sm text-white/65">Add holdings to see allocation by sector.</div>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="flex flex-col sm:flex-row items-center gap-5">
                      <AllocationPie items={sectorAllocation.items} />
                      <div className="space-y-1 text-center sm:text-left">
                        <div className="text-xs uppercase tracking-[0.2em] text-white/50">Portfolio Value</div>
                        <div className="text-2xl font-bold text-white">${sectorAllocation.total.toFixed(2)}</div>
                        <div className="text-sm text-white/70">
                          Top Sector: <span className="text-white">{sectorAllocation.topSector}</span>{" "}
                          <span className="text-white/60">({sectorAllocation.topWeightPct.toFixed(1)}%)</span>
                        </div>
                        <div className="text-sm text-white/70">Sectors Tracked: {sectorAllocation.sectorCount}</div>
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-3 py-2.5">
                        <div className="text-xs text-cyan-200/85 mb-1">Diversification Score</div>
                        <div className="text-2xl font-bold text-cyan-200">{sectorAllocation.diversificationScore}/100</div>
                      </div>
                      <div className="space-y-2">
                        {sectorAllocation.items.map((item) => (
                          <div key={item.sector} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                            <div className="flex items-center justify-between text-sm">
                              <div className="flex items-center gap-2">
                                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                                <span className="text-white/90">{item.sector}</span>
                              </div>
                              <span className="text-white/75">{(item.pct * 100).toFixed(1)}%</span>
                            </div>
                            <div className="mt-1 text-xs text-white/60">${item.value.toFixed(2)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            </div>

            {portfolioAnalysis && (
              <Card title="ASTRA Portfolio Analysis">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
                  <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 p-3">
                    <div className="text-xs text-cyan-200/90 mb-1">Overall Score</div>
                    <div className="text-2xl font-bold text-cyan-200">{portfolioAnalysis.score}/100</div>
                  </div>
                  <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-3">
                    <div className="text-xs text-blue-200/90 mb-1">Invested</div>
                    <div className="text-lg font-semibold text-blue-200">${Number(portfolioAnalysis.totalCost || 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 p-3">
                    <div className="text-xs text-indigo-200/90 mb-1">Current Value</div>
                    <div className="text-lg font-semibold text-indigo-200">${Number(portfolioAnalysis.totalValue || 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-3">
                    <div className="text-xs text-violet-200/90 mb-1">Total Return</div>
                    <div className={`text-lg font-semibold ${Number(portfolioAnalysis.totalReturnPct) >= 0 ? "text-green-300" : "text-red-300"}`}>
                      {Number(portfolioAnalysis.totalReturnPct) >= 0 ? "+" : ""}
                      {Number(portfolioAnalysis.totalReturnPct || 0).toFixed(2)}%
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 mb-3">
                  <div className="text-xs text-emerald-200 mb-1">Green Flags</div>
                  <ul className="list-disc pl-5 text-sm text-emerald-100 space-y-1">
                    {(portfolioAnalysis.greenFlags || []).map((g, i) => <li key={`g-${i}`}>{g}</li>)}
                  </ul>
                </div>
                <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 mb-3">
                  <div className="text-xs text-rose-200 mb-1">Red Flags</div>
                  <ul className="list-disc pl-5 text-sm text-rose-100 space-y-1">
                    {(portfolioAnalysis.redFlags || []).map((r, i) => <li key={`r-${i}`}>{r}</li>)}
                  </ul>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-white/60">
                      <tr className="text-left border-b border-white/10">
                        <th className="py-2 pr-2">Symbol</th>
                        <th className="py-2 pr-2">Qty</th>
                        <th className="py-2 pr-2">Buy</th>
                        <th className="py-2 pr-2">Now</th>
                        <th className="py-2 pr-2">Cost Basis</th>
                        <th className="py-2 pr-2">Market Value</th>
                        <th className="py-2 pr-2">Unrealized P/L</th>
                        <th className="py-2 pr-2">Return %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioRows.map((r) => (
                        <tr key={r.id || r.symbol} className="border-b border-white/5">
                          <td className="py-2 pr-2 font-semibold">{r.symbol}</td>
                          <td className="py-2 pr-2">{fmtQty(r.quantity)}</td>
                          <td className="py-2 pr-2">{fmt(r.buyPrice) != null ? `$${Number(r.buyPrice).toFixed(2)}` : "—"}</td>
                          <td className="py-2 pr-2">{fmt(r.price) != null ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                          <td className="py-2 pr-2">{fmt(r.costBasis) != null ? `$${Number(r.costBasis).toFixed(2)}` : "—"}</td>
                          <td className="py-2 pr-2">{fmt(r.marketValue) != null ? `$${Number(r.marketValue).toFixed(2)}` : "—"}</td>
                          <td className={`py-2 pr-2 ${Number(r.unrealizedPnL) >= 0 ? "text-green-300" : "text-red-300"}`}>
                            {fmt(r.unrealizedPnL) != null ? `${Number(r.unrealizedPnL) >= 0 ? "+" : ""}${Number(r.unrealizedPnL).toFixed(2)}` : "—"}
                          </td>
                          <td className={`py-2 pr-2 ${Number(r.unrealizedPct) >= 0 ? "text-green-300" : "text-red-300"}`}>
                            {fmt(r.unrealizedPct) != null ? `${Number(r.unrealizedPct) >= 0 ? "+" : ""}${Number(r.unrealizedPct).toFixed(2)}%` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      <div className="fixed bottom-5 right-5 z-50">
        {chatOpen ? (
          <div
            className={`w-[92vw] max-w-sm sm:max-w-md rounded-2xl shadow-2xl overflow-hidden ${
              isLight ? "border border-slate-300 bg-white" : "border border-white/15 bg-[#0e1015]"
            }`}
          >
            <div className={`flex items-center justify-between px-4 py-3 ${isLight ? "border-b border-slate-200 bg-slate-50" : "border-b border-white/10 bg-white/[0.04]"}`}>
              <div>
                <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>ASTRA</div>
                <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/55"}`}>
                  {chatContextSymbols.length ? `Portfolio context: ${chatContextSymbols.join(", ")}` : "No holdings context yet"}
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
                  <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${isLight ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-white/10 text-white/75 border border-white/10"}`}>
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
                placeholder="Ask ASTRA about your portfolio, risk, or diversification"
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
            className="h-14 w-14 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-[12px] font-bold tracking-wide shadow-xl border border-blue-400/40"
          >
            ASTRA
          </button>
        )}
      </div>
    </div>
  );
}
