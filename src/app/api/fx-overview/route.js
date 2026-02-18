import { NextResponse } from "next/server";

const FX_QUOTES = ["EUR", "GBP", "JPY", "INR", "CAD", "AUD", "CHF", "CNY", "AED", "MXN"];

async function fetchFrankfurterOverview() {
  const to = FX_QUOTES.join(",");
  const url = `https://api.frankfurter.app/latest?from=USD&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  return { rates: data?.rates || {}, asOf: data?.date || "" };
}

async function fetchOpenErApiOverview() {
  const url = "https://open.er-api.com/v6/latest/USD";
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.result !== "success") return null;
  return { rates: data?.rates || {}, asOf: String(data?.time_last_update_utc || "") };
}

export async function GET() {
  try {
    const payload = (await fetchFrankfurterOverview()) || (await fetchOpenErApiOverview());
    if (!payload) {
      return NextResponse.json({ error: "FX overview fetch failed" }, { status: 502 });
    }
    const rates = payload.rates || {};
    const rows = FX_QUOTES.map((ccy) => ({
      symbol: `USD/${ccy}`,
      name: `US Dollar to ${ccy}`,
      price: Number(rates?.[ccy]),
      percent: null,
    })).filter((x) => Number.isFinite(x.price));

    return NextResponse.json({ rows, asOf: payload.asOf || "" });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
