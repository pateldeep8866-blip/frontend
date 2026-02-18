import { NextResponse } from "next/server";
import { avGetMetalSnapshot, METALS_CATALOG } from "../_lib/alphavantage";

const METAL_SYMBOLS = METALS_CATALOG.map((m) => m.symbol);
const METAL_NAME = Object.fromEntries(METALS_CATALOG.map((m) => [m.symbol, m.name]));

export async function GET() {
  try {
    const responses = await Promise.all(
      METAL_SYMBOLS.map(async (s) => {
        const r = await avGetMetalSnapshot(s);
        return { symbol: s, response: r };
      })
    );

    const rows = responses
      .filter((x) => x.response.ok)
      .map(({ symbol: s, response }) => {
        const row = response.data || {};
        return {
          symbol: s,
          name: METAL_NAME[s] || s,
          price: Number(row?.price),
          percent: Number.isFinite(Number(row?.percentChange)) ? Number(row.percentChange) : null,
        };
      })
      .filter((x) => Number.isFinite(x.price));

    if (!rows.length) {
      const failed = responses.find((x) => !x.response.ok);
      return NextResponse.json(
        { error: "Metals overview fetch failed", status: failed?.response?.status || 502, details: failed?.response?.data || {} },
        { status: failed?.response?.status || 502 }
      );
    }

    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
