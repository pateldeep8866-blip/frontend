import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MEMORY_FILE = "/tmp/astra-briefing-memory.json";

function toEpoch(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function cleanHeadline(raw) {
  let t = String(raw || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(full\s*text\s*\|\s*)+/i, "");
  t = t.replace(/\s*\|\s*news$/i, "");
  t = t.replace(/\s*\|\s*reuters$/i, "");
  t = t.replace(/\s*-\s*reuters$/i, "");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

function cleanSummary(raw) {
  let t = String(raw || "")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&apos;/gi, "'")
    .replace(/href\s*=\s*["'][^"']+["']/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b\d{8}T\d{6}Z\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  t = t.replace(/^full\s*text\s*[:\-|]*/i, "").trim();
  t = t.replace(/^\W+/, "").trim();
  if (!t) return "";
  if (t.length > 320) t = `${t.slice(0, 317).trim()}...`;
  return t;
}

function sectionContextBlock(section) {
  if (section === "crypto") {
    return {
      why: "Why it matters: this can shift risk appetite, liquidity, and near-term positioning across digital assets.",
      watch: "What to watch: ETF flows, exchange liquidity, and the next major regulatory signal.",
    };
  }
  if (section === "us") {
    return {
      why: "Why it matters: this can affect US equity leadership, rates expectations, and sector rotation.",
      watch: "What to watch: Fed path repricing, earnings revisions, and breadth between mega-cap and cyclicals.",
    };
  }
  if (section === "global") {
    return {
      why: "Why it matters: this can move cross-asset flows, currencies, commodities, and global risk sentiment.",
      watch: "What to watch: sovereign yields, dollar direction, and commodity response across oil and metals.",
    };
  }
  if (section === "war") {
    return {
      why: "Why it matters: conflict developments can reprice energy, defense risk, and broader market volatility.",
      watch: "What to watch: escalation signals, shipping disruptions, and policy responses from major powers.",
    };
  }
  return {
    why: "Why it matters: geopolitical shifts can quickly alter policy risk, trade flows, and macro positioning.",
    watch: "What to watch: sanctions, diplomatic breakthroughs, and second-order spillovers into commodities and FX.",
  };
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
  if (section === "war") {
    if (/(ceasefire|truce|talks|diplomac)/.test(t)) return "Market lens: de-escalation headlines can compress risk premia, but follow-through matters more than first prints.";
    if (/(missile|strike|drone|attack|frontline|invasion)/.test(t)) return "Market lens: escalation can reprice energy, shipping risk, and defense-linked assets on short notice.";
    return "Market lens: conflict headlines tend to propagate through energy, freight, and volatility channels first.";
  }
  if (/(sanction|trade|diplomac|election|policy)/.test(t)) return "Market lens: policy and sanction shifts can alter cross-border flows and macro positioning.";
  return "Market lens: geopolitical change matters when it alters policy probability, trade flows, or resource access.";
}

function buildContextSummary(section, headline, rawSummary) {
  const h = cleanHeadline(headline);
  const base = cleanSummary(rawSummary) || fallbackSummaryFromHeadline(h, section);
  const compact = base.length > 260 ? `${base.slice(0, 257).trim()}...` : base;
  const context = sectionContextBlock(section);
  const lens = inferMarketLens(section, h, compact);
  return `${compact} ${context.why} ${context.watch} ${lens}`;
}

function fallbackSummaryFromHeadline(headline, section) {
  const h = cleanHeadline(headline);
  if (!h) return "";
  const prefix =
    section === "crypto"
      ? "Crypto update"
      : section === "us"
        ? "US market update"
        : section === "global"
          ? "Global market update"
          : section === "war"
            ? "Conflict update"
            : "Geopolitical update";
  return `${prefix}: ${h}.`;
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

function parseRssItems(xml, sourceLabel, section) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1] || "";
    const title =
      (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ||
        block.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ||
        "")
        .replace(/\s+/g, " ");
    const cleanTitle = cleanHeadline(title);
    const link = (block.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "").trim();
    const pubDate = (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] || "").trim();
    const descriptionRaw = block.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "";
    const mediaContent = (block.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] || "").trim();
    const mediaThumb = (block.match(/<media:thumbnail[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] || "").trim();
    const enclosure = (block.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*>/i)?.[1] || "").trim();
    const descImg = (block.match(/<description>[\s\S]*?<img[^>]*src=["']([^"']+)["'][\s\S]*?<\/description>/i)?.[1] || "").trim();
    const image = normalizeUrl(mediaContent || mediaThumb || enclosure || descImg);
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
    if (items.length >= 60) break;
  }
  return items;
}

