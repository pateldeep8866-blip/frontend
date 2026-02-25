import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000;
const localCache = new Map();
const QUANT_CACHE_ROOT = "/Users/juanramirez/NOVA/NOVA_LAB/QUANT_LAB/data/cache";

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
  ).slice(0, 200);
}

function isoDateFromUnixSec(unixSec) {
  const d = new Date(Number(unixSec) * 1000);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}

function detectProvider() {
  const raw = String(process.env.QUANTLAB_DATA_PROVIDER || "").trim().toLowerCase();
  if (raw) return raw;
  return "finnhub";
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
    const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / slice.length; // ddof=0
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
  const start = requestedStart || isoDateFromUnixSec(rows[0]?.t);
  const end = requestedEnd || isoDateFromUnixSec(rows[rows.length - 1]?.t);
  if (!start || !end) return { ok: false, error: "invalid cache dates" };

  const file = `${ticker}__1d__${start}__${end}.csv`;
  const providerDir = join(QUANT_CACHE_ROOT, provider);
  await mkdir(providerDir, { recursive: true });

  const csvPath = join(providerDir, file);
  const metaPath = `${csvPath}.meta.json`;

  const csv = toQuantCacheCsv(rows);
  await writeFile(csvPath, csv, "utf-8");

  const meta = {
    provider_name: provider,
    provider_version: "frontend-cache-injected",
    retrieval_timestamp: new Date().toISOString(),
    request_params: {
      symbol: ticker,
      start,
      end,
      interval: "1d",
    },
    row_count: rows.length,
    first_timestamp: new Date(Number(rows[0].t) * 1000).toISOString(),
    last_timestamp: new Date(Number(rows[rows.length - 1].t) * 1000).toISOString(),
    cache_hit: true,
    source: "arthastra_market_features",
  };
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");

  return { ok: true, path: csvPath, start, end };
}

async function buildTicker(origin, ticker, provider, range) {
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
    ohlcv_rows: 0,
    valid: false,
    error: null,
    quant_cache_file: null,
  };

  try {
    const [candles, quote] = await Promise.all([
      fetchJson(
        `${origin}/api/candles?symbol=${encodeURIComponent(ticker)}&resolution=D&from=${range.fromSec}&to=${range.toSec}`
      ),
      fetchJson(`${origin}/api/quote?symbol=${encodeURIComponent(ticker)}`),
    ]);

    const t = Array.isArray(candles.data?.t) ? candles.data.t : [];
    const o = Array.isArray(candles.data?.o) ? candles.data.o : [];
    const h = Array.isArray(candles.data?.h) ? candles.data.h : [];
    const l = Array.isArray(candles.data?.l) ? candles.data.l : [];
    const c = Array.isArray(candles.data?.c) ? candles.data.c : [];
    const v = Array.isArray(candles.data?.v) ? candles.data.v : [];

    const n = Math.min(t.length, o.length, h.length, l.length, c.length, v.length);
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
      if (
        row.t == null ||
        row.open == null ||
        row.high == null ||
        row.low == null ||
        row.close == null ||
        row.volume == null
      ) {
        continue;
      }
      rows.push(row);
    }

    if (rows.length < 65) {
      out.error = "min 65 rows required";
      out.ohlcv_rows = rows.length;
      return out;
    }

    const featureResult = computeFeatureSetFromRows(rows);
    if (!featureResult.ok) {
      out.error = featureResult.error;
      return out;
    }

    const cacheWrite = await writeQuantCacheFile({
      ticker,
      rows,
      provider,
      requestedStart: range.startIso,
      requestedEnd: range.endIso,
    });
    if (cacheWrite.ok) {
      out.quant_cache_file = cacheWrite.path;
    }

    out.price = toNum(quote.data?.price) ?? toNum(rows[rows.length - 1]?.close);
    out.volume = toNum(quote.data?.volume) ?? toNum(rows[rows.length - 1]?.volume);
    out.ret_5d = featureResult.features.ret_5d;
    out.ret_20d = featureResult.features.ret_20d;
    out.ret_60d = featureResult.features.ret_60d;
    out.vol_5d = featureResult.features.vol_5d;
    out.vol_20d = featureResult.features.vol_20d;
    out.avg_volume_20d = featureResult.features.avg_volume_20d;
    out.ohlcv_rows = rows.length;
    out.valid = true;
    out.error = null;
    return out;
  } catch (error) {
    out.error = String(error?.message || error);
    return out;
  }
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
        const px = toNum(data?.price);
        return [key, px];
      } catch {
        return [key, null];
      }
    })
  );

  return Object.fromEntries(entries);
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const tickers = normalizeTickers(body?.tickers);
    const provider = detectProvider();

    if (!tickers.length) {
      return NextResponse.json({ error: "tickers[] is required" }, { status: 400 });
    }

    const cacheKey = `${provider}::${tickers.join(",")}`;
    const hit = localCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
      return NextResponse.json(
        {
          ...hit.payload,
          cache_timestamp: new Date(hit.ts).toISOString(),
          cache_hit: true,
        },
        { headers: { "cache-control": "public, max-age=3600" } }
      );
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const endDate = new Date();
    const startDate = new Date(endDate);
    startDate.setUTCFullYear(startDate.getUTCFullYear() - 3);
    const startIso = startDate.toISOString().slice(0, 10);
    const endIso = endDate.toISOString().slice(0, 10);
    const fromSec = Math.floor(new Date(`${startIso}T00:00:00Z`).getTime() / 1000);
    const toSec = Math.floor(new Date(`${endIso}T23:59:59Z`).getTime() / 1000);
    const range = { startIso, endIso, fromSec, toSec };
    const [macro, rows] = await Promise.all([
      fetchMacro(origin),
      Promise.all(tickers.map((ticker) => buildTicker(origin, ticker, provider, range))),
    ]);

    const failed = rows.filter((r) => !r.valid).map((r) => ({ ticker: r.ticker, error: r.error }));
    if (failed.length) {
      console.warn("[market-features] failed tickers", failed);
    }

    const byTicker = {};
    for (const row of rows) {
      byTicker[row.ticker] = row;
    }

    const nowIso = new Date().toISOString();
    const payload = {
      generated_utc: nowIso,
      asof: nowIso.slice(0, 10),
      tickers: byTicker,
      macro,
      quantlab_provider: provider,
      cache_timestamp: nowIso,
      cache_hit: false,
    };

    localCache.set(cacheKey, { ts: Date.now(), payload });

    return NextResponse.json(payload, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to compute market features", details: String(error?.message || error) },
      { status: 500 }
    );
  }
}
