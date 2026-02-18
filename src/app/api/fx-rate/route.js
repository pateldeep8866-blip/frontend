import { NextResponse } from "next/server";

async function fetchFrankfurterRate(from, to) {
  const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return null;
  const rate = Number(data?.rates?.[to]);
  if (!Number.isFinite(rate)) return null;
  return { rate, asOf: data?.date || "" };
}

async function fetchOpenErApiRate(from, to) {
  const url = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.result !== "success") return null;
  const rate = Number(data?.rates?.[to]);
  if (!Number.isFinite(rate)) return null;
  return { rate, asOf: String(data?.time_last_update_utc || "") };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const from = String(searchParams.get("from") || "USD").trim().toUpperCase();
    const to = String(searchParams.get("to") || "EUR").trim().toUpperCase();
    const amountRaw = Number(searchParams.get("amount") || "1");
    const amount = Number.isFinite(amountRaw) && amountRaw > 0 ? amountRaw : 1;

    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      return NextResponse.json({ error: "Invalid currency code. Use 3-letter codes (USD, EUR, INR)." }, { status: 400 });
    }

    const primary = await fetchFrankfurterRate(from, to);
    const fallback = primary || (await fetchOpenErApiRate(from, to));
    if (!fallback) {
      return NextResponse.json({ error: "FX provider fetch failed" }, { status: 502 });
    }
    const rate = Number(fallback.rate);
    if (!Number.isFinite(rate)) {
      return NextResponse.json({ error: `Rate unavailable for ${from} -> ${to}` }, { status: 404 });
    }

    return NextResponse.json({
      from,
      to,
      amount,
      rate,
      converted: amount * rate,
      asOf: fallback.asOf || "",
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
