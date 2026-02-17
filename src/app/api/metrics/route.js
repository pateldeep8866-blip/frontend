import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    const API_KEY = process.env.FINNHUB_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
    }

    const metricUrl =
      `https://finnhub.io/api/v1/stock/metric` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&metric=all` +
      `&token=${API_KEY}`;

    const metricRes = await fetch(metricUrl, { cache: "no-store" });
    const metricData = await metricRes.json().catch(() => ({}));

    if (!metricRes.ok) {
      return NextResponse.json({ error: "Metric fetch failed", details: metricData }, { status: metricRes.status });
    }

    const m = metricData?.metric || {};

    return NextResponse.json({
      symbol,
      peRatio: m.peTTM ?? m.peBasicExclExtraTTM ?? null,
      week52High: m["52WeekHigh"] ?? null,
      week52Low: m["52WeekLow"] ?? null,
      beta: m.beta ?? null,
      epsTTM: m.epsTTM ?? null,
      dividendYield: m.dividendYieldIndicatedAnnual ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
