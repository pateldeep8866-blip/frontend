import { NextResponse } from "next/server";
import { cgJson } from "../_lib/coingecko";

const DEFAULT_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "binancecoin",
  "ripple",
  "dogecoin",
  "cardano",
  "avalanche-2",
  "chainlink",
  "tron",
];

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const idsParam = (searchParams.get("ids") || "").trim();
    const ids = idsParam
      ? idsParam
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
      : DEFAULT_IDS;

    if (!ids.length) return NextResponse.json({ rows: [] });

    const url =
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd` +
      `&ids=${encodeURIComponent(ids.join(","))}` +
      `&price_change_percentage=24h`;

    const { res, data } = await cgJson(url, { revalidate: 20 });

    if (!res.ok) {
      return NextResponse.json(
        { error: "Crypto overview fetch failed", status: res.status, details: data },
        { status: res.status }
      );
    }

    const byId = new Map(
      (Array.isArray(data) ? data : []).map((row) => [String(row?.id || ""), row])
    );

    const rows = ids.map((id) => {
      const row = byId.get(id);
      return {
        symbol: String(row?.symbol || id).toUpperCase(),
        price: Number(row?.current_price),
        percent: Number(
          row?.price_change_percentage_24h ??
            row?.price_change_percentage_24h_in_currency
        ),
      };
    });

    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
