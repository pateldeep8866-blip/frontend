import { NextResponse } from "next/server";
import { insertTrade } from "../_lib/trade-db";

export const dynamic = "force-dynamic";

const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
const OPENAI_MODEL = "gpt-4.1-mini";
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
const FULL_CANDIDATE_UNIVERSE = [
  "SPY", "QQQ", "IWM", "DIA",
  "XLK", "XLF", "XLE", "XLV",
  "XLI", "XLY", "XLP", "GLD", "TLT",
  "AAPL", "MSFT", "NVDA", "AMZN",
  "GOOGL", "META", "TSLA", "AMD",
  "AVGO", "ORCL", "CRM", "ADBE",
  "JPM", "BAC", "GS", "MS",
  "JNJ", "UNH", "LLY", "ABBV",
  "XOM", "CVX", "WMT", "COST",
  "SOXX", "ARKK", "IBB", "EEM", "EFA",
  "VNQ", "HYG", "USO", "SLV", "GDXJ",
];
const CANDIDATE_CRYPTOS = ["BTC", "ETH", "SOL", "XRP"];
const QUANT_INDICATORS = ["rsi", "macd", "bollinger", "vwap", "ema_cross", "volume_profile"];
const ALLOCATION_RULES = {
  conservative: { maxCrypto: 0, minStocks: 0.7, maxSinglePosition: 0.05, cashReserve: 0.3 },
  moderate: { maxCrypto: 0.2, minStocks: 0.5, maxSinglePosition: 0.15, cashReserve: 0.2 },
  aggressive: { maxCrypto: 0.4, minStocks: 0.3, maxSinglePosition: 0.2, cashReserve: 0.1 },
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeAssetType(value) {
  return String(value || "").toLowerCase() === "crypto" ? "crypto" : "stock";
}

function getRiskPolicy(rawLevel, custom) {
  const level = String(rawLevel || "MODERATE").toUpperCase();
  if (level === "CONSERVATIVE") {
    return {
      level,
      maxPositionPct: 0.05,
      maxCryptoPct: 0,
      minCashReservePct: 0.2,
      allowCrypto: false,
      target: "8-15%",
    };
  }
  if (level === "AGGRESSIVE") {
    return {
      level,
      maxPositionPct: 0.2,
      maxCryptoPct: 0.2,
      minCashReservePct: 0.08,
      allowCrypto: true,
      target: "25%+",
    };
  }
  if (level === "CUSTOM") {
    const maxPositionPct = Math.max(0.01, Math.min(0.3, Number(custom?.maxPositionPct || 0.12)));
    const maxCryptoPct = Math.max(0, Math.min(0.3, Number(custom?.maxCryptoPct || 0.1)));
    const minCashReservePct = Math.max(0.02, Math.min(0.4, Number(custom?.minCashReservePct || 0.1)));
    return {
      level,
      maxPositionPct,
      maxCryptoPct,
      minCashReservePct,
      allowCrypto: maxCryptoPct > 0,
      target: String(custom?.target || "Custom"),
    };
  }
  return {
    level: "MODERATE",
    maxPositionPct: 0.15,
    maxCryptoPct: 0.08,
    minCashReservePct: 0.12,
    allowCrypto: true,
    target: "15-25%",
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanJson(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("```")) return text;
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function sanitizePublicReasoning(reasoning, entryPrice, stopLoss, takeProfit) {
  const raw = String(reasoning || "").trim();
  if (!raw) {
    return `ASTRA identified a tradable setup with defined risk parameters. Entry at $${Number(entryPrice || 0).toFixed(2)}, stop near $${Number(stopLoss || 0).toFixed(2)}, target near $${Number(takeProfit || 0).toFixed(2)}.`;
  }
  let text = raw
    .replace(/quant[_\s-]*lab/gi, "ASTRA")
    .replace(/composite score[^.]*\.?/gi, "")
    .replace(/momentum score[^.]*\.?/gi, "")
    .replace(/mean[_\s-]*reversion[^.]*\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    text = "ASTRA identified a tradable setup with defined risk parameters.";
  }
  return text;
}

function quantScoreToAstraScore(composite) {
  const c = Number(composite || 0);
  if (c > 0.15) return 85;
  if (c > 0.08) return 75;
  if (c > 0.04) return 65;
  if (c > 0.0) return 55;
  if (c > -0.04) return 45;
  if (c > -0.08) return 35;
  return 25;
}

function getLessonForStrategy(strategy) {
  const lessons = {
    momentum: "Momentum investing buys relative strength — instruments that are outperforming peers tend to continue doing so.",
    mean_reversion: "Mean reversion capitalizes on short-term overreactions. Prices that deviate from trend tend to snap back.",
    regime_rotation: "Regime rotation shifts capital to asset classes that historically outperform in current macro conditions.",
    pairs_trading: "Pairs trading is market neutral — it profits from relative performance between correlated instruments.",
    earnings_momentum: "Post-earnings drift (PEAD) captures continued movement after earnings surprises.",
  };
  return lessons[String(strategy || "").toLowerCase()] || "Quantitative signal detected.";
}

function buildPrioritySellDecisions({ holdings, quantResult, riskLevel }) {
  const decisions = [];
  const quantScores = Array.isArray(quantResult?.all_scores) ? quantResult.all_scores : [];
  const scoreByTicker = new Map(quantScores.map((s) => [String(s?.ticker || "").toUpperCase(), s]));
  const maxHoldDays = { conservative: 5, moderate: 15, aggressive: 30 }[String(riskLevel || "").toLowerCase()] || 15;

  for (const holding of holdings) {
    const ticker = String(holding?.symbol || "").toUpperCase();
    const shares = Number(holding?.shares || 0);
    const currentPrice = Number(holding?.currentPrice || 0);
    const avgBuy = Number(holding?.avgBuy || 0);
    if (!ticker || shares <= 0 || currentPrice <= 0) continue;

    const gainPct = avgBuy > 0 ? ((currentPrice - avgBuy) / avgBuy) * 100 : 0;

    // SELL TYPE 1 — Stop Loss
    if (holding?.stopLoss && currentPrice <= Number(holding.stopLoss)) {
      decisions.push({
        action: "SELL",
        ticker,
        shares,
        entry_price: currentPrice,
        reason: "stop_loss",
        reasoning: `🛑 STOP LOSS: Sold ${shares} shares of ${ticker} at $${currentPrice.toFixed(2)}. Entry was $${avgBuy.toFixed(2)}. Loss: ${gainPct.toFixed(2)}%. Capital protected.`,
        confidence: 95,
        risk: "LOW",
        lesson: "Stop losses are essential for capital preservation.",
      });
      continue;
    }

    // SELL TYPE 2 — Take Profit
    if (holding?.takeProfit && currentPrice >= Number(holding.takeProfit)) {
      const sellShares = Math.max(1, Math.floor(shares * 0.5));
      decisions.push({
        action: "SELL",
        ticker,
        shares: sellShares,
        entry_price: currentPrice,
        reason: "take_profit",
        reasoning: `✅ TAKE PROFIT: Sold ${sellShares} shares of ${ticker} at $${currentPrice.toFixed(2)}. Entry was $${avgBuy.toFixed(2)}. Gain: +${gainPct.toFixed(2)}%. Profits locked in.`,
        confidence: 90,
        risk: "LOW",
        lesson: "Taking partial profits locks gains while keeping upside exposure.",
      });
      continue;
    }

    // SELL TYPE 3 — Signal reversal
    const qs = scoreByTicker.get(ticker);
    if (qs) {
      const astraScore = quantScoreToAstraScore(Number(qs?.composite_score || 0));
      if (astraScore < 35) {
        decisions.push({
          action: "SELL",
          ticker,
          shares,
          entry_price: currentPrice,
          reason: "signal_reversal",
          reasoning: `📉 SIGNAL EXIT: Sold ${shares} shares of ${ticker} at $${currentPrice.toFixed(2)}. Quantitative signal reversed. Position closed.`,
          confidence: 80,
          risk: "LOW",
          lesson: "Exit when the original signal no longer supports the position.",
        });
        continue;
      }
      if (astraScore >= 35 && astraScore < 45) {
        const sellShares = Math.max(1, Math.floor(shares * 0.5));
        decisions.push({
          action: "SELL",
          ticker,
          shares: sellShares,
          entry_price: currentPrice,
          reason: "signal_weakening",
          reasoning: `📉 SIGNAL EXIT: Sold ${sellShares} shares of ${ticker} at $${currentPrice.toFixed(2)}. Quantitative signal weakened. Position reduced.`,
          confidence: 65,
          risk: "MEDIUM",
          lesson: "Scale down when conviction weakens.",
        });
        continue;
      }
    }

    // SELL TYPE 4 — Time stop
    const buyDate = holding?.buyDate ? new Date(holding.buyDate).getTime() : null;
    const daysHeld = buyDate ? Math.floor((Date.now() - buyDate) / (1000 * 60 * 60 * 24)) : 0;
    if (daysHeld > maxHoldDays && gainPct < 0) {
      decisions.push({
        action: "SELL",
        ticker,
        shares,
        entry_price: currentPrice,
        reason: "time_stop",
        reasoning: `⏰ TIME STOP: Sold ${shares} shares of ${ticker} after ${daysHeld} days. Freeing capital.`,
        confidence: 70,
        risk: "MEDIUM",
        lesson: "Time stops prevent capital from staying trapped in stale positions.",
      });
    }
  }

  return decisions;
}

async function fetchQuoteBatch(symbols) {
  if (!symbols.length) return [];
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data?.quoteResponse?.result)
      ? data.quoteResponse.result.map((r) => ({
          symbol: String(r?.symbol || "").toUpperCase(),
          price: toNum(r?.regularMarketPrice),
          percentChange: toNum(r?.regularMarketChangePercent),
          change: toNum(r?.regularMarketChange),
          name: String(r?.longName || r?.shortName || r?.symbol || "").trim(),
        }))
      : [];
  } catch {
    return [];
  }
}

async function fetchCryptoBatch(symbolsOrIds) {
  const items = Array.isArray(symbolsOrIds) ? symbolsOrIds : [];
  const ids = Array.from(
    new Set(
      items
        .map((x) => {
          const raw = String(x || "").toUpperCase().trim();
          if (!raw) return "";
          if (raw.includes("-")) return raw.toLowerCase();
          return CRYPTO_SYMBOL_TO_ID[raw] || raw.toLowerCase();
        })
        .filter(Boolean)
    )
  );
  if (!ids.length) return [];
  try {
    const params = new URLSearchParams({
      ids: ids.join(","),
      vs_currencies: "usd",
      include_24hr_change: "true",
      include_24hr_vol: "true",
      include_market_cap: "true",
    });
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?${params.toString()}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || typeof data !== "object") return [];
    return ids
      .map((id) => {
        const row = data?.[id];
        return row
          ? {
              id,
              symbol:
                Object.entries(CRYPTO_SYMBOL_TO_ID).find(([, cgId]) => cgId === id)?.[0] || id.toUpperCase(),
              price: toNum(row?.usd),
              percentChange: toNum(row?.usd_24h_change),
              volume: toNum(row?.usd_24h_vol),
              marketCap: toNum(row?.usd_market_cap),
            }
          : null;
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function fetchMacro() {
  const rows = await fetchQuoteBatch(["^VIX", "DX-Y.NYB", "^TNX", "SPY", "CL=F", "GC=F"]);
  const by = new Map(rows.map((r) => [r.symbol, r]));
  const vix = by.get("^VIX")?.price ?? null;
  return {
    vix,
    vixRegime: vix == null ? "UNKNOWN" : vix < 15 ? "RISK_ON" : vix <= 20 ? "NEUTRAL" : vix <= 25 ? "CAUTION" : "FEAR",
    dxy: by.get("DX-Y.NYB")?.price ?? null,
    tenYear: by.get("^TNX")?.price != null ? by.get("^TNX").price / 10 : null,
    wti: by.get("CL=F")?.price ?? null,
    gold: by.get("GC=F")?.price ?? null,
    marketChange: by.get("SPY")?.percentChange ?? null,
    marketTrend: Number(by.get("SPY")?.percentChange) > 0.2 ? "UP" : Number(by.get("SPY")?.percentChange) < -0.2 ? "DOWN" : "FLAT",
  };
}

async function fetchMovers() {
  try {
    const key = process.env.FINNHUB_API_KEY;
    if (key) {
      const symbols = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "JPM", "XOM"];
      const rows = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`;
            const res = await fetch(url, { cache: "no-store" });
            const data = await res.json().catch(() => ({}));
            const dp = toNum(data?.dp);
            if (dp == null) return null;
            return { symbol, percentChange: dp, price: toNum(data?.c) };
          } catch {
            return null;
          }
        })
      );
      return rows.filter(Boolean).sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange)).slice(0, 5);
    }
  } catch {}
  return [];
}

async function fetchCryptoMovers() {
  const symbols = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "DOGE", "LINK", "MATIC"];
  const rows = await fetchCryptoBatch(symbols);
  return rows
    .map((r) => ({ symbol: r.symbol, id: r.id, percentChange: r.percentChange, price: r.price }))
    .sort((a, b) => Math.abs(Number(b.percentChange || 0)) - Math.abs(Number(a.percentChange || 0)))
    .slice(0, 5);
}

async function fetchHoldingsNews(symbols) {
  const out = [];
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return out;
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const symbol of symbols.slice(0, 8)) {
    try {
      const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${to}&token=${key}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => []);
      const top = Array.isArray(data)
        ? data
            .slice(0, 2)
            .map((n) => ({ symbol, headline: String(n?.headline || "").trim(), source: String(n?.source || "Finnhub") }))
            .filter((n) => n.headline)
        : [];
      out.push(...top);
    } catch {}
  }
  return out;
}

async function fetchSectorPerformance() {
  const sectors = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY"];
  const rows = await fetchQuoteBatch(sectors);
  return rows
    .filter((r) => r?.symbol)
    .map((r) => ({ symbol: r.symbol, percentChange: r.percentChange }))
    .slice(0, 6);
}

async function fetchCandidateNews(candidates) {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return {};
  const out = {};
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const c of candidates.slice(0, 24)) {
    if (normalizeAssetType(c.assetType) !== "stock") continue;
    const symbol = String(c.symbol || "").toUpperCase();
    if (!symbol) continue;
    try {
      const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${key}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => []);
      const first = Array.isArray(data) ? data.find((x) => String(x?.headline || "").trim()) : null;
      const headline = String(first?.headline || "");
      const text = headline.toLowerCase();
      const pos = ["beat", "surge", "upgrade", "growth", "record", "partnership"].some((w) => text.includes(w));
      const neg = ["miss", "lawsuit", "downgrade", "cuts", "probe", "warning"].some((w) => text.includes(w));
      out[symbol] = {
        headline,
        sentiment: neg ? "negative" : pos ? "positive" : "neutral",
      };
    } catch {}
  }
  return out;
}

async function fetchMarketFeatures(tickers) {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const response = await fetch(`${origin}/api/market-features`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Feature fetch failed");
    return await response.json();
  } catch (error) {
    console.error("Market features unavailable:", error);
    return null;
  }
}

async function fetchQuantSignal(featuresPayload) {
  const quantUrl = process.env.QUANT_ENGINE_URL || "http://localhost:3001";
  try {
    const health = await fetch(`${quantUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!health.ok) throw new Error("QUANT_LAB offline");

    const response = await fetch(`${quantUrl}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(featuresPayload),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error("Analysis failed");
    const result = await response.json();

    console.log("QUANT_LAB response:", {
      status: result?.status,
      regime: result?.regime,
      single_pick: result?.single_pick?.ticker,
      universe_size: result?.universe_size,
    });

    return result;
  } catch (error) {
    console.warn("QUANT_LAB unavailable:", error?.message || error);
    return {
      status: "offline",
      no_trade: true,
      single_pick: null,
      all_scores: [],
    };
  }
}

function fallbackQuantFromPrice(candidate) {
  const pct = Number(candidate?.percentChange || 0);
  const signal = pct > 1.5 ? "BUY" : pct < -1.5 ? "SELL" : "NEUTRAL";
  const score = signal === "BUY" ? 62 : signal === "SELL" ? 38 : 50;
  return {
    signal,
    score,
    indicators: {
      rsi: { value: 50, signal: "neutral" },
      macd: { signal: signal === "BUY" ? "bullish" : signal === "SELL" ? "bearish" : "neutral" },
      bollinger: { position: "mid", bandwidth: 0.05, signal: "neutral" },
      vwap: { price_vs_vwap: signal === "BUY" ? "above" : signal === "SELL" ? "below" : "near", signal: signal === "BUY" ? "bullish" : signal === "SELL" ? "bearish" : "neutral" },
      ema_cross: { fast: 0, slow: 0, signal: signal === "BUY" ? "bullish" : signal === "SELL" ? "bearish" : "neutral" },
      volume: { ratio: 1, signal: "normal" },
    },
    support_levels: [],
    resistance_levels: [],
    entry_price: Number(candidate?.price || 0),
    stop_loss: Number(candidate?.price || 0) * 0.95,
    take_profit: [Number(candidate?.price || 0) * 1.1],
    risk_reward_ratio: 2,
    confidence: 55,
  };
}

function compositeScore({ quant, candidate, macro, headlineSentiment }) {
  let quantScore = 20;
  const sig = String(quant?.signal || "NEUTRAL").toUpperCase();
  if (sig === "STRONG_BUY") quantScore = 40;
  else if (sig === "BUY") quantScore = 30;
  else if (sig === "NEUTRAL") quantScore = 20;
  else if (sig === "SELL") quantScore = 5;
  else quantScore = 0;

  const rsi = Number(quant?.indicators?.rsi?.value);
  if (Number.isFinite(rsi)) {
    if (rsi >= 40 && rsi <= 60) quantScore += 5;
    if (rsi < 35) quantScore += 5;
    if (rsi > 70) quantScore -= 5;
  }
  if (String(quant?.indicators?.macd?.signal || "").toLowerCase().includes("bull")) quantScore += 5;
  if (String(quant?.indicators?.macd?.signal || "").toLowerCase().includes("bear")) quantScore -= 5;
  if (String(quant?.indicators?.vwap?.price_vs_vwap || "").toLowerCase().includes("above")) quantScore += 5;
  if (String(quant?.indicators?.ema_cross?.signal || "").toLowerCase().includes("bull")) quantScore += 5;
  if (Number(quant?.risk_reward_ratio) > 2) quantScore += 3;
  quantScore = Math.max(0, Math.min(50, quantScore));

  const pct = Number(candidate?.percentChange || 0);
  const momentumScore =
    pct >= 2 ? 20 : pct >= 1 ? 12 : pct >= -0.4 ? 8 : pct > -2 ? 0 : -8;

  const vix = Number(macro?.vix);
  let macroScore = 12;
  if (Number.isFinite(vix)) {
    macroScore = vix < 15 ? 20 : vix <= 20 ? 12 : vix <= 25 ? 4 : -8;
  }

  let sentimentScore = 0;
  if (headlineSentiment === "positive") sentimentScore = 20;
  else if (headlineSentiment === "neutral") sentimentScore = 10;
  else if (headlineSentiment === "negative") sentimentScore = -10;

  const total = Math.max(0, Math.min(100, quantScore + momentumScore + macroScore + sentimentScore));
  return { total, quantScore, momentumScore, macroScore, sentimentScore };
}

function fallbackDecisions(payload, context) {
  const holdings = Array.isArray(payload?.holdings) ? payload.holdings : [];
  const cash = toNum(payload?.cash) ?? 0;
  const decisions = [];

  holdings
    .slice(0, 2)
    .forEach((h) => {
      const pct = toNum(h?.percentChange);
      if (pct != null && pct < -2.5) {
        decisions.push({
          action: "SELL",
          ticker: h.symbol,
          assetType: normalizeAssetType(h?.assetType),
          cryptoId: String(h?.cryptoId || ""),
          shares: Math.max(0, Math.floor(Number(h.shares || 0) * 0.2)),
          reasoning: "Recent downside momentum with weak relative strength increases drawdown risk. Reducing exposure protects capital while preserving optionality.",
          confidence: 72,
          risk: normalizeAssetType(h?.assetType) === "crypto" ? "HIGH" : "MEDIUM",
          lesson: "This demonstrates risk trimming when trend and momentum deteriorate.",
        });
      }
    });

  if (cash > 1000) {
    const candidate = context?.movers?.find((m) => Number(m?.percentChange) > 1) || context?.todayPick || { symbol: "AAPL" };
    decisions.push({
      action: "BUY",
      ticker: String(candidate?.symbol || "AAPL").toUpperCase(),
      assetType: normalizeAssetType(candidate?.assetType),
      cryptoId: String(candidate?.cryptoId || ""),
      shares: normalizeAssetType(candidate?.assetType) === "crypto" ? 0.01 : 10,
      reasoning:
        normalizeAssetType(candidate?.assetType) === "crypto"
          ? "Crypto momentum is constructive but volatility remains elevated. Adding only a small, controlled position maintains upside exposure while preserving capital."
          : "A high-liquidity leader with positive momentum and broad market participation offers cleaner execution and manageable risk.",
      confidence: normalizeAssetType(candidate?.assetType) === "crypto" ? 65 : 68,
      risk: normalizeAssetType(candidate?.assetType) === "crypto" ? "HIGH" : "MEDIUM",
      lesson:
        normalizeAssetType(candidate?.assetType) === "crypto"
          ? "This demonstrates cautious crypto sizing under a strict risk budget."
          : "This demonstrates momentum confirmation before adding new exposure.",
    });
  }

  if (!decisions.length) {
    decisions.push({
      action: "HOLD",
      ticker: holdings[0]?.symbol || "SPY",
      shares: 0,
      reasoning: "Current setup does not offer favorable risk-reward versus available alternatives. Preserving cash and waiting for higher-conviction signals is optimal.",
      confidence: 64,
      risk: "LOW",
      lesson: "Holding is an active decision when edge is unclear.",
    });
  }

  return decisions.slice(0, 6);
}

function normalizeDecisions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((d) => {
      const action = String(d?.action || "HOLD").toUpperCase();
      const ticker = String(d?.ticker || "").toUpperCase().trim();
      const assetType = normalizeAssetType(d?.assetType);
      const cryptoId = assetType === "crypto" ? String(d?.cryptoId || CRYPTO_SYMBOL_TO_ID[ticker] || "") : "";
      const shares = Math.max(0, Number(d?.shares || 0));
      const confidence = Math.max(0, Math.min(100, Math.round(Number(d?.confidence || 0))));
      const riskRaw = String(d?.risk || "MEDIUM").toUpperCase();
      const riskDefault = assetType === "crypto" ? "HIGH" : "MEDIUM";
      const risk = ["LOW", "MEDIUM", "HIGH"].includes(riskRaw) ? riskRaw : riskDefault;
      return {
        action: ["BUY", "SELL", "HOLD"].includes(action) ? action : "HOLD",
        ticker,
        assetType,
        cryptoId,
        shares,
        reasoning: String(d?.reasoning || "").trim() || "No additional reasoning provided.",
        confidence,
        risk,
        lesson: String(d?.lesson || "This demonstrates disciplined decision-making.").trim(),
      };
    })
    .filter((d) => d.ticker || d.action === "HOLD")
    .slice(0, 8);
}

function ensureActionableDecisions(decisions, { cash, holdings, context, riskPolicy }) {
  const normalized = Array.isArray(decisions) ? [...decisions] : [];
  const holdingByKey = new Map(
    (Array.isArray(holdings) ? holdings : []).map((h) => [
      `${normalizeAssetType(h?.assetType)}:${String(h?.symbol || "").toUpperCase()}`,
      h,
    ])
  );

  const cashNum = Math.max(0, Number(cash || 0));
  const totalHoldingsValue = (Array.isArray(holdings) ? holdings : []).reduce((sum, h) => {
    const px = Number(h?.currentPrice);
    const shares = Number(h?.shares || 0);
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(shares) || shares <= 0) return sum;
    return sum + px * shares;
  }, 0);
  const portfolioValue = cashNum + totalHoldingsValue;
  const reserveCash = portfolioValue * Number(riskPolicy?.minCashReservePct || 0.1);
  const maxPositionPct = Number(riskPolicy?.maxPositionPct || 0.2);
  const maxCryptoPct = Number(riskPolicy?.maxCryptoPct || 0.2);

  // Force share quantities when model outputs BUY/SELL with 0 shares.
  for (let i = 0; i < normalized.length; i += 1) {
    const d = normalized[i];
    const action = String(d?.action || "HOLD").toUpperCase();
    if (!["BUY", "SELL"].includes(action)) continue;
    if (Number(d?.shares || 0) > 0) continue;

    const assetType = normalizeAssetType(d?.assetType);
    const symbol = String(d?.ticker || "").toUpperCase();
    const key = `${assetType}:${symbol}`;
    const h = holdingByKey.get(key);
    const px = Number(h?.currentPrice) || Number(h?.avgBuy) || Number(
      (assetType === "crypto" ? context?.cryptoMovers : context?.movers || []).find((m) => String(m?.symbol || "").toUpperCase() === symbol)?.price
    ) || 100;

    if (action === "SELL") {
      const owned = Math.max(0, Number(h?.shares || 0));
      normalized[i] = { ...d, shares: owned > 0 ? Math.max(0.000001, owned * 0.2) : 0 };
      continue;
    }

    const buyBudget = Math.max(0, Math.min(cashNum - reserveCash, portfolioValue * maxPositionPct));
    const composite = Number(d?.composite_score || d?.compositeScore || 70);
    const convictionMultiplier = Math.max(0.35, Math.min(1, composite / 100));
    const rr = Math.max(0.5, Number(d?.risk_reward_ratio || d?.riskReward || 2));
    const quantMultiplier = Math.min(rr / 3, 1);
    const finalBudget = buyBudget * convictionMultiplier * quantMultiplier;
    normalized[i] = {
      ...d,
      shares: px > 0
        ? assetType === "crypto"
          ? Math.max(0.0001, finalBudget / px)
          : Math.max(1, Math.floor(finalBudget / px))
        : 0,
    };
  }

  const hasPosition = (Array.isArray(holdings) ? holdings : []).some((h) => Number(h?.shares || 0) > 0);
  const hasActionableBuy = normalized.some((d) => String(d?.action || "").toUpperCase() === "BUY" && Number(d?.shares || 0) > 0);

  // If portfolio is empty and model only HOLDs, force a starter BUY.
  if (!hasPosition && !hasActionableBuy && cashNum > 100) {
    const best = (context?.topCandidates || []).find((c) => {
      if (normalizeAssetType(c?.assetType) === "crypto" && Number(maxCryptoPct) <= 0) return false;
      return Number(c?.total || c?.score || 0) >= 65;
    }) || context?.topCandidates?.[0];
    const stockCandidate = String(best?.symbol || context?.todayPick?.symbol || "AAPL").toUpperCase();
    const stockPrice = Number(best?.price) || Number((context?.movers || []).find((m) => String(m?.symbol || "").toUpperCase() === stockCandidate)?.price) || 100;
    const starterBudget = Math.max(0, Math.min(cashNum - reserveCash, portfolioValue * maxPositionPct));
    const starterShares = Math.max(1, Math.floor(starterBudget / stockPrice));
    normalized.unshift({
      action: "BUY",
      ticker: stockCandidate,
      assetType: normalizeAssetType(best?.assetType),
      cryptoId: String(best?.cryptoId || ""),
      shares: starterShares,
      entry_price: Number(best?.quant?.entry_price || stockPrice),
      stop_loss: Number(best?.quant?.stop_loss || stockPrice * (1 - (riskPolicy?.level === "CONSERVATIVE" ? 0.05 : riskPolicy?.level === "AGGRESSIVE" ? 0.12 : 0.08))),
      take_profit: Number(Array.isArray(best?.quant?.take_profit) ? best.quant.take_profit[0] : stockPrice * 1.12),
      composite_score: Number(best?.total || 70),
      quant_signal: String(best?.quant?.signal || "BUY"),
      quant_breakdown: {
        rsi: String(best?.quant?.indicators?.rsi?.value ?? "n/a"),
        macd: String(best?.quant?.indicators?.macd?.signal || "n/a"),
        vwap: String(best?.quant?.indicators?.vwap?.price_vs_vwap || "n/a"),
      },
      reasoning:
        "Portfolio is currently all cash. Initiating a starter position based on the top composite score while respecting risk limits and cash reserve policy.",
      confidence: 67,
      risk: normalizeAssetType(best?.assetType) === "crypto" ? "HIGH" : "MEDIUM",
      lesson: "This demonstrates phased capital deployment instead of remaining inactive in cash.",
    });
  }

  // Prevent no-op logs: remove HOLD entries with empty tickers.
  return normalized.filter((d) => String(d?.ticker || "").trim() || String(d?.action || "").toUpperCase() !== "HOLD");
}

function nextMarketOpenTs() {
  const now = new Date();
  for (let i = 0; i < 10; i += 1) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const ny = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(d);
    const weekday = ny.find((x) => x.type === "weekday")?.value || "Mon";
    if (weekday === "Sat" || weekday === "Sun") continue;
    const yyyy = ny.find((x) => x.type === "year")?.value;
    const mm = ny.find((x) => x.type === "month")?.value;
    const dd = ny.find((x) => x.type === "day")?.value;
    const openEt = new Date(`${yyyy}-${mm}-${dd}T14:30:00.000Z`); // 9:30 ET in UTC (approx, DST handled by date conversion context)
    if (openEt.getTime() > Date.now()) return openEt.getTime();
  }
  return Date.now() + 24 * 60 * 60 * 1000;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const cash = toNum(body?.cash) ?? 0;
    const riskPolicy = getRiskPolicy(body?.riskLevel, body?.customRisk);
    const holdingsInput = Array.isArray(body?.holdings) ? body.holdings : [];
    const holdingsSymbols = holdingsInput
      .filter((h) => normalizeAssetType(h?.assetType) === "stock")
      .map((h) => String(h?.symbol || "").toUpperCase())
      .filter(Boolean);
    const holdingsCryptoIds = holdingsInput
      .filter((h) => normalizeAssetType(h?.assetType) === "crypto")
      .map((h) => String(h?.cryptoId || CRYPTO_SYMBOL_TO_ID[String(h?.symbol || "").toUpperCase()] || "").trim().toLowerCase())
      .filter(Boolean);

    const candidateStocks = FULL_CANDIDATE_UNIVERSE;
    const candidateCryptos = riskPolicy.allowCrypto ? CANDIDATE_CRYPTOS : [];

    const [holdingsQuotes, holdingsCryptoQuotes, candidateStockQuotes, candidateCryptoQuotes, macro, movers, cryptoMovers, holdingsNews, sectors] = await Promise.all([
      fetchQuoteBatch(holdingsSymbols),
      fetchCryptoBatch(holdingsCryptoIds),
      fetchQuoteBatch(candidateStocks),
      fetchCryptoBatch(candidateCryptos),
      fetchMacro(),
      fetchMovers(),
      fetchCryptoMovers(),
      fetchHoldingsNews(holdingsSymbols),
      fetchSectorPerformance(),
    ]);

    const bySymbol = new Map([...holdingsQuotes, ...candidateStockQuotes].map((q) => [q.symbol, q]));
    const byCryptoId = new Map([...holdingsCryptoQuotes, ...candidateCryptoQuotes].map((q) => [q.id, q]));
    const holdings = holdingsInput.map((h) => {
      const symbol = String(h?.symbol || "").toUpperCase();
      const assetType = normalizeAssetType(h?.assetType);
      const cryptoId = String(h?.cryptoId || CRYPTO_SYMBOL_TO_ID[symbol] || "").trim().toLowerCase();
      const q = assetType === "crypto" ? byCryptoId.get(cryptoId) : bySymbol.get(symbol);
      return {
        symbol,
        assetType,
        cryptoId: assetType === "crypto" ? cryptoId : "",
        shares: Number(h?.shares || 0),
        avgBuy: toNum(h?.avgBuy),
        currentPrice: toNum(q?.price) ?? toNum(h?.currentPrice),
        percentChange: toNum(q?.percentChange) ?? toNum(h?.percentChange),
        stopLoss: toNum(h?.stopLoss ?? h?.stop_loss),
        takeProfit: toNum(h?.takeProfit ?? h?.take_profit),
        buyDate: h?.buyDate || h?.created_utc || null,
      };
    });

    const candidates = [
      ...candidateStocks.map((symbol) => ({ symbol, assetType: "stock", cryptoId: "" })),
      ...candidateCryptos.map((symbol) => ({ symbol, assetType: "crypto", cryptoId: CRYPTO_SYMBOL_TO_ID[symbol] || "" })),
    ];
    const newsBySymbol = await fetchCandidateNews(candidates);

    const UNIVERSE = [...FULL_CANDIDATE_UNIVERSE];

    const marketFeatures = await fetchMarketFeatures(UNIVERSE);

    let quantResult = null;
    if (marketFeatures) {
      quantResult = await fetchQuantSignal({
        tickers: marketFeatures.tickers,
        macro: marketFeatures.macro,
        asof: marketFeatures.asof,
      });
    }

    const quantAllScores = Array.isArray(quantResult?.all_scores) ? quantResult.all_scores : [];
    const quantScoresByTicker = new Map(
      quantAllScores.map((row) => [String(row?.ticker || "").toUpperCase(), row])
    );
    const quantSinglePick = quantResult?.single_pick && !quantResult?.no_trade ? quantResult.single_pick : null;
    const strategyRouter = quantResult?.strategy_router || null;

    const scoredCandidatesRaw = [];
    for (const c of candidates) {
      const symbol = String(c.symbol || "").toUpperCase();
      const assetType = normalizeAssetType(c.assetType);
      const cryptoId = String(c.cryptoId || "").toLowerCase();
      const quote = assetType === "crypto" ? byCryptoId.get(cryptoId) : bySymbol.get(symbol);
      const price = toNum(quote?.price);
      if (price == null) continue;

      const quantScore = quantScoresByTicker.get(symbol);
      const fallback = fallbackQuantFromPrice({ ...quote, symbol });
      const quant = {
        ...fallback,
        signal: String(quantScore?.signal || fallback.signal),
        score: Number(quantScore?.composite_score ?? fallback.score ?? 50),
        confidence: Number(
          quantSinglePick && String(quantSinglePick?.ticker || "").toUpperCase() === symbol
            ? quantSinglePick?.confidence
            : fallback.confidence
        ),
        momentum_score: Number(quantScore?.momentum_score ?? fallback?.momentum_score ?? 0),
        mean_reversion_score: Number(quantScore?.mean_reversion_score ?? fallback?.mean_reversion_score ?? 0),
      };

      let quantBoost = false;
      if (quantSinglePick && String(quantSinglePick?.ticker || "").toUpperCase() === symbol) {
        quantBoost = true;
        quant.entry_price = Number(quantSinglePick?.entry_price || price);
        quant.stop_loss = Number(quantSinglePick?.stop_loss || price * 0.92);
        quant.take_profit = [Number(quantSinglePick?.take_profit || price * 1.12)];
        quant.risk_reward_ratio = Number(quantSinglePick?.risk_reward_ratio || 2.5);
        quant.confidence = Number(quantSinglePick?.confidence || quant.confidence || 70);
      }

      const headline = String(newsBySymbol[symbol]?.headline || "");
      const sentiment = String(newsBySymbol[symbol]?.sentiment || "neutral");
      const score = compositeScore({
        quant,
        candidate: quote,
        macro,
        headlineSentiment: sentiment,
      });

      scoredCandidatesRaw.push({
        symbol,
        assetType,
        cryptoId,
        price,
        percentChange: toNum(quote?.percentChange),
        headline,
        sentiment,
        quant,
        quantSignal: String(quantScore?.signal || quant.signal || "NEUTRAL"),
        quantComposite: Number(quantScore?.composite_score ?? 0),
        quantMomentum: Number(quantScore?.momentum_score ?? 0),
        quantMeanReversion: Number(quantScore?.mean_reversion_score ?? 0),
        quantBoost,
        entryPrice: Number(quant.entry_price || price),
        stopLoss: Number(quant.stop_loss || price * 0.92),
        takeProfit: Number(Array.isArray(quant.take_profit) ? quant.take_profit[0] : price * 1.12),
        quantConfidence: Number(quant.confidence || 0),
        ...score,
      });
    }
    const scoredCandidates = scoredCandidatesRaw.sort((a, b) => Number(b.total || 0) - Number(a.total || 0));
    const topCandidates = scoredCandidates.slice(0, 5);

    const marketRegime = quantResult?.regime ||
      (Number(macro.vix) < 15 ? "risk_on" :
       Number(macro.vix) < 20 ? "neutral" : "risk_off");

    let todayPick = null;
    try {
      const origin = new URL(req.url).origin;
      const pickRes = await fetch(`${origin}/api/ai?mode=daily&market=stock`, { cache: "no-store" });
      const pickData = await pickRes.json().catch(() => ({}));
      if (pickRes.ok && pickData?.ticker) {
        todayPick = {
          symbol: String(pickData.ticker || "").toUpperCase(),
          assetType: "stock",
          cryptoId: "",
          recommendation: String(pickData.recommendation || "HOLD"),
          confidence: toNum(pickData.confidence),
        };
      }
    } catch {}

    const context = {
      riskPolicy,
      vix: macro.vix,
      vixRegime: macro.vixRegime,
      dxy: macro.dxy,
      tenYear: macro.tenYear,
      wti: macro.wti,
      gold: macro.gold,
      marketChange: macro.marketChange,
      marketTrend: macro.marketTrend,
      movers,
      cryptoMovers,
      holdingsNews: holdingsNews.slice(0, 12),
      sectors,
      sectorLeaders: [...sectors].sort((a, b) => Number(b.percentChange || 0) - Number(a.percentChange || 0)).slice(0, 2),
      sectorLaggards: [...sectors].sort((a, b) => Number(a.percentChange || 0) - Number(b.percentChange || 0)).slice(0, 2),
      todayPick,
      topCandidates,
    };

    let decisions = [];
    let provider = "fallback";

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;

    if (key && !String(key).includes("PASTE_")) {
      const prompt = [
        `You are ASTRA, an elite quantitative trader managing a $${(cash + holdings.reduce((s, h) => s + Number(h.currentPrice || 0) * Number(h.shares || 0), 0)).toFixed(2)} virtual portfolio.`,
        `Risk Profile: ${riskPolicy.level} (max position ${(riskPolicy.maxPositionPct * 100).toFixed(0)}%, max crypto ${(riskPolicy.maxCryptoPct * 100).toFixed(0)}%, min cash reserve ${(riskPolicy.minCashReservePct * 100).toFixed(0)}%)`,
        `Available Cash: $${cash.toFixed(2)}`,
        `Market Regime: ${marketRegime} (VIX ${macro.vix ?? "—"})`,
        "Current Holdings:",
        JSON.stringify(holdings, null, 2),
        "Today's market context:",
        JSON.stringify(context, null, 2),
        "Top scored candidates:",
        JSON.stringify(topCandidates, null, 2),
        "Decision rules you must follow:",
        "1) Use quant entry_price/stop_loss/take_profit when available.",
        "2) Never BUY if quant signal is SELL or STRONG_SELL.",
        "3) Respect risk profile limits exactly.",
        "4) Deploy capital when composite score > 65 and cash reserve allows.",
        "5) Exit or reduce when composite score < 35.",
        "6) Reasoning must cite specific indicator values (RSI/MACD/VWAP/EMA).",
        "Return a JSON array of decisions:",
        "[{ action: BUY|SELL|HOLD, ticker: string, assetType: stock|crypto, cryptoId?: string, shares: number, entry_price: number, stop_loss: number, take_profit: number, composite_score: number, quant_signal: string, quant_breakdown: { rsi: string, macd: string, vwap: string }, reasoning: string, confidence: number, risk: LOW|MEDIUM|HIGH, lesson: string }]",
        "Return raw JSON only. No markdown.",
      ].join("\n\n");

      const useOpenRouter = String(key).startsWith("sk-or-");
      const url = useOpenRouter
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";

      const headers = {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      };
      if (useOpenRouter) {
        headers["HTTP-Referer"] = "http://localhost:3000";
        headers["X-Title"] = "Arthastra Simulator AutoPilot";
      }

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.25,
            max_tokens: 1200,
          }),
        });
        const data = await resp.json().catch(() => ({}));
        const raw = cleanJson(String(data?.choices?.[0]?.message?.content || ""));
        const parsed = safeJsonParse(raw);
        const normalized = normalizeDecisions(parsed);
        if (resp.ok && normalized.length) {
          decisions = normalized;
          provider = useOpenRouter ? "openrouter" : "openai";
        }
      } catch {
        // fallback below
      }
    }

    // Strategy router signals get priority before fallback template logic.
    if (strategyRouter && !strategyRouter.no_trade && strategyRouter.top_signal) {
      const sig = strategyRouter.top_signal;
      const strategyName = String(sig?.strategy || sig?.strategy_name || "").toLowerCase();
      const price = Number(sig?.entry_price || 0);
      const alloc = Math.max(0.05, Number(sig?.position_size_pct || 0.1));
      const shares = price > 0 ? Math.floor((cash * alloc) / price) : 0;
      if (shares > 0 && price > 0) {
        decisions.unshift({
          action: String(sig?.action || "BUY").toUpperCase(),
          ticker: String(sig?.ticker || "").toUpperCase(),
          assetType: "stock",
          shares,
          entry_price: price,
          stop_loss: Number(sig?.stop_loss || 0),
          take_profit: Number(sig?.take_profit || 0),
          composite_score: Math.max(70, Math.round(Number(sig?.conviction || 0) * 100)),
          strategy: strategyName,
          reasoning: String(sig?.reasoning || "").trim() || "Strategy router identified a valid setup.",
          confidence: Math.round(Number(sig?.conviction || 0) * 100),
          risk: Number(sig?.conviction || 0) > 0.7 ? "LOW" : "MEDIUM",
          holdDays: Number(sig?.hold_days || 0),
          lesson: getLessonForStrategy(strategyName),
        });
      }
    }

    const allSignals = Array.isArray(strategyRouter?.all_signals) ? strategyRouter.all_signals : [];
    const seenStrategies = new Set(decisions.map((d) => String(d?.strategy || "").toLowerCase()).filter(Boolean));
    for (const sig of allSignals) {
      if (String(sig?.action || "").toUpperCase() !== "BUY") continue;
      const strategyName = String(sig?.strategy || sig?.strategy_name || "").toLowerCase();
      if (seenStrategies.has(strategyName)) continue;
      if (Number(sig?.conviction || 0) < 0.2) continue;
      const ticker = String(sig?.ticker || "").toUpperCase();
      if (!ticker || decisions.find((d) => String(d?.ticker || "").toUpperCase() === ticker)) continue;
      const price = Number(sig?.entry_price || 0);
      const shares = price > 0 ? Math.floor((cash * 0.08) / price) : 0;
      if (shares > 0) {
        decisions.push({
          action: "BUY",
          ticker,
          assetType: "stock",
          shares,
          entry_price: price,
          stop_loss: Number(sig?.stop_loss || 0),
          take_profit: Number(sig?.take_profit || 0),
          composite_score: Math.max(70, Math.round(Number(sig?.conviction || 0) * 100)),
          strategy: strategyName,
          reasoning: String(sig?.reasoning || "").trim() || "Strategy signal identified a buy setup.",
          confidence: Math.max(45, Math.round(Number(sig?.conviction || 0) * 100)),
          risk: "MEDIUM",
          holdDays: Number(sig?.hold_days || 0),
          lesson: getLessonForStrategy(strategyName),
        });
        seenStrategies.add(strategyName);
      }
      if (seenStrategies.size >= 3) break;
    }

    for (const sig of allSignals) {
      if (String(sig?.action || "").toUpperCase() !== "SELL") continue;
      const ticker = String(sig?.ticker || "").toUpperCase();
      const holding = holdings.find((h) => String(h?.symbol || "").toUpperCase() === ticker);
      if (!holding || Number(holding?.shares || 0) <= 0) continue;
      decisions.push({
        action: "SELL",
        ticker,
        assetType: String(holding?.assetType || "stock").toLowerCase(),
        shares: Number(holding.shares || 0),
        entry_price: Number(sig?.entry_price || holding?.currentPrice || 0),
        strategy: String(sig?.strategy || sig?.strategy_name || "").toLowerCase(),
        reasoning: String(sig?.reasoning || "").trim() || "Strategy signal indicates exit.",
        confidence: Math.round(Number(sig?.conviction || 0) * 100),
        risk: "LOW",
        holdDays: Number(sig?.hold_days || 0),
        lesson: "Strategy signal indicates exit",
      });
    }

    if (!decisions.length) {
      decisions = normalizeDecisions(fallbackDecisions({ cash, holdings }, { ...context, todayPick }));
    }

    decisions = ensureActionableDecisions(decisions, { cash, holdings, context: { ...context, todayPick }, riskPolicy })
      .map((d) => {
        const c = scoredCandidates.find((x) => x.symbol === String(d?.ticker || "").toUpperCase() && normalizeAssetType(x.assetType) === normalizeAssetType(d?.assetType));
        const composite = Number(d?.composite_score ?? c?.total ?? 50);
        let action = String(d?.action || "HOLD").toUpperCase();
        if (composite >= 80) action = action === "SELL" ? "HOLD" : "BUY";
        else if (composite >= 65) action = action === "SELL" ? "HOLD" : "BUY";
        else if (composite >= 50) action = "HOLD";
        else if (composite >= 35) action = action === "BUY" ? "HOLD" : "SELL";
        else action = "SELL";
        return {
          ...d,
          action,
          composite_score: composite,
          quant_signal: String(d?.quant_signal || c?.quant?.signal || "NEUTRAL"),
          quant_breakdown: d?.quant_breakdown || {
            rsi: String(c?.quant?.indicators?.rsi?.value ?? "n/a"),
            macd: String(c?.quant?.indicators?.macd?.signal || "n/a"),
            vwap: String(c?.quant?.indicators?.vwap?.price_vs_vwap || "n/a"),
          },
          entry_price: Number(d?.entry_price || c?.quant?.entry_price || c?.price || 0),
          stop_loss: Number(d?.stop_loss || c?.quant?.stop_loss || (Number(c?.price || 0) * (1 - (riskPolicy.level === "CONSERVATIVE" ? 0.05 : riskPolicy.level === "AGGRESSIVE" ? 0.12 : 0.08)))),
          take_profit: Number(d?.take_profit || (Array.isArray(c?.quant?.take_profit) ? c.quant.take_profit[0] : Number(c?.price || 0) * 1.12)),
          confidence: Math.max(0, Math.min(100, Number(d?.confidence || c?.quant?.confidence || 60))),
          quant_momentum: Number(d?.quant_momentum || c?.quantMomentum || c?.quant?.momentum_score || 0),
          quant_mean_reversion: Number(d?.quant_mean_reversion || c?.quantMeanReversion || c?.quant?.mean_reversion_score || 0),
        };
      })
      .slice(0, 8);

    const totalHoldingsValue = holdings.reduce((sum, h) => sum + Number(h?.currentPrice || 0) * Number(h?.shares || 0), 0);
    const totalValue = Math.max(1, cash + totalHoldingsValue);
    const availableCash = cash;

    // SELL priority order (before buys): stop loss, take profit, signal reversal, time stop.
    const prioritySells = buildPrioritySellDecisions({
      holdings,
      quantResult,
      riskLevel: riskPolicy.level,
    });
    const sellReasonsOrder = { stop_loss: 1, take_profit: 2, signal_reversal: 3, signal_weakening: 3, time_stop: 4 };
    prioritySells.sort((a, b) => (sellReasonsOrder[a.reason] || 99) - (sellReasonsOrder[b.reason] || 99));

    // Bug fix 3: asset allocation by risk level.
    const riskKey = String(riskPolicy.level || "MODERATE").toLowerCase();
    const rules = ALLOCATION_RULES[riskKey] || ALLOCATION_RULES.moderate;
    const currentCryptoValue = holdings
      .filter((h) => h.assetType === "crypto")
      .reduce((sum, h) => sum + Number(h.currentPrice || 0) * Number(h.shares || 0), 0);
    const cryptoPct = currentCryptoValue / totalValue;
    if (cryptoPct >= rules.maxCrypto) {
      decisions = decisions.filter((d) => normalizeAssetType(d?.assetType) !== "crypto");
    }

    // Bug fix 2: force QUANT pick to BUY when valid and cash available.
    const quantPick = quantResult?.single_pick;
    const noTrade = quantResult?.no_trade;
    const hasCash = availableCash > totalValue * 0.15;
    if (quantPick && !noTrade && hasCash) {
      const price = Number(quantPick?.entry_price || 0);
      const allocation = availableCash * 0.15;
      const shares = price > 0 ? Math.floor(allocation / price) : 0;
      if (shares > 0) {
        const forcedBuy = {
          action: "BUY",
          ticker: String(quantPick.ticker || "").toUpperCase(),
          shares,
          assetType: "stock",
          entry_price: price,
          stop_loss: Number(quantPick.stop_loss || 0),
          take_profit: Number(quantPick.take_profit || 0),
          composite_score: quantScoreToAstraScore(Number(quantPick.composite_score || 0)),
          strategy: String(strategyRouter?.strategy_used || "momentum").toLowerCase(),
          holdDays: Number(strategyRouter?.top_signal?.hold_days || 20),
          reasoning: `Quantitative signal detected strength in ${String(quantPick.ticker || "").toUpperCase()}. Market regime: ${String(quantResult?.regime || "unknown")}. Entry $${price} | Stop $${Number(quantPick.stop_loss || 0)} | Target $${Number(quantPick.take_profit || 0)}`,
          confidence: Number(quantPick.confidence || 72),
          risk: Number(quantPick.composite_score || 0) > 0.15 ? "LOW" : "MEDIUM",
          lesson: `Signal identified through cross-sectional momentum analysis across ${Number(quantResult?.universe_size || 0)} instruments in ${String(quantResult?.regime || "unknown")} market regime.`,
          quant_signal: "BUY",
        };

        const existing = decisions.findIndex((d) => String(d?.ticker || "").toUpperCase() === forcedBuy.ticker);
        if (existing >= 0) decisions[existing] = forcedBuy;
        else decisions.unshift(forcedBuy);
        console.log("Forced BUY:", forcedBuy.ticker, "shares:", shares, "composite:", Number(quantPick.composite_score || 0));
      }
    }

    // Process all sells before buys.
    const buyOrHold = decisions.filter((d) => String(d?.action || "").toUpperCase() !== "SELL");
    decisions = [...prioritySells, ...buyOrHold];

    const heldStockSymbols = holdings.filter((h) => h.assetType === "stock").map((h) => h.symbol);
    const heldCryptoSymbols = holdings.filter((h) => h.assetType === "crypto").map((h) => h.symbol);
    const watchlist = [
      ...movers
        .filter((m) => !heldStockSymbols.includes(String(m?.symbol || "").toUpperCase()))
        .slice(0, 2)
        .map((m) => ({ symbol: m.symbol, assetType: "stock", percentChange: m.percentChange, why: "Momentum and liquidity profile currently stand out." })),
      ...cryptoMovers
        .filter((m) => !heldCryptoSymbols.includes(String(m?.symbol || "").toUpperCase()))
        .slice(0, 2)
        .map((m) => ({ symbol: m.symbol, assetType: "crypto", percentChange: m.percentChange, why: "Crypto momentum is elevated, but volatility risk is high." })),
    ].slice(0, 3);

    const outlook =
      macro.marketTrend === "UP"
        ? "Risk appetite is constructive, but volatility management remains important. ASTRA is favoring quality momentum with cash reserve discipline."
        : macro.marketTrend === "DOWN"
          ? "Market tone is defensive. ASTRA is prioritizing capital preservation and trimming weaker risk exposures."
          : "Market direction is mixed. ASTRA is staying selective and preserving optionality with a higher cash buffer.";

    const buyCount = decisions.filter((d) => String(d?.action || "").toUpperCase() === "BUY").length;
    const sellCount = decisions.filter((d) => String(d?.action || "").toUpperCase() === "SELL").length;
    const holdCount = decisions.filter((d) => String(d?.action || "").toUpperCase() === "HOLD").length;
    const avgConfidence = decisions.length
      ? Math.round(decisions.reduce((sum, d) => sum + Number(d?.confidence || 0), 0) / decisions.length)
      : 0;
    const highRiskCount = decisions.filter((d) => String(d?.risk || "").toUpperCase() === "HIGH").length;

    const executionPlan = decisions.slice(0, 8).map((d, idx) => ({
      step: idx + 1,
      task: `${String(d?.action || "HOLD").toUpperCase()} ${String(d?.ticker || "").toUpperCase()}`,
      strategy: String(d?.strategy || "agent_core").toLowerCase(),
      confidence: Math.max(0, Math.min(100, Number(d?.confidence || 0))),
      status: String(d?.action || "HOLD").toUpperCase() === "HOLD" ? "monitor" : "queued",
      reason: sanitizePublicReasoning(d?.reasoning, d?.entry_price, d?.stop_loss, d?.take_profit),
    }));

    const agentState = {
      mode: "autopilot",
      cycleStatus: buyCount + sellCount > 0 ? "actionable" : "monitoring",
      provider,
      regime: marketRegime,
      confidence: avgConfidence,
      riskLevel: String(riskPolicy?.level || "MODERATE").toUpperCase(),
      scannedInstruments: Number(scoredCandidates.length || 0),
      candidateUniverse: Number(candidates.length || 0),
      buyCount,
      sellCount,
      holdCount,
      highRiskCount,
      cashReserveTargetPct: Number(riskPolicy?.minCashReservePct || 0),
      generatedAt: new Date().toISOString(),
    };

    const runSummary = buyCount + sellCount > 0
      ? `Generated ${buyCount} buy and ${sellCount} sell actions with ${avgConfidence}% average confidence in ${marketRegime} regime.`
      : `No trade actions triggered. Monitoring regime ${marketRegime} with ${avgConfidence}% confidence.`;

    let loggedTrades = 0;
    for (const decision of decisions) {
      const action = String(decision?.action || "").toUpperCase();
      const shares = Number(decision?.shares || 0);
      const ticker = String(decision?.ticker || "").toUpperCase();
      if (!ticker) continue;
      if (!["BUY", "SELL", "HOLD"].includes(action)) continue;
      if ((action === "BUY" || action === "SELL") && shares <= 0) continue;
      try {
        insertTrade({
          source: "astra_autopilot",
          ticker,
          action,
          shares,
          entry_price: Number(decision?.entry_price || 0),
          total_value: Number(decision?.entry_price || 0) * shares,
          quant_composite_score: Number(decision?.composite_score ?? 0),
          quant_signal: String(decision?.quant_signal || "NEUTRAL"),
          quant_momentum: Number(decision?.quant_momentum || 0),
          quant_mean_reversion: Number(decision?.quant_mean_reversion || 0),
          market_regime: marketRegime,
          vix_at_entry: Number(macro?.vix ?? 0),
          dxy_at_entry: Number(macro?.dxy ?? 0),
          sector_performance: sectors,
          weight_momentum: 0.55,
          weight_mean_reversion: 0.35,
          weight_volatility: 0.07,
          weight_range: 0.03,
          user_risk_level: String(riskPolicy?.level || "MODERATE"),
          strategy_name: String(decision?.strategy || "unknown"),
          strategy_conviction: Math.max(0, Math.min(1, Number(decision?.conviction || decision?.confidence || 0) / 100)),
          hold_days_target: Number(decision?.holdDays || 0),
          reasoning: String(decision?.reasoning || ""),
          confidence: Number(decision?.confidence || 0),
          stop_loss: Number(decision?.stop_loss || 0),
          take_profit: Number(decision?.take_profit || 0),
        });
        loggedTrades += 1;
      } catch (error) {
        console.warn("[simulator-autopilot] trade log insert failed", ticker, String(error?.message || error));
      }
    }

    const publicDecisions = decisions.map((d) => ({
      action: String(d?.action || "HOLD").toUpperCase(),
      ticker: String(d?.ticker || "").toUpperCase(),
      shares: Number(d?.shares || 0),
      price: Number(d?.entry_price || 0),
      reasoning: sanitizePublicReasoning(d?.reasoning, d?.entry_price, d?.stop_loss, d?.take_profit),
      confidence: Math.max(0, Math.min(100, Number(d?.confidence || 0))),
      risk: String(d?.risk || "MEDIUM").toUpperCase(),
      stopLoss: Number(d?.stop_loss || 0),
      takeProfit: Number(d?.take_profit || 0),
      lesson: String(d?.lesson || "Manage position size and risk before entry."),
      strategy: String(d?.strategy || "").toLowerCase() || null,
      holdDays: Number(d?.holdDays || 0),
    }));

    return NextResponse.json(
      {
        decisions: publicDecisions,
        context: { ...context, cryptoMovers },
        provider,
        riskPolicy,
        watchlist,
        outlook,
        runSummary,
        agentState,
        executionPlan,
        loggedTrades,
        nextDecisionAt: nextMarketOpenTs(),
      },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (error) {
    return NextResponse.json(
      { error: "Auto-pilot decision engine failed", details: String(error?.message || error) },
      { status: 500 }
    );
  }
}
