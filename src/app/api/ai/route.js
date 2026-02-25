import { NextResponse } from "next/server";

const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
const OPENAI_MODEL = "gpt-4.1-mini";
const QUESTION_TICKER_STOPWORDS = new Set([
  "WHY", "WHAT", "WHEN", "WHERE", "HOW", "IS", "ARE", "WAS", "WERE", "DO", "DOES", "DID",
  "THE", "A", "AN", "AND", "OR", "BUT", "TODAY", "DOWN", "UP", "STOCK", "PRICE", "MARKET",
  "NEWS", "THIS", "THAT", "WITH", "FROM", "FOR", "ABOUT", "PLEASE", "HELP", "CAN", "COULD",
]);

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatMoney(value) {
  const n = toNum(value);
  return n == null ? "N/A" : `$${n.toFixed(2)}`;
}

function formatPct(value) {
  const n = toNum(value);
  if (n == null) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function average(nums) {
  const vals = nums.map((x) => toNum(x)).filter((x) => x != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function parseRssHeadlines(xml) {
  const out = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1] || "";
    const headline =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
        "")
        .trim();
    const url = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();
    if (!headline || !url) continue;
    out.push({ headline, url, source: "Google News", datetime: pubDate });
    if (out.length >= 5) break;
  }
  return out;
}

function extractTickerFromQuestion(question) {
  const raw = String(question || "");
  if (!raw) return "";
  const dollar = raw.match(/\$([A-Za-z]{1,5})\b/);
  if (dollar?.[1]) return dollar[1].toUpperCase();
  const candidates = raw
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => /^[A-Z]{1,5}$/.test(token))
    .filter((token) => !QUESTION_TICKER_STOPWORDS.has(token));
  return candidates[0] || "";
}

async function fetchLiveQuoteWithVolume(symbol, finnhubKey) {
  const out = {
    symbol,
    price: null,
    percentChange: null,
    change: null,
    todayVolume: null,
    avgVolume20d: null,
    volumeVsAveragePct: null,
    source: "",
  };

  try {
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
    const yahooRes = await fetch(yahooUrl, { cache: "no-store" });
    const yahooData = await yahooRes.json().catch(() => ({}));
    const result = yahooData?.chart?.result?.[0];
    const meta = result?.meta || {};
    const volumes = Array.isArray(result?.indicators?.quote?.[0]?.volume) ? result.indicators.quote[0].volume : [];

    const price = toNum(meta?.regularMarketPrice ?? meta?.previousClose);
    const prevClose = toNum(meta?.previousClose);
    const change = price != null && prevClose != null ? price - prevClose : null;
    const percentChange = change != null && prevClose && prevClose > 0 ? (change / prevClose) * 100 : null;

    const cleanVols = volumes.map((v) => toNum(v)).filter((v) => v != null);
    const todayVolume = cleanVols.length ? cleanVols[cleanVols.length - 1] : null;
    const hist = cleanVols.length > 1 ? cleanVols.slice(0, -1).slice(-20) : [];
    const avgVolume20d = average(hist);
    const volumeVsAveragePct =
      todayVolume != null && avgVolume20d != null && avgVolume20d > 0
        ? ((todayVolume - avgVolume20d) / avgVolume20d) * 100
        : null;

    if (price != null) {
      out.price = price;
      out.percentChange = percentChange;
      out.change = change;
      out.todayVolume = todayVolume;
      out.avgVolume20d = avgVolume20d;
      out.volumeVsAveragePct = volumeVsAveragePct;
      out.source = "yahoo";
    }
  } catch {
    // continue with fallback
  }

  if (out.price != null || !finnhubKey) return out;

  try {
    const finnhubRes = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`,
      { cache: "no-store" }
    );
    const finnhubData = await finnhubRes.json().catch(() => ({}));
    const live = toNum(finnhubData?.c);
    const prev = toNum(finnhubData?.pc);
    if (live != null) {
      out.price = live;
      out.change = toNum(finnhubData?.d);
      out.percentChange = toNum(finnhubData?.dp) ?? (prev && prev > 0 ? ((live - prev) / prev) * 100 : null);
      out.source = "finnhub";
    }
  } catch {
    // noop
  }

  return out;
}

async function fetchTickerHeadlines(symbol, finnhubKey) {
  if (!symbol) return [];

  if (finnhubKey) {
    try {
      const today = new Date();
      const from = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      const toStr = today.toISOString().slice(0, 10);
      const fromStr = from.toISOString().slice(0, 10);
      const url =
        `https://finnhub.io/api/v1/company-news` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&from=${fromStr}&to=${toStr}&token=${finnhubKey}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => []);
      const news = Array.isArray(data)
        ? data
            .map((n) => ({
              headline: String(n?.headline || "").trim(),
              source: String(n?.source || "Finnhub"),
              url: String(n?.url || "").trim(),
              datetime: n?.datetime || null,
            }))
            .filter((n) => n.headline && n.url)
            .slice(0, 5)
        : [];
      if (news.length) return news;
    } catch {
      // fallback below
    }
  }

  try {
    const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(symbol + " stock")}&hl=en-US&gl=US&ceid=US:en`;
    const rssRes = await fetch(rssUrl, { cache: "no-store" });
    const xml = await rssRes.text();
    return parseRssHeadlines(xml);
  } catch {
    return [];
  }
}

function buildLiveContextBlock(liveQuote, headlines) {
  if (!liveQuote?.symbol) return "";
  const newsLines = headlines.length
    ? headlines.map((h, idx) => `${idx + 1}. ${h.headline} (${h.source || "Source"})`).join("\n")
    : "No fresh ticker headlines were retrieved.";
  const volumeLine =
    liveQuote.todayVolume != null && liveQuote.avgVolume20d != null
      ? `${Math.round(liveQuote.todayVolume).toLocaleString()} today vs ${Math.round(liveQuote.avgVolume20d).toLocaleString()} 20d avg (${formatPct(liveQuote.volumeVsAveragePct)} vs avg)`
      : "Volume comparison unavailable";
  return `
