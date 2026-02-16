"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function Badge({ value }) {
  const v = (value || "").toUpperCase();
  const cls =
    v === "BUY"
      ? "bg-green-500/20 text-green-300 border-green-500/30"
      : v === "HOLD"
      ? "bg-yellow-500/20 text-yellow-300 border-yellow-500/30"
      : v === "AVOID"
      ? "bg-red-500/20 text-red-300 border-red-500/30"
      : "bg-white/10 text-white/70 border-white/10";

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs ${cls}`}>
      {v || "—"}
    </span>
  );
}

function fmt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function cleanAiText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function drawLineChart(canvas, points) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (!points?.length) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "12px system-ui";
    ctx.fillText("No chart data", 10, 20);
    return;
  }

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pad = 10;

  const xStep = (w - pad * 2) / (points.length - 1 || 1);

  const y = (val) => {
    if (max === min) return h / 2;
    const t = (val - min) / (max - min);
    return h - pad - t * (h - pad * 2);
  };

  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const gy = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // line
  ctx.strokeStyle = "rgba(59,130,246,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = pad + i * xStep;
    const py = y(p.close);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // last value label
  const last = points[points.length - 1]?.close;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "12px system-ui";
  ctx.fillText(`Last: $${last?.toFixed?.(2) ?? last}`, 10, 18);
}

function Card({ title, right, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 md:p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-semibold text-white/80">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function Home() {
  const [ticker, setTicker] = useState("");
  const [usingTicker, setUsingTicker] = useState("");

  const [result, setResult] = useState(null);
  const [company, setCompany] = useState(null);
  const [news, setNews] = useState([]);

  const [loading, setLoading] = useState(false);

  // AI
  const [analysisObj, setAnalysisObj] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [dailyObj, setDailyObj] = useState(null);
  const [dailyLoading, setDailyLoading] = useState(false);

  // Market overview
  const overviewTickers = useMemo(() => ["SPY", "QQQ", "AAPL", "NVDA", "TSLA"], []);
  const [overview, setOverview] = useState([]);

  // Watchlist
  const [watch, setWatch] = useState([]);

  // Alerts
  const [alerts, setAlerts] = useState([]);
  const [alertSymbol, setAlertSymbol] = useState("");
  const [alertPrice, setAlertPrice] = useState("");

  // Chart
  const [chartPoints, setChartPoints] = useState([]);
  const chartRef = useRef(null);

  // Load saved watchlist + alerts
  useEffect(() => {
    try {
      const w = JSON.parse(localStorage.getItem("watchlist") || "[]");
      if (Array.isArray(w)) setWatch(w);
    } catch {}
    try {
      const a = JSON.parse(localStorage.getItem("alerts") || "[]");
      if (Array.isArray(a)) setAlerts(a);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("watchlist", JSON.stringify(watch));
  }, [watch]);

  useEffect(() => {
    localStorage.setItem("alerts", JSON.stringify(alerts));
  }, [alerts]);

  // Draw chart when points change
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.width = 640;
    c.height = 180;
    drawLineChart(c, chartPoints);
  }, [chartPoints]);

  async function resolveSymbol(input) {
    const raw = input.trim();
    if (!raw) return "";
    const fallback = raw.toUpperCase();

    try {
      let res = await fetch(`/api/search?query=${encodeURIComponent(raw)}`);
      if (!res.ok) res = await fetch(`/api/search?q=${encodeURIComponent(raw)}`);
      if (!res.ok) return fallback;

      const data = await res.json();
      const sym = (data?.symbol || data?.result?.symbol || "").toUpperCase();
      return sym || fallback;
    } catch {
      return fallback;
    }
  }

  async function fetchDailyPick() {
    try {
      setDailyLoading(true);
      const res = await fetch("/api/ai?mode=daily");
      const data = await res.json().catch(() => ({}));
      setDailyObj(data);
    } catch {
      setDailyObj({ note: "Daily pick unavailable." });
    } finally {
      setDailyLoading(false);
    }
  }

  async function fetchOverview() {
    try {
      const rows = await Promise.all(
        overviewTickers.map(async (sym) => {
          const r = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return { symbol: sym, error: true };
          return {
            symbol: sym,
            price: d?.price,
            percent: d?.percentChange,
          };
        })
      );
      setOverview(rows);
    } catch {
      setOverview([]);
    }
  }

  // Initial loads
  useEffect(() => {
    fetchDailyPick();
    fetchOverview();
    const t = setInterval(fetchOverview, 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function checkAlerts(sym, currentPrice) {
    if (!alerts.length) return;
    const hits = alerts
      .filter((a) => a.symbol === sym && fmt(a.price) != null && fmt(currentPrice) != null)
      .filter((a) => Number(currentPrice) >= Number(a.price));

    if (hits.length) {
      alert(`Alert: ${sym} reached $${hits[0].price}`);
      setAlerts((prev) => prev.filter((a) => !(a.symbol === sym && Number(currentPrice) >= Number(a.price))));
    }
  }

  const searchStock = async () => {
    const raw = ticker.trim();
    if (!raw) return;

    setLoading(true);
    setCompany(null);
    setNews([]);
    setAnalysisObj(null);
    setChartPoints([]);

    setResult({ symbol: raw.toUpperCase(), price: "Loading...", info: "Resolving ticker..." });

    try {
      const sym = await resolveSymbol(raw);
      if (!sym) {
        setResult({ symbol: "—", price: "—", info: "Enter a ticker or company name." });
        setLoading(false);
        return;
      }
      setUsingTicker(sym);

      // QUOTE
      const quoteRes = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
      const quote = await quoteRes.json().catch(() => ({}));

      if (!quoteRes.ok) {
        setResult({ symbol: sym, price: "—", info: quote?.error || `Quote API failed (${quoteRes.status})` });
        setLoading(false);
        return;
      }

      const priceTxt = typeof quote.price === "number" ? `$${quote.price.toFixed(2)}` : "—";
      const changeTxt =
        typeof quote.change === "number" && typeof quote.percentChange === "number"
          ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)} (${quote.percentChange.toFixed(2)}%)`
          : "";

      setResult({
        symbol: quote.symbol || sym,
        price: priceTxt,
        change: changeTxt,
        high: quote.high,
        low: quote.low,
        open: quote.open,
        previousClose: quote.previousClose,
        info: "Live market data",
      });

      checkAlerts(sym, quote.price);

      // PROFILE
      try {
        const profileRes = await fetch(`/api/profile?symbol=${encodeURIComponent(sym)}`);
        const profileData = await profileRes.json().catch(() => ({}));
        if (profileRes.ok) setCompany(profileData);
      } catch {}

      // NEWS
      try {
        const newsRes = await fetch(`/api/news?symbol=${encodeURIComponent(sym)}`);
        const newsData = await newsRes.json().catch(() => ({}));
        const items = Array.isArray(newsData?.news) ? newsData.news : [];
        const cleaned = items.filter((n) => n?.url && typeof n.url === "string" && n.url.startsWith("http")).slice(0, 5);
        setNews(cleaned);
      } catch {}

      // HISTORY CHART
      try {
        const histRes = await fetch(`/api/history?symbol=${encodeURIComponent(sym)}`);
        const histData = await histRes.json().catch(() => ({}));
        if (histRes.ok && Array.isArray(histData?.points)) setChartPoints(histData.points);
      } catch {}

      // AI ANALYSIS
      try {
        setAnalysisLoading(true);
        const aiRes = await fetch(
          `/api/ai?symbol=${encodeURIComponent(sym)}&price=${encodeURIComponent(quote.price ?? "")}`
        );
        const aiData = await aiRes.json().catch(() => ({}));
        setAnalysisObj(aiData);
      } catch {
        setAnalysisObj({ note: "AI analysis unavailable." });
      } finally {
        setAnalysisLoading(false);
      }
    } catch {
      setResult({ symbol: "—", price: "—", info: "Network error" });
    }

    setLoading(false);
  };

  const addToWatchlist = async () => {
    const sym = (await resolveSymbol(ticker)).toUpperCase();
    if (!sym) return;
    setWatch((prev) => (prev.includes(sym) ? prev : [sym, ...prev]));
  };

  const addAlert = async () => {
    const sym = (await resolveSymbol(alertSymbol)).toUpperCase();
    const p = Number(alertPrice);
    if (!sym || !Number.isFinite(p)) return;
    setAlerts((prev) => [{ symbol: sym, price: p.toFixed(2) }, ...prev]);
    setAlertSymbol("");
    setAlertPrice("");
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-5xl px-6 py-10 md:py-14">
        {/* HEADER */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-white/80">
            <span className="h-2 w-2 rounded-full bg-blue-400" />
            Arthastra AI
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mt-4 tracking-tight">Arthastra AI</h1>
          <p className="text-white/60 mt-2">Your intelligent investing assistant</p>
        </div>

        {/* MARKET OVERVIEW */}
        <div className="mb-6">
          <Card
            title="Market Overview"
            right={
              <button
                onClick={fetchOverview}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                Refresh
              </button>
            }
          >
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {overview.map((o) => (
                <div key={o.symbol} className="rounded-xl bg-white/5 border border-white/10 p-3">
                  <div className="text-sm font-semibold">{o.symbol}</div>
                  <div className="text-xs text-white/70">
                    {fmt(o.price) != null ? `$${Number(o.price).toFixed(2)}` : "—"}
                  </div>
                  <div
                    className={`text-xs ${
                      fmt(o.percent) != null && o.percent >= 0 ? "text-green-300" : "text-red-300"
                    }`}
                  >
                    {fmt(o.percent) != null ? `${o.percent >= 0 ? "+" : ""}${Number(o.percent).toFixed(2)}%` : "—"}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* DAILY PICK + SEARCH ROW */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card
            title="Today’s AI Pick"
            right={
              <button
                onClick={fetchDailyPick}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                {dailyLoading ? "Loading..." : "Refresh"}
              </button>
            }
          >
            {dailyObj?.recommendation && (
              <div className="mb-3 flex items-center gap-2">
                <Badge value={dailyObj.recommendation} />
                <span className="text-white/80 text-sm">{dailyObj.ticker}</span>
              </div>
            )}

            <div className="text-sm text-white/90 whitespace-pre-line">
              {dailyLoading ? "Loading today’s pick..." : cleanAiText(dailyObj?.raw || dailyObj?.note) || "—"}
            </div>
          </Card>

          <Card title="Search">
            <label className="text-sm text-white/60">Search a company name or stock ticker</label>

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                placeholder='Try "Apple" or "AAPL"'
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && searchStock()}
                className="flex-1 px-4 py-3 rounded-xl bg-white text-black text-lg
                           border-2 border-white/20 outline-none
                           focus:border-blue-500 focus:ring-4 focus:ring-blue-500/30
                           placeholder:text-gray-500 shadow-lg"
              />

              <button
                onClick={searchStock}
                disabled={loading}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500
                           font-semibold shadow-lg disabled:opacity-50"
              >
                {loading ? "Loading..." : "Search"}
              </button>
            </div>

            {usingTicker && (
              <div className="text-xs text-white/50 mt-2">
                Using ticker: <span className="text-white/70">{usingTicker}</span>
              </div>
            )}
          </Card>
        </div>

        {/* WATCHLIST + ALERTS */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card title="Watchlist">
            {watch.length === 0 ? (
              <div className="text-sm text-white/60">No watchlist items yet.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {watch.map((sym) => (
                  <div
                    key={sym}
                    className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5"
                  >
                    <span className="text-sm">{sym}</span>
                    <button
                      onClick={() => setWatch((prev) => prev.filter((x) => x !== sym))}
                      className="text-white/50 hover:text-white text-xs"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4">
              <button onClick={addToWatchlist} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm">
                Add current input to watchlist
              </button>
            </div>
          </Card>

          <Card title="Price Alerts">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={alertSymbol}
                onChange={(e) => setAlertSymbol(e.target.value)}
                placeholder="Symbol (ex: AAPL)"
                className="flex-1 px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
              />
              <input
                value={alertPrice}
                onChange={(e) => setAlertPrice(e.target.value)}
                placeholder="Price (ex: 200)"
                className="w-full sm:w-40 px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
              />
              <button onClick={addAlert} className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold">
                Add
              </button>
            </div>

            {alerts.length > 0 ? (
              <div className="mt-3 space-y-2">
                {alerts.map((a, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 p-3"
                  >
                    <div className="text-sm">
                      {a.symbol} ≥ ${a.price}
                    </div>
                    <button
                      onClick={() => setAlerts((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-xs text-white/60 hover:text-white"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-white/50 mt-3">No alerts yet.</div>
            )}
          </Card>
        </div>

        {/* COMPANY */}
        {company?.name && (
          <div className="mb-6">
            <Card title="Company">
              <div className="flex items-center gap-3">
                {company.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.logo} alt={`${company.name} logo`} className="h-10 w-10 rounded bg-white p-1" />
                )}
                <div>
                  <div className="text-lg font-semibold">{company.name}</div>
                  <div className="text-sm text-white/60 mt-1">
                    {company.exchange ? `${company.exchange}` : ""} {company.finnhubIndustry ? `• ${company.finnhubIndustry}` : ""}
                  </div>
                </div>
              </div>

              {company.weburl && (
                <a
                  href={company.weburl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-3 text-sm text-blue-300 hover:underline"
                >
                  Company website
                </a>
              )}
            </Card>
          </div>
        )}

        {/* QUOTE + CHART */}
        {(result || (chartPoints?.length > 0)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {result && (
              <Card title="Quote">
                <div className="text-xl font-semibold">{result.symbol}</div>
                <div className="text-3xl font-bold mt-1">{result.price}</div>

                {result.change && (
                  <div className={`text-sm mt-1 ${result.change.startsWith("+") ? "text-green-400" : "text-red-400"}`}>
                    {result.change}
                  </div>
                )}

                <div className="mt-3 space-y-1">
                  {fmt(result.high) != null && <div className="text-white/70 text-sm">High: ${result.high}</div>}
                  {fmt(result.low) != null && <div className="text-white/70 text-sm">Low: ${result.low}</div>}
                  {fmt(result.open) != null && <div className="text-white/70 text-sm">Open: ${result.open}</div>}
                  {fmt(result.previousClose) != null && <div className="text-white/70 text-sm">Prev Close: ${result.previousClose}</div>}
                </div>

                <div className="text-white/50 text-xs pt-3">{result.info}</div>
              </Card>
            )}

            {chartPoints?.length > 0 && (
              <Card title="Price Trend (Daily)">
                <canvas ref={chartRef} className="w-full h-[180px] rounded-xl bg-black/30" />
                <div className="text-xs text-white/50 mt-2">Data source: Stooq (daily). Educational view.</div>
              </Card>
            )}
          </div>
        )}

        {/* AI ANALYSIS */}
        {(analysisLoading || analysisObj) && (
          <div className="mb-6">
            <Card title="AI Investment Analysis" right={<Badge value={analysisObj?.recommendation} />}>
              {analysisLoading ? (
                <div className="text-white/50 text-sm">Analyzing...</div>
              ) : (
                <>
                  {analysisObj?.ticker && <div className="text-sm text-white/80 mb-3">Ticker: {analysisObj.ticker}</div>}

                  {Array.isArray(analysisObj?.why) && analysisObj.why.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">Why</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {analysisObj.why.slice(0, 6).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Array.isArray(analysisObj?.risks) && analysisObj.risks.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">Risks</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {analysisObj.risks.slice(0, 3).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysisObj?.day_plan && (
                    <div className="mb-2">
                      <div className="text-xs text-white/60 mb-2">Day plan</div>
                      <div className="text-sm text-white/90">{analysisObj.day_plan}</div>
                    </div>
                  )}

                  <div className="text-xs text-white/50 mt-4 whitespace-pre-line">
                    {cleanAiText(analysisObj?.note || analysisObj?.raw)}
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {/* NEWS */}
        {news.length > 0 && (
          <div className="mb-6">
            <Card title="Latest News">
              <div className="space-y-2">
                {news.map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noreferrer" className="block text-blue-300 hover:underline text-sm">
                    • {n.headline}
                  </a>
                ))}
              </div>
            </Card>
          </div>
        )}

        <p className="text-center text-xs text-white/40 mt-8">Educational tool only. Not financial advice.</p>
      </div>
    </div>
  );
}
