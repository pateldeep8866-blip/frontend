import { NextResponse } from "next/server";

function normalizeCompanyText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|plc|sa|nv|holdings|holding|group|class|adr)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const query = (searchParams.get("query") || searchParams.get("q") || "").trim();

    if (!query) {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    const API_KEY = process.env.FINNHUB_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
    }

    const q = query.toLowerCase();
    const qNorm = normalizeCompanyText(query);
    const qUpper = query.toUpperCase();

    const aliasRules = [
      { keys: ["google", "alphabet"], symbol: "GOOGL", description: "Alphabet Inc" },
      { keys: ["facebook", "meta"], symbol: "META", description: "Meta Platforms Inc" },
      { keys: ["toyota"], symbol: "TM", description: "Toyota Motor Corp" },
      { keys: ["honda"], symbol: "HMC", description: "Honda Motor Co Ltd" },
      { keys: ["tesla"], symbol: "TSLA", description: "Tesla Inc" },
      { keys: ["microsoft"], symbol: "MSFT", description: "Microsoft Corp" },
      { keys: ["apple"], symbol: "AAPL", description: "Apple Inc" },
      { keys: ["amazon"], symbol: "AMZN", description: "Amazon.com Inc" },
      { keys: ["netflix"], symbol: "NFLX", description: "Netflix Inc" },
      { keys: ["nvidia"], symbol: "NVDA", description: "NVIDIA Corp" },
    ];

    const preferredAlias = aliasRules.find((r) => r.keys.some((k) => qNorm.includes(k) || q === k));

    const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${API_KEY}`, {
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: "Search failed", details: data }, { status: res.status });
    }

    const results = Array.isArray(data?.result) ? data.result : [];
    if (results.length === 0) {
      return NextResponse.json({ error: "No symbol found" }, { status: 404 });
    }

    const preferredAliasSymbol = preferredAlias?.symbol || "";

    const scored = results
      .map((r) => {
        const symbol = String(r?.symbol || "").toUpperCase();
        const desc = String(r?.description || "").toLowerCase();
        const descNorm = normalizeCompanyText(desc);
        const type = String(r?.type || "").toLowerCase();
        const displaySymbol = String(r?.displaySymbol || "").toUpperCase();
        const exchange = String(r?.mic || r?.exchange || "").toUpperCase();

        let score = 0;

        if (preferredAliasSymbol && (symbol === preferredAliasSymbol || displaySymbol === preferredAliasSymbol)) score += 500;

        if (symbol === qUpper) score += 120;
        if (displaySymbol === qUpper) score += 110;
        if (symbol.startsWith(qUpper)) score += 45;
        if (displaySymbol.startsWith(qUpper)) score += 40;

        if (desc === q) score += 140;
        if (desc.startsWith(q)) score += 90;
        if (desc.includes(q)) score += 55;
        if (descNorm === qNorm && qNorm) score += 120;
        if (descNorm.startsWith(qNorm) && qNorm) score += 80;
        if (descNorm.includes(qNorm) && qNorm) score += 40;

        if (type.includes("common")) score += 18;
        if (!symbol.includes(".")) score += 16;
        if (!displaySymbol.includes(".")) score += 10;
        if (/^[A-Z]{1,5}$/.test(symbol)) score += 22;
        if (exchange.includes("US")) score += 30;
        if (displaySymbol.endsWith(".T") || symbol.endsWith(".T")) score -= 45;
        if (symbol.includes(":")) score -= 20;

        return { ...r, score };
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    const symbol = preferredAliasSymbol || scored?.[0]?.symbol || "";
    if (!symbol) {
      return NextResponse.json({ error: "No symbol found" }, { status: 404 });
    }

    return NextResponse.json({
      symbol,
      query,
      best: preferredAliasSymbol
        ? { symbol: preferredAliasSymbol, description: preferredAlias?.description || query, score: 9999 }
        : scored[0],
      matches: preferredAliasSymbol
        ? [
            { symbol: preferredAliasSymbol, description: preferredAlias?.description || query, score: 9999 },
            ...scored.filter((m) => String(m?.symbol || "").toUpperCase() !== preferredAliasSymbol).slice(0, 9),
          ]
        : scored.slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
