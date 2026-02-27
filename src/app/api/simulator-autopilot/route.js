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
const CORE_CANDIDATE_UNIVERSE = FULL_CANDIDATE_UNIVERSE.slice(0, 13);
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

function getTradingStyle(raw) {
  const style = String(raw || "swing").toLowerCase();
  return style === "day_trading" ? "day_trading" : "swing";
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
      targetInvestedPct: 0.65,
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
      targetInvestedPct: 0.9,
      target: "25%+",
    };
  }
  if (level === "CUSTOM") {
    const maxPositionPct = Math.max(0.01, Math.min(0.3, Number(custom?.maxPositionPct || 0.12)));
    const maxCryptoPct = Math.max(0, Math.min(0.3, Number(custom?.maxCryptoPct || 0.1)));
    const minCashReservePct = Math.max(0.02, Math.min(0.4, Number(custom?.minCashReservePct || 0.1)));
    const targetInvestedPct = Math.max(0.45, Math.min(0.95, 1 - minCashReservePct - 0.03));
    return {
      level,
      maxPositionPct,
      maxCryptoPct,
      minCashReservePct,
      allowCrypto: maxCryptoPct > 0,
      targetInvestedPct,
      target: String(custom?.target || "Custom"),
    };
  }
  return {
    level: "MODERATE",
    maxPositionPct: 0.15,
    maxCryptoPct: 0.08,
    minCashReservePct: 0.12,
    allowCrypto: true,
    targetInvestedPct: 0.78,
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

function buildPrioritySellDecisions({ holdings, quantResult, riskLevel, tradingStyle }) {
  const decisions = [];
  const quantScores = Array.isArray(quantResult?.all_scores) ? quantResult.all_scores : [];
  const scoreByTicker = new Map(quantScores.map((s) => [String(s?.ticker || "").toUpperCase(), s]));
  const riskKey = String(riskLevel || "").toLowerCase();
  const sellProfile = {
    conservative: { maxHoldDays: 5, takeProfitSellPct: 1.0, reversalExitBelow: 45, weakTrimBelow: 58, weakTrimPct: 0.7 },
    moderate: { maxHoldDays: 15, takeProfitSellPct: 0.5, reversalExitBelow: 35, weakTrimBelow: 45, weakTrimPct: 0.5 },
    aggressive: { maxHoldDays: 30, takeProfitSellPct: 0.35, reversalExitBelow: 28, weakTrimBelow: 38, weakTrimPct: 0.35 },
  }[riskKey] || { maxHoldDays: 15, takeProfitSellPct: 0.5, reversalExitBelow: 35, weakTrimBelow: 45, weakTrimPct: 0.5 };
  const maxHoldDays = tradingStyle === "day_trading" ? 1 : sellProfile.maxHoldDays;

  for (const holding of holdings) {
    const ticker = String(holding?.symbol || "").toUpperCase();
    const shares = Number(holding?.shares || 0);
    const currentPrice = Number(holding?.currentPrice || 0);
    const avgBuy = Number(holding?.avgBuy || 0);
    if (!ticker || shares <= 0 || currentPrice <= 0) continue;

    const gainPct = avgBuy > 0 ? ((currentPrice - avgBuy) / avgBuy) * 100 : 0;

    // SELL TYPE 1 — Stop Loss
    const stopLoss = Number(holding?.stopLoss || 0);
    const isMeaningfulLoss = avgBuy > 0 ? currentPrice < avgBuy * 0.999 : true;
    if (stopLoss > 0 && currentPrice <= stopLoss && isMeaningfulLoss) {
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
      const sellShares = Math.max(1, Math.floor(shares * sellProfile.takeProfitSellPct));
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
      if (astraScore < sellProfile.reversalExitBelow) {
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
      if (astraScore >= sellProfile.reversalExitBelow && astraScore < sellProfile.weakTrimBelow) {
        const sellShares = Math.max(1, Math.floor(shares * sellProfile.weakTrimPct));
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

async function checkQuantLabHealth() {
  const quantUrl = process.env.QUANT_ENGINE_URL || "http://localhost:3001";
  try {
    const res = await fetch(`${quantUrl}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    return true;
  } catch (error) {
    console.warn("QUANT_LAB health check failed:", error?.message || error);
    return false;
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
  const allowFallbackBuy = Boolean(context?.allowFallbackBuy);

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

  if (allowFallbackBuy && cash > 1000) {
    const candidate = context?.movers?.find((m) => Number(m?.percentChange) > 1.2) || null;
    if (candidate?.symbol) {
      decisions.push({
        action: "BUY",
        ticker: String(candidate?.symbol || "AAPL").toUpperCase(),
        assetType: normalizeAssetType(candidate?.assetType),
        cryptoId: String(candidate?.cryptoId || ""),
        shares: normalizeAssetType(candidate?.assetType) === "crypto" ? 0.005 : 8,
        reasoning:
          normalizeAssetType(candidate?.assetType) === "crypto"
            ? "Momentum is constructive, but risk remains elevated. Position size is intentionally small."
            : "A liquid leader with improving momentum and broad participation supports a measured starter position.",
        confidence: normalizeAssetType(candidate?.assetType) === "crypto" ? 62 : 66,
        risk: normalizeAssetType(candidate?.assetType) === "crypto" ? "HIGH" : "MEDIUM",
        lesson:
          normalizeAssetType(candidate?.assetType) === "crypto"
            ? "Use smaller size when volatility is elevated."
            : "Position size first, conviction second.",
      });
    }
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

function ensureActionableDecisions(decisions, { cash, holdings, context, riskPolicy, tradingStyle, allowStarterBuy = true }) {
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
  const targetInvestedPct = Math.max(0.45, Math.min(0.95, Number(riskPolicy?.targetInvestedPct || 0.75)));
  const currentInvestedValue = totalHoldingsValue;
  const desiredInvestedValue = portfolioValue * targetInvestedPct;
  const deployGapValue = Math.max(0, desiredInvestedValue - currentInvestedValue);
  const maxDeployableCash = Math.max(0, cashNum - reserveCash);
  let deployBudget = Math.max(
    0,
    Math.min(
      maxDeployableCash,
      deployGapValue > 0 ? deployGapValue : maxDeployableCash * (tradingStyle === "day_trading" ? 0.6 : 0.35)
    )
  );

  const stockHoldingsValue = (Array.isArray(holdings) ? holdings : []).reduce((sum, h) => {
    if (normalizeAssetType(h?.assetType) !== "stock") return sum;
    const px = Number(h?.currentPrice);
    const shares = Number(h?.shares || 0);
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(shares) || shares <= 0) return sum;
    return sum + px * shares;
  }, 0);
  const cryptoHoldingsValue = (Array.isArray(holdings) ? holdings : []).reduce((sum, h) => {
    if (normalizeAssetType(h?.assetType) !== "crypto") return sum;
    const px = Number(h?.currentPrice);
    const shares = Number(h?.shares || 0);
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(shares) || shares <= 0) return sum;
    return sum + px * shares;
  }, 0);
  const maxCryptoValue = portfolioValue * maxCryptoPct;
  let cryptoRoomValue = Math.max(0, maxCryptoValue - cryptoHoldingsValue);

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

    const isCrypto = assetType === "crypto";
    if (isCrypto && (!riskPolicy?.allowCrypto || maxCryptoPct <= 0 || cryptoRoomValue <= 0)) {
      normalized[i] = { ...d, action: "HOLD", shares: 0 };
      continue;
    }
    const buyBudget = Math.max(0, Math.min(deployBudget, portfolioValue * maxPositionPct));
    const composite = Number(d?.composite_score || d?.compositeScore || 70);
    const convictionMultiplier = Math.max(0.35, Math.min(1, composite / 100));
    const rr = Math.max(0.5, Number(d?.risk_reward_ratio || d?.riskReward || 2));
    const quantMultiplier = Math.min(rr / 3, 1);
    let finalBudget = buyBudget * convictionMultiplier * quantMultiplier;
    if (isCrypto) finalBudget = Math.min(finalBudget, cryptoRoomValue);
    if (finalBudget <= 0) {
      normalized[i] = { ...d, shares: 0 };
      continue;
    }
    const filledShares = px > 0
      ? isCrypto
        ? Math.max(0.0001, finalBudget / px)
        : Math.max(1, Math.floor(finalBudget / px))
      : 0;
    normalized[i] = {
      ...d,
      shares: filledShares,
    };
    const spent = px > 0 ? filledShares * px : 0;
    deployBudget = Math.max(0, deployBudget - spent);
    if (isCrypto) cryptoRoomValue = Math.max(0, cryptoRoomValue - spent);
  }

  const hasPosition = (Array.isArray(holdings) ? holdings : []).some((h) => Number(h?.shares || 0) > 0);
  const hasActionableBuy = normalized.some((d) => String(d?.action || "").toUpperCase() === "BUY" && Number(d?.shares || 0) > 0);

  const buyThreshold = tradingStyle === "day_trading" ? 58 : (context?.vixRegime === "risk_off" ? 72 : 64);
  const heldKeys = new Set(
    (Array.isArray(holdings) ? holdings : [])
      .filter((h) => Number(h?.shares || 0) > 0)
      .map((h) => `${normalizeAssetType(h?.assetType)}:${String(h?.symbol || "").toUpperCase()}`)
  );
  const existingDecisionKeys = new Set(
    normalized
      .filter((d) => String(d?.action || "").toUpperCase() === "BUY")
      .map((d) => `${normalizeAssetType(d?.assetType)}:${String(d?.ticker || "").toUpperCase()}`)
  );

  // Portfolio takeover: if idle cash is above target and no actionable BUYs, inject ranked buys.
  if (allowStarterBuy && cashNum > 100 && deployBudget > 0) {
    const candidatePool = (context?.topCandidates || []).filter((c) => {
      const assetType = normalizeAssetType(c?.assetType);
      const key = `${assetType}:${String(c?.symbol || "").toUpperCase()}`;
      if (!String(c?.symbol || "").trim()) return false;
      if (heldKeys.has(key) || existingDecisionKeys.has(key)) return false;
      if (assetType === "crypto" && (!riskPolicy?.allowCrypto || maxCryptoPct <= 0 || cryptoRoomValue <= 0)) return false;
      return Number(c?.total || c?.score || 0) >= buyThreshold;
    });

    const maxInject = tradingStyle === "day_trading" ? 3 : 2;
    let injected = 0;
    for (const best of candidatePool) {
      if (deployBudget <= 0 || injected >= maxInject) break;
      const assetType = normalizeAssetType(best?.assetType);
      const isCrypto = assetType === "crypto";
      const symbol = String(best?.symbol || context?.todayPick?.symbol || "AAPL").toUpperCase();
      const px =
        Number(best?.price) ||
        Number(best?.entryPrice) ||
        Number((isCrypto ? context?.cryptoMovers : context?.movers || []).find((m) => String(m?.symbol || "").toUpperCase() === symbol)?.price) ||
        0;
      if (px <= 0) continue;
      const composite = Number(best?.total || best?.score || 70);
      const convictionMultiplier = Math.max(0.4, Math.min(1, composite / 100));
      let slotBudget = Math.min(deployBudget, portfolioValue * maxPositionPct * convictionMultiplier);
      if (isCrypto) slotBudget = Math.min(slotBudget, cryptoRoomValue);
      if (slotBudget <= 0) continue;
      const shares = isCrypto ? Math.max(0.0001, slotBudget / px) : Math.max(1, Math.floor(slotBudget / px));
      const spent = shares * px;
      if (spent <= 0) continue;
      normalized.unshift({
        action: "BUY",
        ticker: symbol,
        assetType,
        cryptoId: String(best?.cryptoId || ""),
        shares,
        entry_price: Number(best?.quant?.entry_price || best?.entryPrice || px),
        stop_loss: Number(best?.quant?.stop_loss || best?.stopLoss || px * (1 - (riskPolicy?.level === "CONSERVATIVE" ? 0.05 : riskPolicy?.level === "AGGRESSIVE" ? 0.12 : 0.08))),
        take_profit: Number(Array.isArray(best?.quant?.take_profit) ? best.quant.take_profit[0] : best?.takeProfit || px * 1.12),
        composite_score: composite,
        quant_signal: String(best?.quant?.signal || best?.quantSignal || "BUY"),
        quant_breakdown: {
          rsi: String(best?.quant?.indicators?.rsi?.value ?? "n/a"),
          macd: String(best?.quant?.indicators?.macd?.signal || "n/a"),
          vwap: String(best?.quant?.indicators?.vwap?.price_vs_vwap || "n/a"),
        },
        reasoning:
          "Auto-Pilot takeover allocated idle cash into top-ranked opportunities while enforcing risk profile reserve and position limits.",
        confidence: Math.max(60, Math.min(92, Math.round(composite))),
        risk: isCrypto ? "HIGH" : "MEDIUM",
        lesson: "Capital is being deployed systematically from available cash, not randomly.",
      });
      deployBudget = Math.max(0, deployBudget - spent);
      if (isCrypto) cryptoRoomValue = Math.max(0, cryptoRoomValue - spent);
      injected += 1;
    }
  }

  // In day-trading mode, reduce passive HOLD states when a valid setup exists.
  if (tradingStyle === "day_trading") {
    const hasAction = normalized.some((d) => ["BUY", "SELL"].includes(String(d?.action || "").toUpperCase()) && Number(d?.shares || 0) > 0);
    if (!hasAction && cashNum > 100) {
      const best = (context?.topCandidates || []).find((c) => Number(c?.total || c?.score || 0) >= 58) || context?.topCandidates?.[0];
      if (best) {
        const ticker = String(best?.symbol || "AAPL").toUpperCase();
        const price = Number(best?.price || 0) || 100;
        const budget = Math.max(0, Math.min(deployBudget || (cashNum - reserveCash), portfolioValue * Math.max(0.06, maxPositionPct * 0.8)));
        const shares = Math.max(1, Math.floor(budget / price));
        normalized.unshift({
          action: "BUY",
          ticker,
          assetType: normalizeAssetType(best?.assetType),
          shares,
          entry_price: price,
          stop_loss: Number(best?.stopLoss || price * 0.99),
          take_profit: Number(best?.takeProfit || price * 1.02),
          composite_score: Math.max(58, Number(best?.total || best?.score || 58)),
          confidence: 60,
          risk: "MEDIUM",
          reasoning: "Day-trading mode requires active intraday positioning when qualified setups are available.",
          lesson: "Intraday mode prioritizes execution over passive hold states.",
        });
      }
    }
  }

  // Prevent no-op logs: remove HOLD entries with empty tickers.
  return normalized.filter((d) => String(d?.ticker || "").trim() || String(d?.action || "").toUpperCase() !== "HOLD");
}

function isNyseOpenNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const wd = parts.find((p) => p.type === "weekday")?.value || "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  const mins = hour * 60 + minute;
  return wd !== "Sat" && wd !== "Sun" && mins >= 570 && mins < 960;
}

function nextDecisionTs(tradingStyle = "swing") {
  if (tradingStyle === "day_trading") {
    if (isNyseOpenNow()) return Date.now() + 5 * 60 * 1000;
    return nextMarketOpenTs();
  }
  return nextMarketOpenTs();
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
    const startingValue = Math.max(1, toNum(body?.startingCash) ?? toNum(body?.startingValue) ?? 100000);
    const riskPolicy = getRiskPolicy(body?.riskLevel, body?.customRisk);
    const tradingStyle = getTradingStyle(body?.tradingStyle);
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
    const holdingsNowValue = holdings.reduce(
      (sum, h) => sum + Number(h?.currentPrice || 0) * Number(h?.shares || 0),
      0
    );
    const currentPortfolioValue = cash + holdingsNowValue;
    const drawdownPct = ((currentPortfolioValue - startingValue) / startingValue) * 100;
    const dailyDrawdownPct = toNum(body?.dailyDrawdownPct);
    const defaultDailyKillLimitPct =
      String(riskPolicy?.level || "MODERATE").toUpperCase() === "CONSERVATIVE"
        ? 2.5
        : String(riskPolicy?.level || "MODERATE").toUpperCase() === "AGGRESSIVE"
          ? 6.5
          : 4.0;
    const dailyKillLimitPct = Math.max(1, Math.min(20, Math.abs(toNum(body?.dailyKillLimitPct) ?? defaultDailyKillLimitPct)));
    const dailyKillSwitchTriggered = Number.isFinite(dailyDrawdownPct) && Number(dailyDrawdownPct) <= -dailyKillLimitPct;

    const candidates = [
      ...candidateStocks.map((symbol) => ({ symbol, assetType: "stock", cryptoId: "" })),
      ...candidateCryptos.map((symbol) => ({ symbol, assetType: "crypto", cryptoId: CRYPTO_SYMBOL_TO_ID[symbol] || "" })),
    ];
    const newsBySymbol = await fetchCandidateNews(candidates);

    const UNIVERSE = [...FULL_CANDIDATE_UNIVERSE];

    const quantHealthOk = await checkQuantLabHealth();
    const marketFeatures = quantHealthOk ? await fetchMarketFeatures(UNIVERSE) : null;

    let quantResult = null;
    if (marketFeatures && quantHealthOk) {
      quantResult = await fetchQuantSignal({
        tickers: marketFeatures.tickers,
        macro: marketFeatures.macro,
        asof: marketFeatures.asof,
      });
    }

    let provider = "fallback";
    const quantLabConnected = Boolean(quantResult && quantResult.status !== "offline" && !quantResult.error);
    provider = quantLabConnected ? "QUANT_LAB" : "fallback";

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
    const stockCoverage =
      candidateStocks.length > 0 ? candidateStockQuotes.length / candidateStocks.length : 0;
    const severeDrawdown = drawdownPct <= -15;
    const weakDataMode = !quantLabConnected && stockCoverage < 0.25;
    const capitalPreservationMode = severeDrawdown || weakDataMode;
    const allowNewBuysBase =
      !dailyKillSwitchTriggered &&
      !capitalPreservationMode &&
      (marketRegime !== "risk_off" || quantLabConnected) &&
      (Number(macro.marketChange ?? 0) > -1.5 || quantLabConnected);
    const allowFallbackBuy =
      allowNewBuysBase &&
      (macro.marketTrend === "UP" || Number(macro.marketChange ?? 0) > 0.2);
    const maxBuysPerCycle = drawdownPct <= -10 ? 1 : 2;

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
      allowFallbackBuy,
    };

    let decisions = [];

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;

    if (quantLabConnected && key && !String(key).includes("PASTE_")) {
      const prompt = [
        `You are ASTRA, an elite quantitative trader managing a $${(cash + holdings.reduce((s, h) => s + Number(h.currentPrice || 0) * Number(h.shares || 0), 0)).toFixed(2)} virtual portfolio.`,
        `Risk Profile: ${riskPolicy.level} (max position ${(riskPolicy.maxPositionPct * 100).toFixed(0)}%, max crypto ${(riskPolicy.maxCryptoPct * 100).toFixed(0)}%, min cash reserve ${(riskPolicy.minCashReservePct * 100).toFixed(0)}%)`,
        `Available Cash: $${cash.toFixed(2)}`,
        `Trading Style: ${tradingStyle === "day_trading" ? "DAY_TRADING" : "SWING"} (day trading should prefer active intraday decisions and avoid idle HOLD bias)`,
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
          // Keep provider branding tied to signal engine, not LLM vendor.
        }
      } catch {
        // fallback below
      }
    }

    // Strategy router signals get priority before fallback template logic.
    if (allowNewBuysBase && strategyRouter && !strategyRouter.no_trade && strategyRouter.top_signal) {
      const sig = strategyRouter.top_signal;
      if (Number(sig?.conviction || 0) >= 0.45) {
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
          composite_score: Math.round(Math.max(0, Math.min(1, Number(sig?.conviction || 0))) * 100),
          strategy: strategyName,
          reasoning: String(sig?.reasoning || "").trim() || "Strategy router identified a valid setup.",
          confidence: Math.round(Number(sig?.conviction || 0) * 100),
          risk: Number(sig?.conviction || 0) > 0.7 ? "LOW" : "MEDIUM",
          holdDays: Number(sig?.hold_days || 0),
          lesson: getLessonForStrategy(strategyName),
        });
      }
      }
    }

    const allSignals = Array.isArray(strategyRouter?.all_signals) ? strategyRouter.all_signals : [];
    const seenStrategies = new Set(decisions.map((d) => String(d?.strategy || "").toLowerCase()).filter(Boolean));
    for (const sig of allSignals) {
      if (String(sig?.action || "").toUpperCase() !== "BUY") continue;
      if (!allowNewBuysBase) continue;
      const strategyName = String(sig?.strategy || sig?.strategy_name || "").toLowerCase();
      if (seenStrategies.has(strategyName)) continue;
      if (Number(sig?.conviction || 0) < 0.55) continue;
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
          composite_score: Math.round(Math.max(0, Math.min(1, Number(sig?.conviction || 0))) * 100),
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

    decisions = ensureActionableDecisions(decisions, {
      cash,
      holdings,
      context: { ...context, todayPick },
      riskPolicy,
      tradingStyle,
      allowStarterBuy: allowNewBuysBase,
    })
      .map((d) => {
        const c = scoredCandidates.find((x) => x.symbol === String(d?.ticker || "").toUpperCase() && normalizeAssetType(x.assetType) === normalizeAssetType(d?.assetType));
        const chosenPrice = Number(d?.entry_price || c?.price || c?.entryPrice || 0);
        const stopPct =
          riskPolicy.level === "CONSERVATIVE" ? 0.05 : riskPolicy.level === "AGGRESSIVE" ? 0.12 : 0.08;
        const computedStop = chosenPrice > 0 ? chosenPrice * (1 - stopPct) : 0;
        const computedTarget = chosenPrice > 0 ? chosenPrice + (chosenPrice - computedStop) * 2 : 0;
        const candidateStop = Number(d?.stop_loss || c?.quant?.stop_loss || c?.stopLoss || 0);
        const candidateTarget = Number(
          d?.take_profit ||
            (Array.isArray(c?.quant?.take_profit) ? c.quant.take_profit[0] : c?.takeProfit || 0)
        );
        const stopRatio = chosenPrice > 0 ? candidateStop / chosenPrice : 0;
        const targetRatio = chosenPrice > 0 ? candidateTarget / chosenPrice : 0;
        const safeStop =
          Number.isFinite(candidateStop) && candidateStop > 0 && stopRatio > 0.4 && stopRatio < 1
            ? candidateStop
            : computedStop;
        const safeTarget =
          Number.isFinite(candidateTarget) && candidateTarget > 0 && targetRatio > 1 && targetRatio < 3
            ? candidateTarget
            : computedTarget;
        const composite = Number(d?.composite_score ?? c?.total ?? 50);
        let action = String(d?.action || "HOLD").toUpperCase();
        if (tradingStyle === "day_trading") {
          if (composite >= 58) action = action === "SELL" ? "HOLD" : "BUY";
          else if (composite >= 45) action = "HOLD";
          else action = "SELL";
        } else {
          if (composite >= 80) action = action === "SELL" ? "HOLD" : "BUY";
          else if (composite >= 65) action = action === "SELL" ? "HOLD" : "BUY";
          else if (composite >= 50) action = "HOLD";
          else if (composite >= 35) action = action === "BUY" ? "HOLD" : "SELL";
          else action = "SELL";
        }
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
          entry_price: chosenPrice,
          stop_loss: Number(safeStop || 0),
          take_profit: Number(safeTarget || 0),
          confidence: Math.max(0, Math.min(100, Number(d?.confidence || c?.quant?.confidence || 60))),
          quant_momentum: Number(d?.quant_momentum || c?.quantMomentum || c?.quant?.momentum_score || 0),
          quant_mean_reversion: Number(d?.quant_mean_reversion || c?.quantMeanReversion || c?.quant?.mean_reversion_score || 0),
        };
      })
      .slice(0, 8);

    if (tradingStyle === "day_trading" && allowNewBuysBase) {
      const hasActive = decisions.some((d) => ["BUY", "SELL"].includes(String(d?.action || "").toUpperCase()) && Number(d?.shares || 0) > 0);
      if (!hasActive && cash > 100) {
        const best = topCandidates.find((c) => Number(c?.total || 0) >= 55) || topCandidates[0];
        if (best && Number(best?.price || 0) > 0) {
          const px = Number(best.price);
          const alloc = Math.max(0, cash * 0.08);
          const shares = Math.max(1, Math.floor(alloc / px));
          decisions.unshift({
            action: "BUY",
            ticker: String(best.symbol || "AAPL").toUpperCase(),
            assetType: normalizeAssetType(best.assetType),
            shares,
            entry_price: px,
            stop_loss: Number(best.stopLoss || (px * 0.99)),
            take_profit: Number(best.takeProfit || (px * 1.02)),
            composite_score: 62,
            strategy: String(best?.strategy || best?.quantSignal || "momentum").toLowerCase(),
            reasoning: "Day-trading mode selected an intraday setup to avoid idle HOLD bias when cash is available.",
            confidence: 62,
            risk: "MEDIUM",
            holdDays: 1,
            lesson: "Intraday mode prioritizes active execution with tight risk controls.",
          });
        }
      }
    }

    const totalHoldingsValue = holdings.reduce((sum, h) => sum + Number(h?.currentPrice || 0) * Number(h?.shares || 0), 0);
    const totalValue = Math.max(1, cash + totalHoldingsValue);
    const availableCash = cash;
    const investedPct = Math.max(0, Math.min(1, totalHoldingsValue / totalValue));
    const idleCashPct = Math.max(0, Math.min(1, availableCash / totalValue));
    const targetDeploymentPct = Math.max(0.45, Math.min(0.95, Number(riskPolicy?.targetInvestedPct || 0.75)));

    // SELL priority order (before buys): stop loss, take profit, signal reversal, time stop.
    const prioritySells = buildPrioritySellDecisions({
      holdings,
      quantResult,
      riskLevel: riskPolicy.level,
      tradingStyle,
    });
    const sellReasonsOrder = { stop_loss: 1, take_profit: 2, signal_reversal: 3, signal_weakening: 3, time_stop: 4 };
    prioritySells.sort((a, b) => (sellReasonsOrder[a.reason] || 99) - (sellReasonsOrder[b.reason] || 99));

    if (dailyKillSwitchTriggered) {
      decisions = holdings
        .filter((h) => Number(h?.shares || 0) > 0)
        .map((h) => ({
          action: "SELL",
          ticker: String(h?.symbol || "").toUpperCase(),
          assetType: normalizeAssetType(h?.assetType),
          shares: Number(h?.shares || 0),
          entry_price: Number(h?.currentPrice || 0),
          reasoning: `Daily drawdown kill-switch triggered at ${Number(dailyDrawdownPct || 0).toFixed(2)}%. Exiting positions to protect capital.`,
          confidence: 96,
          risk: "LOW",
          lesson: "A hard daily loss limit prevents emotional overtrading and protects long-term survival.",
          reason: "daily_kill_switch",
        }));
    }

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
    const hasCash = availableCash > totalValue * (tradingStyle === "day_trading" ? 0.08 : 0.15);
    console.log('QUANT result:', quantResult);
    console.log('entry price:', quantResult?.single_pick?.entry_price);
    console.log('available cash:', availableCash);
    console.log('forced buy check:', quantPick, noTrade, hasCash);

    if (quantPick && !noTrade && hasCash && allowNewBuysBase) {
      const pickTicker = String(quantPick?.ticker || "").toUpperCase();
      const alreadyHeld = holdings.some((h) => String(h?.symbol || "").toUpperCase() === pickTicker && Number(h?.shares || 0) > 0);
      if (alreadyHeld) {
        console.log("Forced BUY skipped (already held):", pickTicker);
      } else {
      const fallbackCandidate = scoredCandidates.find((c) => String(c?.symbol || "").toUpperCase() === pickTicker);
      const fallbackPx = Number(fallbackCandidate?.entryPrice || fallbackCandidate?.price || 0);
      const price = Number(quantPick?.entry_price || fallbackPx || 0);
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
    }

    if (!allowNewBuysBase) {
      decisions = decisions.map((d) =>
        String(d?.action || "").toUpperCase() === "BUY"
          ? {
              ...d,
              action: "HOLD",
              shares: 0,
              reasoning:
                "Capital-preservation mode is active due to drawdown or weak data quality. ASTRA is pausing new buys until conditions improve.",
              confidence: Math.max(60, Number(d?.confidence || 0)),
              risk: "LOW",
            }
          : d
      );
    }

    const heldKeys = new Set(
      holdings
        .filter((h) => Number(h?.shares || 0) > 0)
        .map((h) => `${normalizeAssetType(h?.assetType)}:${String(h?.symbol || "").toUpperCase()}`)
    );
    let buySlots = 0;
    decisions = decisions.filter((d) => {
      if (String(d?.action || "").toUpperCase() !== "BUY") return true;
      const key = `${normalizeAssetType(d?.assetType)}:${String(d?.ticker || "").toUpperCase()}`;
      if (heldKeys.has(key)) return false;
      const composite = Number(d?.composite_score || 0);
      const compositeFloor = marketRegime === "risk_off" ? 75 : 65;
      if (composite < compositeFloor) return false;
      buySlots += 1;
      return buySlots <= maxBuysPerCycle;
    });

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
      capitalPreservationMode
        ? "Capital-preservation mode is active. ASTRA is reducing risk, prioritizing cash, and waiting for stronger signal quality."
        : macro.marketTrend === "UP"
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
      takeoverMode: true,
      tradingStyle,
      cycleStatus: dailyKillSwitchTriggered ? "killed" : (buyCount + sellCount > 0 ? "actionable" : "monitoring"),
      provider,
      regime: marketRegime,
      confidence: avgConfidence,
      riskLevel: String(riskPolicy?.level || "MODERATE").toUpperCase(),
      scannedInstruments: Number(
        quantLabConnected
          ? (quantResult?.total_requested || marketFeatures?.total_tickers || FULL_CANDIDATE_UNIVERSE.length)
          : Math.max(CORE_CANDIDATE_UNIVERSE.length, marketFeatures?.valid_count || scoredCandidates.length || 0)
      ),
      candidateUniverse: Number(candidates.length || 0),
      quantLabConnected,
      buyCount,
      sellCount,
      holdCount,
      highRiskCount,
      drawdownPct: Number(drawdownPct.toFixed(2)),
      capitalPreservationMode,
      dailyKillSwitchTriggered,
      dailyDrawdownPct: Number.isFinite(dailyDrawdownPct) ? Number(Number(dailyDrawdownPct).toFixed(2)) : null,
      dailyKillLimitPct: Number(dailyKillLimitPct.toFixed(2)),
      cashReserveTargetPct: Number(riskPolicy?.minCashReservePct || 0),
      targetDeploymentPct,
      currentDeploymentPct: Number((investedPct * 100).toFixed(2)),
      idleCashPct: Number((idleCashPct * 100).toFixed(2)),
      generatedAt: new Date().toISOString(),
    };

    const runSummary = buyCount + sellCount > 0
      ? `Generated ${buyCount} buy and ${sellCount} sell actions with ${avgConfidence}% confidence. Deployment ${(investedPct * 100).toFixed(1)}% vs target ${(targetDeploymentPct * 100).toFixed(1)}% in ${marketRegime} regime.`
      : `No trade actions triggered. Monitoring regime ${marketRegime} with ${avgConfidence}% confidence. Deployment ${(investedPct * 100).toFixed(1)}% vs target ${(targetDeploymentPct * 100).toFixed(1)}%.`;
    const runSummaryWithKill = dailyKillSwitchTriggered
      ? `Daily drawdown kill-switch triggered at ${Number(dailyDrawdownPct || 0).toFixed(2)}% (limit -${dailyKillLimitPct.toFixed(2)}%). Exiting risk and pausing new buys.`
      : runSummary;

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
        runSummary: runSummaryWithKill,
        agentState,
        executionPlan,
        loggedTrades,
        nextDecisionAt: nextDecisionTs(tradingStyle),
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
