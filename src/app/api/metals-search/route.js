import { NextResponse } from "next/server";
import { METALS_CATALOG } from "../_lib/alphavantage";

const METALS = METALS_CATALOG.map((m) => ({ ...m, id: m.symbol }));

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const q = String(searchParams.get("q") || searchParams.get("query") || "").trim().toLowerCase();
    if (!q) return NextResponse.json({ error: "Missing query" }, { status: 400 });

    const matches = METALS.filter((m) => {
      const s = m.symbol.toLowerCase();
      const n = m.name.toLowerCase();
      const id = m.id.toLowerCase();
      return s.includes(q) || n.includes(q) || id.includes(q);
    }).map((m) => ({
      id: m.id,
      symbol: m.symbol,
      name: m.name,
      description: m.name,
    }));

    const best = matches[0] || null;
    return NextResponse.json({
      query: q,
      best,
      symbol: best?.symbol || "",
      id: best?.id || "",
      matches,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
