import { NextResponse } from "next/server";

const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
const OPENAI_MODEL = "gpt-4o-mini";

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function GET(req) {
  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;
    if (!key || key.includes("PASTE_")) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY or OPENROUTER_API_KEY" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const mode = (searchParams.get("mode") || "").toLowerCase(); // "daily"
    const symbol = (searchParams.get("symbol") || "").toUpperCase();
    const price = searchParams.get("price") || "";
    const question = (searchParams.get("question") || "").trim();
    const isDaily = mode === "daily";
    const isChat = mode === "chat";

    if (!isDaily && !isChat && !symbol) {
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

Pick ONE US stock for TODAY. Keep it simple and realistic.
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

Analyze ${symbol}. Price (if provided): ${price || "unknown"}.
Keep it beginner friendly.
Return raw JSON only. No markdown, no code fences.
`.trim();

    const chatPrompt = `
You are ASTRA, a professional equity research assistant for retail investors.
Write clear, practical answers with a calm, confident tone.

Rules:
- Keep response between 80 and 160 words.
- Avoid markdown code fences, headings symbols, and decorative formatting.
- Give direct advice framework, not hype.
- If details are uncertain, say what to verify.
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
Educational only. Not financial advice.

Context symbol: ${symbol || "none"}
Context price: ${price || "unknown"}
User question: ${question}
`.trim();

    const promptToUse = isDaily ? dailyPrompt : isChat ? chatPrompt : symbolPrompt;

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
      headers["X-Title"] = "Arthastra AI";
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
        { error: "OpenRouter error", status: resp.status, details: data },
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
      });
    }

    const parsed = safeJsonParse(raw);

    if (!parsed) {
      // fallback: still return raw so UI can show something
      return NextResponse.json({
        mode: isDaily ? "daily" : "symbol",
        model_used: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
        raw,
      });
    }

    return NextResponse.json({
      mode: isDaily ? "daily" : "symbol",
      model_used: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
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
