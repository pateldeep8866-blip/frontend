import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QUANT_CACHE_ROOT = "/Users/juanramirez/NOVA/NOVA_LAB/QUANT_LAB/data/cache";
const localCache = new Map();

const TIER_1_CORE = [
  "SPY", "QQQ", "IWM", "DIA",
  "XLK", "XLF", "XLE", "XLV",
  "XLI", "XLY", "XLP", "GLD", "TLT",
];

const TIER_2_GROWTH = [
  "AAPL", "MSFT", "NVDA", "AMZN",
  "GOOGL", "META", "TSLA", "AMD",
  "AVGO", "ORCL", "CRM", "ADBE",
  "JPM", "BAC", "GS", "MS",
  "JNJ", "UNH", "LLY", "ABBV",
  "XOM", "CVX", "WMT", "COST",
];

const TIER_3_THEMATIC = [
  "SOXX", "ARKK", "IBB", "EEM", "EFA",
  "VNQ", "HYG", "USO", "SLV", "GDXJ",
];

const FULL_UNIVERSE = [...TIER_1_CORE, ...TIER_2_GROWTH, ...TIER_3_THEMATIC];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTickers(input) {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((x) => String(x || "").trim().toUpperCase())
        .filter((x) => /^[A-Z0-9.^=-]{1,15}$/.test(x))
    )
  ).slice(0, 300);
}

function detectProvider() {
  const raw = String(process.env.QUANTLAB_DATA_PROVIDER || "").trim().toLowerCase();
  return raw || "finnhub";
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function computeFeatureSetFromRows(rows) {
  if (!Array.isArray(rows) || rows.length < 65) {
    return { ok: false, error: "min 65 rows required" };
  }

  const close = rows.map((r) => Number(r.close));
  const high = rows.map((r) => Number(r.high));
  const low = rows.map((r) => Number(r.low));
  const volume = rows.map((r) => Number(r.volume));

  if (close.some((n) => !Number.isFinite(n)) || volume.some((n) => !Number.isFinite(n))) {
    return { ok: false, error: "non-finite ohlcv" };
  }

  const ret5 = Number((close[close.length - 1] - close[close.length - 6]) / close[close.length - 6]);
  const ret20 = Number((close[close.length - 1] - close[close.length - 21]) / close[close.length - 21]);
  const ret60 = Number((close[close.length - 1] - close[close.length - 61]) / close[close.length - 61]);

  const logReturns = [];
  for (let i = 1; i < close.length; i += 1) {
    const prev = close[i - 1];
    const cur = close[i];
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0 || cur <= 0) {
      logReturns.push(NaN);
    } else {
      logReturns.push(Math.log(cur) - Math.log(prev));
    }
  }

  function rollingStdLast(arr, window) {
    const slice = arr.slice(-window);
    if (slice.length < window || slice.some((x) => !Number.isFinite(x))) return null;
    const mean = slice.reduce((s, x) => s + x, 0) / slice.length;
    const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / slice.length;
    return Math.sqrt(variance);
  }

  function rollingMeanLast(arr, window) {
    const slice = arr.slice(-window);
    if (slice.length < window || slice.some((x) => !Number.isFinite(x))) return null;
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  }

  const vol5 = rollingStdLast(logReturns, 5);
  const vol20 = rollingStdLast(logReturns, 20);
  const avgVol20 = rollingMeanLast(volume, 20);

  const high20 = Math.max(...high.slice(-20));
  const low20 = Math.min(...low.slice(-20));
  const priceRange = Number((high20 - low20) / close[close.length - 1]);

  if (
    !Number.isFinite(ret5) ||
    !Number.isFinite(ret20) ||
    !Number.isFinite(ret60) ||
    !Number.isFinite(vol5) ||
    !Number.isFinite(vol20) ||
    !Number.isFinite(avgVol20)
  ) {
    return { ok: false, error: "feature computation incomplete" };
  }

  return {
    ok: true,
    features: {
      ret_5d: ret5,
      ret_20d: ret20,
      ret_60d: ret60,
      vol_5d: vol5,
      vol_20d: vol20,
      avg_volume_20d: avgVol20,
      price_range: priceRange,
    },
  };
}

function toQuantCacheCsv(rows) {
  const header = "Date,Open,High,Low,Close,Volume";
  const lines = rows.map((r) => {
    const d = new Date(Number(r.t) * 1000).toISOString().slice(0, 10);
    return `${d},${Number(r.open).toFixed(10)},${Number(r.high).toFixed(10)},${Number(r.low).toFixed(10)},${Number(r.close).toFixed(10)},${Math.round(Number(r.volume))}`;
  });
  return `${header}\n${lines.join("\n")}\n`;
}

