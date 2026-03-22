export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";



function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ── Primary: Yahoo Finance batch (one request for all symbols) ────────────────
async function fetchYahooBatch(symbols) {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const rows = Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
    if (!rows.length) return null;
    return new Map(rows.map((r) => [String(r?.symbol || "").toUpperCase(), r]));
  } catch {
    return null;
  }
}

// ── Fallback: Finnhub per-symbol ──────────────────────────────────────────────
async function fetchFinnhubQuote(symbol, apiKey) {
  const res = await fetch(
    `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
    { cache: "no-store" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const price = toNum(data?.c) ?? toNum(data?.pc);
  if (!price) return null;
  return {
    price,
    change: toNum(data?.d),
    percentChange: toNum(data?.dp),
    high: toNum(data?.h),
    low: toNum(data?.l),
    volume: null,
    week52High: null,
    week52Low: null,
  };
}

async function fetchFinnhubProfile(symbol, apiKey) {
  const res = await fetch(
    `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`,
    { cache: "no-store" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.name) return {};
  return {
    name: data.name || null,
    sector: data.finnhubIndustry || null,
    marketCap: data.marketCapitalization ? Number(data.marketCapitalization) * 1e6 : null,
  };
}

async function fetchFinnhubMetrics(symbol, apiKey) {
  const res = await fetch(
    `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`,
    { cache: "no-store" }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return {};
  const m = data?.metric || {};
  return {
    peRatio: toNum(m.peTTM ?? m.peBasicExclExtraTTM),
    week52High: toNum(m["52WeekHigh"]),
    week52Low: toNum(m["52WeekLow"]),
    volume: toNum(m.averageVolume10Day ?? m.averageVolume),
  };
}

async function fetchSymbolViaFinnhub(symbol, apiKey) {
  const [quote, profile, metrics] = await Promise.all([
    fetchFinnhubQuote(symbol, apiKey),
    fetchFinnhubProfile(symbol, apiKey),
    fetchFinnhubMetrics(symbol, apiKey),
  ]);
  if (!quote?.price) return { symbol, valid: false, error: "Invalid ticker or no market data" };
  return {
    symbol,
    valid: true,
    name: profile?.name || symbol,
    price: quote.price,
    change: quote.change,
    percentChange: quote.percentChange,
    volume: metrics?.volume ?? null,
    week52High: metrics?.week52High ?? null,
    week52Low: metrics?.week52Low ?? null,
    peRatio: metrics?.peRatio ?? null,
    marketCap: profile?.marketCap ?? null,
    sector: profile?.sector || "—",
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

    const API_KEY = process.env.FINNHUB_API_KEY;

    // ── Try Yahoo Finance batch first ──────────────────────────────────────────
    const yahooMap = await fetchYahooBatch(symbols);

    let rows;

    if (yahooMap && yahooMap.size > 0) {
      // Yahoo worked — build rows from Yahoo data
      rows = symbols.map((symbol) => {
        const q = yahooMap.get(symbol);
        if (!q || toNum(q?.regularMarketPrice) == null) {
          return { symbol, valid: false, error: "Invalid ticker or no market data" };
        }
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
          peRatio: toNum(q?.trailingPE),
          marketCap: toNum(q?.marketCap),
          sector: q?.sector || "—",
        };
      });
    } else if (API_KEY) {
      // ── Fallback: Finnhub per-symbol ─────────────────────────────────────────
      rows = await Promise.all(symbols.map((s) => fetchSymbolViaFinnhub(s, API_KEY)));
    } else {
      return NextResponse.json({ error: "No data source available" }, { status: 503 });
    }

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
