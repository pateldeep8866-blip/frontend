export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const symbol = searchParams.get('symbol')

  const API_KEY = "d68ih01r01qq5rjfmhqgd68ih01r01qq5rjfmhr0"

  if (!symbol) {
    return Response.json({ error: "Symbol required" }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${API_KEY}`
    )

    const data = await res.json()

    return Response.json({
      symbol: symbol.toUpperCase(),
      price: data.c,
      change: data.d,
      percentChange: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      previousClose: data.pc
    })
  } catch (error) {
    return Response.json({ error: "Failed to fetch data" }, { status: 500 })
  }
}
