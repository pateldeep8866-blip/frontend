import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isInvestorAuthorizedFromCookies } from "@/app/api/_lib/investor-auth";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const meta = data?.chart?.result?.[0]?.meta || {};
  const price = toNum(meta?.regularMarketPrice ?? meta?.previousClose);
  const prevClose = toNum(meta?.previousClose);
  if (price == null) return null;
  const changePct = prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null;
  return { symbol, price, changePct, source: "yahoo" };
}

async function fetchFinnhubQuote(symbol, key) {
  if (!key) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`,
      { cache: "no-store" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const price = toNum(data?.c);
    const changePct = toNum(data?.dp);
    if (price == null) return null;
    return { symbol, price, changePct, source: "finnhub" };
  } catch {
    return null;
  }
}

async function getQuote(symbol, finnhubKey) {
  const fin = await fetchFinnhubQuote(symbol, finnhubKey);
  if (fin) return fin;
  return fetchYahooQuote(symbol);
}

async function fetchCoinGeckoBtc() {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
      { cache: "no-store" }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return null;
    const row = data?.bitcoin || {};
    const price = toNum(row?.usd);
    if (price == null) return null;
    return {
      symbol: "BTC",
      price,
      changePct: toNum(row?.usd_24h_change),
      source: "coingecko",
    };
  } catch {
    return null;
  }
}

export async function GET() {
  const jar = await cookies();
  if (!isInvestorAuthorizedFromCookies(jar)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const finnhubKey = process.env.FINNHUB_API_KEY || "";
  const [spy, qqq, nvda, msft, btc] = await Promise.all([
    getQuote("SPY", finnhubKey),
    getQuote("QQQ", finnhubKey),
    getQuote("NVDA", finnhubKey),
    getQuote("MSFT", finnhubKey),
    fetchCoinGeckoBtc(),
  ]);

  const live = [spy, qqq, nvda, msft, btc].filter(Boolean);
  const positiveCount = live.filter((x) => Number(x?.changePct) > 0).length;
  const coveragePct = Math.round((live.length / 5) * 100);
  const breadthScore = live.length ? Math.round((positiveCount / live.length) * 100) : 0;

  return NextResponse.json({
    ok: true,
    asOf: new Date().toISOString(),
    metrics: {
      coveragePct,
      breadthScore,
      positiveCount,
      trackedCount: live.length,
      providers: {
        finnhub: Boolean(finnhubKey),
        yahoo: true,
        coingecko: true,
      },
    },
    live,
  });
}

