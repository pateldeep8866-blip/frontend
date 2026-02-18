export function getAlphaVantageKey() {
  return process.env.CRYPTO_API_KEY_2 || process.env.ALPHAVANTAGE_API_KEY || "";
}

const AV_CACHE_TTL_MS = 65 * 1000;
const avCache = new Map();

export const METALS_CATALOG = [
  { symbol: "XAU", name: "Gold (Spot USD)" },
  { symbol: "XAG", name: "Silver (Spot USD)" },
  { symbol: "XPT", name: "Platinum (Spot USD)" },
  { symbol: "XPD", name: "Palladium (Spot USD)" },
];
const YAHOO_METAL_MAP = {
  XAU: "GC=F",
  XAG: "SI=F",
  XPT: "PL=F",
  XPD: "PA=F",
};

export async function avGet(params) {
  const key = getAlphaVantageKey();
  if (!key) {
    return {
      ok: false,
      status: 500,
      data: { error: "Missing CRYPTO_API_KEY_2 (Alpha Vantage key)" },
    };
  }

  const cacheKey = JSON.stringify(params);
  const now = Date.now();
  const cached = avCache.get(cacheKey);
  if (cached && now - cached.ts < AV_CACHE_TTL_MS) {
    return cached.value;
  }

  const qs = new URLSearchParams({ ...params, apikey: key }).toString();
  const url = `https://www.alphavantage.co/query?${qs}`;
  const res = await fetch(url, { next: { revalidate: 30 } });
  const data = await res.json().catch(() => ({}));

  const note = String(data?.Note || "");
  const info = String(data?.Information || "");
  if (!res.ok) {
    const value = { ok: false, status: res.status, data };
    avCache.set(cacheKey, { ts: now, value });
    return value;
  }
  if (note || info) {
    const value = {
      ok: false,
      status: 429,
      data: { error: "Alpha Vantage rate limit", details: note || info },
    };
    // Keep stale cached success if available when rate-limited.
    if (cached?.value?.ok) return cached.value;
    return value;
  }
  if (data?.["Error Message"]) {
    const value = {
      ok: false,
      status: 400,
      data: { error: "Alpha Vantage error", details: data["Error Message"] },
    };
    avCache.set(cacheKey, { ts: now, value });
    return value;
  }
  const value = { ok: true, status: 200, data };
  avCache.set(cacheKey, { ts: now, value });
  return value;
}

export async function avGetMetal(functionName, symbol, extra = {}) {
  const s = String(symbol || "").trim().toUpperCase();
  const preferred = s === "XAU" ? "GOLD" : s === "XAG" ? "SILVER" : s;
  const first = await avGet({ function: functionName, symbol: preferred, ...extra });
  if (first.ok) return first;
  // Fallback to canonical code if provider expects XAU/XAG.
  if (preferred !== s) {
    const second = await avGet({ function: functionName, symbol: s, ...extra });
    return second;
  }
  return first;
}

function parseNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeMetalSymbol(input) {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw) return "";
  const aliases = {
    GOLD: "XAU",
    SILVER: "XAG",
    PLATINUM: "XPT",
    PALLADIUM: "XPD",
  };
  return aliases[raw] || raw;
}

async function yahooMetalChart(symbol, range = "1mo", interval = "1d") {
  const mapped = YAHOO_METAL_MAP[symbol];
  if (!mapped) return null;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(mapped)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data?.chart?.result?.[0] || null;
}

function summarizeYahooSnapshot(result) {
  const meta = result?.meta || {};
  const price = parseNum(meta?.regularMarketPrice ?? meta?.previousClose);
  const prevClose = parseNum(meta?.previousClose);
  if (!Number.isFinite(price)) return null;
  const change = Number.isFinite(prevClose) ? price - prevClose : NaN;
  const percentChange = Number.isFinite(prevClose) && prevClose > 0 ? (change / prevClose) * 100 : NaN;
  return {
    price,
    prevClose: Number.isFinite(prevClose) ? prevClose : null,
    change: Number.isFinite(change) ? change : null,
    percentChange: Number.isFinite(percentChange) ? percentChange : null,
  };
}

