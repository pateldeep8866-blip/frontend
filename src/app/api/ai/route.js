import { NextResponse } from "next/server";

// PASTE YOUR OPENROUTER KEY HERE
const OPENROUTER_API_KEY = "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";
const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function GET(req) {
  try {
    if (!OPENROUTER_API_KEY || OPENROUTER_API_KEY.includes("PASTE_")) {
      return NextResponse.json(
        { error: "Paste your OpenRouter key in src/app/api/ai/route.js" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "").toLowerCase(); // "daily"
    const symbol = (searchParams.get("symbol") || "").toUpperCase();
    const price = searchParams.get("price") || "";

    if (mode !== "daily" && !symbol) {
      return NextResponse.json(
        { error: "Missing symbol. Use /api/ai?symbol=AAPL or /api/ai?mode=daily" },
        { status: 400 }
      );
    }

    const dailyPrompt = `
Return ONLY valid JSON with these keys:
{
  "ticker": "AAPL",
  "recommendation": "BUY|HOLD|AVOID",
  "why": ["bullet1","bullet2","bullet3","bullet4"],
  "risks": ["risk1","risk2"],
  "day_plan": "1-2 sentences",
  "note": "Educational only. Not financial advice."
}

Pick ONE US stock for TODAY. Keep it simple and realistic.
`.trim();

    const symbolPrompt = `
Return ONLY valid JSON with these keys:
{
  "ticker": "${symbol}",
  "recommendation": "BUY|HOLD|AVOID",
  "why": ["bullet1","bullet2","bullet3","bullet4"],
  "risks": ["risk1","risk2"],
  "day_plan": "1-2 sentences",
  "note": "Educational only. Not financial advice."
}

Analyze ${symbol}. Price (if provided): ${price || "unknown"}.
Keep it beginner friendly.
`.trim();

    const promptToUse = mode === "daily" ? dailyPrompt : symbolPrompt;

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Investment Guru AI",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: "user", content: promptToUse }],
        temperature: 0.6,
        max_tokens: 450,
      }),
    });

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return NextResponse.json(
        { error: "OpenRouter error", status: resp.status, details: data },
        { status: resp.status }
      );
    }

    const raw = data?.choices?.[0]?.message?.content?.trim() || "";
    const parsed = safeJsonParse(raw);

    if (!parsed) {
      // fallback: still return raw so UI can show something
      return NextResponse.json({
        mode: mode === "daily" ? "daily" : "symbol",
        model_used: OPENROUTER_MODEL,
        raw,
      });
    }

    return NextResponse.json({
      mode: mode === "daily" ? "daily" : "symbol",
      model_used: OPENROUTER_MODEL,
      ...parsed,
      raw,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Server error", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
