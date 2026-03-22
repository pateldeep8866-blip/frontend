export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

function parseRssItems(xml, sourceLabel) {
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
    if (!title || !link) continue;
    items.push({ headline: title, url: link, source: sourceLabel, datetime: pubDate });
    if (items.length >= 20) break;
  }
  return items;
}

function tagItem(item) {
  const h = item.headline.toLowerCase();

  const companies = [];
  if (h.includes("lockheed") || h.includes(" lmt") || h.includes("f-35")) companies.push("LMT");
  if (h.includes("raytheon") || h.includes(" rtx") || h.includes("patriot")) companies.push("RTX");
  if (h.includes("northrop") || h.includes(" noc") || h.includes("b-21")) companies.push("NOC");
  if (h.includes("general dynamics") || h.includes(" gd ")) companies.push("GD");
  if (h.includes("boeing") || h.includes(" ba ")) companies.push("BA");
  if (h.includes("palantir") || h.includes(" pltr")) companies.push("PLTR");

  let type = "CONTRACT_AWARD";
  if (h.includes("budget") || h.includes("appropriation") || h.includes("supplemental")) type = "BUDGET_REQUEST";
  else if (h.includes("markup") || h.includes("authorization") || h.includes("ndaa")) type = "MARKUP";
  else if (h.includes("escalat") || h.includes("troops") || h.includes("deploy")) type = "ESCALATION";

  let direction = "NEUTRAL";
  if (type === "BUDGET_REQUEST" || type === "MARKUP") direction = "BULLISH";
  else if (type === "ESCALATION") direction = "WATCH";

  return { ...item, companies, type, direction };
}

function toEpoch(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function dedupe(items) {
  const seen = new Set();
  return items.filter((n) => {
    const key = String(n?.headline || "").toLowerCase();
    if (!n?.headline || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function GET() {
  try {
    const sources = [
      { label: "Google News", url: "https://news.google.com/rss/search?q=NDAA+markup+defense+appropriations&hl=en-US&gl=US&ceid=US:en" },
      { label: "Google News", url: "https://news.google.com/rss/search?q=Pentagon+supplemental+budget+request+billion&hl=en-US&gl=US&ceid=US:en" },
      { label: "Google News", url: "https://news.google.com/rss/search?q=defense+contract+award+pre-award+solicitation&hl=en-US&gl=US&ceid=US:en" },
    ];

    const results = await Promise.all(
      sources.map(async (src) => {
        try {
          const res = await fetch(src.url, { cache: "no-store" });
          if (!res.ok) return [];
          const xml = await res.text();
          return parseRssItems(xml, src.label);
        } catch { return []; }
      })
    );

    const signals = dedupe(results.flat())
      .map(tagItem)
      .sort((a, b) => toEpoch(b.datetime) - toEpoch(a.datetime))
      .slice(0, 40);

    return NextResponse.json(
      { signals, asOf: new Date().toISOString() },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
