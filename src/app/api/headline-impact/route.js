import { NextResponse } from "next/server";

const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
const OPENAI_MODEL = "gpt-4.1-mini";
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const impactCache = new Map();

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanModelText(value) {
  return String(value || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseExplanations(raw) {
  const cleaned = cleanModelText(raw);
  if (!cleaned) return [];
  const parsed = safeJsonParse(cleaned);
  if (Array.isArray(parsed?.explanations)) return parsed.explanations;
  if (Array.isArray(parsed)) return parsed;
  return [];
}

function fallbackExplanation(headline) {
  const h = String(headline || "").trim();
  const t = h.toLowerCase();
  if (!h) return "This update may influence near-term investor sentiment and positioning.";
  if (/(fed|ecb|boj|rate|inflation|cpi|jobs|payroll)/.test(t)) {
    return "This macro headline matters because rate and growth expectations can quickly reprice equities, bonds, and the dollar.";
  }
  if (/(earnings|revenue|guidance|profit|forecast|quarter)/.test(t)) {
    return "This matters to investors because earnings and guidance directly change valuation expectations and forward price targets.";
  }
  if (/(war|conflict|sanction|tariff|export|shipping|strait|oil|gas)/.test(t)) {
    return "This matters because geopolitical and supply-chain shocks can shift inflation risk, commodities, and global risk appetite.";
  }
  if (/(downgrade|upgrade|cuts|raises|target)/.test(t)) {
    return "This matters because analyst revisions can change near-term institutional flows and momentum in the stock.";
  }
  return "This headline can alter investor expectations on growth, risk, or policy and move short-term pricing.";
}

function getCached(headline) {
  const key = String(headline || "").trim();
  if (!key) return "";
  const hit = impactCache.get(key);
  if (!hit) return "";
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    impactCache.delete(key);
    return "";
  }
  return String(hit.value || "").trim();
}

function setCached(headline, explanation) {
  const key = String(headline || "").trim();
  const value = String(explanation || "").trim();
  if (!key || !value) return;
  impactCache.set(key, { value, ts: Date.now() });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const headlines = Array.isArray(body?.headlines)
      ? body.headlines.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 40)
      : [];
    if (!headlines.length) return NextResponse.json({ explanations: [] });

    const unique = Array.from(new Set(headlines));
    const resolved = {};
    const missing = [];

    for (const headline of unique) {
      const cached = getCached(headline);
      if (cached) resolved[headline] = cached;
      else missing.push(headline);
    }

    if (missing.length) {
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
      const key = OPENAI_API_KEY || OPENROUTER_API_KEY;

      if (key && !key.includes("PASTE_")) {
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
For each financial headline, explain in exactly one sentence why that specific headline matters to investors today.

Return ONLY valid JSON:
{"explanations":["..."]}

Rules:
- Same order and same number as input (${missing.length}).
- One sentence per item.
- Be specific to that headline's content.
- No generic repeated wording.
- Do not include markdown.

Headlines:
${JSON.stringify(missing)}
`.trim();

        try {
          const resp = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({
              model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
              messages: [{ role: "user", content: prompt }],
              temperature: 0.2,
              max_tokens: 1200,
            }),
          });
          const data = await resp.json().catch(() => ({}));
          const raw = data?.choices?.[0]?.message?.content || "";
          const parsed = parseExplanations(raw);

          missing.forEach((headline, index) => {
            const next = String(parsed[index] || "").trim() || fallbackExplanation(headline);
            resolved[headline] = next;
            setCached(headline, next);
          });
        } catch {
          missing.forEach((headline) => {
            const next = fallbackExplanation(headline);
            resolved[headline] = next;
            setCached(headline, next);
          });
        }
      } else {
        missing.forEach((headline) => {
          const next = fallbackExplanation(headline);
          resolved[headline] = next;
          setCached(headline, next);
        });
      }
    }

    return NextResponse.json({
      explanations: headlines.map((headline) => resolved[headline] || fallbackExplanation(headline)),
    });
  } catch {
    return NextResponse.json({ explanations: [] });
  }
}