Live Market Context (must use this, do not ignore):
- Symbol: ${liveQuote.symbol}
- Price now: ${formatMoney(liveQuote.price)}
- Change today: ${formatPct(liveQuote.percentChange)}
- Volume now vs 20d average: ${volumeLine}
- Data source: ${liveQuote.source || "unknown"}
- Today's headlines:
${newsLines}
`.trim();
}

export async function GET(req) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;
    if (!key || key.includes("PASTE_")) {
      return NextResponse.json(
        { error: "Missing analytical API key (set OPENAI_API_KEY, or OPENROUTER_API_KEY)" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "").toLowerCase(); // "daily"
    const market = (searchParams.get("market") || "stock").toLowerCase();
    const question = (searchParams.get("question") || "").trim();
    const symbolFromQuery = (searchParams.get("symbol") || "").toUpperCase();
    const symbol = symbolFromQuery || extractTickerFromQuestion(question);
    const price = searchParams.get("price") || "";
    const isDaily = mode === "daily";
    const isDayTrader = mode === "day_trader";
    const isChat = mode === "chat";
    const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
    const marketPickLabel =
      market === "crypto" ? "major cryptocurrency" : market === "metals" ? "precious metal asset" : "US stock";
    const assistantDomainLabel =
      market === "crypto"
        ? "multi-asset (crypto, stocks, metals, FX, macro news)"
        : market === "metals"
          ? "multi-asset (crypto, stocks, metals, FX, macro news)"
          : market === "fx"
            ? "multi-asset (crypto, stocks, metals, FX, macro news)"
            : market === "news"
              ? "multi-asset (crypto, stocks, metals, FX, macro news)"
              : "multi-asset (crypto, stocks, metals, FX, macro news)";

    if (!isDaily && !isDayTrader && !isChat && !symbol) {
      return NextResponse.json(
        { error: "Missing symbol. Use /api/ai?symbol=AAPL or /api/ai?mode=daily" },
        { status: 400 }
      );
    }

    if (isChat && !question) {
      return NextResponse.json(
        { error: "Missing question. Use /api/ai?mode=chat&question=your%20question" },
        { status: 400 }
      );
    }

    const dailyPrompt = `
Return ONLY valid JSON with these keys:
{
  "ticker": "AAPL",
  "recommendation": "BUY|HOLD|AVOID",
  "ai_score": 0-100,
  "confidence": 0-100,
  "bull_probability": 0-100,
  "bear_probability": 0-100,
  "horizon": "SHORT_TERM|LONG_TERM",
  "risk_level": "LOW|MEDIUM|HIGH",
  "risk_explanation": "1-2 sentences",
  "short_summary": "1 concise sentence",
  "long_summary": "3-5 concise sentences",
  "reasoning_categories": {
    "fundamental": 0-100,
    "technical": 0-100,
    "sentiment": 0-100
  },
  "strengths": ["s1","s2","s3"],
  "outlook": "1-2 sentences",
  "why": ["bullet1","bullet2","bullet3","bullet4"],
  "risks": ["risk1","risk2"],
  "day_plan": "1-2 sentences",
  "note": "Educational only. Not financial advice."
}

Pick ONE ${marketPickLabel} for TODAY. Keep it simple and realistic.
Return raw JSON only. No markdown, no code fences.
`.trim();

    const symbolPrompt = `
Return ONLY valid JSON with these keys:
{
  "ticker": "${symbol}",
  "recommendation": "BUY|HOLD|AVOID",
  "ai_score": 0-100,
  "confidence": 0-100,
  "bull_probability": 0-100,
  "bear_probability": 0-100,
  "horizon": "SHORT_TERM|LONG_TERM",
  "risk_level": "LOW|MEDIUM|HIGH",
  "risk_explanation": "1-2 sentences",
  "short_summary": "1 concise sentence",
  "long_summary": "3-5 concise sentences",
  "reasoning_categories": {
    "fundamental": 0-100,
    "technical": 0-100,
    "sentiment": 0-100
  },
  "strengths": ["s1","s2","s3"],
  "outlook": "1-2 sentences",
  "why": ["bullet1","bullet2","bullet3","bullet4"],
  "risks": ["risk1","risk2"],
  "day_plan": "1-2 sentences",
  "note": "Educational only. Not financial advice."
}

