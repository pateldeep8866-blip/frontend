import { NextResponse } from "next/server";

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

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    const resolution = (searchParams.get("resolution") || "D").trim(); // D, 60, 15...
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

    if (API_KEY) {
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
      source = "stooq";
      data = await fetchStooqDailyCandles(symbol, from, to);
    }

    const rowCount = Array.isArray(data.c) ? data.c.length : 0;
    if (rowCount < 65) {
      return NextResponse.json(
        {
          error: "Insufficient history",
          details: `min 65 rows required, got ${rowCount}`,
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
