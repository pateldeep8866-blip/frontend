import { NextResponse } from "next/server";

export async function GET() {
  try {
    const API_KEY = "d68ih01r01qq5rjfmhqgd68ih01r01qq5rjfmhr0";
    const url = `https://finnhub.io/api/v1/news?category=general&token=${API_KEY}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => []);

    if (!res.ok) {
      return NextResponse.json({ error: "Market news fetch failed", details: data }, { status: res.status });
    }

    const items = Array.isArray(data)
      ? data
          .filter((n) => n?.headline && n?.url)
          .slice(0, 12)
          .map((n) => ({
            headline: n.headline,
            source: n.source,
            url: n.url,
            datetime: n.datetime,
          }))
      : [];

    return NextResponse.json({ news: items });
  } catch (e) {
    return NextResponse.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
