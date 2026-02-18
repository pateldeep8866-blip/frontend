import { NextResponse } from "next/server";
import { cgFetch } from "../_lib/coingecko";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = (searchParams.get("id") || "").trim().toLowerCase();
    const days = Number(searchParams.get("days") || 30);
    const validDays = Number.isFinite(days) ? Math.max(1, Math.min(365, Math.round(days))) : 30;

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const interval = validDays <= 1 ? "hourly" : "daily";
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
      id
    )}/market_chart?vs_currency=usd&days=${validDays}&interval=${interval}`;
    const res = await cgFetch(url, { revalidate: 20 });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: "Crypto candles fetch failed", status: res.status, details: data }, { status: res.status });
    }

    const prices = Array.isArray(data?.prices) ? data.prices : [];
    const volumes = Array.isArray(data?.total_volumes) ? data.total_volumes : [];
    if (!prices.length) return NextResponse.json({ error: "No candle data" }, { status: 404 });

    const c = [];
    const t = [];
    const v = [];
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      const vol = volumes[i];
      const tsMs = Number(p?.[0]);
      const close = Number(p?.[1]);
      if (!Number.isFinite(tsMs) || !Number.isFinite(close)) continue;
      c.push(close);
      t.push(Math.floor(tsMs / 1000));
      v.push(Number.isFinite(Number(vol?.[1])) ? Number(vol[1]) : null);
    }

    return NextResponse.json({ s: "ok", c, t, v });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
