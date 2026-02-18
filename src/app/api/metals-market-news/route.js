import { NextResponse } from "next/server";

function parseRssItems(xml) {
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
    if (title && link) items.push({ headline: title, url: link });
    if (items.length >= 12) break;
  }
  return items;
}

export async function GET() {
  try {
    const sources = [
      "https://news.google.com/rss/search?q=precious+metals+gold+silver+platinum+palladium&hl=en-US&gl=US&ceid=US:en",
      "https://www.mining.com/feed/",
    ];

    for (const src of sources) {
      const res = await fetch(src, { cache: "no-store" });
      if (!res.ok) continue;
      const xml = await res.text();
      const news = parseRssItems(xml);
      if (news.length) return NextResponse.json({ news });
    }

    return NextResponse.json({ news: [] });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