Analyze ${symbol} in the ${market} market. Price (if provided): ${price || "unknown"}.
Keep it beginner friendly.
Return raw JSON only. No markdown, no code fences.
`.trim();

    const dayTraderPrompt = `
Return ONLY valid JSON with these keys:
{
  "ticker": "AAPL",
  "recommendation": "BUY|HOLD|AVOID",
  "ai_score": 0-100,
  "confidence": 0-100,
  "bull_probability": 0-100,
  "bear_probability": 0-100,
  "horizon": "SHORT_TERM",
  "risk_level": "LOW|MEDIUM|HIGH",
  "risk_explanation": "1-2 sentences",
  "short_summary": "1 concise sentence",
  "long_summary": "3-5 concise sentences",
  "reasoning_categories": {
    "fundamental": 0-100,
    "technical": 0-100,
    "sentiment": 0-100
  },
  "strengths": ["s1","s2","s3"],
  "outlook": "1-2 sentences",
  "why": ["bullet1","bullet2","bullet3","bullet4"],
  "risks": ["risk1","risk2"],
  "day_plan": "Intraday setup with entry idea, invalidation, and session timing.",
  "note": "Informational only. Not financial advice."
}

Generate one realistic ${marketPickLabel} day-trading setup for TODAY in the ${market} market.
Focus on intraday risk control and clear invalidation.
Return raw JSON only. No markdown, no code fences.
`.trim();

    const shouldFetchLiveContext = Boolean(symbol) && !isDaily && !isDayTrader && market !== "crypto" && market !== "metals" && market !== "fx";
    const [liveQuote, tickerHeadlines] = shouldFetchLiveContext
      ? await Promise.all([
          fetchLiveQuoteWithVolume(symbol, FINNHUB_API_KEY),
          fetchTickerHeadlines(symbol, FINNHUB_API_KEY),
        ])
      : [{ symbol, price: toNum(price), percentChange: null, todayVolume: null, avgVolume20d: null, volumeVsAveragePct: null, source: "" }, []];
    const liveContext = buildLiveContextBlock(liveQuote, tickerHeadlines);

    const chatPrompt = `
You are ASTRA, a professional ${assistantDomainLabel} research assistant for retail investors.
Write clear, practical answers with a calm, confident tone.

Rules:
- Keep response between 80 and 160 words.
- Avoid markdown code fences, headings symbols, and decorative formatting.
- Give direct advice framework, not hype.
- If details are uncertain, say what to verify.
- Ground the answer in Live Market Context data below.
- Include the exact current price and % move from context.
- Cite at least one specific headline as likely driver when available.
- Use this structure exactly:
Summary: <1-2 lines>
Key Points:
- <point 1>
- <point 2>
- <point 3>
Risks:
- <risk 1>
- <risk 2>
Next Step: <one actionable next step>

The user can ask about ANY market regardless of current tab.
Use tab context only as a hint, not a restriction.
Context tab: ${market}
Context symbol: ${symbol || "none"}
Context price: ${price || "unknown"}
${liveContext || "Live Market Context unavailable for this request."}
User question: ${question}
`.trim();

    const groundedSymbolPrompt =
      !isChat && !isDaily && !isDayTrader
        ? `${symbolPrompt}\n\n${liveContext}\n\nUse the live context above to avoid generic statements. Reference concrete numbers and one headline driver when available.`
        : symbolPrompt;
    const promptToUse = isDaily ? dailyPrompt : isDayTrader ? dayTraderPrompt : isChat ? chatPrompt : groundedSymbolPrompt;

    const useOpenRouter = key.startsWith("sk-or-");
    const url = useOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";

    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };

    if (useOpenRouter) {
      headers["HTTP-Referer"] = "http://localhost:3000";
      headers["X-Title"] = "Arthastra Analytical Information";
    }

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
        messages: [{ role: "user", content: promptToUse }],
        temperature: 0.35,
        max_tokens: 700,
      }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return NextResponse.json(
        {
          error: "Analytical provider error",
          status: resp.status,
          provider: useOpenRouter ? "openrouter" : "openai",
          model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
          details: data,
        },
        { status: resp.status }
      );
    }

    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    if (isChat) {
      return NextResponse.json({
        mode: "chat",
        model_used: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
        answer: raw,
        raw,
        live_context: liveContext ? { quote: liveQuote, headlines: tickerHeadlines } : null,
      });
    }

    const parsed = safeJsonParse(raw);

    if (!parsed) {
      // fallback: still return raw so UI can show something
      return NextResponse.json({
        mode: isDaily ? "daily" : isDayTrader ? "day_trader" : "symbol",
        model_used: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
        raw,
      });
    }

    return NextResponse.json({
      mode: isDaily ? "daily" : isDayTrader ? "day_trader" : "symbol",
      model_used: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
      ...parsed,
      raw,
      live_context: liveContext ? { quote: liveQuote, headlines: tickerHeadlines } : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
