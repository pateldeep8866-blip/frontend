import { NextResponse } from "next/server";

function parseRssItems(xml, sourceLabel) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1] || "";
    const title =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
        "")
        .trim();
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();
    if (!title || !link) continue;
    items.push({
      headline: title,
      url: link,
      source: sourceLabel,
      datetime: pubDate,
    });
    if (items.length >= 20) break;
  }
  return items;
}

function dedupeNews(items) {
  const seen = new Set();
  const out = [];
  for (const n of items) {
    const key = `${String(n?.headline || "").toLowerCase()}|${String(n?.url || "").toLowerCase()}`;
    if (!n?.headline || !n?.url || seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

export async function GET() {
  try {
    const sources = [
      {
        label: "Google News",
        url: "https://news.google.com/rss/search?q=global+markets+economy+inflation+central+bank+geopolitics&hl=en-US&gl=US&ceid=US:en",
      },
      {
        label: "Google News",
        url: "https://news.google.com/rss/search?q=oil+prices+bond+yields+federal+reserve+ECB+BoJ&hl=en-US&gl=US&ceid=US:en",
      },
      {
        label: "Reuters",
        url: "https://feeds.reuters.com/reuters/businessNews",
      },
      {
        label: "AP",
        url: "https://news.google.com/rss/search?q=AP+business+markets+world&hl=en-US&gl=US&ceid=US:en",
      },
    ];

    const results = await Promise.all(
      sources.map(async (src) => {
        try {
          const res = await fetch(src.url, { cache: "no-store" });
          if (!res.ok) return [];
          const xml = await res.text();
          return parseRssItems(xml, src.label);
        } catch {
          return [];
        }
      })
    );

    const merged = dedupeNews(results.flat()).slice(0, 30);
    return NextResponse.json({ news: merged });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
