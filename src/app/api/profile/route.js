import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    // ✅ Paste your Finnhub API key here
    const API_KEY = "d68ih01r01qq5rjfmhqgd68ih01r01qq5rjfmhr0";

    const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(
      symbol
    )}&token=${API_KEY}`;

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    // Finnhub sometimes returns {} for unknown symbol
    if (!res.ok || !data || Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: "Company not found", symbol, raw: data },
        { status: 404 }
      );
    }

    return NextResponse.json({
      name: data.name || null,
      ticker: data.ticker || symbol,
      logo: data.logo || null,
      exchange: data.exchange || null,
      sector: data.finnhubIndustry || null,
      finnhubIndustry: data.finnhubIndustry || null,
      marketCapitalization: data.marketCapitalization ?? null,
      ipo: data.ipo || null,
      country: data.country || null,
      weburl: data.weburl || null,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
