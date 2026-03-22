export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const BASELINES = {
  ukraine: 9.0,
  gaza: 8.5,
  redsea: 7.5,
  sudan: 7.0,
  taiwan: 6.0,
  indopak: 5.0,
  sahel: 3.5,
};

const SEARCH_TERMS = {
  ukraine: "ukraine russia war",
  gaza: "gaza israel hamas",
  redsea: "iran red sea houthi",
  sudan: "sudan civil war",
  taiwan: "taiwan strait china",
  indopak: "india pakistan border",
  sahel: "sahel west africa instability",
};

let prevScores = {};

async function getNewsCount(query) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return 0;
    const xml = await res.text();
    const matches = xml.match(/<item>/gi);
    return Math.min(matches ? matches.length : 0, 20);
  } catch { return 0; }
}

export async function GET() {
  try {
    const entries = await Promise.all(
      Object.entries(SEARCH_TERMS).map(async ([id, term]) => {
        const newsCount = await getNewsCount(term);
        const newsScore = (newsCount / 20) * 10 * 0.4;
        const baselineScore = BASELINES[id] * 0.6;
        const total = Math.min(Math.round((newsScore + baselineScore) * 10) / 10, 10);
        return [id, total];
      })
    );

    const scores = {};
    for (const [id, total] of entries) {
      const prev = prevScores[id];
      const delta = prev !== undefined ? Math.round((total - prev) * 10) / 10 : 0;
      scores[id] = { score: total, delta };
    }

    for (const [id, total] of entries) prevScores[id] = total;

    return NextResponse.json(
      { scores, asOf: new Date().toISOString() },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
