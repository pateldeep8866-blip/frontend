import { NextResponse } from "next/server";
import { avGetMetalSnapshot, METALS_CATALOG } from "../_lib/alphavantage";

const SUPPORTED = new Set(METALS_CATALOG.map((m) => m.symbol));
const METAL_NAME = Object.fromEntries(METALS_CATALOG.map((m) => [m.symbol, m.name]));

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const requested = String(searchParams.get("symbol") || searchParams.get("id") || "XAU").trim().toUpperCase();
    const symbol = SUPPORTED.has(requested) ? requested : "XAU";

    const spot = await avGetMetalSnapshot(symbol);
    if (!spot.ok) {
      return NextResponse.json({ error: "Metals quote fetch failed", status: spot.status, details: spot.data }, { status: spot.status });
    }

    const row = spot.data || {};
    const price = Number(row?.price);
    if (!Number.isFinite(price)) {
      return NextResponse.json({ error: "Metal not found", details: spot.data }, { status: 404 });
    }
    const prevClose = Number(row?.prevClose);
    const change = Number.isFinite(price) && Number.isFinite(prevClose) ? price - prevClose : null;
    const percentChange = Number.isFinite(change) && Number.isFinite(prevClose) && prevClose > 0 ? (change / prevClose) * 100 : null;

    return NextResponse.json({
      id: symbol,
      symbol,
      name: METAL_NAME[symbol] || `${symbol} (Spot USD)`,
      logo: "",
      category: "Precious Metal",
      price,
      change,
      percentChange,
      high: Number(row?.high ?? row?.["High"]),
      low: Number(row?.low ?? row?.["Low"]),
      volume: null,
      marketCap: null,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
