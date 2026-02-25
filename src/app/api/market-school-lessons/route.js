import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OPENROUTER_MODEL = "mistralai/mistral-7b-instruct";
const OPENAI_MODEL = "gpt-4.1-mini";

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function stripJsonFences(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("```")) return raw;
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchVix() {
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?range=5d&interval=1d";
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const meta = data?.chart?.result?.[0]?.meta || {};
    const value = toNum(meta?.regularMarketPrice ?? meta?.previousClose);
    const prev = toNum(meta?.previousClose);
    const changePct = value != null && prev && prev > 0 ? ((value - prev) / prev) * 100 : null;
    return { value, changePct };
  } catch {
    return { value: null, changePct: null };
  }
}

async function fetchTopMovers() {
  const symbols = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AMD", "JPM", "XOM", "SPY", "QQQ"];
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(","))}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data?.quoteResponse?.result)
      ? data.quoteResponse.result
          .map((r) => ({
            symbol: String(r?.symbol || "").toUpperCase(),
            percentChange: toNum(r?.regularMarketChangePercent),
            price: toNum(r?.regularMarketPrice),
          }))
          .filter((r) => r.symbol && r.percentChange != null)
      : [];
    const sorted = [...rows].sort((a, b) => Math.abs(b.percentChange) - Math.abs(a.percentChange));
    return sorted.slice(0, 3);
  } catch {
    return [];
  }
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
    if (!headline || !url) continue;
    out.push({ headline, url, source: "Google News" });
    if (out.length >= 8) break;
  }
  return out;
}

