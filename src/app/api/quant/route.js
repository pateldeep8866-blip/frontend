export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 500, data: { error: String(error?.message || error) } };
  }
}

function sliceTail(values, n) {
  if (!Array.isArray(values)) return [];
  if (values.length <= n) return values.slice();
  return values.slice(values.length - n);
}

function sma(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) return null;
  const tail = values.slice(values.length - period);
  const sum = tail.reduce((acc, v) => acc + v, 0);
  return sum / period;
}

function emaSeries(values, period) {
  if (!Array.isArray(values) || values.length < period || period <= 0) return [];
  const alpha = 2 / (period + 1);
  const out = [];
  let prev = values.slice(0, period).reduce((acc, v) => acc + v, 0) / period;
  out.push(prev);
  for (let i = period; i < values.length; i += 1) {
    prev = values[i] * alpha + prev * (1 - alpha);
    out.push(prev);
  }
  return out;
}

function calcRsi(values, period = 14) {
  if (!Array.isArray(values) || values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss += Math.abs(diff);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMacd(values) {
  const ema12 = emaSeries(values, 12);
  const ema26 = emaSeries(values, 26);
  if (!ema12.length || !ema26.length) return { macd: null, signal: null, hist: null };

  const offset = ema12.length - ema26.length;
  const line = [];
  for (let i = 0; i < ema26.length; i += 1) {
    line.push(ema12[i + offset] - ema26[i]);
  }
  const signalSeries = emaSeries(line, 9);
  if (!signalSeries.length) return { macd: null, signal: null, hist: null };

  const lineOffset = line.length - signalSeries.length;
  const macd = line[line.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  const hist = line[lineOffset + signalSeries.length - 1] - signal;
  return { macd, signal, hist };
}

function calcStd(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function pctMove(values, periods) {
  if (!Array.isArray(values) || values.length <= periods) return null;
  const last = values[values.length - 1];
  const prev = values[values.length - 1 - periods];
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null;
  return ((last - prev) / prev) * 100;
}

function annualizedVolatility(values) {
  if (!Array.isArray(values) || values.length < 3) return null;
  const tail = sliceTail(values, 31);
  const returns = [];
  for (let i = 1; i < tail.length; i += 1) {
    const prev = tail[i - 1];
    const cur = tail[i];
    if (prev > 0 && cur > 0) returns.push(Math.log(cur / prev));
  }
  if (returns.length < 2) return null;
  const std = calcStd(returns);
  if (std == null) return null;
  return std * Math.sqrt(252) * 100;
}

function calcAtrPercent(highs, lows, closes, period = 14) {
  if (
    !Array.isArray(highs) ||
    !Array.isArray(lows) ||
    !Array.isArray(closes) ||
    highs.length !== lows.length ||
    highs.length !== closes.length ||
    highs.length <= period
  ) {
    return null;
  }

  const tr = [];
  for (let i = 1; i < closes.length; i += 1) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
    if (![h, l, pc].every(Number.isFinite)) continue;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (tr.length < period) return null;
  const atr = tr.slice(tr.length - period).reduce((acc, v) => acc + v, 0) / period;
  const last = closes[closes.length - 1];
  if (!Number.isFinite(last) || last <= 0) return null;
  return (atr / last) * 100;
}

function toScore({ close, sma20, sma50, mom1m, mom3m, rsi, macdHist, vol, volumeRatio, peRatio }) {
  let trend = 10;
  if (close != null && sma20 != null && sma50 != null) {
    if (close > sma20 && sma20 > sma50) trend = 25;
    else if (close > sma20) trend = 18;
    else if (close > sma50) trend = 14;
    else if (close < sma20 && sma20 < sma50) trend = 4;
  }

  let momentum = 10;
  if (mom1m != null || mom3m != null) {
    const m1 = mom1m ?? 0;
    const m3 = mom3m ?? 0;
    const combined = m1 * 0.4 + m3 * 0.6;
    if (combined > 12) momentum = 20;
    else if (combined > 5) momentum = 16;
    else if (combined > 0) momentum = 12;
    else if (combined > -5) momentum = 8;
    else momentum = 3;
  }

  let rsiScore = 8;
  if (rsi != null) {
    if (rsi >= 45 && rsi <= 60) rsiScore = 15;
    else if ((rsi >= 35 && rsi < 45) || (rsi > 60 && rsi <= 70)) rsiScore = 11;
    else if (rsi > 70 || rsi < 25) rsiScore = 4;
  }

  let macdScore = 8;
  if (macdHist != null) macdScore = macdHist > 0 ? 15 : 5;

  let volScore = 5;
  if (vol != null) {
    if (vol < 18) volScore = 10;
    else if (vol < 28) volScore = 8;
    else if (vol < 40) volScore = 6;
    else volScore = 3;
  }

  let volumeScore = 2;
  if (volumeRatio != null) {
    if (volumeRatio > 1.3) volumeScore = 5;
    else if (volumeRatio > 1.05) volumeScore = 4;
    else if (volumeRatio >= 0.8) volumeScore = 3;
    else volumeScore = 1;
  }

  let valuation = 5;
  if (peRatio != null) {
    if (peRatio > 0 && peRatio < 18) valuation = 10;
    else if (peRatio < 30) valuation = 8;
    else if (peRatio < 45) valuation = 6;
    else valuation = 3;
  }

  const total = clamp(trend + momentum + rsiScore + macdScore + volScore + volumeScore + valuation, 0, 100);
  return { total, trend, momentum, rsiScore, macdScore, volScore, volumeScore, valuation };
}

function recommendationFromScore(score) {
  if (score >= 70) return "BUY";
  if (score >= 45) return "HOLD";
  return "AVOID";
}

function riskLevel({ vol, atrPct, beta }) {
  const volN = vol ?? 30;
  const atrN = atrPct ?? 3;
  const betaN = beta ?? 1.1;
  const riskComposite = volN * 0.45 + atrN * 8 + betaN * 16;
  if (riskComposite < 35) return "LOW";
  if (riskComposite < 62) return "MEDIUM";
  return "HIGH";
}

function formatHeadlines(newsPayload) {
  const rows = Array.isArray(newsPayload?.news) ? newsPayload.news : [];
  return rows
    .map((n) => String(n?.headline || "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

async function fetchMarketBundle({ origin, symbol, market }) {
  if (market === "crypto") {
    const quote = await fetchJson(`${origin}/api/crypto-quote?symbol=${encodeURIComponent(symbol)}`);
    if (!quote.ok) return { ok: false, error: quote.data?.error || "Crypto quote failed" };
    const id = String(quote.data?.id || "").trim();
    const candles = await fetchJson(
      `${origin}/api/crypto-candles?${id ? `id=${encodeURIComponent(id)}` : `symbol=${encodeURIComponent(symbol)}`}&days=320`
    );
    if (!candles.ok) return { ok: false, error: candles.data?.error || "Crypto candles failed" };
    const news = await fetchJson(`${origin}/api/crypto-market-news`);
    return {
      ok: true,
      source: ["coingecko"],
      quote: quote.data,
      candles: candles.data,
      metrics: {},
      news: news.ok ? news.data : { news: [] },
    };
  }

  if (market === "metals") {
    const quote = await fetchJson(`${origin}/api/metals-quote?symbol=${encodeURIComponent(symbol)}`);
    if (!quote.ok) return { ok: false, error: quote.data?.error || "Metals quote failed" };
    const candles = await fetchJson(`${origin}/api/metals-candles?symbol=${encodeURIComponent(symbol)}&days=320`);
    if (!candles.ok) return { ok: false, error: candles.data?.error || "Metals candles failed" };
    const news = await fetchJson(`${origin}/api/metals-market-news`);
    return {
      ok: true,
      source: ["alpha-vantage", "yahoo"],
      quote: quote.data,
      candles: candles.data,
      metrics: {},
      news: news.ok ? news.data : { news: [] },
    };
  }

  const quote = await fetchJson(`${origin}/api/quote?symbol=${encodeURIComponent(symbol)}`);
  if (!quote.ok) return { ok: false, error: quote.data?.error || "Quote fetch failed" };
  const candles = await fetchJson(`${origin}/api/candles?symbol=${encodeURIComponent(symbol)}&resolution=D&days=320`);
  if (!candles.ok) return { ok: false, error: candles.data?.error || "Candles fetch failed" };
  const [metrics, news] = await Promise.all([
    fetchJson(`${origin}/api/metrics?symbol=${encodeURIComponent(symbol)}`),
    fetchJson(`${origin}/api/news?symbol=${encodeURIComponent(symbol)}`),
  ]);
  return {
    ok: true,
    source: ["finnhub", "stooq", "yahoo"],
    quote: quote.data,
    candles: candles.data,
    metrics: metrics.ok ? metrics.data : {},
    news: news.ok ? news.data : { news: [] },
  };
}

export async function GET(req) {
  try {
    const { searchParams, origin } = new URL(req.url);
    const symbol = String(searchParams.get("symbol") || "").trim().toUpperCase();
    const market = String(searchParams.get("market") || "stock").trim().toLowerCase();

    if (!symbol) {
      return NextResponse.json({ error: "Missing symbol. Use /api/quant?symbol=AAPL&market=stock" }, { status: 400 });
    }
    if (!["stock", "crypto", "metals"].includes(market)) {
      return NextResponse.json({ error: "Unsupported market. Use stock, crypto, or metals." }, { status: 400 });
    }

    const bundle = await fetchMarketBundle({ origin, symbol, market });
    if (!bundle.ok) {
      return NextResponse.json({ error: bundle.error || "Unable to build quant analysis" }, { status: 422 });
    }

    const rawC = Array.isArray(bundle.candles?.c) ? bundle.candles.c : [];
    const rawH = Array.isArray(bundle.candles?.h) ? bundle.candles.h : [];
    const rawL = Array.isArray(bundle.candles?.l) ? bundle.candles.l : [];
    const rawV = Array.isArray(bundle.candles?.v) ? bundle.candles.v : [];

    const closes = [];
    const highs = [];
    const lows = [];
    const volumes = [];
    for (let i = 0; i < rawC.length; i += 1) {
      const c = toNum(rawC[i]);
      if (c == null) continue;
      closes.push(c);
      highs.push(toNum(rawH[i]));
      lows.push(toNum(rawL[i]));
      volumes.push(toNum(rawV[i]));
    }
    if (closes.length < 60) {
      return NextResponse.json(
        { error: `Not enough market history for quant analysis (${closes.length} rows)` },
        { status: 422 }
      );
    }

    const price = toNum(bundle.quote?.price) ?? closes[closes.length - 1];
    const sma20 = sma(closes, 20);
    const sma50 = sma(closes, 50);
    const ema20 = emaSeries(closes, 20).slice(-1)[0] ?? null;
    const rsi14 = calcRsi(closes, 14);
    const macd = calcMacd(closes);
    const bbBasis = sma20;
    const bbStd = calcStd(sliceTail(closes, 20));
    const bbUpper = bbBasis != null && bbStd != null ? bbBasis + bbStd * 2 : null;
    const bbLower = bbBasis != null && bbStd != null ? bbBasis - bbStd * 2 : null;
    const vol30 = annualizedVolatility(closes);
    const momentum1m = pctMove(closes, 21);
    const momentum3m = pctMove(closes, 63);
    const cleanVolumes = volumes.filter((v) => v != null);
    const avgVol20 = cleanVolumes.length >= 20 ? sma(cleanVolumes, 20) : null;
    const lastVol = cleanVolumes.length ? cleanVolumes[cleanVolumes.length - 1] : null;
    const volumeRatio = lastVol != null && avgVol20 != null && avgVol20 > 0 ? lastVol / avgVol20 : null;
    const atrPct = calcAtrPercent(highs, lows, closes, 14);

    const peRatio = toNum(bundle.metrics?.peRatio);
    const beta = toNum(bundle.metrics?.beta);
    const scoreBreakdown = toScore({
      close: price,
      sma20,
      sma50,
      mom1m: momentum1m,
      mom3m: momentum3m,
      rsi: rsi14,
      macdHist: macd.hist,
      vol: vol30,
      volumeRatio,
      peRatio,
    });
    const score = scoreBreakdown.total;
    const recommendation = recommendationFromScore(score);
    const confidence = Math.round(clamp(50 + Math.abs(score - 50) * 0.9, 50, 95));
    const risk = riskLevel({ vol: vol30, atrPct, beta });
    const trend =
      price != null && sma20 != null && sma50 != null
        ? price > sma20 && sma20 > sma50
          ? "UPTREND"
          : price < sma20 && sma20 < sma50
          ? "DOWNTREND"
          : "SIDEWAYS"
        : "UNKNOWN";

    const why = [
      `Trend is ${trend.toLowerCase()} with price ${price != null && sma20 != null ? (price >= sma20 ? "above" : "below") : "near"} the 20-day average.`,
      `Momentum: 1M ${momentum1m != null ? `${momentum1m.toFixed(2)}%` : "n/a"} and 3M ${momentum3m != null ? `${momentum3m.toFixed(2)}%` : "n/a"}.`,
      `RSI(14) is ${rsi14 != null ? rsi14.toFixed(1) : "n/a"} and MACD histogram is ${macd.hist != null ? macd.hist.toFixed(4) : "n/a"}.`,
      peRatio != null ? `Valuation check: P/E is ${peRatio.toFixed(2)}.` : "Valuation data unavailable for this market/symbol.",
    ];

    const risks = [
      `Volatility (30d annualized): ${vol30 != null ? `${vol30.toFixed(2)}%` : "n/a"}.`,
      `ATR risk proxy: ${atrPct != null ? `${atrPct.toFixed(2)}% of price` : "n/a"}.`,
      beta != null ? `Beta exposure: ${beta.toFixed(2)} vs broader market.` : "Beta not available for this symbol.",
    ];

    return NextResponse.json({
      market,
      symbol,
      name: bundle.quote?.name || bundle.quote?.symbol || symbol,
      price,
      recommendation,
      confidence,
      risk_level: risk,
      score,
      score_breakdown: scoreBreakdown,
      indicators: {
        sma20,
        sma50,
        ema20,
        rsi14,
        macd: macd.macd,
        macd_signal: macd.signal,
        macd_histogram: macd.hist,
        bollinger_upper: bbUpper,
        bollinger_middle: bbBasis,
        bollinger_lower: bbLower,
        volatility_30d_annualized_pct: vol30,
        atr_14_pct: atrPct,
      },
      momentum: {
        one_month_pct: momentum1m,
        three_month_pct: momentum3m,
      },
      volume: {
        latest: lastVol,
        avg_20d: avgVol20,
        relative_to_avg: volumeRatio,
      },
      valuation: {
        pe_ratio: peRatio,
        beta,
      },
      news_headlines: formatHeadlines(bundle.news),
      why,
      risks,
      methodology: [
        "Technical inputs from live candles and quotes.",
        "Composite score combines trend, momentum, RSI, MACD, volatility, volume, and valuation.",
        "Recommendation thresholds: BUY >= 70, HOLD 45-69, AVOID < 45.",
      ],
      sources: bundle.source,
      real_data: true,
      rows_analyzed: closes.length,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Quant analysis failed", details: String(error?.message || error) },
      { status: 500 }
    );
  }
}
