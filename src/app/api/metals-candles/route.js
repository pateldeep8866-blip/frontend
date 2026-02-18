import { NextResponse } from "next/server";
import { avGet, avGetMetal, yahooGetMetalCandles } from "../_lib/alphavantage";

const METAL_MAP = {
  XAU: "XAU",
  XAG: "XAG",
  XPT: "XPT",
  XPD: "XPD",
  GOLD: "XAU",
  SILVER: "XAG",
  PLATINUM: "XPT",
  PALLADIUM: "XPD",
};

function resolveMetalId(symbol, id) {
  const direct = String(id || "").trim();
  if (direct) return direct.toUpperCase().replace("USD=X", "");
  return METAL_MAP[String(symbol || "").trim().toUpperCase()] || "";
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol") || "";
    const id = resolveMetalId(symbol, searchParams.get("id"));
    const days = Number(searchParams.get("days") || 30);
    const validDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.round(days))) : 30;
    if (!id) return NextResponse.json({ error: "Missing or unsupported metal id" }, { status: 400 });

    const c = [];
    const t = [];
    const v = [];

    const yahoo = await yahooGetMetalCandles(id, validDays);
    if (yahoo.ok) {
      return NextResponse.json({ s: "ok", ...yahoo.data });
    }

    const fxDaily = await avGet({
      function: "FX_DAILY",
      from_symbol: id,
      to_symbol: "USD",
      outputsize: "compact",
    });
    if (fxDaily.ok) {
      const series = fxDaily.data?.["Time Series FX (Daily)"] || {};
      const rows = Object.entries(series)
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .slice(-Math.max(2, validDays));
      for (const [date, row] of rows) {
        const tsMs = Date.parse(String(date));
        const ts = Number.isFinite(tsMs) ? Math.floor(tsMs / 1000) : null;
        const close = Number(row?.["4. close"]);
        if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
        c.push(close);
        t.push(ts);
        v.push(null);
      }
      if (c.length >= 2) return NextResponse.json({ s: "ok", c, t, v });
    }

    const interval = validDays <= 7 ? "daily" : validDays <= 60 ? "weekly" : "monthly";
    const history = await avGetMetal("GOLD_SILVER_HISTORY", id, { interval });
    if (!history.ok) {
      return NextResponse.json({ error: "Metals candles fetch failed", status: history.status, details: history.data }, { status: history.status });
    }

    const rows = Array.isArray(history.data?.data) ? history.data.data : [];
    if (!rows.length) return NextResponse.json({ error: "No candle data" }, { status: 404 });
    const limited = rows.slice(-Math.max(2, validDays));
    for (let i = 0; i < limited.length; i++) {
      const row = limited[i];
      const tsMs = Date.parse(String(row?.date || row?.timestamp || ""));
      const ts = Number.isFinite(tsMs) ? Math.floor(tsMs / 1000) : null;
      const close = Number(row?.price ?? row?.close ?? row?.value);
      if (!Number.isFinite(ts) || !Number.isFinite(close)) continue;
      c.push(close);
      t.push(ts);
      v.push(null);
    }
    return NextResponse.json({ s: "ok", c, t, v });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