async function fetchTopHeadlines(finnhubKey) {
  if (finnhubKey) {
    try {
      const url = `https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => []);
      const rows = Array.isArray(data)
        ? data
            .map((item) => ({
              headline: String(item?.headline || "").trim(),
              source: String(item?.source || "Finnhub"),
              url: String(item?.url || "").trim(),
            }))
            .filter((item) => item.headline)
            .slice(0, 8)
        : [];
      if (rows.length) return rows;
    } catch {
      // fallback below
    }
  }

  try {
    const rssUrl = "https://news.google.com/rss/search?q=stock+market+today&hl=en-US&gl=US&ceid=US:en";
    const rssRes = await fetch(rssUrl, { cache: "no-store" });
    const xml = await rssRes.text();
    return parseRssHeadlines(xml);
  } catch {
    return [];
  }
}

async function fetchEconomicEvents(finnhubKey) {
  if (!finnhubKey) {
    return [];
  }
  try {
    const today = new Date();
    const start = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `https://finnhub.io/api/v1/calendar/economic?from=${start}&to=${end}&token=${finnhubKey}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data?.economicCalendar)
      ? data.economicCalendar
          .slice(0, 6)
          .map((item) => ({
            event: String(item?.event || item?.country || "Economic event").trim(),
            date: String(item?.date || "").trim(),
            country: String(item?.country || "").trim(),
          }))
          .filter((item) => item.event)
      : [];
    return rows;
  } catch {
    return [];
  }
}

function buildMarketSummary(vix, movers, headlines) {
  const avgMove = movers.length
    ? movers.reduce((sum, row) => sum + Number(row.percentChange || 0), 0) / movers.length
    : 0;
  const direction = avgMove >= 0 ? "up" : "down";
  const vixText =
    vix.value == null
      ? "volatility signal unavailable"
      : vix.value >= 24
        ? "elevated volatility"
        : vix.value >= 18
          ? "moderate volatility"
          : "calm volatility";
  const leadHeadline = headlines[0]?.headline ? ` Headline focus: ${headlines[0].headline}` : "";
  return `Markets are ${direction} today with ${vixText}.${leadHeadline}`.trim();
}

function fallbackLessons(snapshot) {
  const moverSymbols = snapshot.movers.map((m) => m.symbol).slice(0, 3);
  const leadMover = snapshot.movers[0];
  const vixValue = snapshot.vix?.value;
  const highVol = vixValue != null && vixValue >= 22;
  const leadHeadline = snapshot.headlines[0]?.headline || "Macro headlines are driving risk sentiment.";

  return [
    {
      trigger: highVol ? "VIX ELEVATED TODAY" : "VOLATILITY CHECK",
      title: "How VIX Frames Risk",
      difficulty: "Beginner",
      duration_minutes: 6,
      hook: highVol
        ? `VIX is at ${vixValue?.toFixed?.(2) || vixValue}, so position sizing matters more today.`
        : "Even on quieter days, VIX helps you size risk before entering trades.",
      paragraphs: [
        "VIX tracks expected volatility for the S&P 500 over the next 30 days. Think of it as a market stress gauge, not a directional signal by itself.",
        "When VIX rises quickly, options get more expensive and price swings often widen. Traders usually reduce position size or tighten risk controls.",
        "When VIX is lower, market moves can still happen, but panic-driven swings are less common. The key is matching your trade size to expected volatility.",
      ],
      example: highVol
        ? `With VIX near ${vixValue?.toFixed?.(2) || "today's level"}, many traders cut trade size to avoid being stopped by wider intraday swings.`
        : "With VIX in a calmer range, traders may keep normal size while still defining a clear stop and target.",
      key_takeaway: "Use VIX to adjust risk, not to predict direction.",
      related_tickers: ["^VIX", "SPY", "QQQ"],
    },
    {
      trigger: "TOP MOVER IN FOCUS",
      title: "Why Big Movers Move",
      difficulty: "Intermediate",
      duration_minutes: 7,
      hook: leadMover
        ? `${leadMover.symbol} is moving ${leadMover.percentChange > 0 ? "up" : "down"} ${Math.abs(leadMover.percentChange).toFixed(2)}% today, making it a live case study.`
        : "Large one-day moves often come from earnings, guidance, or macro repricing.",
      paragraphs: [
        "Single-day moves usually combine a catalyst and positioning. A catalyst can be earnings, guidance, regulation, or a macro surprise.",
        "Positioning matters because crowded trades can unwind fast. If too many investors were leaning one way, the move can accelerate.",
        "Volume confirms conviction. A strong move with high volume often means institutions are involved, not just retail noise.",
      ],
      example: leadMover
        ? `${leadMover.symbol} at ${leadMover.price != null ? `$${leadMover.price.toFixed(2)}` : "current price"} with a ${leadMover.percentChange > 0 ? "+" : ""}${leadMover.percentChange.toFixed(2)}% move shows how catalyst plus positioning can reprice a stock in one session.`
        : "A high-volume 3% move after guidance often carries more signal than a low-volume move with no clear catalyst.",
      key_takeaway: "Check catalyst, positioning, and volume before chasing a fast move.",
      related_tickers: moverSymbols.length ? moverSymbols : ["AAPL", "MSFT", "NVDA"],
    },
    {
      trigger: "HEADLINE DRIVEN SESSION",
      title: "Reading News Into Trades",
      difficulty: "Beginner",
      duration_minutes: 5,
      hook: "Today's headlines can shift sector sentiment within minutes.",
      paragraphs: [
        "Not every headline matters equally. Focus on stories that change earnings outlook, rates, or regulation.",
        "Map each headline to likely winners and losers. For example, lower rate expectations can support growth stocks, while energy shocks can lift commodity-linked names.",
        "Wait for confirmation in price and volume. A headline that does not change market behavior is often noise.",
      ],
      example: leadHeadline,
      key_takeaway: "Turn headlines into a thesis only after the tape confirms it.",
      related_tickers: ["SPY", "XLK", "XLE"],
    },
  ];
}

function sanitizeLessons(rawLessons, snapshot) {
  const clean = Array.isArray(rawLessons) ? rawLessons : [];
  const normalized = clean
    .slice(0, 5)
    .map((lesson, index) => {
      const trigger = String(lesson?.trigger || "MARKET CONTEXT").trim().slice(0, 64);
      const title = String(lesson?.title || `Lesson ${index + 1}`).trim().slice(0, 64);
      const difficultyRaw = String(lesson?.difficulty || "Beginner").trim();
      const difficulty = ["Beginner", "Intermediate", "Advanced"].includes(difficultyRaw)
        ? difficultyRaw
        : "Beginner";
      const duration = Math.max(3, Math.min(20, Math.round(Number(lesson?.duration_minutes) || 6)));
      const hook = String(lesson?.hook || "Today has a useful market setup to study.").trim();
      const paragraphs = Array.isArray(lesson?.paragraphs)
        ? lesson.paragraphs.map((p) => String(p || "").trim()).filter(Boolean).slice(0, 3)
        : [];
      const safeParagraphs = paragraphs.length
        ? paragraphs
        : [
            "Watch how price, volume, and news interact before making any decision.",
            "Use one clear thesis, one invalidation level, and one size rule.",
            "Review the outcome so each session improves your next trade plan.",
          ];
      const example = String(lesson?.example || "Use today's movers and headlines as your live case study.").trim();
      const keyTakeaway = String(lesson?.key_takeaway || "Translate market noise into one clear risk-managed plan.").trim();
      const relatedTickers = Array.isArray(lesson?.related_tickers)
        ? lesson.related_tickers
            .map((t) => String(t || "").trim().toUpperCase())
            .filter((t) => /^[A-Z^.=]{1,12}$/.test(t))
            .slice(0, 3)
        : [];

      return {
        id: `${isoToday()}-${index}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        trigger,
        title,
        difficulty,
        duration_minutes: duration,
        hook,
        paragraphs: safeParagraphs,
        example,
        key_takeaway: keyTakeaway,
        related_tickers: relatedTickers.length ? relatedTickers : snapshot.movers.map((m) => m.symbol).slice(0, 3),
      };
    })
    .filter((lesson) => lesson.title);

  return normalized.length ? normalized : fallbackLessons(snapshot);
}

export async function GET() {
  try {
    const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    const llmKey = OPENAI_API_KEY || OPENROUTER_API_KEY;

    const [vix, movers, headlines, economicEvents] = await Promise.all([
      fetchVix(),
      fetchTopMovers(),
      fetchTopHeadlines(FINNHUB_API_KEY),
      fetchEconomicEvents(FINNHUB_API_KEY),
    ]);

    const snapshot = {
      date: isoToday(),
      vix,
      movers,
      headlines: headlines.slice(0, 5),
      economicEvents: economicEvents.slice(0, 5),
    };

    const marketSummary = buildMarketSummary(vix, movers, headlines);

    let lessons = fallbackLessons(snapshot);
    let provider = "fallback";

    if (llmKey && !String(llmKey).includes("PASTE_")) {
      const prompt = [
        "You are a financial educator. Based on today's market conditions:",
        JSON.stringify(snapshot, null, 2),
        "Generate 3-5 lessons that are directly relevant to what is happening in the market today.",
        "Return as JSON array with these fields for each lesson:",
        "- trigger: what market event makes this relevant today",
        "- title: lesson title (max 8 words)",
        "- difficulty: Beginner / Intermediate / Advanced",
        "- duration_minutes: number",
        "- hook: one sentence why this matters TODAY",
        "- paragraphs: array of 3 plain english paragraphs",
        "- example: real example using today's market data",
        "- key_takeaway: one sentence summary",
        "- related_tickers: array of 2-3 ticker strings",
        "Return raw JSON only. No markdown.",
      ].join("\n\n");

      const useOpenRouter = String(llmKey).startsWith("sk-or-");
      const url = useOpenRouter
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.openai.com/v1/chat/completions";

      const headers = {
        Authorization: `Bearer ${llmKey}`,
        "Content-Type": "application/json",
      };
      if (useOpenRouter) {
        headers["HTTP-Referer"] = "http://localhost:3000";
        headers["X-Title"] = "Arthastra Market School";
      }

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: useOpenRouter ? OPENROUTER_MODEL : OPENAI_MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.35,
            max_tokens: 1200,
          }),
        });

        const data = await resp.json().catch(() => ({}));
        const raw = String(data?.choices?.[0]?.message?.content || "").trim();
        const parsed = safeJsonParse(stripJsonFences(raw));

        if (resp.ok && Array.isArray(parsed)) {
          lessons = sanitizeLessons(parsed, snapshot);
          provider = useOpenRouter ? "openrouter" : "openai";
        }
      } catch {
        // keep fallback lessons
      }
    }

    return NextResponse.json(
      {
        date: snapshot.date,
        marketSummary,
        lessons,
        context: snapshot,
        provider,
      },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to build market school lessons",
        details: String(error?.message || error),
      },
      { status: 500 }
    );
  }
}
