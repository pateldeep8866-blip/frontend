export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";



const COUNTRY_BENCHMARKS = [
  { code: "US", symbol: "SPY" },
  { code: "CA", symbol: "EWC" },
  { code: "MX", symbol: "EWW" },
  { code: "BR", symbol: "EWZ" },
  { code: "GB", symbol: "EWU" },
  { code: "DE", symbol: "EWG" },
  { code: "FR", symbol: "EWQ" },
  { code: "SA", symbol: "KSA" },
  { code: "AE", symbol: "UAE" },
  { code: "IN", symbol: "INDA" },
  { code: "CN", symbol: "MCHI" },
  { code: "JP", symbol: "EWJ" },
  { code: "KR", symbol: "EWY" },
  { code: "AU", symbol: "EWA" },
  { code: "ZA", symbol: "EZA" },
];

async function fetchQuoteFromHost(origin, symbol) {
  try {
    const res = await fetch(`${origin}/api/quote?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
      headers: { "cache-control": "no-store" },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const percentChange = Number(data?.percentChange);
    return Number.isFinite(percentChange) ? percentChange : null;
  } catch {
    return null;
  }
}

export async function GET(req) {
  try {
    const { origin } = new URL(req.url);
    const rows = await Promise.all(
      COUNTRY_BENCHMARKS.map(async (item) => ({
        code: item.code,
        symbol: item.symbol,
        percentChange: await fetchQuoteFromHost(origin, item.symbol),
      }))
    );

    const byCountry = {};
    for (const row of rows) {
      byCountry[row.code] = row.percentChange;
    }

    return NextResponse.json(
      { byCountry, rows, asOf: new Date().toISOString() },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to compute global market performance", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
