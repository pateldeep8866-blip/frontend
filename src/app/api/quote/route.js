export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = (searchParams.get('symbol') || '').trim().toUpperCase()

  const API_KEY = "d68ih01r01qq5rjfmhqgd68ih01r01qq5rjfmhr0"

  if (!symbol) {
    return Response.json({ error: "Symbol required" }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${API_KEY}`,
      { cache: "no-store" }
    )

    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      return Response.json(
        { error: "Quote fetch failed", symbol, details: data },
        { status: res.status }
      )
    }

    const live = Number(data?.c)
    const prevClose = Number(data?.pc)
    const hasLive = Number.isFinite(live) && live > 0
    const hasPrev = Number.isFinite(prevClose) && prevClose > 0
    const price = hasLive ? live : hasPrev ? prevClose : null

    return Response.json({
      symbol,
      price,
      priceSource: hasLive ? "live" : hasPrev ? "previousClose" : null,
      change: data.d,
      percentChange: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc,
    })
  } catch (error) {
    return Response.json({ error: "Failed to fetch data" }, { status: 500 })
  }
}
