import { NextResponse } from "next/server";

const UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "AVGO", "JPM", "XOM",
];

export async function GET() {
  try {
    const API_KEY = "d68ih01r01qq5rjfmhqgd68ih01r01qq5rjfmhr0";

    const rows = await Promise.all(
      UNIVERSE.map(async (symbol) => {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`;
        const res = await fetch(url, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));

        if (!res.ok || !Number.isFinite(data?.c) || !Number.isFinite(data?.dp)) {
          return null;
        }

        return {
          symbol,
          price: data.c,
          change: data.d,
          percentChange: data.dp,
        };
      })
    );

    const clean = rows.filter(Boolean);
    const sorted = clean.sort((a, b) => b.percentChange - a.percentChange);

    return NextResponse.json({
      gainers: sorted.slice(0, 5),
      losers: [...sorted].reverse().slice(0, 5),
      universeCount: clean.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
