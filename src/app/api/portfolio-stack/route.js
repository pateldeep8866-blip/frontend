export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const cache = new Map();
const TTL = 60 * 60 * 1000; // 1 hour

export async function POST(req) {
  try {
    const { conflicts = [], companies = [] } = await req.json();

    const cacheKey = JSON.stringify({
      conflicts: conflicts.map((c) => c.id).sort(),
      companies: companies.map((c) => c.ticker).sort(),
    });
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TTL) {
      return NextResponse.json(cached.data);
    }

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;
    if (!key || key.includes("PASTE_")) {
      return NextResponse.json({ error: "Missing API key" }, { status: 503 });
    }

    const useOpenRouter = key.startsWith("sk-or-");
    const url = useOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions";
    const model = useOpenRouter ? "mistralai/mistral-7b-instruct" : "gpt-4o";

    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (useOpenRouter) {
      headers["HTTP-Referer"] = "http://localhost:3000";
      headers["X-Title"] = "Arthastra War Room";
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 200,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              'You are a defense sector portfolio strategist. Respond ONLY in this exact JSON format with no other text: {"add":["LMT","RTX"],"hold":["NOC"],"watch":["PLTR"],"avoid":["BA"],"etf":"XAR over ITA","reasoning":"one sentence under 30 words"}',
          },
          {
            role: "user",
            content: `Current theater escalation data: ${JSON.stringify(conflicts)}. Company data: ${JSON.stringify(companies)}. Today is ${new Date().toISOString().split("T")[0]}. Generate portfolio positioning.`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      return NextResponse.json({ error: "AI API error", details: err }, { status: 502 });
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || "";

    let parsed = null;
    try {
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch { parsed = null; }
      }
    }

    if (!parsed) {
      return NextResponse.json({ error: "Parse error", raw }, { status: 502 });
    }

    const result = { ...parsed, asOf: new Date().toISOString() };
    cache.set(cacheKey, { data: result, ts: Date.now() });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
