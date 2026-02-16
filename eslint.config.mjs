import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q");

    if (!q) {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    // PASTE YOUR FINNHUB API KEY HERE
    const API_KEY = "d68igk9r01qq5rjfmgggd68igk9r01qq5rjfmgh0";

    const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(q)}&token=${API_KEY}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: "Finnhub failed", details: data },
        { status: res.status }
      );
    }

    if (!data.result || data.result.length === 0) {
      return NextResponse.json({
        symbol: null,
        query: q,
      });
    }

    // Take best match
    const bestMatch = data.result[0];

    return NextResponse.json({
      query: q,
      symbol: bestMatch.symbol,
      description: bestMatch.description,
    });

  } catch (error) {
    return NextResponse.json(
      { error: "Server error", details: error.message },
      { status: 500 }
    );
  }
}
