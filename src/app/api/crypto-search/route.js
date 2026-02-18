import { NextResponse } from "next/server";
import { cgFetch } from "../_lib/coingecko";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || searchParams.get("query") || "").trim();
    if (!q) return NextResponse.json({ error: "Missing query" }, { status: 400 });

    const res = await cgFetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, {
      revalidate: 12,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: "Crypto search failed", status: res.status, details: data }, { status: res.status });
    }

    const coins = Array.isArray(data?.coins) ? data.coins : [];
    const matches = coins.slice(0, 10).map((c) => ({
      id: String(c?.id || ""),
      symbol: String(c?.symbol || "").toUpperCase(),
      name: String(c?.name || ""),
      description: `${String(c?.name || "")} (${String(c?.symbol || "").toUpperCase()})`,
    }));

    const best = matches[0] || null;
    return NextResponse.json({
      query: q,
      best,
      symbol: best?.symbol || "",
      id: best?.id || "",
      matches,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
