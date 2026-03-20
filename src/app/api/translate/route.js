
import { NextResponse } from "next/server";

const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
const OPENAI_MODEL = "gpt-4.1-mini";

const LANGUAGE_LABEL_BY_CODE = {
  en: "English",
  zh: "Mandarin Chinese",
  hi: "Hindi",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
  bn: "Bengali",
  pt: "Portuguese",
  ru: "Russian",
  ur: "Urdu",
};

const GOOGLE_TRANSLATE_LANG_BY_CODE = {
  en: "en",
  zh: "zh-CN",
  hi: "hi",
  es: "es",
  fr: "fr",
  ar: "ar",
  bn: "bn",
  pt: "pt",
  ru: "ru",
  ur: "ur",
};

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

function parseTranslations(raw) {
  const cleaned = cleanModelText(raw);
  if (!cleaned) return [];

  const parsed = safeJsonParse(cleaned);
  if (Array.isArray(parsed?.translations)) return parsed.translations;
  if (Array.isArray(parsed)) return parsed;

  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    const nested = safeJsonParse(cleaned.slice(objStart, objEnd + 1));
    if (Array.isArray(nested?.translations)) return nested.translations;
  }

  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    const arr = safeJsonParse(cleaned.slice(arrStart, arrEnd + 1));
    if (Array.isArray(arr)) return arr;
  }

  return [];
}

function normalizeTranslation(value, fallback) {
  const out = String(value || "").trim();
  return out || fallback;
}

async function translateViaGoogleFallback(texts, language) {
  const targetLang = GOOGLE_TRANSLATE_LANG_BY_CODE[language] || "en";
  if (targetLang === "en") return texts;

  const translated = await Promise.all(
    texts.map(async (text) => {
      try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(payload?.[0])) return text;
        const sentence = payload[0]
          .map((entry) => String(entry?.[0] || ""))
          .join("")
          .trim();
        return sentence || text;
      } catch {
        return text;
      }
    })
  );

  return translated;
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const language = String(body?.language || "en").toLowerCase();
    const textsRaw = Array.isArray(body?.texts) ? body.texts : [];
    const texts = textsRaw
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .slice(0, 40);

    if (!texts.length) return NextResponse.json({ translations: [] });
    if (language === "en") return NextResponse.json({ translations: texts });
    if (!LANGUAGE_LABEL_BY_CODE[language]) return NextResponse.json({ translations: texts });

    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const key = OPENAI_API_KEY || OPENROUTER_API_KEY;
    if (!key || key.includes("PASTE_")) {
      const fallbackTranslations = await translateViaGoogleFallback(texts, language);
      return NextResponse.json({ translations: fallbackTranslations, provider: "google-fallback" });
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
Translate each financial news headline into ${LANGUAGE_LABEL_BY_CODE[language]}.

Return ONLY valid JSON with this exact shape:
{"translations":["..."]}

Rules:
- Keep the exact same number of items (${texts.length}) and same order.
- Keep ticker symbols, currency codes, percentages, and numbers unchanged.
- Do not add commentary, numbering, or extra keys.
- Do not summarize; translate the full meaning.

Headlines:
${JSON.stringify(texts)}
`.trim();

    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1400,
      }),
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const fallbackTranslations = await translateViaGoogleFallback(texts, language);
      return NextResponse.json({ translations: fallbackTranslations, provider: "google-fallback" });
    }

    const raw = data?.choices?.[0]?.message?.content || "";
    const parsedTranslations = parseTranslations(raw);
    const translations = texts.map((text, index) => normalizeTranslation(parsedTranslations[index], text));
    const hasRealTranslation = translations.some((value, index) => String(value || "").trim() !== String(texts[index] || "").trim());
    if (!hasRealTranslation) {
      const fallbackTranslations = await translateViaGoogleFallback(texts, language);
      return NextResponse.json({
        translations: fallbackTranslations,
        provider: "google-fallback",
      });
    }

    return NextResponse.json({
      translations,
      model_used: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
      provider: useOpenRouter ? "openrouter" : "openai",
    });
  } catch {
    return NextResponse.json({ translations: [] });
  }
}
