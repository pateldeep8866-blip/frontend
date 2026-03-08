import { NextResponse } from "next/server";

const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
const OPENAI_MODEL = "gpt-4.1-mini";

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizePayload(parsed, ticker) {
  if (!parsed || typeof parsed !== "object") {
    return {
      ticker,
      summary: "No structured deep research was returned. Review key risks and market context manually.",
      bull_case: [],
      bear_case: [],
      key_risks: [],
      financial_highlights: {},
      news_sentiment: { label: "neutral", score: 0 },
      recommendation: "HOLD",
      confidence: 55,
      sources: [],
    };
  }

  return {
    ticker: String(parsed.ticker || ticker).toUpperCase(),
    summary: String(parsed.summary || "No summary available."),
    bull_case: Array.isArray(parsed.bull_case) ? parsed.bull_case.map(String).slice(0, 6) : [],
    bear_case: Array.isArray(parsed.bear_case) ? parsed.bear_case.map(String).slice(0, 6) : [],
    key_risks: Array.isArray(parsed.key_risks) ? parsed.key_risks.map(String).slice(0, 8) : [],
    financial_highlights:
      parsed.financial_highlights && typeof parsed.financial_highlights === "object"
        ? parsed.financial_highlights
        : {},
    news_sentiment:
      parsed.news_sentiment && typeof parsed.news_sentiment === "object"
        ? {
            label: String(parsed.news_sentiment.label || "neutral"),
            score: Number.isFinite(Number(parsed.news_sentiment.score))
              ? Number(parsed.news_sentiment.score)
              : 0,
          }
        : { label: "neutral", score: 0 },
    recommendation: String(parsed.recommendation || "HOLD").toUpperCase(),
    confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 55,
    sources: Array.isArray(parsed.sources) ? parsed.sources.map(String).slice(0, 8) : [],
  };
}

export async function POST(req) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;

    if (!key || key.includes("PASTE_")) {
      return NextResponse.json(
        { error: "Missing analytical API key (set OPENAI_API_KEY or OPENROUTER_API_KEY)" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const ticker = String(body?.ticker || body?.symbol || "")
      .trim()
      .toUpperCase();
    const type = String(body?.type || "full").toLowerCase() === "quick" ? "quick" : "full";

    if (!ticker) {
      return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
    }

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
      headers["X-Title"] = "Arthastra Deep Research";
    }

    const prompt = `
Return ONLY valid JSON:
{
  "ticker": "${ticker}",
  "summary": "4-6 sentence investor summary",
  "bull_case": ["b1","b2","b3"],
  "bear_case": ["r1","r2","r3"],
  "key_risks": ["k1","k2","k3"],
  "financial_highlights": {
    "valuation": "short line",
    "growth": "short line",
    "profitability": "short line",
    "balance_sheet": "short line",
    "cash_flow": "short line"
  },
  "news_sentiment": { "label": "bullish|neutral|bearish", "score": -100 to 100 },
  "recommendation": "BUY|HOLD|AVOID",
  "confidence": 0-100,
  "sources": ["source1","source2"]
}

Analyze ${ticker} with a ${type === "quick" ? "quick, trader-oriented" : "deep, investor-oriented"} perspective.
No markdown. JSON only.
`.trim();

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: type === "quick" ? 450 : 900,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return NextResponse.json(
        {
          error: "Analytical provider error",
          status: resp.status,
          details: data,
        },
        { status: resp.status }
      );
    }

    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    const parsed = safeJsonParse(raw);
    const payload = normalizePayload(parsed, ticker);

    return NextResponse.json({
      ...payload,
      model_used: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
      raw,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Deep research server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}

