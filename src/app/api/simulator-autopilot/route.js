import { NextResponse } from "next/server";

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

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeAssetType(value) {
  return String(value || "").toLowerCase() === "crypto" ? "crypto" : "stock";
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
  const rows = await fetchQuoteBatch(["^VIX", "DX-Y.NYB", "^TNX", "SPY"]);
  const by = new Map(rows.map((r) => [r.symbol, r]));
  return {
    vix: by.get("^VIX")?.price ?? null,
    dxy: by.get("DX-Y.NYB")?.price ?? null,
    tenYear: by.get("^TNX")?.price != null ? by.get("^TNX").price / 10 : null,
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
    const holdingsInput = Array.isArray(body?.holdings) ? body.holdings : [];
    const holdingsSymbols = holdingsInput
      .filter((h) => normalizeAssetType(h?.assetType) === "stock")
      .map((h) => String(h?.symbol || "").toUpperCase())
      .filter(Boolean);
    const holdingsCryptoIds = holdingsInput
      .filter((h) => normalizeAssetType(h?.assetType) === "crypto")
      .map((h) => String(h?.cryptoId || CRYPTO_SYMBOL_TO_ID[String(h?.symbol || "").toUpperCase()] || "").trim().toLowerCase())
      .filter(Boolean);

    const [holdingsQuotes, holdingsCryptoQuotes, macro, movers, cryptoMovers, holdingsNews, sectors] = await Promise.all([
      fetchQuoteBatch(holdingsSymbols),
      fetchCryptoBatch(holdingsCryptoIds),
      fetchMacro(),
      fetchMovers(),
      fetchCryptoMovers(),
      fetchHoldingsNews(holdingsSymbols),
      fetchSectorPerformance(),
    ]);

    const bySymbol = new Map(holdingsQuotes.map((q) => [q.symbol, q]));
    const byCryptoId = new Map(holdingsCryptoQuotes.map((q) => [q.id, q]));
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
      };
    });

    let todayPick = null;
    try {
      const origin = new URL(req.url).origin;
      const pickRes = await fetch(`${origin}/api/ai?mode=daily&market=stock`, { cache: "no-store" });
      const pickData = await pickRes.json().catch(() => ({}));
      if (pickRes.ok && pickData?.ticker) {
        todayPick = {
          symbol: String(pickData.ticker || "").toUpperCase(),
          recommendation: String(pickData.recommendation || "HOLD"),
          confidence: toNum(pickData.confidence),
        };
      }
    } catch {}

    const context = {
      vix: macro.vix,
      dxy: macro.dxy,
      tenYear: macro.tenYear,
      marketTrend: macro.marketTrend,
      movers,
      cryptoMovers,
      holdingsNews: holdingsNews.slice(0, 12),
      sectors,
      todayPick,
    };

    let decisions = [];
    let provider = "fallback";

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;

    if (key && !String(key).includes("PASTE_")) {
      const prompt = [
        `You are ASTRA, an AI portfolio manager with $${cash.toFixed(2)} cash and these holdings:`,
        JSON.stringify(holdings, null, 2),
        "Today's market context:",
        JSON.stringify(context, null, 2),
        "Based on this data, decide what trades to make today.",
        "You can BUY, SELL, or HOLD any position.",
        "Never invest more than 20% in a single stock.",
        "Total crypto allocation must stay at or below 20% of portfolio value.",
        "Treat crypto positions as HIGH risk by default, size smaller, and explain volatility context.",
        "Always keep at least 10% in cash as reserve.",
        "Prioritize capital preservation over aggressive gains.",
        "Return a JSON array of decisions:",
        "[{ action: BUY/SELL/HOLD, ticker: string, assetType: stock|crypto, cryptoId?: string, shares: number, reasoning: string, confidence: number 0-100, risk: LOW/MEDIUM/HIGH, lesson: string }]",
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

    if (!decisions.length) {
      decisions = normalizeDecisions(fallbackDecisions({ cash, holdings }, { ...context, todayPick }));
    }

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

    return NextResponse.json(
      {
        decisions,
        context: { ...context, cryptoMovers },
        provider,
        watchlist,
        outlook,
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
