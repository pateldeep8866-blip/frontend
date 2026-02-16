import { NextResponse } from "next/server";

/**
 * Free daily history from Stooq (no API key).
 * Example: https://stooq.com/q/d/l/?s=aapl.us&i=d
 */
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    // Stooq uses lowercase and often needs ".us" for US stocks
    const stooqSymbol = `${symbol.toLowerCase()}.us`;

    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      return NextResponse.json(
        { error: "History fetch failed", status: res.status },
        { status: 502 }
      );
    }

    const csv = await res.text();

    // CSV columns: Date,Open,High,Low,Close,Volume
    const lines = csv.trim().split("\n");
    if (lines.length < 3) {
      return NextResponse.json({ error: "No history data" }, { status: 404 });
    }

    const rows = lines.slice(1).map((line) => line.split(","));
    const data = rows
      .filter((r) => r.length >= 5 && r[0] && r[4] && r[4] !== "null")
      .slice(-120) // last ~6 months trading days
      .map((r) => ({
        date: r[0],
        close: Number(r[4]),
      }))
      .filter((p) => Number.isFinite(p.close));

    if (!data.length) {
      return NextResponse.json({ error: "No usable history" }, { status: 404 });
    }

    return NextResponse.json({ symbol, points: data });
  } catch (e) {
    return NextResponse.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
