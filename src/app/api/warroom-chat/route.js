export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const {
      messages = [],
      conflictData,
      escalationScores,
      currentConflict,
      signalsCount = 0,
    } = await req.json();

    if (!messages.length) {
      return NextResponse.json({ error: "messages required" }, { status: 400 });
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
    const model = useOpenRouter ? "mistralai/mistral-7b-instruct" : "gpt-4.1-mini";

    const headers = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (useOpenRouter) {
      headers["HTTP-Referer"] = "http://localhost:3000";
      headers["X-Title"] = "Arthastra War Room";
    }

    const conflictJson = conflictData
      ? JSON.stringify({ name: conflictData.name, tags: conflictData.tags, companies: conflictData.companies }).slice(0, 800)
      : "{}";
    const scoresJson = escalationScores ? JSON.stringify(escalationScores).slice(0, 400) : "{}";

    const systemPrompt = `You are ASTRA, an intelligence analyst embedded in the ARTHASTRA War Room. You have access to current conflict data and defense sector intelligence. You can answer questions about active conflicts, explain what signals mean for specific defense stocks, generate portfolio positioning rationale, and search for the latest defense news.

Current active conflict: ${currentConflict || "ukraine"}.
Active conflict data: ${conflictJson}.
Current escalation scores (1-10): ${scoresJson}.
Active pre-award signals in feed: ${signalsCount}.

Always be direct and specific. Format stock tickers in caps. Keep responses under 150 words unless asked for detail. No markdown code fences. Use plain dashes for lists.`;

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-10),
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      return NextResponse.json({ error: "AI API error", details: err }, { status: 502 });
    }

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content?.trim() || "";
    return NextResponse.json({ answer });
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
