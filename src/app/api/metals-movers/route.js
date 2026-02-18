import { NextResponse } from "next/server";
import { avGetMetalSnapshot, METALS_CATALOG } from "../_lib/alphavantage";

const METAL_SYMBOLS = METALS_CATALOG.map((m) => m.symbol);

export async function GET() {
  try {
    const responses = await Promise.all(
      METAL_SYMBOLS.map(async (s) => {
        const r = await avGetMetalSnapshot(s);
        return { symbol: s, response: r };
      })
    );

    const rows = responses
      .map(({ symbol, response }) => {
        if (!response.ok) return { symbol, price: NaN, percentChange: NaN };
        const x = response.data || {};
        const price = Number(x?.price);
        const percentChange = Number(x?.percentChange);
        return { symbol, price, percentChange };
      })
      .filter((x) => x.symbol && Number.isFinite(x.price) && Number.isFinite(x.percentChange));

    if (!rows.length) {
      const failed = responses.find((x) => !x.response.ok);
      return NextResponse.json(
        { error: "Metals movers fetch failed", status: failed?.response?.status || 502, details: failed?.response?.data || {} },
        { status: failed?.response?.status || 502 }
      );
    }

    const sorted = rows.sort((a, b) => b.percentChange - a.percentChange);
    return NextResponse.json({
      gainers: sorted.slice(0, 5),
      losers: [...sorted].reverse().slice(0, 5),
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
