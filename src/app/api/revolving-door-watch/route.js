export const dynamic = "force-static";
import { NextResponse } from "next/server";

const COMPANIES = {
  LMT: "Lockheed Martin",
  RTX: "Raytheon RTX",
  NOC: "Northrop Grumman",
  GD: "General Dynamics",
  BA: "Boeing defense",
  PLTR: "Palantir",
};

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1] || "";
    const title = (
      block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
      block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ""
    ).trim();
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();
    if (!title) continue;
    const ts = Date.parse(pubDate);
    const age = Number.isFinite(ts) ? Date.now() - ts : Infinity;
    items.push({
      headline: title,
      url: link,
      datetime: pubDate,
      status: age <= NINETY_DAYS_MS ? "ACTIVE" : "HISTORICAL",
    });
    if (items.length >= 10) break;
  }
  return items;
}

export async function GET() {
  try {
    const results = await Promise.all(
      Object.entries(COMPANIES).map(async ([ticker, name]) => {
        try {
          const q = encodeURIComponent(
            `${name} board appointment OR former Pentagon OR retired general OR ex-secretary defense`
          );
          const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) return [ticker, []];
          const xml = await res.text();
          return [ticker, parseRssItems(xml)];
        } catch { return [ticker, []]; }
      })
    );

    const door = Object.fromEntries(results);

    return NextResponse.json(
      { door, asOf: new Date().toISOString() },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