async function fetchRss(source) {
  try {
    const res = await fetch(source.url, { cache: "no-store" });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, source.label, source.section);
  } catch {
    return [];
  }
}

async function fetchGdelt(section, query) {
  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc" +
    `?query=${encodeURIComponent(query)}` +
    "&mode=ArtList&maxrecords=80&sort=DateDesc&format=json";
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
        datetime: r?.seendate || r?.socialimage || "",
        section,
      }))
      .filter((r) => r.headline && r.url);
  } catch {
    return [];
  }
}

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
  } catch {
    // best-effort only
  }
}

function cadenceWindowMs(cadence) {
  return cadence === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function sectionTitle(key) {
  const map = {
    us: "US Market",
    global: "Global Market",
    crypto: "Crypto",
    geopolitics: "Geopolitics",
    war: "War / Conflict",
  };
  return map[key] || key;
}

function yahooHeaders() {
  return {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    accept: "application/json,text/plain,*/*",
  };
}

async function fetchPulse() {
  const symbols = {
    us10y: "^TNX",
    dxy: "DX-Y.NYB",
    wti: "CL=F",
    gold: "GC=F",
    btc: "BTC-USD",
    vix: "^VIX",
  };
  const symbolList = Object.values(symbols);
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbolList.join(","))}`;
  try {
    const res = await fetch(url, { cache: "no-store", headers: yahooHeaders() });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const rows = Array.isArray(data?.quoteResponse?.result) ? data.quoteResponse.result : [];
    const by = new Map(rows.map((r) => [String(r?.symbol || "").toUpperCase(), r]));

    const fmt = (key, label, symbol, suffix = "") => {
      const row = by.get(String(symbol).toUpperCase());
      const value = Number(row?.regularMarketPrice);
      const changePct = Number(row?.regularMarketChangePercent);
      return {
        key,
        label,
        symbol,
        value: Number.isFinite(value) ? value : null,
        changePct: Number.isFinite(changePct) ? changePct : null,
        suffix,
      };
    };

    return [
      fmt("us10y", "US10Y", symbols.us10y, "%"),
      fmt("dxy", "DXY", symbols.dxy, ""),
      fmt("wti", "WTI", symbols.wti, ""),
      fmt("gold", "Gold", symbols.gold, ""),
      fmt("btc", "BTC", symbols.btc, ""),
      fmt("vix", "VIX", symbols.vix, ""),
    ];
  } catch {
    return [];
  }
}

function buildEditionTheme(pulse = []) {
  const by = new Map(pulse.map((p) => [p.key, p]));
  const vix = by.get("vix");
  const dxy = by.get("dxy");
  const wti = by.get("wti");

  const vixHigh = Number(vix?.value) >= 20;
  const dxyStrong = Number(dxy?.changePct) > 0.35;
  const oilSpike = Number(wti?.changePct) > 1.5;

  if (vixHigh && (dxyStrong || oilSpike)) {
    return "Edition Theme: Risk-off pressure is building as volatility, dollar strength, and energy sensitivity move together.";
  }
  if (Number(vix?.value) < 16 && Number(dxy?.changePct) <= 0.2) {
    return "Edition Theme: Broad risk sentiment is relatively constructive, with volatility contained and macro stress muted.";
  }
  return "Edition Theme: Mixed macro tape, with cross-asset signals showing selective risk appetite and headline-driven swings.";
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
  const vixRegime = !Number.isFinite(vix)
    ? "unknown"
    : vix < 16
      ? "risk-on"
      : vix <= 21
        ? "balanced"
        : "risk-off";

  const sectionHighlights = activeSections
    .slice(0, 4)
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
    `Macro pulse: VIX ${fmtPulse("vix")} (${vixRegime}), DXY ${fmtPulse("dxy")} (${fmtDelta("dxy")}), WTI $${fmtPulse("wti")} (${fmtDelta("wti")}), Gold $${fmtPulse("gold")} (${fmtDelta("gold")}), BTC $${fmtPulse("btc", 0)} (${fmtDelta("btc")}).`,
    `Coverage quality: ${activeSections.length} active section(s), ${freshItems.length} fresh story(ies), ${carryItems.length} carryover item(s). Fresh flow is ${freshItems.length >= carryItems.length ? "dominant" : "thin"} this cycle.`,
    `Tactical read: focus first on sections with fresh flow, then use carryover pieces as background only if they still align with today's macro pulse.`,
    `Execution cue: open only headlines that change positioning, policy, liquidity, or volatility assumptions; skip repetitive narrative items.`,
  ];

  return { title: "ASTRA Summary", deck, bullets, highlights: sectionHighlights };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const cadence = String(searchParams.get("cadence") || "daily").toLowerCase() === "weekly" ? "weekly" : "daily";
    const now = Date.now();
    const cutoff = now - cadenceWindowMs(cadence);

    const rssSources = [
      { section: "us", label: "Google News", url: "https://news.google.com/rss/search?q=US+stock+market+Federal+Reserve+S%26P+500+Nasdaq&hl=en-US&gl=US&ceid=US:en" },
      { section: "global", label: "Reuters", url: "https://feeds.reuters.com/reuters/businessNews" },
      { section: "global", label: "Google News", url: "https://news.google.com/rss/search?q=global+markets+economy+inflation+bonds+oil&hl=en-US&gl=US&ceid=US:en" },
      { section: "crypto", label: "Google News", url: "https://news.google.com/rss/search?q=bitcoin+ethereum+crypto+ETF+exchange+regulation&hl=en-US&gl=US&ceid=US:en" },
      { section: "crypto", label: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
    ];

    const [rssLists, geopoliticsRows, warRows, pulse] = await Promise.all([
      Promise.all(rssSources.map(fetchRss)),
      fetchGdelt("geopolitics", '(geopolitics OR sanctions OR diplomacy OR "trade war" OR "South China Sea") AND sourcelang:eng'),
      fetchGdelt("war", '(war OR missile OR invasion OR drone strike OR ceasefire OR frontline) AND sourcelang:eng'),
      fetchPulse(),
    ]);

    const pool = [...rssLists.flat(), ...geopoliticsRows, ...warRows]
      .filter((x) => x.headline && x.url)
      .filter((x) => {
        const ts = toEpoch(x.datetime);
        return ts ? ts >= cutoff : true;
      });

    const dedupedByEvent = new Map();
    for (const item of pool) {
      const key = eventKey(item);
      const existing = dedupedByEvent.get(key);
      if (!existing || toEpoch(item.datetime) > toEpoch(existing.datetime)) dedupedByEvent.set(key, item);
    }

    const memory = await loadMemory();
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

    const perSectionLimit = cadence === "weekly" ? 10 : 6;
    const sections = ["us", "global", "crypto", "geopolitics", "war"].map((section) => {
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

    const usedKeys = sections.flatMap((s) => s.items.map((x) => eventKey(x)));
    memory[memKey] = [...oldRecent, ...usedKeys.map((k) => ({ key: k, ts: now }))].slice(-4000);
    await saveMemory(memory);

    const heroPriority = ["us", "global", "crypto", "geopolitics", "war"];
    const headlineItem =
      heroPriority
        .map((k) => sections.find((s) => s.key === k)?.items?.[0] || null)
        .find(Boolean) || null;
    const headline = headlineItem?.headline || "No major new items in this cycle.";
    const theme = buildEditionTheme(pulse);
    const summary = buildAstraSummary({ sections, headline, pulse, theme });
    return NextResponse.json(
      {
        name: "ASTRA Briefing",
        cadence,
        generatedAt: new Date(now).toISOString(),
        headline,
        pulse,
        theme,
        summary,
        sections,
        notes: [
          "No-repeat logic is best-effort and uses local memory.",
          "If a story meaningfully updates, it can reappear with a newer publication timestamp.",
        ],
      },
      { headers: { "cache-control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json({ error: "Failed to build briefing", details: String(e?.message || e) }, { status: 500 });
  }
}
