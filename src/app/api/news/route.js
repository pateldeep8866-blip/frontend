export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get("symbol") || "").trim().toUpperCase();

  if (!symbol) {
    return Response.json({ error: "Symbol required" }, { status: 400 });
  }

  const API_KEY = "d68ih01r01qq5rjfmhqgd68ih01r01qq5rjfmhr0";

  // last 7 days
  const to = new Date();
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const toStr = to.toISOString().slice(0, 10);
  const fromStr = from.toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromStr}&to=${toStr}&token=${API_KEY}`
    );

    const data = await res.json();

    const cleaned = Array.isArray(data)
      ? data.slice(0, 5).map((n) => ({
          headline: n.headline,
          source: n.source,
          url: n.url,
          datetime: n.datetime
        }))
      : [];

    return Response.json({ symbol, news: cleaned });
  } catch (e) {
    return Response.json({ error: "Failed to fetch news" }, { status: 500 });
  }
}