async function writeQuantCacheFile({ ticker, rows, provider, requestedStart, requestedEnd }) {
  const file = `${ticker}__1d__${requestedStart}__${requestedEnd}.csv`;
  const providerDir = join(QUANT_CACHE_ROOT, provider);
  await mkdir(providerDir, { recursive: true });

  const csvPath = join(providerDir, file);
  const metaPath = `${csvPath}.meta.json`;

  await writeFile(csvPath, toQuantCacheCsv(rows), "utf-8");

  const meta = {
    provider_name: provider,
    provider_version: "frontend-cache-injected",
    retrieval_timestamp: new Date().toISOString(),
    request_params: { symbol: ticker, start: requestedStart, end: requestedEnd, interval: "1d" },
    row_count: rows.length,
    first_timestamp: new Date(Number(rows[0].t) * 1000).toISOString(),
    last_timestamp: new Date(Number(rows[rows.length - 1].t) * 1000).toISOString(),
    cache_hit: true,
    source: "arthastra_market_features",
  };
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  return csvPath;
}

async function fetchTickerOHLCV(origin, ticker, provider, range, includeOhlcv) {
  const out = {
    ticker,
    price: null,
    volume: null,
    ret_5d: null,
    ret_20d: null,
    ret_60d: null,
    vol_5d: null,
    vol_20d: null,
    avg_volume_20d: null,
    price_range: null,
    week52High: null,
    week52Low: null,
    ohlcv_rows: 0,
    valid: false,
    error: null,
    quant_cache_file: null,
  };

  const quote = await fetchJson(`${origin}/api/quote?symbol=${encodeURIComponent(ticker)}`);
  const loadCandles = () =>
    fetchJson(`${origin}/api/candles?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${range.fromSec}&to=${range.toSec}`);

  let candles = await loadCandles();
  let t = Array.isArray(candles.data?.t) ? candles.data.t : [];
  let o = Array.isArray(candles.data?.o) ? candles.data.o : [];
  let h = Array.isArray(candles.data?.h) ? candles.data.h : [];
  let l = Array.isArray(candles.data?.l) ? candles.data.l : [];
  let c = Array.isArray(candles.data?.c) ? candles.data.c : [];
  let v = Array.isArray(candles.data?.v) ? candles.data.v : [];

  let n = Math.min(t.length, o.length, h.length, l.length, c.length, v.length);
  if ((!candles.response.ok || n === 0) && !String(candles.data?.error || "").toLowerCase().includes("missing")) {
    await new Promise((r) => setTimeout(r, 350));
    candles = await loadCandles();
    t = Array.isArray(candles.data?.t) ? candles.data.t : [];
    o = Array.isArray(candles.data?.o) ? candles.data.o : [];
    h = Array.isArray(candles.data?.h) ? candles.data.h : [];
    l = Array.isArray(candles.data?.l) ? candles.data.l : [];
    c = Array.isArray(candles.data?.c) ? candles.data.c : [];
    v = Array.isArray(candles.data?.v) ? candles.data.v : [];
    n = Math.min(t.length, o.length, h.length, l.length, c.length, v.length);
  }

  if (!candles.response.ok || n === 0) {
    out.error = "insufficient history";
    return out;
  }

  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const row = {
      t: toNum(t[i]),
      open: toNum(o[i]),
      high: toNum(h[i]),
      low: toNum(l[i]),
      close: toNum(c[i]),
      volume: toNum(v[i]),
    };
    if ([row.t, row.open, row.high, row.low, row.close, row.volume].some((x) => x == null)) continue;
    rows.push(row);
  }

  out.ohlcv_rows = rows.length;
  if (rows.length < 65) {
    out.error = "min 65 rows required";
    return out;
  }

  const featureResult = computeFeatureSetFromRows(rows);
  if (!featureResult.ok) {
    out.error = featureResult.error;
    return out;
  }

  try {
    out.quant_cache_file = await writeQuantCacheFile({
      ticker,
      rows,
      provider,
      requestedStart: range.startIso,
      requestedEnd: range.endIso,
    });
  } catch (e) {
    out.error = `cache write failed: ${String(e?.message || e)}`;
  }

  out.price = toNum(quote.data?.price) ?? toNum(rows[rows.length - 1]?.close);
  out.volume = toNum(quote.data?.volume) ?? toNum(rows[rows.length - 1]?.volume);
  out.week52High = toNum(quote.data?.week52High);
  out.week52Low = toNum(quote.data?.week52Low);
  out.ret_5d = featureResult.features.ret_5d;
  out.ret_20d = featureResult.features.ret_20d;
  out.ret_60d = featureResult.features.ret_60d;
  out.vol_5d = featureResult.features.vol_5d;
  out.vol_20d = featureResult.features.vol_20d;
  out.avg_volume_20d = featureResult.features.avg_volume_20d;
  out.price_range = featureResult.features.price_range;
  out.valid = true;
  out.error = null;

  if (includeOhlcv) {
    out.ohlcv = rows.map((r) => ({
      t: r.t,
      date: new Date(Number(r.t) * 1000).toISOString().slice(0, 10),
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    }));
  }

  return out;
}

