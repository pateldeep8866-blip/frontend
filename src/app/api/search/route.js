export const dynamic = "force-dynamic";

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
      { keys: ["wmt", "walmart", "wlamart"], symbol: "WMT", description: "Walmart Inc" },
      { keys: ["netflix"], symbol: "NFLX", description: "Netflix Inc" },
      { keys: ["nvidia"], symbol: "NVDA", description: "NVIDIA Corp" },
      { keys: ["brkb", "brk b", "berkshire b", "berkshire hathaway b"], symbol: "BRK.B", description: "Berkshire Hathaway Inc Class B" },
      // ETFs
      { keys: ["spy", "s&p 500 etf", "spdr s&p 500"], symbol: "SPY", description: "SPDR S&P 500 ETF" },
      { keys: ["voo", "vanguard s&p 500"], symbol: "VOO", description: "Vanguard S&P 500 ETF" },
      { keys: ["vti", "vanguard total stock market"], symbol: "VTI", description: "Vanguard Total Stock Market ETF" },
      { keys: ["qqq", "nasdaq 100 etf", "invesco qqq"], symbol: "QQQ", description: "Invesco QQQ Trust" },
      { keys: ["dia", "dow etf", "dow jones etf"], symbol: "DIA", description: "SPDR Dow Jones Industrial Average ETF" },
      { keys: ["iwm", "russell 2000 etf"], symbol: "IWM", description: "iShares Russell 2000 ETF" },
      // Mutual funds / index funds
      { keys: ["fxaix", "fidelity 500 index fund"], symbol: "FXAIX", description: "Fidelity 500 Index Fund" },
      { keys: ["vtsax", "vanguard total stock market index fund"], symbol: "VTSAX", description: "Vanguard Total Stock Market Index Fund" },
      { keys: ["vfiax", "vanguard 500 index fund"], symbol: "VFIAX", description: "Vanguard 500 Index Fund Admiral Shares" },
      // Bonds / bond ETFs
      { keys: ["bond", "total bond", "vanguard total bond", "bnd"], symbol: "BND", description: "Vanguard Total Bond Market ETF" },
      { keys: ["agg", "aggregate bond", "ishares core us aggregate"], symbol: "AGG", description: "iShares Core U.S. Aggregate Bond ETF" },
      { keys: ["tlt", "20 year treasury", "long treasury"], symbol: "TLT", description: "iShares 20+ Year Treasury Bond ETF" },
      { keys: ["ief", "7 10 year treasury"], symbol: "IEF", description: "iShares 7-10 Year Treasury Bond ETF" },
      { keys: ["shy", "1 3 year treasury", "short treasury"], symbol: "SHY", description: "iShares 1-3 Year Treasury Bond ETF" },
      { keys: ["tip", "tips", "inflation protected bond"], symbol: "TIP", description: "iShares TIPS Bond ETF" },
      { keys: ["lqd", "investment grade corporate bond"], symbol: "LQD", description: "iShares iBoxx $ Investment Grade Corporate Bond ETF" },
      { keys: ["hyg", "high yield bond", "junk bond"], symbol: "HYG", description: "iShares iBoxx $ High Yield Corporate Bond ETF" },
      { keys: ["govt", "us treasury bond etf"], symbol: "GOVT", description: "iShares U.S. Treasury Bond ETF" },
      { keys: ["sphy", "high yield corporate bond etf", "spdr portfolio high yield bond"], symbol: "SPHY", description: "SPDR Portfolio High Yield Bond ETF" },
      { keys: ["bsv", "short term bond etf", "vanguard short term bond"], symbol: "BSV", description: "Vanguard Short-Term Bond ETF" },
      { keys: ["biv", "intermediate term bond etf", "vanguard intermediate bond"], symbol: "BIV", description: "Vanguard Intermediate-Term Bond ETF" },
      { keys: ["vgit", "intermediate treasury", "vanguard intermediate treasury"], symbol: "VGIT", description: "Vanguard Intermediate-Term Treasury ETF" },
      { keys: ["vgsh", "short treasury", "vanguard short treasury"], symbol: "VGSH", description: "Vanguard Short-Term Treasury ETF" },
      { keys: ["schz", "schwab aggregate bond"], symbol: "SCHZ", description: "Schwab U.S. Aggregate Bond ETF" },
      { keys: ["fxnax", "fidelity us bond index fund"], symbol: "FXNAX", description: "Fidelity U.S. Bond Index Fund" },
      { keys: ["fipdx", "fidelity inflation protected bond"], symbol: "FIPDX", description: "Fidelity Inflation-Protected Bond Index Fund" },
      { keys: ["treasury", "us treasury", "government bond"], symbol: "GOVT", description: "iShares U.S. Treasury Bond ETF" },
    ];

    const preferredAlias = aliasRules.find((r) => r.keys.some((k) => qNorm.includes(k) || q === k));

    let results = [];
    if (API_KEY) {
      const res = await fetch(`https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${API_KEY}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json({ error: "Search failed", details: data }, { status: res.status });
      }
      results = Array.isArray(data?.result) ? data.result : [];
    }
    if (results.length === 0 && !preferredAlias) {
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
        const symbolBase = symbol.split(/[.:]/)[0];
        const displayBase = displaySymbol.split(/[.:]/)[0];
        const isEtf = type.includes("etf");
        const isFund = type.includes("fund") || type.includes("mutual");
        const descHasFundWord = /\b(etf|fund|index fund|mutual)\b/.test(desc);

        let score = 0;

        if (preferredAliasSymbol && (symbol === preferredAliasSymbol || displaySymbol === preferredAliasSymbol)) score += 500;

        if (symbol === qUpper) score += 120;
        if (displaySymbol === qUpper) score += 110;
        if (symbolBase === qUpper && symbol !== qUpper) score -= 25;
        if (displayBase === qUpper && displaySymbol !== qUpper) score -= 20;
        if (symbol.startsWith(qUpper)) score += 45;
        if (displaySymbol.startsWith(qUpper)) score += 40;

        if (desc === q) score += 140;
        if (desc.startsWith(q)) score += 90;
        if (desc.includes(q)) score += 55;
        if (descNorm === qNorm && qNorm) score += 120;
        if (descNorm.startsWith(qNorm) && qNorm) score += 80;
        if (descNorm.includes(qNorm) && qNorm) score += 40;

        if (type.includes("common")) score += 18;
        if (isEtf) score += 26;
        if (isFund) score += 24;
        if (descHasFundWord) score += 14;
        if (!symbol.includes(".")) score += 16;
        if (!displaySymbol.includes(".")) score += 10;
        if (/^[A-Z]{1,6}X?$/.test(symbol)) score += 22;
        if (exchange.includes("US")) score += 30;
        if (displaySymbol.endsWith(".T") || symbol.endsWith(".T")) score -= 45;
        if (!qUpper.includes(".") && (symbol.includes(".") || displaySymbol.includes("."))) score -= 30;
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
