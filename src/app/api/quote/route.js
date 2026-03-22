export const dynamic = "force-dynamic";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, status: res.status, data };

  const meta = data?.chart?.result?.[0]?.meta || {};
  const price = toNum(meta?.regularMarketPrice ?? meta?.previousClose);
  const prevClose = toNum(meta?.previousClose);
  if (price == null) return { ok: false, status: 404, data: { error: "No Yahoo quote" } };

  const change = prevClose != null ? price - prevClose : null;
  const percentChange = prevClose != null && prevClose > 0 && change != null ? (change / prevClose) * 100 : null;
  return {
    ok: true,
    status: 200,
    data: {
      symbol,
      price,
      priceSource: "yahoo",
      change,
      percentChange,
      high: toNum(meta?.regularMarketDayHigh),
      low: toNum(meta?.regularMarketDayLow),
      open: toNum(meta?.regularMarketOpen),
      previousClose: prevClose,
    },
  };
}

export async function GET(request) {
  let searchParams;
  try {
    searchParams = new URL(request.url).searchParams;
  } catch {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
  const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
  const API_KEY = process.env.FINNHUB_API_KEY;

  if (!symbol) {
    return Response.json({ error: "Symbol required" }, { status: 400 });
  }

  // Try Finnhub first when configured.
  if (API_KEY) {
    try {
      const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        const live = toNum(data?.c);
        const prevClose = toNum(data?.pc);
        const hasLive = live != null && live > 0;
        const hasPrev = prevClose != null && prevClose > 0;
        const price = hasLive ? live : hasPrev ? prevClose : null;

        if (price != null) {
          return Response.json({
            symbol,
            price,
            priceSource: hasLive ? "live" : "previousClose",
            change: toNum(data?.d),
            percentChange: toNum(data?.dp),
            high: toNum(data?.h),
            low: toNum(data?.l),
            open: toNum(data?.o),
            previousClose: prevClose,
          });
        }
      }
    } catch {
      // Fall through to Yahoo.
    }
  }

  // Fallback for ETFs/mutual funds and symbols Finnhub doesn't price.
  try {
    const yahoo = await fetchYahooQuote(symbol);
    if (yahoo.ok) return Response.json(yahoo.data);
    return Response.json({ error: "Quote fetch failed", symbol, details: yahoo.data }, { status: yahoo.status || 404 });
  } catch {
    return Response.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}