async function fetchInBatches(origin, tickers, provider, range, includeOhlcv = false, batchSize = 6, delayMs = 900) {
  const results = {};

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((ticker) =>
        fetchTickerOHLCV(origin, ticker, provider, range, includeOhlcv).catch((err) => ({
          ticker,
          valid: false,
          error: String(err?.message || err),
          ohlcv_rows: 0,
        }))
      )
    );

    batchResults.forEach((r) => {
      results[r.ticker] = r;
    });

    if (i + batchSize < tickers.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}

async function fetchMacro(origin) {
  const symbols = {
    vix: "^VIX",
    dxy: "DX-Y.NYB",
    tenYear: "^TNX",
    wti: "CL=F",
    gold: "GC=F",
  };

  const entries = await Promise.all(
    Object.entries(symbols).map(async ([key, symbol]) => {
      try {
        const { response, data } = await fetchJson(`${origin}/api/quote?symbol=${encodeURIComponent(symbol)}`);
        if (!response.ok) return [key, null];
        return [key, toNum(data?.price)];
      } catch {
        return [key, null];
      }
    })
  );

  return Object.fromEntries(entries);
}

function pickTier(tickers) {
  const set = new Set(tickers);
  const hasTier2 = TIER_2_GROWTH.some((t) => set.has(t));
  const hasTier3 = TIER_3_THEMATIC.some((t) => set.has(t));
  if (hasTier2 || hasTier3) return "full";
  return "core";
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const includeOhlcv = Boolean(body?.include_ohlcv);
    const requestTickers = normalizeTickers(body?.tickers);

    let activeTier = requestTickers.length ? pickTier(requestTickers) : "full";
    let tickers = requestTickers.length ? requestTickers : FULL_UNIVERSE;

    const provider = detectProvider();
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;

    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setUTCFullYear(startDate.getUTCFullYear() - 3);
    const startIso = startDate.toISOString().slice(0, 10);
    const endIso = endDate.toISOString().slice(0, 10);
    const fromSec = Math.floor(new Date(`${startIso}T00:00:00Z`).getTime() / 1000);
    const toSec = Math.floor(new Date(`${endIso}T23:59:59Z`).getTime() / 1000);
    const range = { startIso, endIso, fromSec, toSec };

    const nowHour = new Date().toISOString().slice(0, 13);
    const cacheKey = `features_${activeTier}_${nowHour}_${includeOhlcv ? "ohlcv" : "lite"}`;
    const cacheTtlMs = activeTier === "full" ? 60 * 60 * 1000 : 30 * 60 * 1000;

    const hit = localCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < cacheTtlMs) {
      return NextResponse.json({ ...hit.payload, cache_hit: true, cache_timestamp: new Date(hit.ts).toISOString() });
    }

    let tickerData = {};
    try {
      tickerData = await fetchInBatches(origin, tickers, provider, range, includeOhlcv, 6, 900);
    } catch (err) {
      console.warn("Full universe failed, using core:", err?.message || err);
      activeTier = "core";
      tickers = TIER_1_CORE;
      tickerData = await fetchInBatches(origin, tickers, provider, range, includeOhlcv, 5, 500);
    }

    const macro = await fetchMacro(origin);

    const failedTickers = [];
    let validCount = 0;
    for (const [ticker, row] of Object.entries(tickerData)) {
      if (row?.valid) validCount += 1;
      else failedTickers.push(ticker);
    }

    const payload = {
      generated_utc: new Date().toISOString(),
      asof: endIso,
      tickers: tickerData,
      macro,
      universe_tier: activeTier,
      tier_1_count: TIER_1_CORE.length,
      tier_2_count: TIER_2_GROWTH.length,
      tier_3_count: TIER_3_THEMATIC.length,
      total_tickers: tickers.length,
      valid_count: validCount,
      failed_tickers: failedTickers,
      quantlab_provider: provider,
      cache_hit: false,
      cache_timestamp: new Date().toISOString(),
    };

    localCache.set(cacheKey, { ts: Date.now(), payload });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to compute market features", details: String(error?.message || error) },
      { status: 500 }
    );
  }
}
