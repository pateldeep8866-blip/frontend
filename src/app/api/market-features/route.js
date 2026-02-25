import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map();

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTickers(input) {
  if (!Array.isArray(input)) return [];
  const clean = input
    .map((x) => String(x || "").trim().toUpperCase())
    .filter((x) => /^[A-Z0-9.^=-]{1,15}$/.test(x));
  return Array.from(new Set(clean)).slice(0, 200);
}

function stdDev(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const nums = values.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  const mean = nums.reduce((sum, n) => sum + n, 0) / nums.length;
  const variance = nums.reduce((sum, n) => sum + (n - mean) ** 2, 0) / nums.length;
  return Number.isFinite(variance) ? Math.sqrt(variance) : null;
}

function computeReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = Number(closes[i - 1]);
    const cur = Number(closes[i]);
    if (!Number.isFinite(prev) || !Number.isFinite(cur) || prev <= 0) continue;
    out.push((cur - prev) / prev);
  }
  return out;
}

function getOriginFromRequest(req) {
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL;
  if (envOrigin) return envOrigin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

async function fetchInternalJson(origin, path) {
  const response = await fetch(`${origin}${path}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function fetchMacro(origin) {
  const symbols = {
    vix: "^VIX",
    dxy: "DX-Y.NYB",
    tenYear: "^TNX",
    wti: "CL=F",
    gold: "GC=F",
  };

  const pairs = await Promise.all(
    Object.entries(symbols).map(async ([key, symbol]) => {
      try {
        const { response, data } = await fetchInternalJson(origin, `/api/quote?symbol=${encodeURIComponent(symbol)}`);
        if (!response.ok) return [key, null];
        return [key, toNum(data?.price)];
      } catch {
        return [key, null];
      }
    })
  );

  const macro = Object.fromEntries(pairs);
  if (macro.tenYear != null) {
    const ten = Number(macro.tenYear);
    macro.tenYear = ten > 20 ? ten / 10 : ten;
  }
  return macro;
}

function buildEmptyTicker(ticker) {
  return {
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
    valid: false,
    error: null,
  };
}

async function buildTickerFeatures(origin, ticker) {
  const out = buildEmptyTicker(ticker);

  try {
    const [candlesRes, quoteRes, metricsRes] = await Promise.all([
      fetchInternalJson(origin, `/api/candles?symbol=${encodeURIComponent(ticker)}&resolution=D&days=252`),
      fetchInternalJson(origin, `/api/quote?symbol=${encodeURIComponent(ticker)}`),
      fetchInternalJson(origin, `/api/metrics?symbol=${encodeURIComponent(ticker)}`),
    ]);

    const t = Array.isArray(candlesRes.data?.t) ? candlesRes.data.t : [];
    const o = Array.isArray(candlesRes.data?.o) ? candlesRes.data.o : [];
    const h = Array.isArray(candlesRes.data?.h) ? candlesRes.data.h : [];
    const l = Array.isArray(candlesRes.data?.l) ? candlesRes.data.l : [];
    const c = Array.isArray(candlesRes.data?.c) ? candlesRes.data.c : [];
    const v = Array.isArray(candlesRes.data?.v) ? candlesRes.data.v : [];

    const n = Math.min(t.length, o.length, h.length, l.length, c.length, v.length);
    if (!candlesRes.response.ok || n === 0) {
      out.error = "insufficient history";
      return out;
    }

    const rows = [];
    for (let i = 0; i < n; i += 1) {
      const row = {
        date: toNum(t[i]),
        open: toNum(o[i]),
        high: toNum(h[i]),
        low: toNum(l[i]),
        close: toNum(c[i]),
        volume: toNum(v[i]),
      };
      if (
        row.date == null ||
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
      return out;
    }

    const closeAsc = rows.map((r) => r.close);
    const volumeAsc = rows.map((r) => r.volume);

    const close = [...closeAsc].reverse();
    const volume = [...volumeAsc].reverse();
    const high = rows.map((r) => r.high).reverse();
    const low = rows.map((r) => r.low).reverse();

    const latestClose = close[0];
    const close4 = close[4];
    const close19 = close[19];
    const close59 = close[59];

    const ret5 = latestClose > 0 && close4 > 0 ? (latestClose - close4) / close4 : null;
    const ret20 = latestClose > 0 && close19 > 0 ? (latestClose - close19) / close19 : null;
    const ret60 = latestClose > 0 && close59 > 0 ? (latestClose - close59) / close59 : null;

    const returnsAsc = computeReturns(closeAsc);
    const vol5 = stdDev(returnsAsc.slice(-5));
    const vol20 = stdDev(returnsAsc.slice(-20));

    const latest20Volume = volume.slice(0, 20);
    const avgVol20 =
      latest20Volume.length === 20
        ? latest20Volume.reduce((sum, nVal) => sum + Number(nVal), 0) / latest20Volume.length
        : null;

    const high20 = high.slice(0, 20);
    const low20 = low.slice(0, 20);
    const high20Max = high20.length ? Math.max(...high20) : null;
    const low20Min = low20.length ? Math.min(...low20) : null;
    const priceRange =
      latestClose > 0 && Number.isFinite(high20Max) && Number.isFinite(low20Min)
        ? (high20Max - low20Min) / latestClose
        : null;

    const quote = quoteRes.data || {};
    const metrics = metricsRes.data || {};

    out.price = toNum(quote?.price) ?? latestClose;
    out.volume = toNum(quote?.volume) ?? volume[0] ?? null;
    out.ret_5d = toNum(ret5);
    out.ret_20d = toNum(ret20);
    out.ret_60d = toNum(ret60);
    out.vol_5d = toNum(vol5);
    out.vol_20d = toNum(vol20);
    out.avg_volume_20d = toNum(avgVol20);
    out.price_range = toNum(priceRange);
    out.week52High = toNum(quote?.week52High) ?? toNum(metrics?.week52High);
    out.week52Low = toNum(quote?.week52Low) ?? toNum(metrics?.week52Low);

    const required = [
      out.price,
      out.volume,
      out.ret_5d,
      out.ret_20d,
      out.ret_60d,
      out.vol_5d,
      out.vol_20d,
      out.avg_volume_20d,
      out.price_range,
    ];

    out.valid = required.every((x) => Number.isFinite(Number(x)));
    if (!out.valid) {
      out.error = "feature computation incomplete";
    }

    return out;
  } catch (error) {
    out.error = String(error?.message || error || "feature error");
    return out;
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const tickers = normalizeTickers(body?.tickers);

    if (!tickers.length) {
      return NextResponse.json({ error: "tickers[] is required" }, { status: 400 });
    }

    const cacheKey = tickers.join(",");
    const now = Date.now();
    const cached = cache.get(cacheKey);
    if (cached && now - cached.storedAt < CACHE_TTL_MS) {
      return NextResponse.json(
        {
          ...cached.payload,
          cache_timestamp: new Date(cached.storedAt).toISOString(),
          cache_hit: true,
        },
        { headers: { "cache-control": "public, max-age=3600" } }
      );
    }

    const origin = getOriginFromRequest(req);

    const [macro, tickerRows] = await Promise.all([
      fetchMacro(origin),
      Promise.all(tickers.map((ticker) => buildTickerFeatures(origin, ticker))),
    ]);

    const failed = tickerRows.filter((r) => !r.valid).map((r) => ({ ticker: r.ticker, error: r.error }));
    if (failed.length) {
      console.warn("[market-features] failed tickers", failed);
    }

    const tickersPayload = {};
    for (const row of tickerRows) {
      tickersPayload[row.ticker] = row;
    }

    const generatedUtc = new Date().toISOString();
    const payload = {
      generated_utc: generatedUtc,
      asof: generatedUtc.slice(0, 10),
      tickers: tickersPayload,
      macro,
      cache_timestamp: generatedUtc,
      cache_hit: false,
    };

    cache.set(cacheKey, { storedAt: now, payload });

    return NextResponse.json(payload, {
      headers: { "cache-control": "public, max-age=3600" },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to generate market features",
        details: String(error?.message || error),
      },
      { status: 500 }
    );
  }
}
