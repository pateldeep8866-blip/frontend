import { NextResponse } from "next/server";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();
    const resolution = (searchParams.get("resolution") || "D").trim(); // D, 60, 15...
    const days = Number(searchParams.get("days") || 30);

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol" }, { status: 400 });
    }

    const API_KEY = process.env.FINNHUB_API_KEY;
    if (!API_KEY) {
      return NextResponse.json({ error: "Missing FINNHUB_API_KEY" }, { status: 500 });
    }

    const now = Math.floor(Date.now() / 1000);
    const from = now - days * 24 * 60 * 60;

    const url =
      `https://finnhub.io/api/v1/stock/candle` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&resolution=${encodeURIComponent(resolution)}` +
      `&from=${from}` +
      `&to=${now}` +
      `&token=${API_KEY}`;

    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: "Finnhub error", details: data }, { status: res.status });
    }

    if (data.s !== "ok") {
      return NextResponse.json({ error: "No candle data", raw: data }, { status: 404 });
    }

    return NextResponse.json({
      symbol,
      t: data.t,
      c: data.c,
      h: data.h,
      l: data.l,
      o: data.o,
      v: data.v,
    });
  } catch (e) {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
