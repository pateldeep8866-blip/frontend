export const dynamic = "force-static";
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
    items.push({ headline: title, url: link, source: sourceLabel, datetime: pubDate });
    if (items.length >= 20) break;
  }
  return items;
}

function parseDefenseGov(html) {
  const items = [];
  const re = /<a\s+href="\/News\/Contracts\/Contract\/Article\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const title = m[1].replace(/<[^>]+>/g, "").trim();
    if (!title || title.length < 10) continue;
    items.push({ headline: title, url: "https://www.defense.gov/News/Contracts/", source: "DEFENSE.GOV", datetime: new Date().toISOString() });
    if (items.length >= 15) break;
  }
  return items;
}

function toEpoch(v) { const t = Date.parse(String(v || "")); return Number.isFinite(t) ? t : 0; }

function dedupe(items) {
  const seen = new Set();
  return items.filter(n => {
    const k = String(n?.headline || "").toLowerCase().slice(0, 60);
    if (!n?.headline || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

export async function GET() {
  try {
    const sources = [
      { label: "Google News", url: "https://news.google.com/rss/search?q=defense+contract+award+DOD+Pentagon+million+billion&hl=en-US&gl=US&ceid=US:en" },
      { label: "Google News", url: "https://news.google.com/rss/search?q=Lockheed+Raytheon+Northrop+Boeing+General+Dynamics+contract+military+award&hl=en-US&gl=US&ceid=US:en" },
      { label: "DEFENSE.GOV", url: "https://www.defense.gov/News/Contracts/", isHtml: true },
    ];
    const results = await Promise.all(sources.map(async (src) => {
      try {
        const res = await fetch(src.url, { cache: "no-store", headers: { "User-Agent": "Mozilla/5.0 (compatible; news-aggregator/1.0)" } });
        if (!res.ok) return [];
        if (src.isHtml) { const html = await res.text(); return parseDefenseGov(html); }
        const xml = await res.text(); return parseRssItems(xml, src.label);
      } catch { return []; }
    }));
    const merged = dedupe(results.flat()).sort((a, b) => toEpoch(b.datetime) - toEpoch(a.datetime)).slice(0, 30);
    return NextResponse.json({ contracts: merged, asOf: new Date().toISOString() }, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
