import { NextResponse } from "next/server";

const CRYPTO_TO_YAHOO = {
  BTC: "BTC-USD",
  ETH: "ETH-USD",
  SOL: "SOL-USD",
  BNB: "BNB-USD",
  XRP: "XRP-USD",
  ADA: "ADA-USD",
  AVAX: "AVAX-USD",
  DOGE: "DOGE-USD",
  LINK: "LINK-USD",
  MATIC: "MATIC-USD",
};

const CRYPTO_TO_COINGECKO = {
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

function toYahooSymbol(symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  if (CRYPTO_TO_YAHOO[clean]) return CRYPTO_TO_YAHOO[clean];
  if (/^[A-Z0-9]{2,10}$/.test(clean)) return clean;
  return clean;
}

function isCryptoSymbol(symbol) {
  const clean = String(symbol || "").trim().toUpperCase();
  return Boolean(CRYPTO_TO_YAHOO[clean]);
}

async function fetchStooqDailyCandles(symbol, from, to) {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Stooq history fetch failed with status ${res.status}`);
  }
  const csv = await res.text();
  const lines = csv.trim().split("\n");
  if (lines.length < 2) {
    return { t: [], o: [], h: [], l: [], c: [], v: [] };
  }

  const t = [];
  const o = [];
  const h = [];
  const l = [];
  const c = [];
  const v = [];

  for (const line of lines.slice(1)) {
    const [dateStr, openStr, highStr, lowStr, closeStr, volumeStr] = line.split(",");
    if (!dateStr || !openStr || !highStr || !lowStr || !closeStr || closeStr === "null") continue;

    const ts = Math.floor(new Date(`${dateStr}T00:00:00Z`).getTime() / 1000);
    if (!Number.isFinite(ts) || ts < from || ts > to) continue;

    const open = Number(openStr);
    const high = Number(highStr);
    const low = Number(lowStr);
    const close = Number(closeStr);
    const volume = Number(volumeStr);
    if (![open, high, low, close].every(Number.isFinite)) continue;

    t.push(ts);
    o.push(open);
    h.push(high);
    l.push(low);
    c.push(close);
    v.push(Number.isFinite(volume) ? volume : 0);
  }

  return { t, o, h, l, c, v };
}


async function fetchCoinGeckoDailyCandles(symbol, from, to) {
  const clean = String(symbol || "").trim().toUpperCase();
  const id = CRYPTO_TO_COINGECKO[clean];
  if (!id) return { t: [], o: [], h: [], l: [], c: [], v: [] };

  const fromMs = Number(from) * 1000;
  const toMs = Number(to) * 1000;
  const days = Math.max(2, Math.ceil((toMs - fromMs) / (24 * 60 * 60 * 1000)));
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { t: [], o: [], h: [], l: [], c: [], v: [] };
  const data = await res.json().catch(() => ({}));
  const prices = Array.isArray(data?.prices) ? data.prices : [];
  const volumes = Array.isArray(data?.total_volumes) ? data.total_volumes : [];

  const volByDay = new Map();
  for (const row of volumes) {
    const ts = Number(row?.[0]);
    const vol = Number(row?.[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(vol)) continue;
    const dayTs = Math.floor(ts / 1000);
    volByDay.set(dayTs, vol);
  }

  const t = [];
  const o = [];
  const h = [];
  const l = [];
  const c = [];
  const v = [];

  let prevClose = null;
  for (const row of prices) {
    const tsMs = Number(row?.[0]);
    const close = Number(row?.[1]);
    if (!Number.isFinite(tsMs) || !Number.isFinite(close)) continue;
    const ts = Math.floor(tsMs / 1000);
    if (ts < from || ts > to) continue;

    const open = Number.isFinite(prevClose) ? prevClose : close;
    const high = Math.max(open, close);
    const low = Math.min(open, close);

    t.push(ts);
    o.push(open);
    h.push(high);
    l.push(low);
    c.push(close);
    v.push(Number(volByDay.get(ts) || 0));

    prevClose = close;
  }

  return { t, o, h, l, c, v };
}

async function fetchYahooDailyCandles(symbol, from, to) {
  const yahooSymbol = toYahooSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=5y&interval=1d`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return { t: [], o: [], h: [], l: [], c: [], v: [] };
  const data = await res.json().catch(() => ({}));
  const result = data?.chart?.result?.[0] || {};
  const ts = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const opens = Array.isArray(quote?.open) ? quote.open : [];
  const highs = Array.isArray(quote?.high) ? quote.high : [];
  const lows = Array.isArray(quote?.low) ? quote.low : [];
  const closes = Array.isArray(quote?.close) ? quote.close : [];
  const volumes = Array.isArray(quote?.volume) ? quote.volume : [];

  const t = [];
  const o = [];
  const h = [];
  const l = [];
  const c = [];
  const v = [];
  const n = Math.min(ts.length, opens.length, highs.length, lows.length, closes.length, volumes.length);
  for (let i = 0; i < n; i += 1) {
    const tVal = Number(ts[i]);
    const oVal = Number(opens[i]);
    const hVal = Number(highs[i]);
    const lVal = Number(lows[i]);
    const cVal = Number(closes[i]);
    const vVal = Number(volumes[i]);
    if (![tVal, oVal, hVal, lVal, cVal].every(Number.isFinite)) continue;
    if (tVal < from || tVal > to) continue;
    t.push(tVal);
    o.push(oVal);
    h.push(hVal);
    l.push(lVal);
    c.push(cVal);
    v.push(Number.isFinite(vVal) ? vVal : 0);
  }
  return { t, o, h, l, c, v };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    const resolution = (searchParams.get("resolution") || "D").trim(); // D, 60, 15...
    const isCrypto = isCryptoSymbol(symbol);
    const daysParam = Number(searchParams.get("days"));
    const fromParam = Number(searchParams.get("from"));
    const toParam = Number(searchParams.get("to"));

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    const API_KEY = process.env.FINNHUB_API_KEY;
    const now = Math.floor(Date.now() / 1000);
    const to = Number.isFinite(toParam) && toParam > 0 ? Math.floor(toParam) : now;
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.floor(daysParam) : 400;
    const from =
      Number.isFinite(fromParam) && fromParam > 0
        ? Math.floor(fromParam)
        : to - days * 24 * 60 * 60;

    let data = null;
    let source = "finnhub";

    if (API_KEY && !(isCrypto && resolution === "D")) {
      const url =
        `https://finnhub.io/api/v1/stock/candle` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&resolution=${encodeURIComponent(resolution)}` +
        `&from=${from}` +
        `&to=${to}` +
        `&token=${API_KEY}`;

      const res = await fetch(url, { cache: "no-store" });
      const payload = await res.json();
      if (res.ok && payload?.s === "ok") {
        data = payload;
      } else if (resolution !== "D") {
        return NextResponse.json(
          { error: "Finnhub candle fetch failed", details: payload, symbol, resolution, from, to },
          { status: res.status || 502 }
        );
      }
    }

    if (!data) {
      if (resolution !== "D") {
        return NextResponse.json(
          { error: "Missing FINNHUB_API_KEY for intraday candles", symbol, resolution, from, to },
          { status: 500 }
        );
      }

      if (isCrypto) {
        source = "coingecko";
        data = await fetchCoinGeckoDailyCandles(symbol, from, to);
        if (!Array.isArray(data?.c) || data.c.length < 2) {
          source = "yahoo";
          data = await fetchYahooDailyCandles(symbol, from, to);
        }
      } else {
        source = "stooq";
        data = await fetchStooqDailyCandles(symbol, from, to);
        if (!Array.isArray(data?.c) || data.c.length < 65) {
          source = "yahoo";
          data = await fetchYahooDailyCandles(symbol, from, to);
        }
      }
    }

    const rowCount = Array.isArray(data.c) ? data.c.length : 0;
    const minRowsRequired = isCrypto && resolution === "D" ? 2 : 65;
    if (rowCount < minRowsRequired) {
      return NextResponse.json(
        {
          error: "Insufficient history",
          details: `min ${minRowsRequired} rows required, got ${rowCount}`,
          symbol,
          resolution,
          source,
          from,
          to,
          rows: rowCount,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      symbol,
      resolution,
      source,
      from,
      to,
      rows: rowCount,
      t: data.t,
      c: data.c,
      h: data.h,
      l: data.l,
      o: data.o,
      v: data.v,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
