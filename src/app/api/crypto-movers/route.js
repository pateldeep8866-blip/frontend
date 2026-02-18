import { NextResponse } from "next/server";
import { cgJson } from "../_lib/coingecko";

export async function GET() {
  try {
    const url =
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=80&page=1&price_change_percentage=24h";
    const { res, data } = await cgJson(url, { revalidate: 25 });
    if (!res.ok) {
      return NextResponse.json({ error: "Crypto movers fetch failed", status: res.status, details: data }, { status: res.status });
    }

    const rows = (Array.isArray(data) ? data : [])
      .map((x) => ({
        symbol: String(x?.symbol || "").toUpperCase(),
        price: Number(x?.current_price),
        percentChange: Number(
          x?.price_change_percentage_24h ??
            x?.price_change_percentage_24h_in_currency
        ),
      }))
      .filter((x) => x.symbol && Number.isFinite(x.price) && Number.isFinite(x.percentChange));

    const sorted = rows.sort((a, b) => b.percentChange - a.percentChange);
    return NextResponse.json({
      gainers: sorted.slice(0, 5),
      losers: [...sorted].reverse().slice(0, 5),
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
