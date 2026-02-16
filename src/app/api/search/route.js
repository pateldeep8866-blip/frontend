import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("query");

    if (!query) {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    // PASTE YOUR API KEY HERE BETWEEN QUOTES
    const API_KEY = "d68ih01r01qq5rjfmhqgd68ih01r01qq5rjfmhr0";

    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${API_KEY}`
    );

    const data = await res.json();

    if (!data.result || data.result.length === 0) {
      return NextResponse.json({ error: "No symbol found" }, { status: 404 });
    }

    const symbol = data.result[0].symbol;

    return NextResponse.json({
      symbol: symbol
    });

  } catch (error) {
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
