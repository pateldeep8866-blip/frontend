import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MEMORY_FILE = "/tmp/astra-briefing-memory.json";

// ── Utilities ──────────────────────────────────────────────────────────────

function toEpoch(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function decodeHtmlEntities(raw) {
  let t = String(raw || "");
  // Strip HTML tags first
  t = t.replace(/<[^>]*>/g, " ");
  // Named entities
  t = t.replace(/&amp;/gi, "&");
  t = t.replace(/&lt;/gi, "<");
  t = t.replace(/&gt;/gi, ">");
  t = t.replace(/&quot;/gi, '"');
  t = t.replace(/&apos;/gi, "'");
  t = t.replace(/&#39;/gi, "'");
  t = t.replace(/&#x27;/gi, "'");
  t = t.replace(/&#x2F;/gi, "/");
  t = t.replace(/&nbsp;/gi, " ");
  t = t.replace(/&ndash;/gi, "–");
  t = t.replace(/&mdash;/gi, "—");
  t = t.replace(/&lsquo;/gi, "\u2018");
  t = t.replace(/&rsquo;/gi, "\u2019");
  t = t.replace(/&ldquo;/gi, "\u201C");
  t = t.replace(/&rdquo;/gi, "\u201D");
  t = t.replace(/&hellip;/gi, "…");
  t = t.replace(/&bull;/gi, "•");
  t = t.replace(/&copy;/gi, "©");
  t = t.replace(/&reg;/gi, "®");
  t = t.replace(/&trade;/gi, "™");
  // Decimal numeric entities  (e.g. &#38; &#8217; &#160;)
  t = t.replace(/&#(\d{1,6});/g, (_, n) => {
    try { return String.fromCodePoint(parseInt(n, 10)); } catch { return " "; }
  });
  // Hex numeric entities (e.g. &#x26; &#x2019;)
  t = t.replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => {
    try { return String.fromCodePoint(parseInt(n, 16)); } catch { return " "; }
  });
  // Second pass for double-encoded amp (e.g. &amp;amp; → &amp; after first pass → & now)
  t = t.replace(/&amp;/gi, "&");
  // Remove any leftover broken entity fragments like &#123 (missing semicolon) or &word;
  t = t.replace(/&#?\w+;?/g, " ");
  return t.replace(/\s+/g, " ").trim();
}

function cleanHeadline(raw) {
  let t = decodeHtmlEntities(String(raw || ""));
  t = t.replace(/^(full\s*text\s*\|\s*)+/i, "");
  t = t.replace(/\s*\|\s*(news|reuters|bloomberg|ft|wsj|cnbc|marketwatch|bbc)$/i, "");
  t = t.replace(/\s*-\s*(reuters|bloomberg|ft|wsj|cnbc|ap news|marketwatch|bbc news)$/i, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function cleanSummary(raw) {
  let t = decodeHtmlEntities(String(raw || ""));
  t = t.replace(/href\s*=\s*["'][^"']+["']/gi, " ");
  t = t.replace(/https?:\/\/\S+/gi, " ");
  t = t.replace(/\b\d{8}T\d{6}Z\b/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/^full\s*text\s*[:\-|]*/i, "").trim();
  t = t.replace(/^\W+/, "").trim();
  if (!t) return "";
  if (t.length > 360) t = `${t.slice(0, 357).trim()}...`;
  return t;
}

function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    u.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ocid"].forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return String(raw || "").trim();
  }
}

function hashKey(s) {
  let h = 0;
  const t = String(s || "");
  for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function eventKey(item) {
  const title = String(item?.headline || "").toLowerCase().replace(/\s+/g, " ").trim();
  const link = normalizeUrl(item?.url || "").toLowerCase();
  const compactTitle = title.replace(/[^\w\s]/g, "").split(" ").slice(0, 10).join(" ");
  return hashKey(`${compactTitle}|${link}`);
}

// ── Section metadata ────────────────────────────────────────────────────────

function sectionTitle(key) {
  const map = {
    us: "U.S. Markets",
    global: "Global Markets",
    crypto: "Crypto & Digital Assets",
    fx: "Foreign Exchange",
    metals: "Metals & Mining",
    energy: "Energy & Oil",
    funds: "ETFs & Funds",
    geopolitics: "Geopolitics",
    war: "War & Conflict",
  };
  return map[key] || key;
}

function sectionContextBlock(section) {
  const blocks = {
    us: {
      why: "Why it matters: this can affect US equity leadership, rates expectations, and sector rotation.",
      watch: "What to watch: Fed path repricing, earnings revisions, and breadth between mega-cap and cyclicals.",
    },
    global: {
      why: "Why it matters: this can move cross-asset flows, currencies, commodities, and global risk sentiment.",
      watch: "What to watch: sovereign yields, dollar direction, and commodity response across oil and metals.",
    },
    crypto: {
      why: "Why it matters: this can shift risk appetite, liquidity, and near-term positioning across digital assets.",
      watch: "What to watch: ETF flows, exchange liquidity, and the next major regulatory signal.",
    },
    fx: {
      why: "Why it matters: currency moves ripple into export competitiveness, inflation imports, and sovereign debt dynamics.",
      watch: "What to watch: central bank divergence, carry trade positioning, and DXY direction relative to risk sentiment.",
    },
    metals: {
      why: "Why it matters: metals signal inflation expectations, industrial demand cycles, and safe-haven allocation shifts.",
      watch: "What to watch: gold-real yield relationship, copper as a growth proxy, and silver's dual industrial/monetary role.",
    },
    energy: {
      why: "Why it matters: energy prices feed directly into inflation readings, geopolitical risk premiums, and sector earnings.",
      watch: "What to watch: OPEC+ production signals, US rig counts, LNG demand from Europe and Asia, and refining margins.",
    },
    funds: {
      why: "Why it matters: ETF and fund flows reveal where institutional capital is actually rotating — not just where pundits say it is.",
      watch: "What to watch: passive vs active flows, factor tilts, and whether outflows from one sleeve are finding a new home.",
    },
    geopolitics: {
      why: "Why it matters: geopolitical shifts can quickly alter policy risk, trade flows, and macro positioning.",
      watch: "What to watch: sanctions, diplomatic breakthroughs, and second-order spillovers into commodities and FX.",
    },
    war: {
      why: "Why it matters: conflict developments can reprice energy, defense risk, and broader market volatility.",
      watch: "What to watch: escalation signals, shipping disruptions, and policy responses from major powers.",
    },
  };
  return blocks[section] || blocks.geopolitics;
}

function inferMarketLens(section, headline = "", summary = "") {
  const t = `${headline} ${summary}`.toLowerCase();
  if (section === "crypto") {
    if (/(etf|sec|regulat|approval)/.test(t)) return "Market lens: regulatory flow can quickly reset crypto risk premium and liquidity participation.";
    if (/(liquidat|leverage|funding|open interest|oi)/.test(t)) return "Market lens: leverage conditions may amplify short-term volatility and squeeze risk.";
    if (/(stablecoin|exchange|custod|hack|breach|security)/.test(t)) return "Market lens: infrastructure trust and custody confidence directly impact capital rotation in the space.";
    return "Market lens: watch whether this changes institutional participation, liquidity depth, or short-term positioning.";
  }
  if (section === "us") {
    if (/(fed|powell|rates|treasury|cpi|inflation|payroll)/.test(t)) return "Market lens: rates-path repricing can move duration, equity multiples, and sector leadership.";
    if (/(earnings|guidance|revenue|margin)/.test(t)) return "Market lens: earnings revision direction matters more than headline beats in this tape.";
    return "Market lens: track whether this shifts US growth expectations, policy assumptions, or factor rotation.";
  }
  if (section === "global") {
    if (/(oil|gas|opec|commodit)/.test(t)) return "Market lens: commodity repricing can spill into inflation expectations, FX, and risk sentiment.";
    if (/(china|europe|boj|ecb|trade|tariff)/.test(t)) return "Market lens: policy divergence and trade signals can redirect global capital flows quickly.";
    return "Market lens: monitor cross-asset transmission into currencies, sovereign yields, and commodity volatility.";
  }
  if (section === "fx") {
    if (/(dollar|dxy|usd)/.test(t)) return "Market lens: dollar direction is the master variable for risk assets, commodities, and EM capital flows.";
    if (/(yen|jpy|boj)/.test(t)) return "Market lens: yen moves can unwind carry trades and trigger cross-asset volatility when aggressive.";
    if (/(euro|ecb|pound|boe)/.test(t)) return "Market lens: G10 central bank divergence drives duration and FX premium — watch the rate-differential spread.";
    return "Market lens: FX moves amplify or offset local-currency returns for global equity and bond allocators.";
  }
  if (section === "metals") {
    if (/(gold|silver)/.test(t)) return "Market lens: precious metals move inversely to real yields — watch TIPS and central bank reserve demand.";
    if (/(copper|industrial|supply)/.test(t)) return "Market lens: copper is a leading indicator of global industrial activity and China demand cycle.";
    return "Market lens: metals pricing reflects inflation expectations, supply chain stress, and safe-haven demand simultaneously.";
  }
  if (section === "energy") {
    if (/(opec|production|cut|output)/.test(t)) return "Market lens: OPEC+ supply management directly sets the energy risk premium across portfolios.";
    if (/(lng|gas|winter|demand)/.test(t)) return "Market lens: natural gas dynamics increasingly drive power prices, inflation, and European economic fragility.";
    return "Market lens: energy repricing transmits quickly into headline inflation, consumer spending, and sector earnings.";
  }
  if (section === "funds") {
    if (/(etf|flow|inflow|outflow)/.test(t)) return "Market lens: ETF flow data is a real-time signal of where institutional and retail conviction is shifting.";
    if (/(passive|active|index|factor)/.test(t)) return "Market lens: passive vs active tilt is a structural force — follow the flow to find the momentum.";
    return "Market lens: fund allocation shifts reveal the consensus trade — which is often the most crowded and fragile.";
  }
  if (section === "war") {
    if (/(ceasefire|truce|talks|diplomac)/.test(t)) return "Market lens: de-escalation headlines can compress risk premia, but follow-through matters more than first prints.";
    if (/(missile|strike|drone|attack|frontline|invasion)/.test(t)) return "Market lens: escalation can reprice energy, shipping risk, and defense-linked assets on short notice.";
    return "Market lens: conflict headlines tend to propagate through energy, freight, and volatility channels first.";
  }
  if (/(sanction|trade|diplomac|election|policy)/.test(t)) return "Market lens: policy and sanction shifts can alter cross-border flows and macro positioning.";
  return "Market lens: geopolitical change matters when it alters policy probability, trade flows, or resource access.";
}

function fallbackSummaryFromHeadline(headline, section) {
  const h = cleanHeadline(headline);
  if (!h) return "";
  const prefixes = {
    us: "U.S. market update",
    global: "Global market update",
    crypto: "Crypto update",
    fx: "Currency market update",
    metals: "Metals market update",
    energy: "Energy market update",
    funds: "Fund & ETF update",
    war: "Conflict update",
    geopolitics: "Geopolitical update",
  };
  return `${prefixes[section] || "Update"}: ${h}.`;
}

function buildContextSummary(section, headline, rawSummary) {
  const h = cleanHeadline(headline);
  const base = cleanSummary(rawSummary) || fallbackSummaryFromHeadline(h, section);
  const compact = base.length > 280 ? `${base.slice(0, 277).trim()}...` : base;
  const context = sectionContextBlock(section);
  const lens = inferMarketLens(section, h, compact);
  return `${compact} ${context.why} ${context.watch} ${lens}`;
}

// ── RSS Parsing ─────────────────────────────────────────────────────────────

function extractImageFromDescription(html) {
  const patterns = [
    /<img[^>]+src=["']([^"']+)["'][^>]*>/i,
    /url\(["']?([^"')]+)["']?\)/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1] && m[1].startsWith("http")) return m[1].trim();
  }
  return "";
}

function parseRssItems(xml, sourceLabel, section) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1] || "";
    const title =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "")
        .replace(/\s+/g, " ");
    const cleanTitle = cleanHeadline(title);
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();
    const descriptionRaw = block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "";
    // Image extraction — try multiple locations
    const mediaContent = (block.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] || "").trim();
    const mediaThumb = (block.match(/<media:thumbnail[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] || "").trim();
    const enclosure = (block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image/i)?.[1] || "").trim();
    const descImg = extractImageFromDescription(descriptionRaw);
    const ogImage = (block.match(/<og:image[^>]*content=["']([^"']+)["']/i)?.[1] || "").trim();
    const image = normalizeUrl(mediaContent || mediaThumb || enclosure || ogImage || descImg);
    if (!cleanTitle || !link) continue;
    items.push({
      headline: cleanTitle,
      summary: buildContextSummary(section, cleanTitle, descriptionRaw),
      url: normalizeUrl(link),
      image,
      source: sourceLabel,
      datetime: pubDate,
      section,
    });
    if (items.length >= 80) break;
  }
  return items;
}

