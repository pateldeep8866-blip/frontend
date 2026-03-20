
import { NextResponse } from "next/server";

const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
const OPENAI_MODEL = "gpt-4.1-mini";
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const summaryCache = new Map();

function fromCache(country) {
  const hit = summaryCache.get(country);
  if (!hit) return "";
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    summaryCache.delete(country);
    return "";
  }
  return String(hit.value || "").trim();
}

function toCache(country, value) {
  const c = String(country || "").trim();
  const v = String(value || "").trim();
  if (!c || !v) return;
  summaryCache.set(c, { ts: Date.now(), value: v });
}

function fallbackSummary(country, relations) {
  const allies = Array.isArray(relations?.alliesPartners) ? relations.alliesPartners.slice(0, 2).map((x) => x.name).filter(Boolean) : [];
  const tensions = Array.isArray(relations?.tensionsSanctions) ? relations.tensionsSanctions.slice(0, 2).map((x) => x.name).filter(Boolean) : [];
  const conflicts = Array.isArray(relations?.activeConflicts) ? relations.activeConflicts.slice(0, 1).map((x) => x.name).filter(Boolean) : [];
  const allyText = allies.length ? allies.join(" and ") : "regional and strategic partners";
  const tensionText = tensions.length ? tensions.join(" and ") : "major strategic rivals";
  const conflictText = conflicts.length ? `Active conflict-linked exposure is tied to ${conflicts.join(" and ")}.` : "No direct active military conflict is flagged in this profile.";
  return `${country} is positioned around key partnerships with ${allyText} while balancing economic and security priorities. Its main pressure points are linked to tensions with ${tensionText}, which can influence risk premium and policy posture. ${conflictText}`;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const country = String(body?.country || "").trim();
    const relations = body?.relations && typeof body.relations === "object" ? body.relations : {};
    if (!country) return NextResponse.json({ summary: "" });

    const cached = fromCache(country);
    if (cached) return NextResponse.json({ summary: cached, cached: true });

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;
    if (!key || key.includes("PASTE_")) {
      const fallback = fallbackSummary(country, relations);
      toCache(country, fallback);
      return NextResponse.json({ summary: fallback, cached: false, provider: "fallback" });
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
      headers["X-Title"] = "Arthastra Analytical Information";
    }

    const prompt = `
In 3 sentences, summarize the current geopolitical standing of ${country} — who are their key allies, who are their main adversaries, and any active conflicts as of 2025.

Use this structured relationship context:
${JSON.stringify(relations)}

Rules:
- Exactly 3 sentences.
- Specific and investor-relevant.
- No markdown.
`.trim();

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 260,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    const raw = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!resp.ok || !raw) {
      const fallback = fallbackSummary(country, relations);
      toCache(country, fallback);
      return NextResponse.json({ summary: fallback, cached: false, provider: "fallback" });
    }

    toCache(country, raw);
    return NextResponse.json({
      summary: raw,
      cached: false,
      provider: useOpenRouter ? "openrouter" : "openai",
      model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
    });
  } catch {
    return NextResponse.json({ summary: "" });
  }
}
