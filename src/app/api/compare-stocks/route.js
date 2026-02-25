import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchYahooQuoteBatch(symbols) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  return Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
}

async function fetchYahooProfile(symbol) {
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}` +
    `?modules=assetProfile,summaryDetail,defaultKeyStatistics`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return {};
  const result = data?.quoteSummary?.result?.[0] || {};
  const asset = result?.assetProfile || {};
  const summary = result?.summaryDetail || {};
  const stats = result?.defaultKeyStatistics || {};
  return {
    sector: asset?.sector || null,
    peRatio:
      toNum(summary?.trailingPE?.raw) ??
      toNum(stats?.trailingPE?.raw) ??
      null,
  };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbols = String(searchParams.get("symbols") || "")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 10);

    if (!symbols.length) {
      return NextResponse.json({ error: "Missing symbols" }, { status: 400 });
    }

    const quoteRows = await fetchYahooQuoteBatch(symbols);
    const bySymbol = new Map(
      quoteRows
        .map((row) => [String(row?.symbol || "").toUpperCase(), row])
        .filter(([k]) => k)
    );

    const profileRows = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          return [symbol, await fetchYahooProfile(symbol)];
        } catch {
          return [symbol, {}];
        }
      })
    );
    const profileBySymbol = new Map(profileRows);

    const rows = symbols.map((symbol) => {
      const q = bySymbol.get(symbol);
      const p = profileBySymbol.get(symbol) || {};
      if (!q || toNum(q?.regularMarketPrice) == null) {
        return {
          symbol,
          valid: false,
          error: "Invalid ticker or no market data",
        };
      }

      const peRatio =
        toNum(q?.trailingPE) ??
        toNum(p?.peRatio) ??
        null;

      return {
        symbol,
        valid: true,
        name: q?.longName || q?.shortName || symbol,
        price: toNum(q?.regularMarketPrice),
        change: toNum(q?.regularMarketChange),
        percentChange: toNum(q?.regularMarketChangePercent),
        volume: toNum(q?.regularMarketVolume),
        week52High: toNum(q?.fiftyTwoWeekHigh),
        week52Low: toNum(q?.fiftyTwoWeekLow),
        peRatio,
        marketCap: toNum(q?.marketCap),
        sector: p?.sector || "—",
      };
    });

    return NextResponse.json(
      {
        rows,
        invalid: rows.filter((r) => !r.valid).map((r) => ({ symbol: r.symbol, error: r.error })),
        asOf: new Date().toISOString(),
      },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to fetch comparison data", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
