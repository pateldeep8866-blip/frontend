import { NextResponse } from "next/server";
import { cgJson } from "../_lib/coingecko";

async function resolveId(symbol) {
  const q = String(symbol || "").trim();
  if (!q) return "";
  const { data: d } = await cgJson(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`,
    { revalidate: 12 }
  );
  const coins = Array.isArray(d?.coins) ? d.coins : [];
  const exact = coins.find((c) => String(c?.symbol || "").toUpperCase() === q.toUpperCase());
  return String((exact || coins[0])?.id || "");
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    let id = (searchParams.get("id") || "").trim().toLowerCase();
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    if (!id && symbol) id = await resolveId(symbol);

    if (!id) return NextResponse.json({ error: "Missing id or symbol" }, { status: 400 });

    const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}&price_change_percentage=24h`;
    const { res, data } = await cgJson(url, { revalidate: 20 });
    if (!res.ok) {
      return NextResponse.json({ error: "Crypto quote fetch failed", status: res.status, details: data }, { status: res.status });
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return NextResponse.json({ error: "Crypto not found" }, { status: 404 });

    return NextResponse.json({
      id: row.id,
      symbol: String(row.symbol || "").toUpperCase(),
      name: row.name,
      logo: row.image || "",
      homepage: "",
      category: "Cryptocurrency",
      price: row.current_price,
      change: row.price_change_24h,
      percentChange:
        row.price_change_percentage_24h ??
        row.price_change_percentage_24h_in_currency,
      high: row.high_24h,
      low: row.low_24h,
      volume: row.total_volume,
      marketCap: row.market_cap,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