async function fetchRss(source) {
  try {
    const res = await fetch(source.url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AstraBot/1.0; +https://astra.finance)" },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, source.label, source.section);
  } catch {
    return [];
  }
}

// ── GDELT ──────────────────────────────────────────────────────────────────

async function fetchGdelt(section, query, limit = 80) {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc" +
    `?query=${encodeURIComponent(query)}` +
    `&mode=ArtList&maxrecords=${limit}&sort=DateDesc&format=json`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data?.articles) ? data.articles : [];
    return rows
      .map((r) => ({
        headline: cleanHeadline(r?.title),
        summary: buildContextSummary(section, r?.title, r?.snippet || r?.description || ""),
        url: normalizeUrl(r?.url || ""),
        image: normalizeUrl(r?.socialimage || ""),
        source: String(r?.sourceCommonName || r?.domain || "GDELT"),
        datetime: r?.seendate || "",
        section,
      }))
      .filter((r) => r.headline && r.url);
  } catch {
    return [];
  }
}

// ── Yahoo Finance Pulse ─────────────────────────────────────────────────────

async function fetchPulse() {
  const symbolDefs = [
    { key: "sp500",  label: "S&P 500",      symbol: "^GSPC",      suffix: "" },
    { key: "nasdaq", label: "Nasdaq",        symbol: "^IXIC",      suffix: "" },
    { key: "vix",    label: "VIX",           symbol: "^VIX",       suffix: "" },
    { key: "us10y",  label: "US 10Y",        symbol: "^TNX",       suffix: "%" },
    { key: "dxy",    label: "DXY",           symbol: "DX-Y.NYB",   suffix: "" },
    { key: "eurusd", label: "EUR/USD",       symbol: "EURUSD=X",   suffix: "" },
    { key: "gbpusd", label: "GBP/USD",       symbol: "GBPUSD=X",   suffix: "" },
    { key: "usdjpy", label: "USD/JPY",       symbol: "JPY=X",      suffix: "" },
    { key: "wti",    label: "WTI Oil",       symbol: "CL=F",       suffix: "" },
    { key: "natgas", label: "Nat Gas",       symbol: "NG=F",       suffix: "" },
    { key: "gold",   label: "Gold",          symbol: "GC=F",       suffix: "" },
    { key: "silver", label: "Silver",        symbol: "SI=F",       suffix: "" },
    { key: "copper", label: "Copper",        symbol: "HG=F",       suffix: "" },
    { key: "btc",    label: "BTC",           symbol: "BTC-USD",    suffix: "" },
    { key: "eth",    label: "ETH",           symbol: "ETH-USD",    suffix: "" },
  ];
  const symbolList = symbolDefs.map((d) => d.symbol);
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbolList.join(","))}`;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "application/json,text/plain,*/*",
      },
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
    const by = new Map(rows.map((r) => [String(r?.symbol || "").toUpperCase(), r]));
    return symbolDefs.map(({ key, label, symbol, suffix }) => {
      const row = by.get(symbol.toUpperCase());
      const value = Number(row?.regularMarketPrice);
      const changePct = Number(row?.regularMarketChangePercent);
      return {
        key, label, symbol,
        value: Number.isFinite(value) ? value : null,
        changePct: Number.isFinite(changePct) ? changePct : null,
        suffix,
      };
    });
  } catch {
    return [];
  }
}

// ── Edition schedule helpers ────────────────────────────────────────────────

// 8 AM Eastern = 13:00 UTC (EST) / 12:00 UTC (EDT); we use 13:00 UTC as conservative
const PUBLISH_HOUR_UTC = 13;

function todayAt8amUtc() {
  const d = new Date();
  d.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
  return d;
}

function getEditionCutoff(cadence) {
  // Returns the timestamp of the most recent scheduled publish time
  const now = new Date();
  if (cadence === "daily") {
    const t = todayAt8amUtc();
    if (t > now) t.setUTCDate(t.getUTCDate() - 1); // use yesterday's if 8am hasn't hit yet today
    return t.getTime();
  } else {
    // Most recent Monday at 8am UTC
    const day = now.getUTCDay(); // 0=Sun, 1=Mon...
    const daysBack = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - daysBack);
    monday.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
    if (monday > now) monday.setUTCDate(monday.getUTCDate() - 7);
    return monday.getTime();
  }
}

function getNextPublishAt(cadence) {
  const now = new Date();
  if (cadence === "daily") {
    const t = todayAt8amUtc();
    if (t <= now) t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString();
  } else {
    const day = now.getUTCDay();
    const daysToMonday = day === 0 ? 1 : 8 - day;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + daysToMonday);
    monday.setUTCHours(PUBLISH_HOUR_UTC, 0, 0, 0);
    return monday.toISOString();
  }
}

// ── Memory / Cache ──────────────────────────────────────────────────────────

async function loadMemory() {
  try {
    const fs = await import("fs/promises");
    const raw = await fs.readFile(MEMORY_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveMemory(memory) {
  try {
    const fs = await import("fs/promises");
    await fs.writeFile(MEMORY_FILE, JSON.stringify(memory), "utf8");
  } catch {}
}

// ── Edition theme & ASTRA summary ──────────────────────────────────────────

function buildEditionTheme(pulse = []) {
  const by = new Map(pulse.map((p) => [p.key, p]));
  const vix = by.get("vix");
  const dxy = by.get("dxy");
  const wti = by.get("wti");
  const sp500 = by.get("sp500");

  const vixHigh = Number(vix?.value) >= 20;
  const dxyStrong = Number(dxy?.changePct) > 0.35;
  const oilSpike = Number(wti?.changePct) > 1.5;
  const equityDown = Number(sp500?.changePct) < -0.5;

  if (vixHigh && equityDown && (dxyStrong || oilSpike)) {
    return "Edition Theme: Risk-off pressure is building — volatility, dollar strength, and equity weakness are moving together. Defensives and cash may be outperforming.";
  }
  if (Number(vix?.value) < 16 && Number(sp500?.changePct) > 0) {
    return "Edition Theme: Broad risk sentiment is constructive, with volatility contained and equity momentum intact. Watch for complacency signals near resistance.";
  }
  if (oilSpike && !vixHigh) {
    return "Edition Theme: Energy is the driver today — oil and gas moves are front and center. Watch inflation pass-through and OPEC-related positioning.";
  }
  return "Edition Theme: Mixed macro tape with cross-asset signals showing selective risk appetite and headline-driven swings across equities, FX, and commodities.";
}

function buildAstraSummary({ sections = [], headline = "", pulse = [], theme = "" }) {
  const freshItems = sections.flatMap((s) => (Array.isArray(s?.items) ? s.items.filter((i) => !i?.carryover) : []));
  const carryItems = sections.flatMap((s) => (Array.isArray(s?.items) ? s.items.filter((i) => i?.carryover) : []));
  const activeSections = sections.filter((s) => Array.isArray(s?.items) && s.items.length > 0);
  const lead = cleanHeadline(headline || "");

  const byPulse = new Map((Array.isArray(pulse) ? pulse : []).map((p) => [p.key, p]));
  const fmtPulse = (k, d = 2) => {
    const v = Number(byPulse.get(k)?.value);
    return Number.isFinite(v) ? v.toFixed(d) : "--";
  };
  const fmtDelta = (k) => {
    const v = Number(byPulse.get(k)?.changePct);
    if (!Number.isFinite(v)) return "--";
    return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  };

  const vix = Number(byPulse.get("vix")?.value);
  const vixRegime = !Number.isFinite(vix) ? "unknown" : vix < 16 ? "risk-on" : vix <= 21 ? "balanced" : "risk-off";

  const sectionHighlights = activeSections
    .slice(0, 6)
    .map((s) => {
      const top = s.items?.[0] || null;
      if (!top) return null;
      const raw = String(top?.summary || "").trim();
      const first = raw.split("Why it matters:")[0].trim();
      const context = (first || top.headline || "").slice(0, 170).trim();
      return {
        section: s.title,
        headline: cleanHeadline(top.headline || ""),
        context: context.length >= 170 ? `${context.slice(0, 167)}...` : context,
      };
    })
    .filter(Boolean);

  const deck = lead
    ? `Front page leads with: ${lead}. ${theme || "Macro is headline-driven with cross-asset sensitivity."}`
    : `${theme || "Macro is headline-driven with cross-asset sensitivity."}`;

  const bullets = [
    `Equities: S&P 500 ${fmtPulse("sp500")} (${fmtDelta("sp500")}), Nasdaq ${fmtPulse("nasdaq")} (${fmtDelta("nasdaq")}), VIX ${fmtPulse("vix")} — regime is ${vixRegime}.`,
    `Macro: DXY ${fmtPulse("dxy")} (${fmtDelta("dxy")}), US10Y ${fmtPulse("us10y")}% (${fmtDelta("us10y")}). EUR/USD ${fmtPulse("eurusd")} (${fmtDelta("eurusd")}), USD/JPY ${fmtPulse("usdjpy")} (${fmtDelta("usdjpy")}).`,
    `Commodities: WTI $${fmtPulse("wti")} (${fmtDelta("wti")}), Gold $${fmtPulse("gold")} (${fmtDelta("gold")}), Silver $${fmtPulse("silver")} (${fmtDelta("silver")}), Copper $${fmtPulse("copper")} (${fmtDelta("copper")}), Nat Gas $${fmtPulse("natgas")} (${fmtDelta("natgas")}).`,
    `Crypto: BTC $${fmtPulse("btc", 0)} (${fmtDelta("btc")}), ETH $${fmtPulse("eth", 0)} (${fmtDelta("eth")}).`,
    `Coverage: ${activeSections.length} active sections — ${freshItems.length} fresh stories, ${carryItems.length} carryover. Fresh flow is ${freshItems.length >= carryItems.length ? "dominant" : "thin"} this cycle.`,
    `Execution cue: open only headlines that change positioning, policy, liquidity, or volatility assumptions; skip repetitive narrative items.`,
  ];

  return { title: "Arthastra Intelligence Summary", deck, bullets, highlights: sectionHighlights };
}

// ── Main handler ────────────────────────────────────────────────────────────

function cadenceWindowMs(cadence) {
  return cadence === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const cadence = String(searchParams.get("cadence") || "daily").toLowerCase() === "weekly" ? "weekly" : "daily";
    const forceRefresh = searchParams.get("force") === "1";
    const now = Date.now();

    // ── Cache check ──────────────────────────────────────────────────────────
    const memory = await loadMemory();
    const cacheKey = `cache_${cadence}`;
    const editionCutoff = getEditionCutoff(cadence);
    const cached = memory[cacheKey];

    if (!forceRefresh && cached && Number(cached.generatedAt) >= editionCutoff) {
      return NextResponse.json(
        { ...cached.payload, _cached: true },
        { headers: { "cache-control": "no-store, max-age=0" } }
      );
    }

    // ── Fetch all sources in parallel ────────────────────────────────────────
    const cutoff = now - cadenceWindowMs(cadence);

    const rssSources = [
      // U.S. Markets
      { section: "us", label: "Google News", url: "https://news.google.com/rss/search?q=US+stock+market+S%26P+500+Nasdaq+Federal+Reserve+earnings+Wall+Street&hl=en-US&gl=US&ceid=US:en" },
      { section: "us", label: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews" },
      { section: "us", label: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
      { section: "us", label: "CNBC", url: "https://www.cnbc.com/id/10000664/device/rss/rss.html" },
      // Global Markets
      { section: "global", label: "Google News", url: "https://news.google.com/rss/search?q=global+markets+world+economy+inflation+interest+rates+bonds+ECB+BOJ+China+economy&hl=en-US&gl=US&ceid=US:en" },
      { section: "global", label: "Reuters Top", url: "https://feeds.reuters.com/reuters/topNews" },
      { section: "global", label: "BBC Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml" },
      // Crypto
      { section: "crypto", label: "Google News", url: "https://news.google.com/rss/search?q=bitcoin+ethereum+crypto+blockchain+DeFi+ETF+SEC+regulation+stablecoin&hl=en-US&gl=US&ceid=US:en" },
      { section: "crypto", label: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
      { section: "crypto", label: "CoinTelegraph", url: "https://cointelegraph.com/rss" },
      // Foreign Exchange
      { section: "fx", label: "Google News", url: "https://news.google.com/rss/search?q=forex+currency+dollar+euro+yen+pound+yuan+exchange+rate+central+bank&hl=en-US&gl=US&ceid=US:en" },
      { section: "fx", label: "ForexLive", url: "https://www.forexlive.com/feed/" },
      { section: "fx", label: "FX Street", url: "https://www.fxstreet.com/rss/news" },
      // Metals & Mining
      { section: "metals", label: "Google News", url: "https://news.google.com/rss/search?q=gold+silver+copper+platinum+palladium+metals+mining+commodities+prices&hl=en-US&gl=US&ceid=US:en" },
      { section: "metals", label: "Kitco", url: "https://www.kitco.com/rss/" },
      { section: "metals", label: "Mining.com", url: "https://www.mining.com/feed/" },
      // Energy
      { section: "energy", label: "Google News", url: "https://news.google.com/rss/search?q=oil+gas+energy+OPEC+crude+WTI+Brent+LNG+natural+gas+renewables+energy+stocks&hl=en-US&gl=US&ceid=US:en" },
      { section: "energy", label: "OilPrice", url: "https://oilprice.com/rss/main" },
      { section: "energy", label: "Reuters Energy", url: "https://feeds.reuters.com/reuters/energy" },
      // ETFs & Funds
      { section: "funds", label: "Google News", url: "https://news.google.com/rss/search?q=ETF+mutual+fund+index+fund+BlackRock+Vanguard+Fidelity+fund+flows+asset+management&hl=en-US&gl=US&ceid=US:en" },
      { section: "funds", label: "ETF.com", url: "https://www.etf.com/sections/blog?format=feed&type=rss" },
    ];

    const [rssLists, geopoliticsRows, warRows, pulse] = await Promise.all([
      Promise.all(rssSources.map(fetchRss)),
      fetchGdelt("geopolitics", '(geopolitics OR sanctions OR diplomacy OR "trade war" OR "South China Sea" OR election OR "foreign policy") AND sourcelang:eng'),
      fetchGdelt("war", '(war OR missile OR invasion OR "drone strike" OR ceasefire OR frontline OR military OR conflict OR troops) AND sourcelang:eng'),
      fetchPulse(),
    ]);

    const pool = [...rssLists.flat(), ...geopoliticsRows, ...warRows]
      .filter((x) => x.headline && x.url)
      .filter((x) => {
        const ts = toEpoch(x.datetime);
        return ts ? ts >= cutoff : true;
      });

    // Deduplicate by event key
    const dedupedByEvent = new Map();
    for (const item of pool) {
      const key = eventKey(item);
      const existing = dedupedByEvent.get(key);
      if (!existing || toEpoch(item.datetime) > toEpoch(existing.datetime)) {
        dedupedByEvent.set(key, item);
      }
    }

    // No-repeat memory
    const memKey = `published_${cadence}`;
    const old = Array.isArray(memory[memKey]) ? memory[memKey] : [];
    const keepCutoff = now - 21 * 24 * 60 * 60 * 1000;
    const oldRecent = old.filter((x) => Number(x?.ts) >= keepCutoff);
    const publishedSet = new Set(oldRecent.map((x) => String(x?.key || "")));

    const fresh = Array.from(dedupedByEvent.entries())
      .filter(([k]) => !publishedSet.has(k))
      .map(([k, item]) => ({ key: k, ...item }))
      .sort((a, b) => toEpoch(b.datetime) - toEpoch(a.datetime));

    const dedupedAll = Array.from(dedupedByEvent.entries())
      .map(([key, item]) => ({ key, ...item }))
      .sort((a, b) => toEpoch(b.datetime) - toEpoch(a.datetime));

    const perSectionLimit = cadence === "weekly" ? 12 : 8;
    const sectionKeys = ["us", "global", "crypto", "fx", "metals", "energy", "funds", "geopolitics", "war"];

    const sections = sectionKeys.map((section) => {
      const freshItems = fresh.filter((x) => x.section === section).slice(0, perSectionLimit);
      const carryoverItems =
        freshItems.length > 0
          ? []
          : dedupedAll
              .filter((x) => x.section === section)
              .slice(0, perSectionLimit)
              .map((x) => ({ ...x, carryover: true }));
      const items = freshItems.length > 0 ? freshItems : carryoverItems;
      return {
        key: section,
        title: sectionTitle(section),
        items: items.map(({ key, ...rest }) => rest),
      };
    });

    // Update no-repeat memory
    const usedKeys = sections.flatMap((s) => s.items.map((x) => eventKey(x)));
    memory[memKey] = [...oldRecent, ...usedKeys.map((k) => ({ key: k, ts: now }))].slice(-6000);

    // Build response
    const heroPriority = ["us", "global", "energy", "geopolitics", "war", "crypto", "fx", "metals", "funds"];
    const headlineItem =
      heroPriority.map((k) => sections.find((s) => s.key === k)?.items?.[0] || null).find(Boolean) || null;
    const headline = headlineItem?.headline || "No major new items in this cycle.";
    const theme = buildEditionTheme(pulse);
    const summary = buildAstraSummary({ sections, headline, pulse, theme });
    const nextPublishAt = getNextPublishAt(cadence);

    const payload = {
      name: "The Arthastra",
      cadence,
      generatedAt: new Date(now).toISOString(),
      nextPublishAt,
      headline,
      pulse,
      theme,
      summary,
      sections,
      _cached: false,
    };

    // Save to cache
    memory[cacheKey] = { generatedAt: now, payload };
    await saveMemory(memory);

    return NextResponse.json(payload, { headers: { "cache-control": "no-store, max-age=0" } });
  } catch (e) {
    return NextResponse.json(
      { error: "Failed to build briefing", details: String(e?.message || e) },
      { status: 500 }
    );
  }
}