export async function yahooGetMetalSnapshot(symbolInput) {
  const symbol = normalizeMetalSymbol(symbolInput);
  if (!symbol) return { ok: false, status: 400, data: { error: "Missing metal symbol" } };
  const result = await yahooMetalChart(symbol, "5d", "1d");
  const summary = summarizeYahooSnapshot(result);
  if (!summary) return { ok: false, status: 404, data: { error: `No yahoo quote for ${symbol}` } };
  return { ok: true, status: 200, data: { symbol, ...summary } };
}

export async function yahooGetMetalCandles(symbolInput, days = 30) {
  const symbol = normalizeMetalSymbol(symbolInput);
  if (!symbol) return { ok: false, status: 400, data: { error: "Missing metal symbol" } };
  const range = days <= 7 ? "7d" : days <= 30 ? "1mo" : days <= 120 ? "6mo" : "1y";
  const result = await yahooMetalChart(symbol, range, "1d");
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const rows = timestamps
    .map((ts, i) => ({ ts: Number(ts), close: parseNum(closes?.[i]) }))
    .filter((x) => Number.isFinite(x.ts) && Number.isFinite(x.close))
    .slice(-Math.max(2, Math.round(days)));
  if (!rows.length) return { ok: false, status: 404, data: { error: `No yahoo candles for ${symbol}` } };
  return {
    ok: true,
    status: 200,
    data: {
      c: rows.map((r) => r.close),
      t: rows.map((r) => r.ts),
      v: rows.map(() => null),
    },
  };
}

export async function avGetMetalSnapshot(symbolInput) {
  const symbol = normalizeMetalSymbol(symbolInput);
  if (!symbol) {
    return { ok: false, status: 400, data: { error: "Missing metal symbol" } };
  }

  let price = NaN;
  let prevClose = NaN;

  const fxRealtime = await avGet({
    function: "CURRENCY_EXCHANGE_RATE",
    from_currency: symbol,
    to_currency: "USD",
  });
  if (fxRealtime.ok) {
    const rate = fxRealtime.data?.["Realtime Currency Exchange Rate"] || {};
    price = parseNum(rate?.["5. Exchange Rate"] ?? rate?.exchange_rate);
  }

  const fxDaily = await avGet({
    function: "FX_DAILY",
    from_symbol: symbol,
    to_symbol: "USD",
    outputsize: "compact",
  });
  if (fxDaily.ok) {
    const series = fxDaily.data?.["Time Series FX (Daily)"] || {};
    const dates = Object.keys(series).sort();
    const last = dates[dates.length - 1];
    const prev = dates[dates.length - 2];
    const lastClose = parseNum(series?.[last]?.["4. close"]);
    const prevVal = parseNum(series?.[prev]?.["4. close"]);
    if (!Number.isFinite(price)) price = lastClose;
    if (Number.isFinite(prevVal)) prevClose = prevVal;
  }

  if ((!Number.isFinite(price) || !Number.isFinite(prevClose)) && (symbol === "XAU" || symbol === "XAG")) {
    const spot = await avGetMetal("GOLD_SILVER_SPOT", symbol);
    if (spot.ok) {
      const row = spot.data || {};
      const spotPrice = parseNum(row?.price ?? row?.["Price"] ?? row?.["spot_price"] ?? row?.["Spot Price"]);
      const spotPrev = parseNum(row?.previous_close ?? row?.prev_close ?? row?.close ?? row?.["Previous Close"]);
      if (!Number.isFinite(price)) price = spotPrice;
      if (!Number.isFinite(prevClose)) prevClose = spotPrev;
    }
  }

  if (!Number.isFinite(price)) {
    const yahoo = await yahooGetMetalSnapshot(symbol);
    if (yahoo.ok) return yahoo;
    return {
      ok: false,
      status: 404,
      data: { error: `No quote available for ${symbol}` },
    };
  }

  const change = Number.isFinite(prevClose) ? price - prevClose : NaN;
  const percentChange = Number.isFinite(prevClose) && prevClose > 0 ? (change / prevClose) * 100 : NaN;
  return {
    ok: true,
    status: 200,
    data: {
      symbol,
      price,
      prevClose: Number.isFinite(prevClose) ? prevClose : null,
      change: Number.isFinite(change) ? change : null,
      percentChange: Number.isFinite(percentChange) ? percentChange : null,
    },
  };
}
