export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const cache = new Map();
const TTL = 2 * 60 * 60 * 1000; // 2 hours

export async function POST(req) {
  try {
    const { conflict, company, escalationScore, dependencyScore, recentSignals = [] } = await req.json();
    if (!conflict || !company) {
      return NextResponse.json({ error: "conflict and company are required" }, { status: 400 });
    }

    const cacheKey = `${company}-${conflict}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < TTL) {
      return NextResponse.json(cached.data);
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 503 });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 120,
        system: "You are a defense sector equity analyst. Respond only in this exact format — first line: SIGNAL: BULLISH or SIGNAL: CAUTION or SIGNAL: AVOID. Second line: one sentence of reasoning under 25 words mentioning the specific conflict and company. No other text.",
        messages: [
          {
            role: "user",
            content: `Conflict: ${conflict} (escalation ${escalationScore}/10). Company: ${company} (conflict dependency ${dependencyScore}/100). Recent signals: ${recentSignals.slice(0, 3).join("; ")}. What is the investor signal?`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text().catch(() => "");
      return NextResponse.json({ error: "Claude API error", details: err }, { status: 502 });
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text || "";
    const lines = text.trim().split("\n").map((l) => l.trim()).filter(Boolean);
    const signalLine = lines.find((l) => l.startsWith("SIGNAL:")) || "SIGNAL: CAUTION";
    const signal = signalLine.replace("SIGNAL:", "").trim();
    const reasoning = lines.find((l) => !l.startsWith("SIGNAL:")) || "";

    const result = { signal, reasoning };
    cache.set(cacheKey, { data: result, ts: Date.now() });

    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "Server error", details: String(e?.message || e) }, { status: 500 });
  }
}
