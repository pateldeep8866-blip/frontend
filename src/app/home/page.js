"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { geoMercator, geoPath } from "d3-geo";
import { getSupabaseClient } from "@/app/api/_lib/supabaseClient";
import geopoliticalRelations from "@/data/geopolitical-relations.json";
import AzulaThemeBackground from "@/components/AzulaThemeBackground";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";

function Badge({ value, light = false }) {
  const v = (value || "").toUpperCase();
  const cls =
    v === "BUY"
      ? light
        ? "bg-emerald-100 text-emerald-700 border-emerald-300"
        : "bg-green-500/20 text-green-300 border-green-500/30 shadow-[0_0_20px_rgba(34,197,94,0.22)]"
      : v === "HOLD"
      ? light
        ? "bg-amber-100 text-amber-700 border-amber-300"
        : "bg-yellow-500/20 text-yellow-300 border-yellow-500/30 shadow-[0_0_20px_rgba(234,179,8,0.2)]"
      : v === "AVOID"
      ? light
        ? "bg-rose-100 text-rose-700 border-rose-300"
        : "bg-red-500/20 text-red-300 border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.2)]"
      : light
        ? "bg-slate-100 text-slate-700 border-slate-300"
        : "bg-white/10 text-white/70 border-white/10";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs transition-all duration-300 animate-[pulse_2.2s_ease-in-out_infinite] ${cls}`}
    >
      {v || "—"}
    </span>
  );
}

function fmt(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function fmtLarge(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return `${v.toFixed(2)}`;
}

function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function fmtPctPlain(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

function fmtPctSigned(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function normalizeHistoryEntry(value) {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number"
        ? String(value)
        : value && typeof value === "object"
          ? String(value.symbol || value.id || value.name || "")
          : "";
  const out = String(raw || "").trim().toUpperCase();
  if (!out || out === "[OBJECT OBJECT]") return "";
  return out;
}

function safeDomainFromUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function faviconUrlFor(rawUrl) {
  const domain = safeDomainFromUrl(rawUrl);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

const FX_CURRENCY_OPTIONS = [
  { code: "USD", name: "US Dollar", aliases: ["united states", "america", "dollar"] },
  { code: "EUR", name: "Euro", aliases: ["europe", "eurozone"] },
  { code: "GBP", name: "British Pound", aliases: ["uk", "united kingdom", "britain", "england", "pound"] },
  { code: "JPY", name: "Japanese Yen", aliases: ["japan", "yen"] },
  { code: "INR", name: "Indian Rupee", aliases: ["india", "rupee"] },
  { code: "CAD", name: "Canadian Dollar", aliases: ["canada"] },
  { code: "AUD", name: "Australian Dollar", aliases: ["australia"] },
  { code: "CHF", name: "Swiss Franc", aliases: ["switzerland", "franc"] },
  { code: "CNY", name: "Chinese Yuan", aliases: ["china", "yuan", "renminbi", "rmb"] },
  { code: "AED", name: "UAE Dirham", aliases: ["uae", "united arab emirates", "dirham", "dubai"] },
  { code: "MXN", name: "Mexican Peso", aliases: ["mexico", "peso"] },
];

const DEFAULT_QUIZ_ANSWERS = {
  goal: "",
  horizon: "",
  drawdownAction: "",
  riskTolerance: "",
  incomeStability: "",
  experience: "",
  analysisStyle: "",
  reviewFrequency: "",
  assetClasses: [],
  regionFocus: "",
  sectorPreferences: [],
  exclusions: "",
  liquidityNeeds: "",
  ethicalPreference: "",
  ethicalOther: "",
  dayTradingInterest: "",
  dayTradingMarkets: [],
  dayTradingTime: "",
  followupChange: "",
  followupNotes: "",
};

const GEO_POLITICS_THEMES = [
  {
    title: "Conflict Zones",
    detail: "Major military and regional flashpoints that can reshape global risk appetite.",
  },
  {
    title: "Trade & Sanctions",
    detail: "New sanctions, tariffs, and export controls affecting supply chains and pricing.",
  },
  {
    title: "Energy & Shipping",
    detail: "Oil, gas, and shipping-lane disruptions with direct inflation and growth impact.",
  },
];
const GEO_THEME_RULES = [
  { key: "conflict", label: "Conflict Zones", terms: ["war", "missile", "military", "conflict", "strike", "ceasefire", "nato", "troops"] },
  { key: "trade", label: "Trade & Sanctions", terms: ["sanction", "tariff", "export", "import", "trade", "embargo", "restriction", "duty"] },
  { key: "energy", label: "Energy & Shipping", terms: ["oil", "gas", "lng", "pipeline", "shipping", "strait", "red sea", "opec", "brent"] },
];

const GEO_REGION_RULES = [
  { label: "Europe", terms: ["ukraine", "russia", "eu", "europe", "nato", "poland", "germany", "france", "uk"] },
  { label: "Middle East", terms: ["middle east", "gaza", "israel", "iran", "saudi", "yemen", "uae", "qatar", "iraq"] },
  { label: "Asia-Pacific", terms: ["china", "taiwan", "korea", "japan", "indo-pacific", "south china sea", "philippines", "india"] },
  { label: "Americas", terms: ["united states", "u.s.", "canada", "mexico", "brazil", "latam"] },
  { label: "Africa", terms: ["africa", "sudan", "niger", "ethiopia", "congo"] },
];
const GLOBAL_MAP_WIDTH = 1000;
const GLOBAL_MAP_HEIGHT = 520;
const GLOBAL_MARKET_GEOJSON_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson";
const GLOBAL_MARKET_COUNTRIES = [
  { code: "US", iso2: "US", name: "United States", lon: -98, lat: 39, symbols: [{ symbol: "SPY", label: "S&P 500 Proxy" }, { symbol: "DIA", label: "Dow 30 Proxy" }], keywords: ["united states", "u.s.", "wall street", "federal reserve", "nasdaq", "dow", "s&p"] },
  { code: "CA", iso2: "CA", name: "Canada", lon: -106, lat: 56, symbols: [{ symbol: "EWC", label: "Canada ETF" }], keywords: ["canada", "toronto", "tsx"] },
  { code: "MX", iso2: "MX", name: "Mexico", lon: -102, lat: 23, symbols: [{ symbol: "EWW", label: "Mexico ETF" }], keywords: ["mexico", "peso", "mexican"] },
  { code: "BR", iso2: "BR", name: "Brazil", lon: -52, lat: -14, symbols: [{ symbol: "EWZ", label: "Brazil ETF" }], keywords: ["brazil", "brazilian", "bovespa"] },
  { code: "UK", iso2: "GB", name: "United Kingdom", lon: -1.5, lat: 53.5, symbols: [{ symbol: "EWU", label: "UK ETF" }], keywords: ["uk", "britain", "london", "united kingdom"] },
  { code: "DE", iso2: "DE", name: "Germany", lon: 10.3, lat: 51.2, symbols: [{ symbol: "EWG", label: "Germany ETF" }], keywords: ["germany", "berlin", "frankfurt", "bund"] },
  { code: "FR", iso2: "FR", name: "France", lon: 2.2, lat: 46.2, symbols: [{ symbol: "EWQ", label: "France ETF" }], keywords: ["france", "paris"] },
  { code: "SA", iso2: "SA", name: "Saudi Arabia", lon: 45, lat: 23.8, symbols: [{ symbol: "KSA", label: "Saudi ETF" }], keywords: ["saudi", "riyadh", "aramco"] },
  { code: "AE", iso2: "AE", name: "UAE", lon: 54.3, lat: 24.5, symbols: [{ symbol: "UAE", label: "UAE ETF" }], keywords: ["uae", "dubai", "abu dhabi", "emirates"] },
  { code: "IN", iso2: "IN", name: "India", lon: 78.9, lat: 22.9, symbols: [{ symbol: "INDA", label: "India ETF" }], keywords: ["india", "nifty", "sensex", "rupee"] },
  { code: "CN", iso2: "CN", name: "China", lon: 104, lat: 35.8, symbols: [{ symbol: "MCHI", label: "China ETF" }], keywords: ["china", "beijing", "yuan", "renminbi"] },
  { code: "JP", iso2: "JP", name: "Japan", lon: 138, lat: 36.2, symbols: [{ symbol: "EWJ", label: "Japan ETF" }], keywords: ["japan", "tokyo", "nikkei", "yen"] },
  { code: "KR", iso2: "KR", name: "South Korea", lon: 127.7, lat: 36.3, symbols: [{ symbol: "EWY", label: "Korea ETF" }], keywords: ["korea", "seoul", "kospi"] },
  { code: "AU", iso2: "AU", name: "Australia", lon: 134.5, lat: -25.5, symbols: [{ symbol: "EWA", label: "Australia ETF" }], keywords: ["australia", "asx", "australian"] },
  { code: "ZA", iso2: "ZA", name: "South Africa", lon: 24.5, lat: -29, symbols: [{ symbol: "EZA", label: "South Africa ETF" }], keywords: ["south africa", "johannesburg", "rand"] },
];
const COUNTRY_NAME_TO_ISO = {
  "United States of America": "US",
  "United States": "US",
  "United Kingdom": "GB",
  Russia: "RU",
  "South Korea": "KR",
  Korea: "KR",
  "Dem. Rep. Korea": "KP",
  "Czechia": "CZ",
};

function geoFeatureIso2(feature) {
  const props = feature?.properties || {};
  const iso = String(
    props.ISO_A2 || props.ISO_A2_EH || props.ADM0_A3_US || props.WB_A2 || ""
  ).toUpperCase();
  if (iso && iso !== "-99") return iso;
  const byName = COUNTRY_NAME_TO_ISO[String(props.NAME || props.NAME_EN || "").trim()];
  return byName || "";
}

function geopoliticsThemeFromHeadline(headline) {
  const text = String(headline || "").toLowerCase();
  const matched = GEO_THEME_RULES.find((rule) => rule.terms.some((term) => text.includes(term)));
  return matched?.label || "Strategic Watch";
}

function geopoliticsRegionFromHeadline(headline) {
  const text = String(headline || "").toLowerCase();
  const matched = GEO_REGION_RULES.find((rule) => rule.terms.some((term) => text.includes(term)));
  return matched?.label || "Global";
}

function geopoliticsImpactFromHeadline(headline) {
  const text = String(headline || "").toLowerCase();
  const high = ["war", "attack", "missile", "invasion", "sanction", "strait", "oil spike", "martial"].some((term) => text.includes(term));
  if (high) return "High";
  const medium = ["talks", "summit", "warning", "tariff", "security", "diplomatic", "opec"].some((term) => text.includes(term));
  if (medium) return "Medium";
  return "Low";
}

function geopoliticsTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function geopoliticsAgeLabel(value) {
  const ts = geopoliticsTimestamp(value);
  if (!ts) return "";
  const diffMs = Date.now() - ts;
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const diffHours = Math.floor(diffMs / 3600000);
  if (diffHours < 1) return "just now";
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w ago`;
}

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "zh", label: "Mandarin Chinese" },
  { code: "hi", label: "Hindi" },
  { code: "es", label: "Espanol" },
  { code: "fr", label: "Francais" },
  { code: "ar", label: "Arabic" },
  { code: "bn", label: "Bengali" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "ur", label: "Urdu" },
];

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
const GLOBAL_MACRO_INDICATORS = [
  { key: "vix", label: "VIX", symbol: "^VIX" },
  { key: "tnx", label: "10Y Yield", symbol: "^TNX" },
  { key: "dxy", label: "DXY", symbol: "DX-Y.NYB" },
  { key: "wti", label: "WTI Crude", symbol: "CL=F" },
  { key: "gold", label: "Gold", symbol: "GC=F" },
];
const GLOBAL_MARKET_SESSIONS = [
  { key: "nyse", name: "New York (NYSE)", timeZone: "America/New_York", open: "09:30", close: "16:00", label: "ET" },
  { key: "lse", name: "London (LSE)", timeZone: "Europe/London", open: "08:00", close: "16:30", label: "GMT/BST" },
  { key: "tse", name: "Tokyo (TSE)", timeZone: "Asia/Tokyo", open: "09:00", close: "15:30", label: "JST" },
  { key: "hkex", name: "Hong Kong (HKEX)", timeZone: "Asia/Hong_Kong", open: "09:30", close: "16:00", label: "HKT" },
  { key: "xetra", name: "Frankfurt (XETRA)", timeZone: "Europe/Berlin", open: "09:00", close: "17:30", label: "CET/CEST" },
  { key: "asx", name: "Sydney (ASX)", timeZone: "Australia/Sydney", open: "10:00", close: "16:00", label: "AEST/AEDT" },
];

function withLocalizedHeadlines(items, language, cache) {
  return items.map((item) => {
    const headlineOriginal = String(item?.headline || "");
    const cacheKey = `${language}::${headlineOriginal}`;
    const headlineDisplay =
      language === "en" ? headlineOriginal : cache.get(cacheKey) || headlineOriginal;
    return {
      ...item,
      headlineOriginal,
      headlineDisplay,
    };
  });
}

function resolveLocalizedText(text, language, cache) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  if (language === "en") return raw;
  return cache.get(`${language}::${raw}`) || raw;
}

function marketContextLabel(assetMode) {
  if (assetMode === "crypto") return "crypto prices";
  if (assetMode === "metals") return "metals prices";
  if (assetMode === "fx") return "currency pairs";
  if (assetMode === "geopolitics") return "global risk";
  if (assetMode === "news" || assetMode === "globalmarket") return "cross-market sentiment";
  return "stock prices";
}

function buildHeadlineLaymanSummary(headline, assetMode = "stock") {
  const text = String(headline || "").toLowerCase();
  const context = marketContextLabel(assetMode);
  if (!text) return `This update can move ${context} in the short term.`;

  if (/(rise|rises|rally|surge|jump|gain|record high|all-time high|beat estimates)/.test(text)) {
    return "This is generally positive news and may support prices if momentum continues.";
  }
  if (/(fall|falls|drop|drops|slump|plunge|misses|downgrade|cuts forecast)/.test(text)) {
    return "This is generally negative news and may pressure prices until confidence improves.";
  }
  if (/(fed|ecb|boj|central bank|interest rate|rate cut|rate hike|cpi|inflation|jobs report|payroll)/.test(text)) {
    return "This is macro policy news that can move the whole market by changing rate and growth expectations.";
  }
  if (/(earnings|revenue|profit|guidance|quarter|forecast)/.test(text)) {
    return "This is company performance news. Investors compare results versus expectations to decide direction.";
  }
  if (/(sanction|tariff|export|import|trade|embargo|regulation|sec)/.test(text)) {
    return "This is policy or regulation news that can raise uncertainty and reprice risk quickly.";
  }
  if (/(oil|gas|lng|opec|pipeline|shipping|strait|red sea)/.test(text)) {
    return "This is energy and supply-chain news that can impact inflation, transport costs, and market volatility.";
  }
  if (/(bitcoin|ethereum|crypto|token|etf approval|etf flows)/.test(text)) {
    return "This is crypto-specific news that can change risk appetite and near-term demand for digital assets.";
  }
  if (/(gold|silver|platinum|palladium|copper|metals)/.test(text)) {
    return "This is metals-market news tied to inflation, safe-haven demand, and industrial growth expectations.";
  }

  return `This headline can shift ${context} sentiment and short-term price direction.`;
}

function buildNewsDigest(headlines, assetMode = "stock") {
  const list = Array.isArray(headlines)
    ? headlines.map((h) => String(h || "").toLowerCase()).filter(Boolean)
    : [];
  if (!list.length) return "";

  let macro = 0;
  let earnings = 0;
  let policy = 0;
  let risk = 0;
  let positive = 0;
  let negative = 0;

  for (const text of list) {
    if (/(fed|ecb|boj|interest rate|cpi|inflation|jobs|payroll)/.test(text)) macro += 1;
    if (/(earnings|revenue|profit|guidance|quarter)/.test(text)) earnings += 1;
    if (/(sanction|tariff|regulation|sec|policy|export|import|embargo)/.test(text)) policy += 1;
    if (/(war|missile|conflict|attack|shipping|strait|oil|gas)/.test(text)) risk += 1;
    if (/(rise|rally|surge|jump|beat|record high)/.test(text)) positive += 1;
    if (/(fall|drop|slump|plunge|miss|downgrade|cuts forecast)/.test(text)) negative += 1;
  }

  const segments = [];
  if (macro >= 2) segments.push("Macro signals are a major driver right now.");
  if (policy >= 2) segments.push("Policy and regulation headlines are raising uncertainty.");
  if (earnings >= 2) segments.push("Earnings updates are shaping near-term direction.");
  if (risk >= 2) segments.push("Geopolitical and supply risks are still in play.");

  if (positive > negative) {
    segments.push(`Overall tone is slightly risk-on, which can support ${marketContextLabel(assetMode)}.`);
  } else if (negative > positive) {
    segments.push(`Overall tone is risk-off, which can pressure ${marketContextLabel(assetMode)}.`);
  } else {
    segments.push("Headline tone is mixed, so expect two-way volatility.");
  }

  return segments.join(" ");
}

function buildDailyPickLaymanSummary(view) {
  const short = cleanAiText(view?.shortSummary || view?.longSummary || "");
  if (short) return short;
  const ticker = String(view?.ticker || "this asset").trim() || "this asset";
  const recommendation = String(view?.recommendation || "HOLD").toUpperCase();
  const firstWhy = Array.isArray(view?.why) ? String(view.why[0] || "").trim() : "";
  const firstRisk = Array.isArray(view?.risks) ? String(view.risks[0] || "").trim() : "";
  const action = recommendation === "BUY" ? "has a constructive setup" : recommendation === "AVOID" ? "has elevated downside risk" : "is currently a watchlist setup";
  if (firstWhy || firstRisk) {
    return `${ticker} ${action}. Main reason: ${firstWhy || "setup quality"}. Main risk: ${firstRisk || "headline volatility"}.`;
  }
  return `${ticker} ${action}. Treat this as an educational idea and verify with your own risk plan before acting.`;
}

function buildSearchSectionSummary(payload) {
  const assetMode = String(payload?.assetMode || "stock");
  const symbol = String(payload?.usingTicker || payload?.result?.symbol || "").trim();
  const name = String(payload?.company?.name || "").trim();
  const display = symbol || name || "this asset";
  const short = cleanAiText(payload?.analysis?.shortSummary || payload?.analysis?.longSummary || "");
  const confidence = Number(payload?.analysis?.confidence || 0);
  const recommendation = String(payload?.analysis?.recommendation || "").trim().toUpperCase();
  const risk = String(payload?.analysis?.riskLevel || "").trim().toUpperCase();
  const price = String(payload?.result?.price || "").trim();
  const change = String(payload?.result?.change || "").trim();
  const info = String(payload?.result?.info || "").trim();

  if (!display && !short && !price && !info) return "";

  const parts = [`${display} ${assetMode === "crypto" ? "crypto" : assetMode === "metals" ? "metal" : "market"} snapshot.`];
  if (short) parts.push(short);
  if (price && price !== "Loading...") parts.push(`Current price: ${price}.`);
  if (change) parts.push(`Day move: ${change}.`);
  if (recommendation) {
    parts.push(
      confidence > 0
        ? `ASTRA view: ${recommendation} with ${confidence}% confidence${risk ? ` and ${risk} risk` : ""}.`
        : `ASTRA view: ${recommendation}${risk ? ` with ${risk} risk` : ""}.`
    );
  } else if (risk) {
    parts.push(`Current risk level: ${risk}.`);
  }
  if (!short && info) parts.push(info);
  return parts.join(" ");
}

function buildFxSearchSummary(fxResult) {
  if (!fxResult) return "";
  const amount = Number(fxResult?.amount);
  const converted = Number(fxResult?.converted);
  const rate = Number(fxResult?.rate);
  if (!Number.isFinite(amount) || !Number.isFinite(converted) || !Number.isFinite(rate)) return "";
  return `${amount.toFixed(2)} ${fxResult.from} converts to ${converted.toFixed(4)} ${fxResult.to} at a rate of ${rate.toFixed(6)}. This is your quick purchasing-power snapshot.`;
}

function formatMacroIndicatorValue(symbol, value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  if (symbol === "^TNX") return `${(n / 10).toFixed(2)}%`;
  if (symbol === "^VIX") return n.toFixed(2);
  return n >= 100 ? n.toFixed(2) : n.toFixed(3);
}

function parseSessionClock(value) {
  const [h, m] = String(value || "00:00")
    .split(":")
    .map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

function formatCountdown(minutes) {
  const mins = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function relationColor(kind, isLight) {
  if (kind === "ally") return "#22c55e";
  if (kind === "tension") return "#ef4444";
  if (kind === "conflict") return "#7f1d1d";
  if (kind === "trade") return "#60a5fa";
  return isLight ? "#d1d5db" : "#334155";
}

function buildSparklinePolyline(values, width = 60, height = 30, pad = 2) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (nums.length < 2) return "";
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const w = width - pad * 2;
  const h = height - pad * 2;
  return nums
    .map((v, i) => {
      const x = pad + (i / (nums.length - 1)) * w;
      const y = pad + (1 - (v - min) / span) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function getSessionStatus(session, now = new Date()) {
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: session.timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const part = (type) => parts.find((p) => p.type === type)?.value || "";
  const weekday = weekdayMap[part("weekday")] ?? 0;
  const hour = Number(part("hour") || 0);
  const minute = Number(part("minute") || 0);
  const nowMinutes = hour * 60 + minute;
  const openMinutes = parseSessionClock(session.open);
  const closeMinutes = parseSessionClock(session.close);
  const isBusinessDay = weekday >= 1 && weekday <= 5;
  const isOpen = isBusinessDay && nowMinutes >= openMinutes && nowMinutes < closeMinutes;

  let minutesUntil = 0;
  let phase = "open";

  if (isOpen) {
    phase = "close";
    minutesUntil = closeMinutes - nowMinutes;
  } else {
    phase = "open";
    if (isBusinessDay && nowMinutes < openMinutes) {
      minutesUntil = openMinutes - nowMinutes;
    } else {
      let daysAhead = 1;
      while (daysAhead <= 7) {
        const d = (weekday + daysAhead) % 7;
        if (d >= 1 && d <= 5) break;
        daysAhead += 1;
      }
      minutesUntil = daysAhead * 1440 + openMinutes - nowMinutes;
    }
  }

  const localTime = new Intl.DateTimeFormat("en-US", {
    timeZone: session.timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);

  return { isOpen, phase, minutesUntil, localTime };
}

function localizeAiPayloadView(view, language, cache) {
  if (!view || typeof view !== "object") return view;
  if (language === "en") return view;
  const localizeText = (value) => resolveLocalizedText(value, language, cache);
  const localizeList = (items) =>
    Array.isArray(items)
      ? items.map((x) => localizeText(String(x || ""))).filter(Boolean)
      : [];
  return {
    ...view,
    why: localizeList(view.why),
    risks: localizeList(view.risks),
    strengths: localizeList(view.strengths),
    dayPlan: localizeText(view.dayPlan),
    shortSummary: localizeText(view.shortSummary),
    longSummary: localizeText(view.longSummary),
    riskExplanation: localizeText(view.riskExplanation),
    outlook: localizeText(view.outlook),
    note: localizeText(view.note),
    fallbackText: localizeText(view.fallbackText),
  };
}

const UI_TEXT = {
  en: {
    theme: "Theme",
    menu: "Menu",
    language: "Language",
    dark: "Dark",
    light: "Light",
    sakura: "Sakura",
    azula: "Azula",
    alerik: "Alerik",
    home: "Home",
    learn: "Learn",
    marketSchool: "Market School",
    simulator: "Bots",
    portfolio: "Portfolio",
    about: "About",
    terms: "Terms of Service",
    privacy: "Privacy Policy",
    cookies: "Cookie Policy",
    disclaimer: "Disclaimer",
    help: "Help",
    loginSignup: "Login / Signup",
    supportEmail: "Support Email",
    copyEmail: "Copy email",
    analyticalInformation: "Analytical Information",
    clarityLine: "Clarity in Every Market.",
    founder: "Founder",
    coFounder: "Co-founder",
    stock: "Stocks/ETF/MF",
    crypto: "Crypto",
    metals: "Metals",
    fx: "FX",
    news: "News",
    geoPolitics: "Geo Politics",
    globalMarket: "Global Market",
    warRoom: "War Room",
    briefing: "Briefing",
  },
  es: {
    theme: "Tema",
    menu: "Menu",
    language: "Idioma",
    dark: "Oscuro",
    light: "Claro",
    sakura: "Sakura",
    azula: "Azula",
    alerik: "Alerik",
    home: "Inicio",
    learn: "Aprender",
    marketSchool: "Market School",
    simulator: "Bots",
    portfolio: "Portafolio",
    about: "Acerca de",
    terms: "Terminos de servicio",
    privacy: "Politica de privacidad",
    cookies: "Politica de cookies",
    disclaimer: "Descargo de responsabilidad",
    help: "Ayuda",
    loginSignup: "Iniciar sesion / Registro",
    supportEmail: "Correo de soporte",
    copyEmail: "Copiar correo",
    analyticalInformation: "Informacion Analitica",
    clarityLine: "Claridad en cada mercado.",
    founder: "Fundador",
    coFounder: "Cofundador",
    stock: "Acciones/ETF/FI",
    crypto: "Cripto",
    metals: "Metales",
    fx: "FX",
    news: "Noticias",
    geoPolitics: "Geopolitica",
    globalMarket: "Mercado Global",
    warRoom: "War Room",
    briefing: "Briefing",
  },
  fr: {
    theme: "Theme",
    menu: "Menu",
    language: "Langue",
    dark: "Sombre",
    light: "Clair",
    sakura: "Sakura",
    azula: "Azula",
    alerik: "Alerik",
    home: "Accueil",
    learn: "Learn",
    marketSchool: "Market School",
    simulator: "Bots",
    portfolio: "Portefeuille",
    about: "A propos",
    terms: "Conditions d'utilisation",
    privacy: "Politique de confidentialite",
    cookies: "Politique de cookies",
    disclaimer: "Avertissement",
    help: "Aide",
    loginSignup: "Connexion / Inscription",
    supportEmail: "Email de support",
    copyEmail: "Copier l'email",
    analyticalInformation: "Information Analytique",
    clarityLine: "Clarte sur chaque marche.",
    founder: "Fondateur",
    coFounder: "Cofondateur",
    stock: "Actions/ETF/FCP",
    crypto: "Crypto",
    metals: "Metaux",
    fx: "FX",
    news: "Actualites",
    geoPolitics: "Geopolitique",
    globalMarket: "Marche Global",
    warRoom: "War Room",
    briefing: "Briefing",
  },
  hi: {
    theme: "थीम",
    menu: "मेन्यू",
    language: "भाषा",
    dark: "डार्क",
    light: "लाइट",
    sakura: "सकुरा",
    azula: "अज़ूला",
    alerik: "Alerik",
    home: "होम",
    learn: "लर्न",
    marketSchool: "मार्केट स्कूल",
    simulator: "बॉट्स",
    portfolio: "पोर्टफोलियो",
    about: "अबाउट",
    terms: "सेवा की शर्तें",
    privacy: "प्राइवेसी पॉलिसी",
    cookies: "कुकी नीति",
    disclaimer: "डिस्क्लेमर",
    help: "मदद",
    loginSignup: "लॉगिन / साइनअप",
    supportEmail: "सपोर्ट ईमेल",
    copyEmail: "ईमेल कॉपी करें",
    analyticalInformation: "विश्लेषणात्मक जानकारी",
    clarityLine: "हर बाजार में स्पष्टता।",
    founder: "संस्थापक",
    coFounder: "सह-संस्थापक",
    stock: "स्टॉक्स/ETF/MF",
    crypto: "क्रिप्टो",
    metals: "मेटल्स",
    fx: "एफएक्स",
    news: "समाचार",
    geoPolitics: "जियो पॉलिटिक्स",
    globalMarket: "ग्लोबल मार्केट",
    warRoom: "वार रूम",
    briefing: "ब्रीफिंग",
  },
};


function normalizeQuizAnswers(value) {
  const raw = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_QUIZ_ANSWERS,
    ...raw,
    assetClasses: Array.isArray(raw.assetClasses) ? raw.assetClasses : [],
    sectorPreferences: Array.isArray(raw.sectorPreferences) ? raw.sectorPreferences : [],
    dayTradingMarkets: Array.isArray(raw.dayTradingMarkets) ? raw.dayTradingMarkets : [],
  };
}

function resolveCurrencyInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper)) {
    const exact = FX_CURRENCY_OPTIONS.find((x) => x.code === upper);
    return exact?.code || "";
  }
  const q = raw.toLowerCase();
  const hit = FX_CURRENCY_OPTIONS.find((x) =>
    x.name.toLowerCase().includes(q) || x.aliases.some((a) => a.includes(q))
  );
  return hit?.code || "";
}

function mapIndustryToSectorETF(industryRaw) {
  const industry = String(industryRaw || "").toLowerCase();
  if (!industry) return { label: "Unknown", etf: "SPY" };
  if (industry.includes("tech") || industry.includes("software") || industry.includes("semiconductor")) {
    return { label: "Technology", etf: "XLK" };
  }
  if (industry.includes("bank") || industry.includes("financial")) return { label: "Financials", etf: "XLF" };
  if (industry.includes("health") || industry.includes("biotech") || industry.includes("pharma")) {
    return { label: "Healthcare", etf: "XLV" };
  }
  if (industry.includes("energy") || industry.includes("oil") || industry.includes("gas")) {
    return { label: "Energy", etf: "XLE" };
  }
  if (industry.includes("consumer") || industry.includes("retail")) return { label: "Consumer", etf: "XLY" };
  if (industry.includes("industrial") || industry.includes("aerospace")) return { label: "Industrials", etf: "XLI" };
  if (industry.includes("communication") || industry.includes("media")) return { label: "Communication", etf: "XLC" };
  if (industry.includes("utility")) return { label: "Utilities", etf: "XLU" };
  if (industry.includes("real estate")) return { label: "Real Estate", etf: "XLRE" };
  return { label: "Broad Market", etf: "SPY" };
}

function canonicalTicker(input) {
  const raw = String(input || "").trim().toUpperCase();
  if (!raw) return "";

  const aliasMap = {
    GOOGLE: "GOOGL",
    ALPHABET: "GOOGL",
    FACEBOOK: "META",
    HONDA: "HMC",
    TOYOTA: "TM",
  };
  if (aliasMap[raw]) return aliasMap[raw];

  // Convert foreign exchange tickers to base ticker when possible (e.g. HMC.AX -> HMC, 7203.T -> 7203)
  const parts = raw.split(".");
  if (parts.length === 2) {
    const [base, suffix] = parts;
    const foreignSuffixes = new Set([
      "AX", "T", "TO", "L", "HK", "AS", "PA", "MI", "SW", "F", "DE", "ST", "OL", "HE", "V", "KS", "KQ",
    ]);
    if (foreignSuffixes.has(suffix) && base) {
      return base;
    }
  }

  return raw;
}

function cleanAiText(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function cleanChatAnswer(value) {
  const text = cleanAiText(value)
    .replace(/\*\*/g, "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s*/gm, "- ")
    .replace(/\bEducational only\. Not financial advice\.\s*/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text;
}

function parseJsonLike(text) {
  const cleaned = cleanAiText(text);
  if (!cleaned) return null;

  try {
    return JSON.parse(cleaned);
  } catch {}

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function extractQuotedField(text, key) {
  const fieldPattern = new RegExp(
    `"${key}"\\s*:\\s*"([\\s\\S]*?)"\\s*(?=,\\s*"(?:ticker|recommendation|why|risks|day_plan|note|risk_level|confidence|ai_score|bull_probability|bear_probability|horizon|risk_explanation|short_summary|long_summary|reasoning_categories|strengths|outlook)"\\s*:|,\\s*}|})`,
    "i"
  );
  const match = text.match(fieldPattern);
  return match?.[1]?.trim() || "";
}

function extractArrayField(text, key) {
  const sectionPattern = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`, "i");
  const section = text.match(sectionPattern)?.[1] || "";
  if (!section) return [];

  const items = [];
  const itemRegex = /"([^"]+)"/g;
  let m;
  while ((m = itemRegex.exec(section)) !== null) {
    const value = String(m[1] || "").trim();
    if (value) items.push(value);
  }
  return items;
}

function extractNumericField(text, key) {
  const numericPattern = new RegExp(`"${key}"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)`, "i");
  const matched = text.match(numericPattern)?.[1];
  const value = Number(matched);
  return Number.isFinite(value) ? value : NaN;
}

function parseLooseAnalysisText(text) {
  const cleaned = cleanAiText(text);
  if (!cleaned) return null;

  const ticker = extractQuotedField(cleaned, "ticker").toUpperCase();
  const recommendation = extractQuotedField(cleaned, "recommendation").toUpperCase();
  const why = extractArrayField(cleaned, "why");
  const risks = extractArrayField(cleaned, "risks");
  const day_plan = extractQuotedField(cleaned, "day_plan");
  const note = extractQuotedField(cleaned, "note");
  const risk_level = extractQuotedField(cleaned, "risk_level").toUpperCase();
  const horizon = extractQuotedField(cleaned, "horizon").toUpperCase();
  const risk_explanation = extractQuotedField(cleaned, "risk_explanation");
  const short_summary = extractQuotedField(cleaned, "short_summary");
  const long_summary = extractQuotedField(cleaned, "long_summary");
  const outlook = extractQuotedField(cleaned, "outlook");
  const strengths = extractArrayField(cleaned, "strengths");
  const confidenceText = extractQuotedField(cleaned, "confidence");
  const confidenceQuoted = Number(confidenceText.replace(/[^0-9.]/g, ""));
  const confidenceNumeric = extractNumericField(cleaned, "confidence");
  const confidence = Number.isFinite(confidenceQuoted) && confidenceQuoted > 0 ? confidenceQuoted : confidenceNumeric;
  const ai_score = extractNumericField(cleaned, "ai_score");
  const bull_probability = extractNumericField(cleaned, "bull_probability");
  const bear_probability = extractNumericField(cleaned, "bear_probability");
  const fundamental = extractNumericField(cleaned, "fundamental");
  const technical = extractNumericField(cleaned, "technical");
  const sentiment = extractNumericField(cleaned, "sentiment");
  const reasoning_categories =
    Number.isFinite(fundamental) || Number.isFinite(technical) || Number.isFinite(sentiment)
      ? {
          fundamental: Number.isFinite(fundamental) ? fundamental : 0,
          technical: Number.isFinite(technical) ? technical : 0,
          sentiment: Number.isFinite(sentiment) ? sentiment : 0,
        }
      : undefined;

  if (!ticker && !recommendation && !why.length && !risks.length && !day_plan && !note && !risk_level && !short_summary) {
    return null;
  }

  return {
    ticker,
    recommendation,
    why,
    risks,
    day_plan,
    note,
    risk_level,
    confidence,
    ai_score,
    bull_probability,
    bear_probability,
    horizon,
    risk_explanation,
    short_summary,
    long_summary,
    reasoning_categories,
    strengths,
    outlook,
  };
}

function listOfStrings(value) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || "").trim()).filter(Boolean);
}

function normalizeAiPayload(payload) {
  const sourceText = payload?.raw || payload?.note;
  const parsed = parseJsonLike(sourceText) || parseLooseAnalysisText(sourceText);
  const merged = { ...(parsed || {}), ...(payload || {}) };

  const ticker = String(merged?.ticker || "").trim().toUpperCase();
  const recommendation = String(merged?.recommendation || "").trim().toUpperCase();
  const why = listOfStrings(merged?.why);
  const risks = listOfStrings(merged?.risks);
  const strengths = listOfStrings(merged?.strengths);
  const dayPlan = String(merged?.day_plan || merged?.dayPlan || "").trim();
  const note = cleanAiText(merged?.note);
  const shortSummary = cleanAiText(merged?.short_summary || merged?.shortSummary);
  const longSummary = cleanAiText(merged?.long_summary || merged?.longSummary);
  const riskExplanation = cleanAiText(merged?.risk_explanation || merged?.riskExplanation);
  const outlook = cleanAiText(merged?.outlook);
  const confidenceRaw = Number(String(merged?.confidence ?? "").replace(/[^0-9.]/g, ""));
  const confidence = Number.isFinite(confidenceRaw) && confidenceRaw > 0
    ? Math.min(100, Math.round(confidenceRaw))
    : recommendation === "BUY"
      ? 74
      : recommendation === "HOLD"
        ? 61
        : recommendation === "AVOID"
          ? 57
          : 0;
  const riskLevelRaw = String(merged?.risk_level || merged?.riskLevel || "").trim().toUpperCase();
  const riskLevel = riskLevelRaw || (risks.length >= 3 ? "HIGH" : risks.length === 2 ? "MEDIUM" : "LOW");
  const aiScoreRaw = Number(String(merged?.ai_score ?? "").replace(/[^0-9.]/g, ""));
  const aiScore = Number.isFinite(aiScoreRaw) && aiScoreRaw > 0 ? Math.min(100, Math.round(aiScoreRaw)) : confidence;
  const bullRaw = Number(String(merged?.bull_probability ?? "").replace(/[^0-9.]/g, ""));
  const bearRaw = Number(String(merged?.bear_probability ?? "").replace(/[^0-9.]/g, ""));
  const bullProbability = Number.isFinite(bullRaw) ? Math.min(100, Math.max(0, Math.round(bullRaw))) : Math.min(95, Math.max(5, aiScore));
  const bearProbability = Number.isFinite(bearRaw) ? Math.min(100, Math.max(0, Math.round(bearRaw))) : 100 - bullProbability;
  const horizon = String(merged?.horizon || "").trim().toUpperCase() || (recommendation === "BUY" ? "LONG_TERM" : "SHORT_TERM");
  const rc = merged?.reasoning_categories || {};
  const reasoningCategories = {
    fundamental: Math.min(100, Math.max(0, Number(rc?.fundamental ?? 55) || 55)),
    technical: Math.min(100, Math.max(0, Number(rc?.technical ?? 50) || 50)),
    sentiment: Math.min(100, Math.max(0, Number(rc?.sentiment ?? 52) || 52)),
  };

  let fallbackText = "";
  if (!why.length && !risks.length && !dayPlan) {
    fallbackText = cleanAiText(merged?.raw || merged?.note);
    if (parsed) fallbackText = "";
  }

  return {
    ticker,
    recommendation,
    why,
    risks,
    strengths,
    dayPlan,
    shortSummary,
    longSummary,
    riskExplanation,
    outlook,
    note,
    confidence,
    aiScore,
    bullProbability,
    bearProbability,
    horizon,
    reasoningCategories,
    riskLevel,
    fallbackText,
  };
}

function drawLineChart(canvas, points) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  if (!points?.length) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "12px system-ui";
    ctx.fillText("No chart data", 10, 20);
    return;
  }

  const closes = points.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const pad = 10;

  const xStep = (w - pad * 2) / (points.length - 1 || 1);

  const y = (val) => {
    if (max === min) return h / 2;
    const t = (val - min) / (max - min);
    return h - pad - t * (h - pad * 2);
  };

  // grid
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const gy = (h / 4) * i;
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // line
  ctx.strokeStyle = "rgba(59,130,246,0.9)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const px = pad + i * xStep;
    const py = y(p.close);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();

  // last value label
  const last = points[points.length - 1]?.close;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "12px system-ui";
  ctx.fillText(`Last: $${last?.toFixed?.(2) ?? last}`, 10, 18);
}

function Card({ title, right, children }) {
  return (
    <div className="app-card rounded-2xl border border-white/12 bg-slate-900/55 backdrop-blur-md p-5 md:p-6 shadow-[0_14px_40px_-22px_rgba(15,23,42,0.9)] transition-all duration-300">
      <div className="flex items-center justify-between mb-4">
        <div className="app-card-title text-sm font-semibold text-slate-100 tracking-wide">{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function SummaryPanel({ label = "Summary", text, isLight, className = "" }) {
  if (!text) return null;
  return (
    <div
      className={`rounded-xl border p-3.5 ${isLight ? "border-slate-200 bg-gradient-to-b from-white to-slate-50" : "border-white/12 bg-gradient-to-b from-white/[0.08] to-white/[0.03]"} ${className}`.trim()}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className={`inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] ${isLight ? "text-slate-600" : "text-cyan-200/85"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isLight ? "bg-slate-500" : "bg-cyan-300"}`} />
          {label}
        </div>
        <div className={`text-[10px] uppercase tracking-[0.14em] ${isLight ? "text-slate-400" : "text-white/45"}`}>Executive Brief</div>
      </div>
      <p className={`text-sm leading-relaxed ${isLight ? "text-slate-700" : "text-white/85"}`}>{text}</p>
    </div>
  );
}

export default function Home() {
  const [assetMode, setAssetMode] = useState("stock");
  const [ticker, setTicker] = useState("");
  const [usingTicker, setUsingTicker] = useState("");
  const [usingAssetId, setUsingAssetId] = useState("");

  const [result, setResult] = useState(null);
  const [company, setCompany] = useState(null);
  const [news, setNews] = useState([]);
  const [searchHistory, setSearchHistory] = useState([]);
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suppressSuggestions, setSuppressSuggestions] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [theme, setTheme] = useState("dark");
  const [language, setLanguage] = useState("en");
  const [analysisViewMode, setAnalysisViewMode] = useState("short");
  const [marketNews, setMarketNews] = useState([]);
  const [globalMarketCountry, setGlobalMarketCountry] = useState("US");
  const [globalCountryQuery, setGlobalCountryQuery] = useState("");
  const [globalMapZoom, setGlobalMapZoom] = useState(1);
  const [globalCountryQuotes, setGlobalCountryQuotes] = useState([]);
  const [globalCountryQuotesLoading, setGlobalCountryQuotesLoading] = useState(false);
  const [globalWorldFeatures, setGlobalWorldFeatures] = useState([]);
  const [globalWorldLoading, setGlobalWorldLoading] = useState(false);
  const [globalWorldError, setGlobalWorldError] = useState("");
  const [globalMacroRows, setGlobalMacroRows] = useState([]);
  const [globalMacroLoading, setGlobalMacroLoading] = useState(false);
  const [marketSessionsTick, setMarketSessionsTick] = useState(Date.now());
  const [geoCountrySummary, setGeoCountrySummary] = useState("");
  const [geoCountrySummaryLoading, setGeoCountrySummaryLoading] = useState(false);
  const geoCountrySummaryCacheRef = useRef(new Map());
  const [geoCountrySummaryVersion, setGeoCountrySummaryVersion] = useState(0);
  const [geoFilter, setGeoFilter] = useState("all");
  const [geoRegionFilter, setGeoRegionFilter] = useState("all");
  const [geoSort, setGeoSort] = useState("impact");
  const [geoQuery, setGeoQuery] = useState("");
  const [movers, setMovers] = useState({ gainers: [], losers: [] });
  const [sectorInfo, setSectorInfo] = useState(null);
  const [compareInput, setCompareInput] = useState("AAPL,MSFT,NVDA");
  const [compareRows, setCompareRows] = useState([]);
  const [compareError, setCompareError] = useState("");
  const [compareInvalidTickers, setCompareInvalidTickers] = useState([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const [fxFrom, setFxFrom] = useState("USD");
  const [fxTo, setFxTo] = useState("INR");
  const [fxAmount, setFxAmount] = useState("1");
  const [fxResult, setFxResult] = useState(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [fxError, setFxError] = useState("");

  const [loading, setLoading] = useState(false);

  // AI
  const [analysisObj, setAnalysisObj] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [dailyObj, setDailyObj] = useState(null);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([
    {
      role: "assistant",
      content:
        "I am ASTRA. Ask me about stocks, crypto, metals, FX, world news, or geopolitics.",
    },
  ]);
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState("signin");
  const [authFirstName, setAuthFirstName] = useState("");
  const [authLastName, setAuthLastName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authConfirmPassword, setAuthConfirmPassword] = useState("");
  const [authSignupCode, setAuthSignupCode] = useState("");
  const [authSignupCodeSent, setAuthSignupCodeSent] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileLastName, setProfileLastName] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [welcomeBanner, setWelcomeBanner] = useState({ show: false, text: "" });
  const [quizAnswers, setQuizAnswers] = useState(DEFAULT_QUIZ_ANSWERS);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [quizPanelOpen, setQuizPanelOpen] = useState(false);
  const [quizDismissed, setQuizDismissed] = useState(false);
  const [quizSaving, setQuizSaving] = useState(false);
  const [quizError, setQuizError] = useState("");
  const [quizCompletedAt, setQuizCompletedAt] = useState("");
  const [quizFollowupMode, setQuizFollowupMode] = useState(false);
  const [quizFollowupDue, setQuizFollowupDue] = useState(false);
  const [dayTraderObj, setDayTraderObj] = useState(null);
  const [dayTraderLoading, setDayTraderLoading] = useState(false);
  const [portfolioSymbolInput, setPortfolioSymbolInput] = useState("");
  const [portfolioQtyInput, setPortfolioQtyInput] = useState("1");
  const [portfolioBuyPriceInput, setPortfolioBuyPriceInput] = useState("");
  const [portfolioBuyDateInput, setPortfolioBuyDateInput] = useState("");
  const [portfolioHoldings, setPortfolioHoldings] = useState([]);
  const [portfolioRows, setPortfolioRows] = useState([]);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const [portfolioAnalyzing, setPortfolioAnalyzing] = useState(false);
  const [portfolioError, setPortfolioError] = useState("");
  const [portfolioNotice, setPortfolioNotice] = useState("");
  const [portfolioAnalysis, setPortfolioAnalysis] = useState(null);
  const [portfolioSuggestions, setPortfolioSuggestions] = useState([]);
  const [portfolioSuggestionLoading, setPortfolioSuggestionLoading] = useState(false);
  const [portfolioSuggestionOpen, setPortfolioSuggestionOpen] = useState(false);
  const headlineTranslationCacheRef = useRef(new Map());
  const headlineTranslationRequestRef = useRef(0);
  const [headlineTranslationVersion, setHeadlineTranslationVersion] = useState(0);
  const headlineInsightCacheRef = useRef(new Map());
  const headlineInsightRequestRef = useRef(0);
  const [headlineInsightVersion, setHeadlineInsightVersion] = useState(0);
  const quizPromptTimerRef = useRef(null);
  const initialQuizPromptedRef = useRef(false);
  const followupQuizPromptedRef = useRef(false);

  // Market overview
  const overviewStockTickers = useMemo(() => ["SPY", "QQQ", "DIA", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META"], []);
  const overviewCryptoIds = useMemo(
    () => ["bitcoin", "ethereum", "solana", "binancecoin", "ripple", "dogecoin", "cardano", "avalanche-2", "chainlink", "tron"],
    []
  );
  const overviewMetalsIds = useMemo(
    () => ["XAU", "XAG", "XPT", "XPD"],
    []
  );
  const metalNameBySymbol = useMemo(
    () => ({
      XAU: "Gold",
      XAG: "Silver",
      XPT: "Platinum",
      XPD: "Palladium",
    }),
    []
  );
  const overviewTickers =
    assetMode === "crypto" ? overviewCryptoIds : assetMode === "metals" ? overviewMetalsIds : assetMode === "fx" ? ["USD/EUR", "USD/GBP", "USD/JPY"] : overviewStockTickers;
  const [overview, setOverview] = useState([]);
  const [overviewSparklines, setOverviewSparklines] = useState({});
  const [simulatorReturnPct, setSimulatorReturnPct] = useState(null);
  const [simulatorAutoPilotActive, setSimulatorAutoPilotActive] = useState(false);
  const [fundamentals, setFundamentals] = useState(null);
  const [fundInsights, setFundInsights] = useState(null);
  const [fundInsightsLoading, setFundInsightsLoading] = useState(false);
  const [secFundamentals, setSecFundamentals] = useState(null);
  const [secFundamentalsLoading, setSecFundamentalsLoading] = useState(false);

  // Chart
  const [chartPoints, setChartPoints] = useState([]);
  const [chartRange, setChartRange] = useState("1M");
  const [chartLoading, setChartLoading] = useState(false);
  const [latestVolume, setLatestVolume] = useState(null);
  const chartRef = useRef(null);

  const addToSearchHistory = (value) => {
    const item = normalizeHistoryEntry(value);
    if (!item) return;
    setSearchHistory((prev) => {
      const cleanPrev = prev.map(normalizeHistoryEntry).filter(Boolean);
      return [item, ...cleanPrev.filter((x) => x !== item)].slice(0, 8);
    });
  };

  useEffect(() => {
    const VALID_ASSET_MODES = new Set(["stock", "crypto", "metals", "fx", "geopolitics", "globalmarket", "news"]);
    try {
      const h = JSON.parse(localStorage.getItem("search_history") || "[]");
      if (Array.isArray(h)) setSearchHistory(h.map(normalizeHistoryEntry).filter(Boolean).slice(0, 8));
    } catch {}
    try {
      const t = localStorage.getItem("theme_mode");
      if (t === "light" || t === "dark" || t === "cherry" || t === "azula" || t === "alerik") setTheme(t);
    } catch {}
    try {
      const l = localStorage.getItem("site_language");
      if (LANGUAGE_OPTIONS.some((x) => x.code === l)) setLanguage(l);
    } catch {}
    try {
      const params = new URLSearchParams(window.location.search);
      const modeFromQuery = String(params.get("mode") || "").toLowerCase().trim();
      const conflictFromQuery = String(params.get("conflict") || "").trim();
      const companyFromQuery = String(params.get("company") || "").toUpperCase().trim();
      if (VALID_ASSET_MODES.has(modeFromQuery)) {
        setAssetMode(modeFromQuery);
      }
      const rawWarRoom = localStorage.getItem("warroom_context_v1");
      const warRoomContext = rawWarRoom ? JSON.parse(rawWarRoom) : null;
      const modeFromWarRoom = String(warRoomContext?.suggestedMode || "").toLowerCase().trim();
      if (!modeFromQuery && VALID_ASSET_MODES.has(modeFromWarRoom)) {
        setAssetMode(modeFromWarRoom);
      }
      const contextCompany = companyFromQuery || String(warRoomContext?.ticker || "").toUpperCase().trim();
      if (contextCompany && /^[A-Z0-9.\-]{1,12}$/.test(contextCompany)) {
        setTicker(contextCompany);
      }
      const contextConflict = conflictFromQuery || String(warRoomContext?.conflictName || "").trim();
      if (contextConflict && (modeFromQuery === "geopolitics" || modeFromWarRoom === "geopolitics")) {
        setGeoQuery(contextConflict);
      }
    } catch {}
    try {
      const raw = localStorage.getItem("headline_impact_cache_v1");
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object") {
        const now = Date.now();
        Object.entries(parsed).forEach(([headline, item]) => {
          const value = String(item?.value || "").trim();
          const ts = Number(item?.ts || 0);
          if (!value) return;
          if (Number.isFinite(ts) && now - ts <= 1000 * 60 * 60 * 24 * 7) {
            headlineInsightCacheRef.current.set(headline, value);
          }
        });
      }
    } catch {}
    try {
      const raw = localStorage.getItem("geo_country_summary_cache_v1");
      const parsed = JSON.parse(raw || "{}");
      if (parsed && typeof parsed === "object") {
        const now = Date.now();
        Object.entries(parsed).forEach(([key, item]) => {
          const value = String(item?.value || "").trim();
          const ts = Number(item?.ts || 0);
          if (!value) return;
          if (Number.isFinite(ts) && now - ts <= 1000 * 60 * 60 * 24 * 7) {
            geoCountrySummaryCacheRef.current.set(key, value);
          }
        });
      }
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("search_history", JSON.stringify(searchHistory.slice(0, 8)));
  }, [searchHistory]);

  useEffect(() => {
    const loadSimulatorBadge = () => {
      try {
        const raw = localStorage.getItem("simulator_nav_snapshot_v1");
        const parsed = raw ? JSON.parse(raw) : {};
        const pct = Number(parsed?.returnPct);
        setSimulatorReturnPct(Number.isFinite(pct) ? pct : null);
        setSimulatorAutoPilotActive(Boolean(parsed?.autoPilotActive));
      } catch {
        setSimulatorReturnPct(null);
        setSimulatorAutoPilotActive(false);
      }
    };
    loadSimulatorBadge();
    const onStorage = (event) => {
      if (!event || event.key === "simulator_nav_snapshot_v1") loadSimulatorBadge();
    };
    const onSimulatorUpdate = () => loadSimulatorBadge();
    window.addEventListener("storage", onStorage);
    window.addEventListener("simulator-updated", onSimulatorUpdate);
    const timer = setInterval(loadSimulatorBadge, 5000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("simulator-updated", onSimulatorUpdate);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("theme_mode", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("site_language", language);
  }, [language]);

  useEffect(() => {
    try {
      const out = {};
      headlineInsightCacheRef.current.forEach((value, key) => {
        out[key] = { value, ts: Date.now() };
      });
      localStorage.setItem("headline_impact_cache_v1", JSON.stringify(out));
    } catch {}
  }, [headlineInsightVersion]);
  useEffect(() => {
    try {
      const out = {};
      geoCountrySummaryCacheRef.current.forEach((value, key) => {
        out[key] = { value, ts: Date.now() };
      });
      localStorage.setItem("geo_country_summary_cache_v1", JSON.stringify(out));
    } catch {}
  }, [geoCountrySummaryVersion]);

  useEffect(() => {
    const headlines = [
      ...marketNews.map((item) => String(item?.headline || "").trim()).filter(Boolean),
      ...news.map((item) => String(item?.headline || "").trim()).filter(Boolean),
    ];
    const unique = Array.from(new Set(headlines)).slice(0, 80);
    if (!unique.length) return;
    const cache = headlineInsightCacheRef.current;
    const missing = unique.filter((headline) => !cache.has(headline));
    if (!missing.length) return;

    const requestId = ++headlineInsightRequestRef.current;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/headline-impact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ headlines: missing }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data?.explanations)) return;
        missing.forEach((headline, index) => {
          const value = String(data.explanations[index] || "").trim();
          if (value) cache.set(headline, value);
        });
        if (!cancelled && requestId === headlineInsightRequestRef.current) {
          setHeadlineInsightVersion((v) => v + 1);
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [marketNews, news]);

  useEffect(() => {
    if (!LANGUAGE_LABEL_BY_CODE[language]) return;
    if (language === "en") return;

    const marketHeadlines = marketNews.map((item) => String(item?.headline || "").trim()).filter(Boolean);
    const companyHeadlines = news.map((item) => String(item?.headline || "").trim()).filter(Boolean);
    const dailyViewCurrent = normalizeAiPayload(dailyObj);
    const dayTraderViewCurrent = normalizeAiPayload(dayTraderObj);
    const analysisViewCurrent = normalizeAiPayload(analysisObj);
    const searchSectionSummary = buildSearchSectionSummary({
      assetMode,
      usingTicker,
      result,
      company,
      analysis: analysisViewCurrent,
    });
    const fxSearchSummary = buildFxSearchSummary(fxResult);
    const aiTextFields = [dailyViewCurrent, dayTraderViewCurrent, analysisViewCurrent].flatMap((view) => [
      String(view?.shortSummary || ""),
      String(view?.longSummary || ""),
      String(view?.dayPlan || ""),
      String(view?.riskExplanation || ""),
      String(view?.outlook || ""),
      String(view?.note || ""),
      String(view?.fallbackText || ""),
      ...listOfStrings(view?.why),
      ...listOfStrings(view?.risks),
      ...listOfStrings(view?.strengths),
    ]);
    const staticUiPhrases = [
      "Market News",
      "Metals News",
      "World Market Impact News",
      "Latest News",
      "ASTRA Today Pick",
      "ASTRA Day Trader Pick",
      "ASTRA Analysis",
      "Layman Summary",
      "Summary",
      "Why",
      "Risks",
      "Day plan",
      "Setup rationale",
      "Trade plan",
      "No market headlines yet.",
      "No metals headlines yet.",
      "No world-impact headlines yet.",
      "Outlook",
      "Strengths",
      "Bull vs Bear Probability",
      "Risk Assessment",
      "Analytical Reasoning Categories",
      "Analytical Score",
      "Bull",
      "Bear",
      "Short",
      "Detailed",
      "Confidence",
      "Risk",
      "Refresh",
      "Copy",
      "Share",
      "Analyzing...",
      "Loading...",
      "Loading today’s pick...",
      "Loading day-trader pick...",
      "Search Summary",
      "No summary yet. Run a search to get a plain-language explanation.",
      "No FX summary yet. Convert a pair to see the plain-language summary.",
      "Exchange Rate Converter",
      "Converting...",
      "Convert",
      "Search",
      "Clear",
    ];
    const summaryTexts = [
      ...marketHeadlines.map((headline) => headlineInsightCacheRef.current.get(headline) || buildHeadlineLaymanSummary(headline, assetMode)),
      ...companyHeadlines.map((headline) => headlineInsightCacheRef.current.get(headline) || buildHeadlineLaymanSummary(headline, assetMode)),
      buildNewsDigest(marketHeadlines, assetMode),
      buildNewsDigest(companyHeadlines, assetMode),
      buildDailyPickLaymanSummary(dailyViewCurrent),
      searchSectionSummary,
      fxSearchSummary,
      ...aiTextFields,
      ...staticUiPhrases,
    ].filter(Boolean);
    const allTexts = Array.from(new Set([...marketHeadlines, ...companyHeadlines, ...summaryTexts]));
    if (!allTexts.length) return;

    const cache = headlineTranslationCacheRef.current;
    const missingTexts = allTexts.filter((text) => !cache.has(`${language}::${text}`));
    if (!missingTexts.length) return;

    const requestId = ++headlineTranslationRequestRef.current;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            language,
            texts: missingTexts,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data?.translations)) return;

        missingTexts.forEach((text, index) => {
          const nextValue = String(data.translations[index] || text).trim() || text;
          cache.set(`${language}::${text}`, nextValue);
        });

        if (!cancelled && requestId === headlineTranslationRequestRef.current) {
          setHeadlineTranslationVersion((v) => v + 1);
        }
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [language, marketNews, news, assetMode, dailyObj, dayTraderObj, analysisObj, usingTicker, result, company, fxResult, headlineInsightVersion]);

  const localizedMarketNews = useMemo(
    () => withLocalizedHeadlines(marketNews, language, headlineTranslationCacheRef.current),
    [marketNews, language, headlineTranslationVersion]
  );
  const localizedNews = useMemo(
    () => withLocalizedHeadlines(news, language, headlineTranslationCacheRef.current),
    [news, language, headlineTranslationVersion]
  );
  const localizedMarketNewsWithSummary = useMemo(
    () =>
      localizedMarketNews.map((item) => {
        const headline = item.headlineOriginal || item.headlineDisplay;
        const summaryRaw = headlineInsightCacheRef.current.get(headline) || buildHeadlineLaymanSummary(headline, assetMode);
        return {
          ...item,
          laymanSummary: resolveLocalizedText(summaryRaw, language, headlineTranslationCacheRef.current),
        };
      }),
    [localizedMarketNews, assetMode, language, headlineTranslationVersion, headlineInsightVersion]
  );
  const localizedNewsWithSummary = useMemo(
    () =>
      localizedNews.map((item) => {
        const headline = item.headlineOriginal || item.headlineDisplay;
        const summaryRaw = headlineInsightCacheRef.current.get(headline) || buildHeadlineLaymanSummary(headline, assetMode);
        return {
          ...item,
          laymanSummary: resolveLocalizedText(summaryRaw, language, headlineTranslationCacheRef.current),
        };
      }),
    [localizedNews, assetMode, language, headlineTranslationVersion, headlineInsightVersion]
  );
  const marketNewsDigestRaw = useMemo(
    () => buildNewsDigest(localizedMarketNews.map((item) => item.headlineOriginal || item.headlineDisplay), assetMode),
    [localizedMarketNews, assetMode]
  );
  const marketNewsDigest = useMemo(
    () => resolveLocalizedText(marketNewsDigestRaw, language, headlineTranslationCacheRef.current),
    [marketNewsDigestRaw, language, headlineTranslationVersion]
  );
  const latestNewsDigestRaw = useMemo(
    () => buildNewsDigest(localizedNews.map((item) => item.headlineOriginal || item.headlineDisplay), assetMode),
    [localizedNews, assetMode]
  );
  const latestNewsDigest = useMemo(
    () => resolveLocalizedText(latestNewsDigestRaw, language, headlineTranslationCacheRef.current),
    [latestNewsDigestRaw, language, headlineTranslationVersion]
  );

  useEffect(() => {
    let mounted = true;
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    const inRecoveryFlow =
      (typeof window !== "undefined" && window.location.hash.includes("type=recovery")) ||
      (typeof window !== "undefined" && window.location.search.includes("type=recovery"));
    if (inRecoveryFlow) {
      setAuthPanelOpen(true);
      setAuthMode("reset");
      setAuthNotice("Reset flow detected. Enter and confirm your new password.");
    }

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setAuthUser(data?.session?.user || null);
        setAuthReady(true);
      })
      .catch(() => {
        if (!mounted) return;
        setAuthUser(null);
        setAuthReady(true);
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user || null);
      if (event === "PASSWORD_RECOVERY") {
        setAuthPanelOpen(true);
        setAuthMode("reset");
        setAuthNotice("Recovery confirmed. Set your new password.");
      }
    });

    return () => {
      mounted = false;
      data?.subscription?.unsubscribe();
    };
  }, []);

  const displayName = useMemo(() => {
    const md = authUser?.user_metadata || {};
    const full = String(md?.full_name || "").trim();
    const first = String(md?.first_name || "").trim();
    const last = String(md?.last_name || "").trim();
    const email = String(authUser?.email || "").trim();
    if (full) return full;
    if (first || last) return `${first} ${last}`.trim();
    if (email.includes("@")) return email.split("@")[0];
    return "Investor";
  }, [authUser]);

  const userInitials = useMemo(() => {
    const name = String(displayName || "").trim();
    if (!name) return "U";
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }, [displayName]);

  useEffect(() => {
    if (!authUser?.id) {
      setWelcomeBanner({ show: false, text: "" });
      return;
    }

    try {
      const key = `auth_welcome_seen_${authUser.id}`;
      const hasSeen = localStorage.getItem(key) === "true";
      const msg = hasSeen ? `Welcome back, ${displayName}.` : `Welcome, ${displayName}.`;
      setWelcomeBanner({ show: true, text: msg });
      localStorage.setItem(key, "true");
      const t = setTimeout(() => setWelcomeBanner({ show: false, text: "" }), 60000);
      return () => clearTimeout(t);
    } catch {
      setWelcomeBanner({ show: true, text: `Welcome, ${displayName}.` });
      const t = setTimeout(() => setWelcomeBanner({ show: false, text: "" }), 60000);
      return () => clearTimeout(t);
    }
  }, [authUser?.id, displayName]);

  useEffect(() => {
    if (!authUser) return;
    const md = authUser.user_metadata || {};
    setProfileFirstName(String(md.first_name || ""));
    setProfileLastName(String(md.last_name || ""));
  }, [authUser]);

  useEffect(() => {
    if (!authUser?.id) {
      setPortfolioHoldings([]);
      setPortfolioRows([]);
      setPortfolioAnalysis(null);
      setPortfolioError("");
      return;
    }
    try {
      const key = `portfolio_holdings_${authUser.id}`;
      const saved = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(saved)) {
        const clean = saved
          .map((x, idx) => {
            if (typeof x === "string") {
              const sym = canonicalTicker(x);
              if (!sym) return null;
              return { id: `legacy-${sym}-${idx}`, symbol: sym, quantity: 1, buyPrice: 0, buyDate: "" };
            }
            const sym = canonicalTicker(x?.symbol || "");
            if (!sym) return null;
            return {
              id: String(x?.id || `h-${sym}-${idx}`),
              symbol: sym,
              quantity: Number(x?.quantity) > 0 ? Number(x.quantity) : 1,
              buyPrice: Number(x?.buyPrice) >= 0 ? Number(x.buyPrice) : 0,
              buyDate: String(x?.buyDate || ""),
            };
          })
          .filter(Boolean)
          .slice(0, 50);
        setPortfolioHoldings(clean);
      }
    } catch {}
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser?.id) return;
    try {
      const key = `portfolio_holdings_${authUser.id}`;
      localStorage.setItem(key, JSON.stringify(portfolioHoldings.slice(0, 50)));
    } catch {}
  }, [authUser?.id, portfolioHoldings]);

  useEffect(() => {
    initialQuizPromptedRef.current = false;
    followupQuizPromptedRef.current = false;
    if (quizPromptTimerRef.current) {
      clearTimeout(quizPromptTimerRef.current);
      quizPromptTimerRef.current = null;
    }

    if (!authUser?.id) {
      setQuizCompleted(false);
      setQuizAnswers(DEFAULT_QUIZ_ANSWERS);
      setQuizPanelOpen(false);
      setQuizFollowupMode(false);
      setQuizFollowupDue(false);
      setQuizCompletedAt("");
      setQuizDismissed(false);
      return;
    }

    const metaQuiz = normalizeQuizAnswers(authUser?.user_metadata?.profile_quiz);
    const metaCompleted = Boolean(authUser?.user_metadata?.profile_quiz_completed);

    let localQuiz = DEFAULT_QUIZ_ANSWERS;
    let localCompleted = false;
    let localCompletedAt = "";
    try {
      const q = localStorage.getItem(`profile_quiz_answers_${authUser.id}`);
      const c = localStorage.getItem(`profile_quiz_completed_${authUser.id}`);
      const at = localStorage.getItem(`profile_quiz_completed_at_${authUser.id}`);
      if (q) localQuiz = normalizeQuizAnswers(JSON.parse(q));
      localCompleted = c === "true";
      localCompletedAt = at || "";
    } catch {}

    const useMeta = metaCompleted || Object.values(metaQuiz).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
    const mergedQuiz = useMeta ? metaQuiz : localQuiz;
    const completed = useMeta ? metaCompleted : localCompleted;
    const metaCompletedAt = String(authUser?.user_metadata?.profile_quiz_completed_at || "");
    const completedAt = metaCompletedAt || localCompletedAt || "";

    setQuizAnswers(mergedQuiz);
    setQuizCompleted(completed);
    setQuizDismissed(false);
    setQuizCompletedAt(completedAt);

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const due = Boolean(completedAt) && Date.now() - new Date(completedAt).getTime() >= THIRTY_DAYS_MS;
    setQuizFollowupDue(due);
    setQuizFollowupMode(due);
  }, [authUser]);

  useEffect(() => {
    if (!authUser?.id) return;
    try {
      localStorage.setItem(`profile_quiz_answers_${authUser.id}`, JSON.stringify(quizAnswers));
      localStorage.setItem(`profile_quiz_completed_${authUser.id}`, String(quizCompleted));
      localStorage.setItem(`profile_quiz_completed_at_${authUser.id}`, String(quizCompletedAt || ""));
    } catch {}
  }, [authUser, quizAnswers, quizCompleted, quizCompletedAt]);

  useEffect(() => {
    if (!authUser?.id) return;
    if (quizPanelOpen) return;

    if (!quizCompleted && !quizDismissed && !initialQuizPromptedRef.current) {
      initialQuizPromptedRef.current = true;
      if (quizPromptTimerRef.current) clearTimeout(quizPromptTimerRef.current);
      quizPromptTimerRef.current = setTimeout(() => {
        setQuizPanelOpen(true);
        setQuizDismissed(false);
      }, 30000);
      return () => {
        if (quizPromptTimerRef.current) clearTimeout(quizPromptTimerRef.current);
      };
    }

    if (quizCompleted && quizFollowupDue && !quizDismissed && !followupQuizPromptedRef.current) {
      followupQuizPromptedRef.current = true;
      if (quizPromptTimerRef.current) clearTimeout(quizPromptTimerRef.current);
      quizPromptTimerRef.current = setTimeout(() => {
        setQuizFollowupMode(true);
        setQuizPanelOpen(true);
        setQuizDismissed(false);
      }, 30000);
      return () => {
        if (quizPromptTimerRef.current) clearTimeout(quizPromptTimerRef.current);
      };
    }
  }, [authUser, quizCompleted, quizFollowupDue, quizPanelOpen, quizDismissed]);

  useEffect(() => {
    setTicker("");
    setUsingTicker("");
    setUsingAssetId("");
    setResult(null);
    setCompany(null);
    setFundamentals(null);
    setFundInsights(null);
    setFundInsightsLoading(false);
    setSecFundamentals(null);
    setSectorInfo(null);
    setNews([]);
    setAnalysisObj(null);
    setChartPoints([]);
    setSecFundamentalsLoading(false);
    setCompareRows([]);
    setCompareInput(assetMode === "crypto" ? "BTC,ETH,SOL" : assetMode === "metals" ? "XAU,XAG,XPT" : "AAPL,MSFT,NVDA");
    setFxResult(null);
    setFxError("");
    setErrorMsg("");
  }, [assetMode]);

  useEffect(() => {
    if (!authUser || assetMode !== "stock") {
      setPortfolioSuggestions([]);
      setPortfolioSuggestionOpen(false);
      return;
    }
    const q = String(portfolioSymbolInput || "").trim();
    if (q.length < 1) {
      setPortfolioSuggestions([]);
      setPortfolioSuggestionOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setPortfolioSuggestionLoading(true);
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        const matchesRaw = Array.isArray(data?.matches) ? data.matches : data?.best ? [data.best] : [];
        const dedup = new Map();
        for (const m of matchesRaw) {
          const symbol = String(m?.symbol || "").toUpperCase();
          const description = String(m?.description || "").trim();
          if (!symbol) continue;
          if (!dedup.has(symbol)) dedup.set(symbol, { symbol, description });
        }
        const suggestions = Array.from(dedup.values()).slice(0, 8);
        setPortfolioSuggestions(suggestions);
        setPortfolioSuggestionOpen(suggestions.length > 0);
      } catch (e) {
        if (e?.name !== "AbortError") {
          setPortfolioSuggestions([]);
          setPortfolioSuggestionOpen(false);
        }
      } finally {
        setPortfolioSuggestionLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [portfolioSymbolInput, authUser, assetMode]);

  useEffect(() => {
    if (loading) {
      setSuggestionOpen(false);
      return;
    }

    if (suppressSuggestions) {
      setSuggestionOpen(false);
      return;
    }

    const q = ticker.trim();
    if (q.length < 1) {
      setSearchSuggestions([]);
      setSuggestionOpen(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSuggestionLoading(true);
        const endpoint =
          assetMode === "crypto" ? "/api/crypto-search" : assetMode === "metals" ? "/api/metals-search" : "/api/search";
        const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        const matchesRaw = Array.isArray(data?.matches)
          ? data.matches
          : data?.best
            ? [data.best]
            : [];

        const dedup = new Map();
        for (const m of matchesRaw) {
          const symbol = String(m?.symbol || "").toUpperCase();
          const description = String(m?.description || "").trim();
          const id = String(m?.id || "").trim();
          if (!symbol) continue;
          if (!dedup.has(symbol)) dedup.set(symbol, { symbol, description, id });
        }
        const suggestions = Array.from(dedup.values()).slice(0, 6);
        setSearchSuggestions(suggestions);
        setSuggestionOpen(suggestions.length > 0);
      } catch (e) {
        if (e?.name !== "AbortError") {
          setSearchSuggestions([]);
          setSuggestionOpen(false);
        }
      } finally {
        setSuggestionLoading(false);
      }
    }, 280);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [ticker, assetMode, loading, suppressSuggestions]);

  const applySuggestion = (suggestion) => {
    const rawSymbol = String(suggestion?.symbol || "");
    const sym = assetMode === "crypto" || assetMode === "metals" ? rawSymbol.toUpperCase() : canonicalTicker(rawSymbol);
    if (!sym) return;
    setTicker(sym);
    setSuppressSuggestions(true);
    if (assetMode === "crypto" || assetMode === "metals") {
      setUsingAssetId(String(suggestion?.id || ""));
    }
    setSearchSuggestions([]);
    setSuggestionOpen(false);
    searchStock(sym);
  };

  const getSearchInput = (forcedInput) => {
    if (typeof forcedInput === "string" || typeof forcedInput === "number") {
      return String(forcedInput).trim();
    }
    if (forcedInput && typeof forcedInput === "object") {
      const maybeSymbol = String(forcedInput?.symbol || forcedInput?.id || forcedInput?.name || "").trim();
      if (maybeSymbol) return maybeSymbol;
      // Click/submit event passed from onClick/onSubmit.
      if (typeof forcedInput.preventDefault === "function") return String(ticker || "").trim();
    }
    return String(ticker || "").trim();
  };

  // Draw chart when points change
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.width = 640;
    c.height = 180;
    drawLineChart(c, chartPoints);
  }, [chartPoints]);

  async function resolveSymbol(input) {
    const raw = String(input || "").trim();
    if (!raw) return "";
    const fallback = canonicalTicker(raw);

    try {
      let res = await fetch(`/api/search?query=${encodeURIComponent(raw)}`);
      if (!res.ok) res = await fetch(`/api/search?q=${encodeURIComponent(raw)}`);
      if (!res.ok) return fallback;

      const data = await res.json();
      const sym = canonicalTicker(data?.symbol || data?.result?.symbol || "");
      return sym || fallback;
    } catch {
      return fallback;
    }
  }

  async function resolveCryptoAsset(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;
    try {
      const res = await fetch(`/api/crypto-search?q=${encodeURIComponent(raw)}`);
      const data = await res.json().catch(() => ({}));
      const best = data?.best || data?.result || data;
      if (best?.id) {
        return {
          id: String(best.id),
          symbol: String(best.symbol || raw).toUpperCase(),
          name: String(best.name || best.description || raw),
        };
      }
      return {
        id: "",
        symbol: String(raw).toUpperCase(),
        name: String(raw),
      };
    } catch {
      return {
        id: "",
        symbol: String(raw).toUpperCase(),
        name: String(raw),
      };
    }
  }

  async function resolveMetalAsset(input) {
    const raw = String(input || "").trim();
    if (!raw) return null;
    try {
      const res = await fetch(`/api/metals-search?q=${encodeURIComponent(raw)}`);
      const data = await res.json().catch(() => ({}));
      const best = data?.best || data?.result || data;
      if (best?.id) {
        return {
          id: String(best.id),
          symbol: String(best.symbol || raw).toUpperCase(),
          name: String(best.name || best.description || raw),
        };
      }
      return {
        id: "",
        symbol: String(raw).toUpperCase(),
        name: String(raw),
      };
    } catch {
      return {
        id: "",
        symbol: String(raw).toUpperCase(),
        name: String(raw),
      };
    }
  }

  async function fetchDailyPick() {
    if (assetMode === "fx" || assetMode === "news" || assetMode === "globalmarket" || assetMode === "geopolitics") {
      setDailyObj(null);
      return;
    }
    try {
      setDailyLoading(true);
      const res = await fetch(`/api/ai?mode=daily&market=${assetMode}`);
      const data = await res.json().catch(() => ({}));
      setDailyObj(data);
    } catch {
      setDailyObj({ note: "Daily pick unavailable." });
    } finally {
      setDailyLoading(false);
    }
  }

  async function fetchOverview() {
    try {
      if (assetMode === "news" || assetMode === "globalmarket" || assetMode === "geopolitics") {
        setOverview([]);
        return;
      }

      if (assetMode === "fx") {
        const r = await fetch("/api/fx-overview");
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d?.rows)) {
          setOverview([]);
          return;
        }
        setOverview(d.rows.map((x) => ({ symbol: x?.symbol, name: x?.name, price: x?.price, percent: x?.percent })));
        return;
      }

      if (assetMode === "crypto") {
        const ids = overviewTickers.join(",");
        const r = await fetch(`/api/crypto-overview?ids=${encodeURIComponent(ids)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d?.rows)) {
          setOverview([]);
          return;
        }
        setOverview(
          d.rows.map((x) => ({
            symbol: x?.symbol,
            price: x?.price,
            percent: x?.percent,
          }))
        );
        return;
      }

      if (assetMode === "metals") {
        const r = await fetch("/api/metals-overview");
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !Array.isArray(d?.rows)) {
          setOverview([]);
          return;
        }
        setOverview(d.rows.map((x) => ({ symbol: x?.symbol, name: x?.name, price: x?.price, percent: x?.percent })));
        return;
      }

      const rows = await Promise.all(
        overviewTickers.map(async (sym) => {
          const r = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return { symbol: sym, error: true };
          return {
            symbol: sym,
            price: d?.price,
            percent: d?.percentChange,
          };
        })
      );
      setOverview(rows);
    } catch {
      setOverview([]);
    }
  }

  async function fetchMarketNews() {
    if (assetMode === "fx") {
      setMarketNews([]);
      return;
    }
    try {
      const res = await fetch(
        assetMode === "geopolitics"
          ? "/api/geopolitics-news"
          : assetMode === "news" || assetMode === "globalmarket"
            ? "/api/global-impact-news"
          : assetMode === "crypto"
            ? "/api/crypto-market-news"
            : assetMode === "metals"
              ? "/api/metals-market-news"
              : "/api/market-news"
      );
      const data = await res.json().catch(() => ({}));
      const maxItems = assetMode === "geopolitics" || assetMode === "news" || assetMode === "globalmarket" ? 30 : 12;
      setMarketNews(Array.isArray(data?.news) ? data.news.slice(0, maxItems) : []);
    } catch {
      setMarketNews([]);
    }
  }

  async function fetchMovers() {
    if (assetMode === "fx" || assetMode === "news" || assetMode === "globalmarket" || assetMode === "geopolitics") {
      setMovers({ gainers: [], losers: [] });
      return;
    }
    try {
      const res = await fetch(
        assetMode === "crypto" ? "/api/crypto-movers" : assetMode === "metals" ? "/api/metals-movers" : "/api/movers"
      );
      const data = await res.json().catch(() => ({}));
      setMovers({
        gainers: Array.isArray(data?.gainers) ? data.gainers : [],
        losers: Array.isArray(data?.losers) ? data.losers : [],
      });
    } catch {
      setMovers({ gainers: [], losers: [] });
    }
  }

  async function fetchSectorAnalysis(industry) {
    const mapped = mapIndustryToSectorETF(industry);
    try {
      const res = await fetch(`/api/quote?symbol=${encodeURIComponent(mapped.etf)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return;
      setSectorInfo({
        sector: mapped.label,
        benchmark: mapped.etf,
        change: data?.change,
        percentChange: data?.percentChange,
        price: data?.price,
      });
    } catch {}
  }

  async function runComparison() {
    if (assetMode === "fx" || assetMode === "news" || assetMode === "globalmarket" || assetMode === "geopolitics") {
      setCompareRows([]);
      setCompareInvalidTickers([]);
      setCompareError("");
      return;
    }
    const syms = Array.from(
      new Set(
        compareInput
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      )
    ).slice(0, 8);
    if (!syms.length) {
      setCompareRows([]);
      setCompareInvalidTickers([]);
      setCompareError("Enter at least one valid ticker (for example: AAPL,MSFT,NVDA).");
      return;
    }

    try {
      setCompareLoading(true);
      setCompareError("");
      setCompareInvalidTickers([]);

      if (assetMode === "stock") {
        const res = await fetch(`/api/compare-stocks?symbols=${encodeURIComponent(syms.join(","))}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setCompareRows([]);
          setCompareError(data?.error || `Comparison failed (${res.status}).`);
          return;
        }
        const rows = Array.isArray(data?.rows) ? data.rows : [];
        const validRows = rows.filter((r) => r?.valid);
        const invalidRows = Array.isArray(data?.invalid) ? data.invalid : rows.filter((r) => !r?.valid);
        setCompareRows(validRows);
        setCompareInvalidTickers(invalidRows);
        if (!validRows.length && invalidRows.length) {
          setCompareError(`No valid tickers found. Invalid: ${invalidRows.map((x) => x.symbol).join(", ")}`);
        } else if (invalidRows.length) {
          setCompareError(`Some tickers were invalid: ${invalidRows.map((x) => x.symbol).join(", ")}`);
        }
        return;
      }

      const rows = await Promise.all(
        syms.map(async (symbol) => {
          if (assetMode === "crypto") {
            const qRes = await fetch(`/api/crypto-quote?symbol=${encodeURIComponent(symbol)}`);
            const q = await qRes.json().catch(() => ({}));
            const price = Number(q?.price);
            if (!qRes.ok || !Number.isFinite(price)) {
              return { symbol, valid: false, error: "Invalid ticker" };
            }
            const percentChange = Number(q?.percentChange);
            const change = Number.isFinite(Number(q?.change))
              ? Number(q?.change)
              : Number.isFinite(price) && Number.isFinite(percentChange)
                ? (price * percentChange) / 100
                : null;
            return {
              symbol: q?.symbol || symbol,
              valid: true,
              name: q?.name || symbol,
              price,
              change,
              percentChange,
              peRatio: null,
              marketCap: q?.marketCap,
              volume: q?.volume,
              week52High: null,
              week52Low: null,
              sector: "Crypto",
            };
          }

          if (assetMode === "metals") {
            const qRes = await fetch(`/api/metals-quote?symbol=${encodeURIComponent(symbol)}`);
            const q = await qRes.json().catch(() => ({}));
            const price = Number(q?.price);
            if (!qRes.ok || !Number.isFinite(price)) {
              return { symbol, valid: false, error: "Invalid ticker" };
            }
            return {
              symbol: q?.symbol || symbol,
              valid: true,
              name: q?.name || symbol,
              price,
              change: q?.change,
              percentChange: q?.percentChange,
              peRatio: null,
              marketCap: q?.marketCap,
              volume: q?.volume,
              week52High: q?.high,
              week52Low: q?.low,
              sector: "Precious Metal",
            };
          }

          const [quoteRes, metricRes, profileRes] = await Promise.all([
            fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
            fetch(`/api/metrics?symbol=${encodeURIComponent(symbol)}`),
            fetch(`/api/profile?symbol=${encodeURIComponent(symbol)}`),
          ]);
          const q = await quoteRes.json().catch(() => ({}));
          const m = await metricRes.json().catch(() => ({}));
          const p = await profileRes.json().catch(() => ({}));
          const price = Number(q?.price);

          if (!quoteRes.ok || !Number.isFinite(price)) {
            return { symbol, valid: false, error: "Invalid ticker" };
          }

          return {
            symbol,
            valid: true,
            name: p?.name || symbol,
            price,
            change: q?.change,
            percentChange: q?.percentChange,
            peRatio: m?.peRatio,
            marketCap: p?.marketCapitalization ? Number(p.marketCapitalization) * 1e6 : null,
            volume: q?.volume,
            week52High: m?.week52High,
            week52Low: m?.week52Low,
            sector: p?.sector || p?.finnhubIndustry || "—",
          };
        })
      );
      const validRows = rows.filter((r) => r?.valid);
      const invalidRows = rows.filter((r) => !r?.valid);
      setCompareRows(validRows);
      setCompareInvalidTickers(invalidRows);
      if (!validRows.length && invalidRows.length) {
        setCompareError(`No valid tickers found. Invalid: ${invalidRows.map((x) => x.symbol).join(", ")}`);
      } else if (invalidRows.length) {
        setCompareError(`Some tickers were invalid: ${invalidRows.map((x) => x.symbol).join(", ")}`);
      }
    } catch {
      setCompareRows([]);
      setCompareInvalidTickers([]);
      setCompareError("Comparison failed. Please try again.");
    } finally {
      setCompareLoading(false);
    }
  }

  async function convertFx() {
    const from = resolveCurrencyInput(fxFrom);
    const to = resolveCurrencyInput(fxTo);
    const amount = Number(fxAmount);
    if (!from || !to) {
      setFxResult(null);
      setFxError("Use a valid currency code or country name (ex: INR, India, Japan, UK).");
      return;
    }

    try {
      setFxLoading(true);
      setFxError("");
      const res = await fetch(
        `/api/fx-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&amount=${encodeURIComponent(
          Number.isFinite(amount) && amount > 0 ? amount : 1
        )}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFxResult(null);
        setFxError(data?.error || `FX conversion failed (${res.status})`);
        return;
      }
      setFxResult(data);
      setFxFrom(from);
      setFxTo(to);
    } catch {
      setFxResult(null);
      setFxError("FX conversion failed");
    } finally {
      setFxLoading(false);
    }
  }

  async function fetchFundamentals(symbol) {
    if (!symbol) return;
    try {
      const res = await fetch(`/api/metrics?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setFundamentals(data);
    } catch {}
  }

  async function fetchSecFundamentals(symbol) {
    if (!symbol) return;
    try {
      setSecFundamentalsLoading(true);
      const res = await fetch(`/api/sec-fundamentals?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSecFundamentals(data);
      } else {
        setSecFundamentals(null);
      }
    } catch {
      setSecFundamentals(null);
    } finally {
      setSecFundamentalsLoading(false);
    }
  }

  async function fetchFundInsights(symbol) {
    if (!symbol) return;
    try {
      setFundInsightsLoading(true);
      const res = await fetch(`/api/fund-insights?symbol=${encodeURIComponent(symbol)}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.isFund) {
        setFundInsights(data);
      } else {
        setFundInsights(null);
      }
    } catch {
      setFundInsights(null);
    } finally {
      setFundInsightsLoading(false);
    }
  }

  async function fetchChart(symbol, range, assetIdOverride = "") {
    if (!symbol) return;
    const key = range || "1M";
    const configByRange = {
      "1D": { resolution: "5", days: 1, historyPoints: 1 },
      "1W": { resolution: "D", days: 7, historyPoints: 7 },
      "1M": { resolution: "D", days: 30, historyPoints: 30 },
      "1Y": { resolution: "D", days: 365, historyPoints: 252 },
    };
    const cfg = configByRange[key] || configByRange["1M"];

    try {
      setChartLoading(true);
      const url =
        assetMode === "crypto"
          ? `/api/crypto-candles?id=${encodeURIComponent(assetIdOverride || usingAssetId || symbol)}&days=${cfg.days}`
          : assetMode === "metals"
            ? `/api/metals-candles?id=${encodeURIComponent(assetIdOverride || usingAssetId || symbol)}&symbol=${encodeURIComponent(symbol)}&days=${cfg.days}`
          : `/api/candles?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(cfg.resolution)}&days=${cfg.days}`;
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data?.c) || !Array.isArray(data?.t)) {
        if (assetMode === "stock") {
          const histRes = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`);
          const histData = await histRes.json().catch(() => ({}));
          if (histRes.ok && Array.isArray(histData?.points) && histData.points.length > 1) {
            const points = histData.points
              .slice(-cfg.historyPoints)
              .map((p) => ({ close: Number(p?.close), date: String(p?.date || ""), volume: null }))
              .filter((p) => Number.isFinite(p.close));
            setChartPoints(points);
            setLatestVolume(null);
            return;
          }
        }
        return;
      }

      const points = data.c
        .map((close, i) => ({
          close: Number(close),
          date: data.t[i] ? new Date(Number(data.t[i]) * 1000).toISOString() : "",
          volume: Number(data?.v?.[i]),
        }))
        .filter((p) => Number.isFinite(p.close));

      if (!points.length && assetMode === "stock") {
        const histRes = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`);
        const histData = await histRes.json().catch(() => ({}));
        if (histRes.ok && Array.isArray(histData?.points) && histData.points.length > 1) {
          const histPoints = histData.points
            .slice(-cfg.historyPoints)
            .map((p) => ({ close: Number(p?.close), date: String(p?.date || ""), volume: null }))
            .filter((p) => Number.isFinite(p.close));
          setChartPoints(histPoints);
          setLatestVolume(null);
          return;
        }
      }

      setChartPoints(points);
      const last = points[points.length - 1];
      setLatestVolume(Number.isFinite(last?.volume) ? last.volume : null);
    } catch {
      if (assetMode === "stock") {
        try {
          const histRes = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`);
          const histData = await histRes.json().catch(() => ({}));
          if (histRes.ok && Array.isArray(histData?.points) && histData.points.length > 1) {
            const points = histData.points
              .slice(-cfg.historyPoints)
              .map((p) => ({ close: Number(p?.close), date: String(p?.date || ""), volume: null }))
              .filter((p) => Number.isFinite(p.close));
            setChartPoints(points);
            setLatestVolume(null);
            return;
          }
        } catch {}
      }
    } finally {
      setChartLoading(false);
    }
  }

  // Initial loads
  useEffect(() => {
    fetchDailyPick();
    fetchDayTraderPick();
    fetchOverview();
    fetchMarketNews();
    setTimeout(fetchMovers, 1200);
    const overviewTimer = setInterval(fetchOverview, 60000);
    const newsRefreshMs = assetMode === "geopolitics" || assetMode === "news" || assetMode === "globalmarket" ? 30000 : 90000;
    const newsTimer = setInterval(fetchMarketNews, newsRefreshMs);
    return () => {
      clearInterval(overviewTimer);
      clearInterval(newsTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMode]);

  useEffect(() => {
    if (assetMode !== "stock") {
      setOverviewSparklines({});
      return;
    }
    const symbols = Array.from(
      new Set(
        overview
          .map((o) => String(o?.symbol || "").trim().toUpperCase())
          .filter(Boolean)
      )
    ).slice(0, 20);
    if (!symbols.length) return;

    let cancelled = false;
    (async () => {
      const rows = await Promise.all(
        symbols.map(async (symbol) => {
          try {
            const res = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`);
            const data = await res.json().catch(() => ({}));
            const values = Array.isArray(data?.points)
              ? data.points
                  .slice(-7)
                  .map((p) => Number(p?.close))
                  .filter((v) => Number.isFinite(v))
              : [];
            if (values.length < 2) return [symbol, { values: [], up: null }];
            return [symbol, { values, up: values[values.length - 1] >= values[0] }];
          } catch {
            return [symbol, { values: [], up: null }];
          }
        })
      );
      if (!cancelled) {
        setOverviewSparklines((prev) => ({ ...prev, ...Object.fromEntries(rows) }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assetMode, overview]);

  useEffect(() => {
    fetchDayTraderPick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser, quizCompleted, quizAnswers.dayTradingInterest, quizAnswers.dayTradingMarkets, quizAnswers.dayTradingTime, assetMode]);

  useEffect(() => {
    if (assetMode !== "fx") return;
    convertFx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMode]);

  useEffect(() => {
    if (!usingTicker) return;
    fetchChart(usingTicker, chartRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartRange, usingTicker, usingAssetId, assetMode]);

  const searchStock = async (forcedInput) => {
    const raw = getSearchInput(forcedInput);
    if (!raw) return;
    const rawCanonical = assetMode === "crypto" || assetMode === "metals" ? raw.toUpperCase() : canonicalTicker(raw);

    setLoading(true);
    setSuppressSuggestions(true);
    setSuggestionOpen(false);
    setErrorMsg("");
    setCompany(null);
    setFundamentals(null);
    setFundInsights(null);
    setFundInsightsLoading(false);
    setSecFundamentals(null);
    setSecFundamentalsLoading(false);
    setSectorInfo(null);
    setNews([]);
    setAnalysisObj(null);
    setChartPoints([]);

    setResult({ symbol: rawCanonical || raw.toUpperCase(), price: "Loading...", info: "Resolving ticker..." });

    try {
      if (assetMode === "crypto") {
        const resolved = await resolveCryptoAsset(rawCanonical || raw);
        const assetId = String(resolved?.id || "").trim();
        const sym = (resolved?.symbol || rawCanonical || raw).toUpperCase();
        const name = resolved?.name || sym;
        if (!sym) {
          setResult({ symbol: "—", price: "—", info: "Enter a crypto name or symbol." });
          setLoading(false);
          return;
        }

        setUsingTicker(sym);
        setUsingAssetId(assetId);

        const quoteRes = await fetch(
          `/api/crypto-quote?${assetId ? `id=${encodeURIComponent(assetId)}` : `symbol=${encodeURIComponent(sym)}`}`
        );
        const quote = await quoteRes.json().catch(() => ({}));

        if (!quoteRes.ok) {
          const msg = quote?.error || `Crypto quote API failed (${quoteRes.status})`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const priceNum = Number(quote?.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
          const msg = `Unavailable quote for ${sym}.`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const pct = Number(quote?.percentChange);
        const chg = Number(quote?.change);
        setResult({
          symbol: quote.symbol || sym,
          price: `$${priceNum.toFixed(2)}`,
          change: Number.isFinite(chg) && Number.isFinite(pct) ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${pct.toFixed(2)}%)` : "",
          high: quote.high,
          low: quote.low,
          open: null,
          previousClose: null,
          info: "Live crypto market data",
        });

        setCompany({
          name: quote?.name || name,
          logo: quote?.logo || "",
          exchange: "Crypto",
          finnhubIndustry: quote?.category || "Digital Asset",
          utilitySummary: quote?.utilitySummary || "",
          marketCapitalization: Number(quote?.marketCap) / 1e6,
          weburl: quote?.homepage || "",
        });
        setFundamentals({
          marketCap: Number(quote?.marketCap) || null,
          peRatio: null,
          week52High: null,
          week52Low: null,
          marketCapRank: Number(quote?.marketCapRank) || null,
          fdv: Number(quote?.fdv) || null,
          circulatingSupply: Number(quote?.circulatingSupply) || null,
          totalSupply: Number(quote?.totalSupply) || null,
          maxSupply: Number(quote?.maxSupply) || null,
          ath: Number(quote?.ath) || null,
          athChangePct: Number(quote?.athChangePct),
          atl: Number(quote?.atl) || null,
          atlChangePct: Number(quote?.atlChangePct),
          sentimentUpVotesPct: Number(quote?.sentimentUpVotesPct),
          coingeckoScore: Number(quote?.coingeckoScore),
          developerScore: Number(quote?.developerScore),
          communityScore: Number(quote?.communityScore),
          liquidityScore: Number(quote?.liquidityScore),
          publicInterestScore: Number(quote?.publicInterestScore),
          twitterFollowers: Number(quote?.twitterFollowers) || null,
          redditSubscribers: Number(quote?.redditSubscribers) || null,
          telegramUsers: Number(quote?.telegramUsers) || null,
          githubRepo: String(quote?.githubRepo || ""),
          githubStars: Number(quote?.githubStars) || null,
          githubForks: Number(quote?.githubForks) || null,
          githubSubscribers: Number(quote?.githubSubscribers) || null,
          githubTotalIssues: Number(quote?.githubTotalIssues) || null,
          githubClosedIssues: Number(quote?.githubClosedIssues) || null,
          githubCommits4w: Number(quote?.githubCommits4w) || null,
        });
        setLatestVolume(Number(quote?.volume) || null);
        setSectorInfo(null);
        addToSearchHistory(sym);

        try {
          const newsRes = await fetch(`/api/crypto-market-news?symbol=${encodeURIComponent(sym)}`);
          const newsData = await newsRes.json().catch(() => ({}));
          const items = Array.isArray(newsData?.news) ? newsData.news : [];
          const cleaned = items.filter((n) => n?.url && typeof n.url === "string" && n.url.startsWith("http")).slice(0, 5);
          setNews(cleaned);
        } catch {}

        fetchChart(sym, chartRange, assetId);

        try {
          setAnalysisLoading(true);
          const aiRes = await fetch(
            `/api/ai?market=crypto&symbol=${encodeURIComponent(sym)}&price=${encodeURIComponent(quote.price ?? "")}`
          );
          const aiData = await aiRes.json().catch(() => ({}));
          if (!aiRes.ok) {
            setAnalysisObj({ note: aiData?.error || `Analytical information failed (${aiRes.status}).` });
          } else {
            setAnalysisObj(aiData);
          }
        } catch {
          setAnalysisObj({ note: "Analytical information unavailable." });
        } finally {
          setAnalysisLoading(false);
        }
      } else if (assetMode === "metals") {
        const resolved = await resolveMetalAsset(rawCanonical || raw);
        const assetId = String(resolved?.id || "").trim();
        const sym = (resolved?.symbol || rawCanonical || raw).toUpperCase();
        const name = resolved?.name || sym;
        if (!sym) {
          setResult({ symbol: "—", price: "—", info: "Enter a metal name or symbol." });
          setLoading(false);
          return;
        }

        setUsingTicker(sym);
        setUsingAssetId(assetId);

        const quoteRes = await fetch(
          `/api/metals-quote?${assetId ? `id=${encodeURIComponent(assetId)}` : `symbol=${encodeURIComponent(sym)}`}`
        );
        const quote = await quoteRes.json().catch(() => ({}));

        if (!quoteRes.ok) {
          const msg = quote?.error || `Metals quote API failed (${quoteRes.status})`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const priceNum = Number(quote?.price);
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
          const msg = `Unavailable quote for ${sym}.`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const pct = Number(quote?.percentChange);
        const chg = Number(quote?.change);
        setResult({
          symbol: quote.symbol || sym,
          price: `$${priceNum.toFixed(2)}`,
          change: Number.isFinite(chg) && Number.isFinite(pct) ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)} (${pct.toFixed(2)}%)` : "",
          high: quote.high,
          low: quote.low,
          open: null,
          previousClose: null,
          info: "Live precious metals market data",
        });

        setCompany({
          name: quote?.name || name,
          logo: quote?.logo || "",
          exchange: "Metals",
          finnhubIndustry: "Precious Metal",
          marketCapitalization: Number(quote?.marketCap) / 1e6,
          weburl: "",
        });
        setFundamentals({
          marketCap: Number(quote?.marketCap) || null,
          peRatio: null,
          week52High: null,
          week52Low: null,
        });
        setLatestVolume(Number(quote?.volume) || null);
        setSectorInfo(null);
        addToSearchHistory(sym);

        try {
          const newsRes = await fetch(`/api/metals-market-news?symbol=${encodeURIComponent(sym)}`);
          const newsData = await newsRes.json().catch(() => ({}));
          const items = Array.isArray(newsData?.news) ? newsData.news : [];
          const cleaned = items.filter((n) => n?.url && typeof n.url === "string" && n.url.startsWith("http")).slice(0, 5);
          setNews(cleaned);
        } catch {}

        fetchChart(sym, chartRange, assetId);

        try {
          setAnalysisLoading(true);
          const aiRes = await fetch(
            `/api/ai?market=metals&symbol=${encodeURIComponent(sym)}&price=${encodeURIComponent(quote.price ?? "")}`
          );
          const aiData = await aiRes.json().catch(() => ({}));
          if (!aiRes.ok) {
            setAnalysisObj({ note: aiData?.error || `Analytical information failed (${aiRes.status}).` });
          } else {
            setAnalysisObj(aiData);
          }
        } catch {
          setAnalysisObj({ note: "Analytical information unavailable." });
        } finally {
          setAnalysisLoading(false);
        }
      } else {
        const sym = await resolveSymbol(rawCanonical || raw);
        if (!sym) {
          setResult({ symbol: "—", price: "—", info: "Enter a ticker or company name." });
          setLoading(false);
          return;
        }
        setUsingTicker(sym);
        setUsingAssetId("");

        // QUOTE
        const quoteRes = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
        const quote = await quoteRes.json().catch(() => ({}));

        if (!quoteRes.ok) {
          const msg = quote?.error || `Quote API failed (${quoteRes.status})`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const livePrice = Number(quote?.price);
        const prevClose = Number(quote?.previousClose);
        const hasPrice = Number.isFinite(livePrice) && livePrice > 0;
        const hasPrevClose = Number.isFinite(prevClose) && prevClose > 0;

        if (!hasPrice && !hasPrevClose) {
          const msg = `Invalid ticker or unavailable quote for ${sym}.`;
          setResult({ symbol: sym, price: "—", info: msg });
          setErrorMsg(msg);
          setLoading(false);
          return;
        }

        const displayPrice = hasPrice ? livePrice : prevClose;
        const fallbackChange = hasPrice && hasPrevClose ? livePrice - prevClose : null;
        const fallbackPercent = hasPrice && hasPrevClose && prevClose > 0 ? (fallbackChange / prevClose) * 100 : null;

        const priceTxt = Number.isFinite(displayPrice) ? `$${displayPrice.toFixed(2)}` : "—";
        const changeTxt =
          typeof quote.change === "number" && typeof quote.percentChange === "number"
            ? `${quote.change >= 0 ? "+" : ""}${quote.change.toFixed(2)} (${quote.percentChange.toFixed(2)}%)`
            : Number.isFinite(fallbackChange) && Number.isFinite(fallbackPercent)
              ? `${fallbackChange >= 0 ? "+" : ""}${fallbackChange.toFixed(2)} (${fallbackPercent.toFixed(2)}%)`
              : "";

        setResult({
          symbol: quote.symbol || sym,
          price: priceTxt,
          change: changeTxt,
          high: quote.high,
          low: quote.low,
          open: quote.open,
          previousClose: quote.previousClose,
          info: quote.priceSource === "previousClose" ? "Using previous close (live quote unavailable)" : "Live market data",
        });
        addToSearchHistory(sym);

        // PROFILE
        try {
          const profileRes = await fetch(`/api/profile?symbol=${encodeURIComponent(sym)}`);
          const profileData = await profileRes.json().catch(() => ({}));
          if (profileRes.ok) {
            setCompany(profileData);
            fetchSectorAnalysis(profileData?.sector || profileData?.finnhubIndustry);
          }
        } catch {}
        fetchFundamentals(sym);
        fetchFundInsights(sym);
        fetchSecFundamentals(sym);

        // NEWS
        try {
          const newsRes = await fetch(`/api/news?symbol=${encodeURIComponent(sym)}`);
          const newsData = await newsRes.json().catch(() => ({}));
          const items = Array.isArray(newsData?.news) ? newsData.news : [];
          const cleaned = items.filter((n) => n?.url && typeof n.url === "string" && n.url.startsWith("http")).slice(0, 5);
          setNews(cleaned);
        } catch {}

        fetchChart(sym, chartRange);

        // AI ANALYSIS
        try {
          setAnalysisLoading(true);
          const aiRes = await fetch(
            `/api/ai?market=stock&symbol=${encodeURIComponent(sym)}&price=${encodeURIComponent(quote.price ?? "")}`
          );
          const aiData = await aiRes.json().catch(() => ({}));
          if (!aiRes.ok) {
            setAnalysisObj({ note: aiData?.error || `Analytical information failed (${aiRes.status}).` });
          } else {
            setAnalysisObj(aiData);
          }
        } catch {
          setAnalysisObj({ note: "Analytical information unavailable." });
        } finally {
          setAnalysisLoading(false);
        }
      }
    } catch {
      const msg = "Network error";
      setResult({ symbol: "—", price: "—", info: msg });
      setErrorMsg(msg);
    }

    setLoading(false);
  };

  const handleQuickSelect = async (symbolOrPair) => {
    const value = String(symbolOrPair || "").trim();
    if (!value) return;

    if (assetMode === "fx") {
      const [fromRaw, toRaw] = value.split("/");
      const from = String(fromRaw || "").trim().toUpperCase();
      const to = String(toRaw || "").trim().toUpperCase();
      if (!from || !to) return;
      setFxFrom(from);
      setFxTo(to);
      setTimeout(() => convertFx(), 0);
      return;
    }

    setTicker(value.toUpperCase());
    setSuppressSuggestions(true);
    setSuggestionOpen(false);
    await searchStock(value);
  };

  const resetAnalysis = () => {
    setTicker("");
    setSuppressSuggestions(false);
    setSearchSuggestions([]);
    setSuggestionOpen(false);
    setUsingTicker("");
    setResult(null);
    setCompany(null);
    setFundamentals(null);
    setFundInsights(null);
    setFundInsightsLoading(false);
    setSecFundamentals(null);
    setSecFundamentalsLoading(false);
    setSectorInfo(null);
    setNews([]);
    setAnalysisObj(null);
    setChartPoints([]);
    setErrorMsg("");
  };

  const applyPortfolioSuggestion = (suggestion) => {
    const symbol = canonicalTicker(suggestion?.symbol || "");
    if (!symbol) return;
    setPortfolioSymbolInput(symbol);
    setPortfolioSuggestionOpen(false);
  };

  const addPortfolioHolding = async () => {
    const fallback = canonicalTicker(usingTicker || ticker || "");
    const rawSymbol = String(portfolioSymbolInput || fallback || "").trim();
    const symbol = rawSymbol ? await resolveSymbol(rawSymbol) : "";
    const quantity = Number(portfolioQtyInput);
    const buyPrice = Number(portfolioBuyPriceInput || 0);
    const buyDate = String(portfolioBuyDateInput || "");

    if (!symbol) {
      setPortfolioError("Enter a valid stock symbol.");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setPortfolioError("Quantity must be greater than 0.");
      return;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      setPortfolioError("Buy price must be 0 or greater.");
      return;
    }

    setPortfolioError("");
    setPortfolioNotice("");
    const cleanSymbol = canonicalTicker(symbol);
    setPortfolioHoldings((prev) => {
      const idx = prev.findIndex((h) => canonicalTicker(h.symbol) === cleanSymbol);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], symbol: cleanSymbol, quantity, buyPrice, buyDate };
        return next;
      }
      const id = `${cleanSymbol}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      return [...prev, { id, symbol: cleanSymbol, quantity, buyPrice, buyDate }].slice(0, 50);
    });
    setPortfolioSymbolInput("");
    setPortfolioQtyInput("1");
    setPortfolioBuyPriceInput("");
    setPortfolioBuyDateInput("");
    setPortfolioSuggestionOpen(false);
    setPortfolioNotice(`${cleanSymbol} saved in portfolio.`);
  };

  const removePortfolioHolding = (id) => {
    setPortfolioHoldings((prev) => prev.filter((x) => x.id !== id));
    setPortfolioRows((prev) => prev.filter((x) => x.id !== id));
    setPortfolioNotice("Holding removed from portfolio.");
  };

  const updatePortfolioHoldingField = (id, field, rawValue) => {
    setPortfolioHoldings((prev) =>
      prev.map((h) => {
        if (h.id !== id) return h;
        if (field === "quantity") return { ...h, quantity: rawValue };
        if (field === "buyPrice") return { ...h, buyPrice: rawValue };
        if (field === "buyDate") return { ...h, buyDate: String(rawValue || "") };
        return h;
      })
    );
  };

  const savePortfolioHolding = (id) => {
    let savedSymbol = "";
    let valid = true;
    setPortfolioHoldings((prev) =>
      prev.map((h) => {
        if (h.id !== id) return h;
        const qty = Number(h.quantity);
        const buyPx = Number(h.buyPrice || 0);
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(buyPx) || buyPx < 0) {
          valid = false;
          return h;
        }
        savedSymbol = h.symbol;
        return { ...h, quantity: qty, buyPrice: buyPx };
      })
    );
    if (!valid) {
      setPortfolioError("Quantity must be > 0 and buy price must be >= 0.");
      return;
    }
    setPortfolioError("");
    setPortfolioNotice(`${savedSymbol || "Holding"} updated.`);
  };

  const fetchPortfolioRows = async (holdings) => {
    if (!Array.isArray(holdings) || holdings.length === 0) return [];
    const rows = await Promise.all(
      holdings.map(async (h) => {
        const sym = canonicalTicker(h?.symbol || "");
        const qty = Number(h?.quantity || 0);
        const buyPrice = Number(h?.buyPrice || 0);
        const buyDate = String(h?.buyDate || "");
        try {
          const res = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
          const d = await res.json().catch(() => ({}));
          if (!res.ok) return { id: h.id, symbol: sym, quantity: qty, buyPrice, buyDate, error: d?.error || "Quote unavailable" };
          const livePrice = Number(d?.price);
          const dayChange = Number(d?.change);
          const pct = Number(d?.percentChange);
          const costBasis = Number.isFinite(qty) && Number.isFinite(buyPrice) ? qty * buyPrice : null;
          const marketValue = Number.isFinite(qty) && Number.isFinite(livePrice) ? qty * livePrice : null;
          const unrealizedPnL =
            Number.isFinite(marketValue) && Number.isFinite(costBasis) ? marketValue - costBasis : null;
          const unrealizedPct =
            Number.isFinite(costBasis) && costBasis > 0 && Number.isFinite(unrealizedPnL)
              ? (unrealizedPnL / costBasis) * 100
              : null;
          return {
            id: h.id,
            symbol: canonicalTicker(d?.symbol || sym),
            quantity: qty,
            buyPrice,
            buyDate,
            price: livePrice,
            change: dayChange,
            percentChange: pct,
            previousClose: Number(d?.previousClose),
            dayPnL: Number.isFinite(dayChange) && Number.isFinite(qty) ? dayChange * qty : null,
            costBasis,
            marketValue,
            unrealizedPnL,
            unrealizedPct,
          };
        } catch {
          return { id: h.id, symbol: sym, quantity: qty, buyPrice, buyDate, error: "Network issue" };
        }
      })
    );
    return rows;
  };

  const computePortfolioAnalysis = (rows) => {
    const valid = rows.filter((r) => Number.isFinite(r?.percentChange) && Number.isFinite(r?.marketValue));
    const greenFlags = [];
    const redFlags = [];
    let score = 65;

    if (!valid.length) {
      return {
        score: 35,
        greenFlags,
        redFlags: ["No valid holdings data yet. Add symbols and refresh portfolio analysis."],
      };
    }

    const totalValue = valid.reduce((a, r) => a + Number(r.marketValue || 0), 0);
    const avgChange = valid.reduce((a, r) => a + Number(r.percentChange || 0), 0) / valid.length;
    const weightedDaily =
      totalValue > 0
        ? valid.reduce((a, r) => a + Number(r.percentChange || 0) * (Number(r.marketValue || 0) / totalValue), 0)
        : avgChange;
    if (avgChange >= 0) {
      score += 12;
      greenFlags.push(`Portfolio daily momentum is positive (${avgChange.toFixed(2)}%).`);
    } else {
      score -= 12;
      redFlags.push(`Portfolio daily momentum is negative (${avgChange.toFixed(2)}%).`);
    }

    const deepRed = valid.filter((r) => Number(r.percentChange) <= -4 || Number(r.unrealizedPct) <= -15);
    if (deepRed.length) {
      score -= Math.min(20, deepRed.length * 5);
      redFlags.push(`High drawdown risk: ${deepRed.map((r) => r.symbol).join(", ")} show elevated downside.`);
    } else {
      score += 6;
      greenFlags.push("No holdings are showing severe drawdown risk right now.");
    }

    const strongGreen = valid.filter((r) => Number(r.percentChange) >= 2);
    if (strongGreen.length >= 2) {
      score += 8;
      greenFlags.push(`Multiple strong movers: ${strongGreen.map((r) => r.symbol).join(", ")}.`);
    }

    if (valid.length >= 5) {
      score += 8;
      greenFlags.push(`Diversification: ${valid.length} holdings tracked.`);
    } else {
      score -= 8;
      redFlags.push("Low diversification: consider 5+ holdings to reduce concentration risk.");
    }

    const variance = valid.reduce((a, r) => a + Math.pow(Number(r.percentChange) - weightedDaily, 2), 0) / valid.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 3.5) {
      score -= 8;
      redFlags.push("Volatility is elevated across holdings.");
    } else {
      score += 5;
      greenFlags.push("Volatility profile is relatively stable.");
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    const totalCost = valid.reduce((a, r) => a + Number(r.costBasis || 0), 0);
    const totalUnrealized = valid.reduce((a, r) => a + Number(r.unrealizedPnL || 0), 0);
    const totalReturnPct = totalCost > 0 ? (totalUnrealized / totalCost) * 100 : 0;
    if (totalReturnPct >= 0) {
      greenFlags.push(`Overall unrealized return is positive (${totalReturnPct.toFixed(2)}%).`);
    } else {
      redFlags.push(`Overall unrealized return is negative (${totalReturnPct.toFixed(2)}%).`);
      score = Math.max(0, score - 8);
    }

    return {
      score,
      greenFlags,
      redFlags,
      totalCost,
      totalValue,
      totalUnrealized,
      totalReturnPct,
      weightedDaily,
    };
  };

  const runPortfolioAnalysis = async () => {
    if (!authUser) {
      setPortfolioError("Login required to use portfolio tools.");
      return;
    }
    if (assetMode !== "stock") {
      setPortfolioError("Portfolio analysis is currently available in the Stock tab.");
      return;
    }
    const holdings = portfolioHoldings.filter((h) => canonicalTicker(h?.symbol || ""));
    if (!holdings.length) {
      setPortfolioError("Add at least one stock symbol to analyze.");
      return;
    }

    setPortfolioError("");
    setPortfolioLoading(true);
    setPortfolioAnalyzing(true);
    try {
      const rows = await fetchPortfolioRows(holdings);
      setPortfolioRows(rows);
      setPortfolioAnalysis(computePortfolioAnalysis(rows));
    } catch {
      setPortfolioError("Portfolio analysis failed. Try again.");
    } finally {
      setPortfolioLoading(false);
      setPortfolioAnalyzing(false);
    }
  };

  const handleAuthSubmit = async () => {
    const email = authEmail.trim();
    const password = authPassword;
    const confirmPassword = authConfirmPassword;
    const firstName = authFirstName.trim();
    const lastName = authLastName.trim();

    if (authMode === "forgot") return;

    if (authMode === "reset") {
      if (!password || !confirmPassword) {
        setAuthError("New password and confirm password are required.");
        return;
      }
      if (password !== confirmPassword) {
        setAuthError("Passwords do not match.");
        return;
      }
      if (password.length < 8) {
        setAuthError("Password must be at least 8 characters.");
        return;
      }
    } else if (authMode === "signup" && authSignupCodeSent) {
      if (!email || !authSignupCode.trim()) {
        setAuthError("Email and verification code are required.");
        return;
      }
    } else {
      if (!email || !password) {
        setAuthError("Email and password are required.");
        return;
      }
    }

    if (authMode === "signup" && (!firstName || !lastName)) {
      setAuthError("First name and last name are required for sign up.");
      return;
    }
    if (authMode !== "forgot" && authMode !== "reset" && password.length < 8) {
      setAuthError("Password must be at least 8 characters.");
      return;
    }
    if (authMode === "signup" && password !== confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError("Authentication is not configured. Add Supabase env vars.");
      return;
    }

    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthNotice("");

      if (authMode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) {
          setAuthError(error.message || "Password reset failed.");
          return;
        }
        setAuthNotice("Password updated successfully. You can now continue.");
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthMode("signin");
        if (typeof window !== "undefined") {
          window.history.replaceState({}, "", window.location.pathname);
        }
      } else if (authMode === "signup") {
        if (!authSignupCodeSent) {
          const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
              shouldCreateUser: true,
              data: {
                first_name: firstName,
                last_name: lastName,
                full_name: `${firstName} ${lastName}`.trim(),
              },
            },
          });
          if (error) {
            setAuthError(error.message || "Could not send verification code.");
            return;
          }
          setAuthSignupCodeSent(true);
          setAuthNotice("Verification code sent. Enter the code to finish creating your account.");
          return;
        }

        const { error: verifyError } = await supabase.auth.verifyOtp({
          email,
          token: authSignupCode.trim(),
          type: "email",
        });
        if (verifyError) {
          setAuthError(verifyError.message || "Code verification failed.");
          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password,
          data: {
            first_name: firstName,
            last_name: lastName,
            full_name: `${firstName} ${lastName}`.trim(),
          },
        });
        if (updateError) {
          setAuthError(updateError.message || "Account created, but password setup failed. Use Forgot Password.");
          return;
        }

        setAuthNotice("Email verified. Your account is ready and you are now signed in.");
        setAuthSignupCode("");
        setAuthSignupCodeSent(false);
        setAuthPanelOpen(false);
        setAuthPassword("");
        setAuthConfirmPassword("");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setAuthError(error.message || "Sign in failed.");
          return;
        }
        setAuthPassword("");
        setAuthConfirmPassword("");
        setAuthPanelOpen(false);
      }
    } catch {
      setAuthError("Authentication failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    const email = authEmail.trim();
    if (!email) {
      setAuthError("Enter your email first.");
      return;
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError("Authentication is not configured. Add Supabase env vars.");
      return;
    }
    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthNotice("");
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      });
      if (error) {
        setAuthError(error.message || "Could not send reset email.");
        return;
      }
      setAuthNotice("Reset email sent. Open the email link, then set your new password.");
    } catch {
      setAuthError("Could not send reset email. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleOAuthLogin = async (provider) => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setAuthError("Authentication is not configured. Add Supabase env vars.");
      return;
    }
    try {
      setAuthLoading(true);
      setAuthError("");
      setAuthNotice("");
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          ...(provider === "google" ? { queryParams: { prompt: "select_account" } } : {}),
        },
      });
      if (error) {
        setAuthError(error.message || `Could not sign in with ${provider}.`);
      }
    } catch {
      setAuthError(`Could not sign in with ${provider}.`);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    await supabase.auth.signOut();
    setAuthUser(null);
    setUserMenuOpen(false);
    setProfilePanelOpen(false);
  };

  const handleSaveProfileName = async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !authUser) {
      setProfileError("Profile update is unavailable.");
      return;
    }
    const first = profileFirstName.trim();
    const last = profileLastName.trim();
    if (!first || !last) {
      setProfileError("First name and last name are required.");
      return;
    }
    try {
      setProfileLoading(true);
      setProfileError("");
      setProfileNotice("");
      const { error } = await supabase.auth.updateUser({
        data: {
          first_name: first,
          last_name: last,
          full_name: `${first} ${last}`.trim(),
        },
      });
      if (error) {
        setProfileError(error.message || "Could not update profile.");
        return;
      }
      setProfileNotice("Profile updated.");
    } catch {
      setProfileError("Could not update profile.");
    } finally {
      setProfileLoading(false);
    }
  };

  const updateQuizField = (field, value) => {
    setQuizAnswers((prev) => ({ ...prev, [field]: value }));
  };

  const toggleQuizArrayValue = (field, value) => {
    setQuizAnswers((prev) => {
      const current = Array.isArray(prev[field]) ? prev[field] : [];
      const next = current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
      return { ...prev, [field]: next };
    });
  };

  const validateQuiz = () => {
    if (quizFollowupMode) {
      if (!quizAnswers.followupChange) return "Please answer the follow-up question.";
      return "";
    }

    const required = [
      ["goal", "Goal"],
      ["horizon", "Investment horizon"],
      ["drawdownAction", "Drawdown behavior"],
      ["riskTolerance", "Risk tolerance"],
      ["incomeStability", "Income stability"],
      ["experience", "Experience"],
      ["analysisStyle", "Analysis style"],
      ["reviewFrequency", "Review frequency"],
      ["regionFocus", "Region focus"],
      ["liquidityNeeds", "Liquidity needs"],
      ["ethicalPreference", "Ethical preference"],
      ["dayTradingInterest", "Day trading interest"],
    ];
    for (const [key, label] of required) {
      if (!String(quizAnswers[key] || "").trim()) return `${label} is required.`;
    }
    if (!Array.isArray(quizAnswers.assetClasses) || quizAnswers.assetClasses.length === 0) {
      return "Select at least one preferred asset class.";
    }
    if (quizAnswers.dayTradingInterest.startsWith("yes") && quizAnswers.dayTradingMarkets.length === 0) {
      return "Select at least one day-trading market.";
    }
    if (quizAnswers.dayTradingInterest.startsWith("yes") && !quizAnswers.dayTradingTime) {
      return "Select time available per day for day trading.";
    }
    return "";
  };

  const submitQuiz = async () => {
    const err = validateQuiz();
    if (err) {
      setQuizError(err);
      return;
    }
    setQuizError("");
    setQuizSaving(true);
    setQuizCompleted(true);
    setQuizDismissed(false);
    setQuizPanelOpen(false);
    const completedAtIso = new Date().toISOString();
    setQuizCompletedAt(completedAtIso);
    setQuizFollowupDue(false);
    setQuizFollowupMode(false);

    const supabase = getSupabaseClient();
    if (supabase && authUser) {
      try {
        await supabase.auth.updateUser({
          data: {
            profile_quiz: quizAnswers,
            profile_quiz_completed: true,
            profile_quiz_completed_at: completedAtIso,
            profile_quiz_last_followup_change: quizAnswers.followupChange || "",
            profile_quiz_last_followup_notes: quizAnswers.followupNotes || "",
          },
        });
      } catch {}
    }
    setQuizSaving(false);
  };

  const fetchDayTraderPick = async () => {
    const enabled = Boolean(authUser && quizCompleted && String(quizAnswers.dayTradingInterest || "").startsWith("yes"));
    if (!enabled || assetMode === "fx" || assetMode === "news" || assetMode === "globalmarket" || assetMode === "geopolitics") {
      setDayTraderObj(null);
      return;
    }
    try {
      setDayTraderLoading(true);
      const profileHint = encodeURIComponent(
        JSON.stringify({
          riskTolerance: quizAnswers.riskTolerance,
          horizon: quizAnswers.horizon,
          dayTradingInterest: quizAnswers.dayTradingInterest,
          dayTradingMarkets: quizAnswers.dayTradingMarkets,
          dayTradingTime: quizAnswers.dayTradingTime,
          analysisStyle: quizAnswers.analysisStyle,
          experience: quizAnswers.experience,
        })
      );
      const res = await fetch(`/api/ai?mode=day_trader&market=${assetMode}&profile=${profileHint}`);
      const data = await res.json().catch(() => ({}));
      setDayTraderObj(data);
    } catch {
      setDayTraderObj({ note: "Day trader pick unavailable." });
    } finally {
      setDayTraderLoading(false);
    }
  };

  const analysisSummaryText = () => {
    if (!analysisView?.ticker) return "";
    const whyText = analysisView.why.slice(0, 4).map((x) => `- ${x}`).join("\n");
    const risksText = analysisView.risks.slice(0, 3).map((x) => `- ${x}`).join("\n");
    return [
      `Ticker: ${analysisView.ticker}`,
      `Recommendation: ${analysisView.recommendation || "N/A"}`,
      `Confidence: ${analysisView.confidence || 0}%`,
      `Risk Level: ${analysisView.riskLevel || "N/A"}`,
      "",
      "Why:",
      whyText || "- N/A",
      "",
      "Risks:",
      risksText || "- N/A",
      "",
      `Day Plan: ${analysisView.dayPlan || "N/A"}`,
      `Note: ${analysisView.note || "Educational only. Not financial advice."}`,
    ].join("\n");
  };

  const copyAnalysis = async () => {
    const text = analysisSummaryText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  const shareAnalysis = async () => {
    const text = analysisSummaryText();
    if (!text) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Arthastra Analytical Information: ${analysisView.ticker}`, text });
      } else {
        await navigator.clipboard.writeText(text);
      }
    } catch {}
  };

  const sendChatMessage = async () => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;

    const ctxSymbol = usingTicker || result?.symbol || "";
    const priceNum =
      typeof result?.price === "string" ? Number(result.price.replace(/[^0-9.-]/g, "")) : null;
    const priceForApi = Number.isFinite(priceNum) ? String(priceNum) : "";

    setChatMessages((prev) => [...prev, { role: "user", content: question }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const q = question.toLowerCase();
      const asksFounder =
        /\b(founder|owner|creator|made you|who built you|who created you|who made this|who made the site)\b/.test(q) ||
        /\bdeep patel\b/.test(q) ||
        /\bjuan m\. ramirez\b/.test(q);
      if (asksFounder) {
        const identityReply =
          "Arthastra was founded by Deep Patel with Juan M. Ramirez as Co-founder. They are the owners and creators behind this platform. For support, contact support@arthastraai.com.";
        setChatMessages((prev) => [...prev, { role: "assistant", content: identityReply }]);
        setChatLoading(false);
        return;
      }

      const profileHint =
        authUser && quizCompleted
          ? encodeURIComponent(
              JSON.stringify({
                goal: quizAnswers.goal,
                horizon: quizAnswers.horizon,
                riskTolerance: quizAnswers.riskTolerance,
                experience: quizAnswers.experience,
                analysisStyle: quizAnswers.analysisStyle,
                dayTradingInterest: quizAnswers.dayTradingInterest,
                dayTradingMarkets: quizAnswers.dayTradingMarkets,
              })
            )
          : "";
      const res = await fetch(
        `/api/ai?mode=chat&market=${assetMode}&question=${encodeURIComponent(question)}&symbol=${encodeURIComponent(ctxSymbol)}&price=${encodeURIComponent(priceForApi)}${profileHint ? `&profile=${profileHint}` : ""}`
      );
      const data = await res.json().catch(() => ({}));
      const answer = cleanChatAnswer(data?.answer || data?.raw || data?.error || "I could not generate a reply.");
      setChatMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Network issue. Please try again. For informational purposes only. Not financial advice." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const dailyViewBase = normalizeAiPayload(dailyObj);
  const dayTraderViewBase = normalizeAiPayload(dayTraderObj);
  const analysisViewBase = normalizeAiPayload(analysisObj);
  const dailyView = useMemo(
    () => localizeAiPayloadView(dailyViewBase, language, headlineTranslationCacheRef.current),
    [dailyObj, language, headlineTranslationVersion]
  );
  const dayTraderView = useMemo(
    () => localizeAiPayloadView(dayTraderViewBase, language, headlineTranslationCacheRef.current),
    [dayTraderObj, language, headlineTranslationVersion]
  );
  const analysisView = useMemo(
    () => localizeAiPayloadView(analysisViewBase, language, headlineTranslationCacheRef.current),
    [analysisObj, language, headlineTranslationVersion]
  );
  const dailyLaymanSummaryRaw = useMemo(() => buildDailyPickLaymanSummary(dailyViewBase), [dailyObj]);
  const dailyLaymanSummary = useMemo(
    () => resolveLocalizedText(dailyLaymanSummaryRaw, language, headlineTranslationCacheRef.current),
    [dailyLaymanSummaryRaw, language, headlineTranslationVersion]
  );
  const searchSectionSummaryRaw = useMemo(
    () =>
      buildSearchSectionSummary({
        assetMode,
        usingTicker,
        result,
        company,
        analysis: analysisViewBase,
      }),
    [assetMode, usingTicker, result, company, analysisObj]
  );
  const searchSectionSummary = useMemo(
    () => resolveLocalizedText(searchSectionSummaryRaw, language, headlineTranslationCacheRef.current),
    [searchSectionSummaryRaw, language, headlineTranslationVersion]
  );
  const fxSearchSummaryRaw = useMemo(() => buildFxSearchSummary(fxResult), [fxResult]);
  const fxSearchSummary = useMemo(
    () => resolveLocalizedText(fxSearchSummaryRaw, language, headlineTranslationCacheRef.current),
    [fxSearchSummaryRaw, language, headlineTranslationVersion]
  );
  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isAlerik = theme === "alerik";
  const isLight = theme === "light" || isCherry;
  const trendDelta =
    chartPoints.length > 1 ? Number(chartPoints[chartPoints.length - 1].close) - Number(chartPoints[0].close) : 0;
  const trendPct =
    chartPoints.length > 1 && Number(chartPoints[0].close) > 0
      ? (trendDelta / Number(chartPoints[0].close)) * 100
      : 0;
  const trendLabel =
    chartPoints.length > 1 ? (trendDelta >= 0 ? "Uptrend" : "Downtrend") : "No trend";
  const parsedResultPrice = useMemo(() => {
    const raw = String(result?.price || "").replace(/[^0-9.-]/g, "");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [result?.price]);
  const intradayRangePct = useMemo(() => {
    const high = Number(result?.high);
    const low = Number(result?.low);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !parsedResultPrice || parsedResultPrice <= 0) return null;
    return ((high - low) / parsedResultPrice) * 100;
  }, [result?.high, result?.low, parsedResultPrice]);
  const volumeToMarketCapPct = useMemo(() => {
    const vol = Number(latestVolume);
    const cap = Number(fundamentals?.marketCap);
    if (!Number.isFinite(vol) || !Number.isFinite(cap) || cap <= 0) return null;
    return (vol / cap) * 100;
  }, [latestVolume, fundamentals?.marketCap]);
  const fdvToMarketCapRatio = useMemo(() => {
    const fdv = Number(fundamentals?.fdv);
    const cap = Number(fundamentals?.marketCap);
    if (!Number.isFinite(fdv) || !Number.isFinite(cap) || cap <= 0) return null;
    return fdv / cap;
  }, [fundamentals?.fdv, fundamentals?.marketCap]);
  const circulatingToMaxPct = useMemo(() => {
    const circ = Number(fundamentals?.circulatingSupply);
    const max = Number(fundamentals?.maxSupply);
    if (!Number.isFinite(circ) || !Number.isFinite(max) || max <= 0) return null;
    return (circ / max) * 100;
  }, [fundamentals?.circulatingSupply, fundamentals?.maxSupply]);
  const issueCloseRatePct = useMemo(() => {
    const total = Number(fundamentals?.githubTotalIssues);
    const closed = Number(fundamentals?.githubClosedIssues);
    if (!Number.isFinite(total) || !Number.isFinite(closed) || total <= 0) return null;
    return (closed / total) * 100;
  }, [fundamentals?.githubTotalIssues, fundamentals?.githubClosedIssues]);
  const isFxMode = assetMode === "fx";
  const currentTabLabel =
    assetMode === "crypto"
      ? "crypto"
      : assetMode === "metals"
        ? "metals"
          : assetMode === "fx"
            ? "FX"
            : assetMode === "news" || assetMode === "globalmarket"
              ? "world news"
              : assetMode === "geopolitics"
                ? "geopolitics"
              : "stock";
  const chatInputPlaceholder =
    assetMode === "crypto"
      ? "Ask anything (crypto, stocks, metals, FX, news, geopolitics)..."
      : assetMode === "metals"
        ? "Ask anything (metals, crypto, stocks, FX, news, geopolitics)..."
          : assetMode === "fx"
            ? "Ask anything (FX, stocks, crypto, metals, news, geopolitics)..."
            : assetMode === "news" || assetMode === "globalmarket"
              ? "Ask anything (world news, markets, crypto, FX, metals, geopolitics)..."
            : assetMode === "geopolitics"
              ? "Ask anything (global conflicts, diplomacy, sanctions, trade, markets)..."
              : "Ask anything (stocks, crypto, metals, FX, news, geopolitics)...";
  const isNewsMode = assetMode === "news";
  const isGlobalMarketMode = assetMode === "globalmarket";
  const isGeoPoliticsMode = assetMode === "geopolitics";
  const isNarrativeMode = isNewsMode || isGlobalMarketMode || isGeoPoliticsMode;
  const isMetalsMode = assetMode === "metals";
  const overviewLoop = overview.length ? [...overview, ...overview] : [];
  const supabaseConfigured = Boolean(getSupabaseClient());
  const dayTraderEligible = Boolean(authUser && quizCompleted && String(quizAnswers.dayTradingInterest || "").startsWith("yes"));
  const geopoliticsItems = useMemo(
    () =>
      localizedMarketNewsWithSummary.map((n, idx) => ({
        id: [idx, n?.url || n?.headlineOriginal || "item"].join("-"),
        ...n,
        theme: geopoliticsThemeFromHeadline(n?.headlineOriginal),
        region: geopoliticsRegionFromHeadline(n?.headlineOriginal),
        impact: geopoliticsImpactFromHeadline(n?.headlineOriginal),
      })),
    [localizedMarketNewsWithSummary]
  );
  const geoRegionOptions = useMemo(() => {
    const regions = Array.from(new Set(geopoliticsItems.map((x) => x.region).filter(Boolean))).sort();
    return ["all", ...regions];
  }, [geopoliticsItems]);

  const geopoliticsThemeCounts = useMemo(() => {
    const counts = {};
    for (const item of geopoliticsItems) {
      const key = item.theme || "Strategic Watch";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [geopoliticsItems]);

  const geopoliticsRegionCounts = useMemo(() => {
    const counts = {};
    for (const item of geopoliticsItems) {
      const key = item.region || "Global";
      counts[key] = (counts[key] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([region, count]) => ({ region, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  }, [geopoliticsItems]);

  const geopoliticsWatchlist = useMemo(() => {
    const watchRules = [
      { key: "Energy Chokepoints", terms: ["strait", "shipping", "red sea", "pipeline", "lng", "opec", "oil", "gas"] },
      { key: "Sanctions & Trade", terms: ["sanction", "tariff", "export", "import", "embargo", "trade"] },
      { key: "Military Escalation", terms: ["attack", "missile", "troops", "war", "strike", "ceasefire"] },
    ];
    return watchRules
      .map((rule) => {
        const hits = geopoliticsItems.filter((item) =>
          rule.terms.some((term) => String(item.headlineOriginal || "").toLowerCase().includes(term))
        );
        const top = hits.sort((a, b) => geopoliticsTimestamp(b.datetime) - geopoliticsTimestamp(a.datetime))[0];
        return { key: rule.key, hits: hits.length, top };
      })
      .sort((a, b) => b.hits - a.hits);
  }, [geopoliticsItems]);

  const filteredGeopoliticsItems = useMemo(() => {
    let items = [...geopoliticsItems];
    if (geoFilter === "high") items = items.filter((x) => x.impact === "High");
    else if (geoFilter !== "all") items = items.filter((x) => x.theme === geoFilter);

    if (geoRegionFilter !== "all") items = items.filter((x) => x.region === geoRegionFilter);

    const q = geoQuery.trim().toLowerCase();
    if (q) {
      items = items.filter((x) =>
        [x.headlineDisplay, x.headlineOriginal, x.source, x.theme, x.region].some((field) => String(field || "").toLowerCase().includes(q))
      );
    }

    const impactScore = { High: 3, Medium: 2, Low: 1 };
    if (geoSort === "latest") {
      items.sort((a, b) => geopoliticsTimestamp(b.datetime) - geopoliticsTimestamp(a.datetime));
    } else if (geoSort === "oldest") {
      items.sort((a, b) => geopoliticsTimestamp(a.datetime) - geopoliticsTimestamp(b.datetime));
    } else {
      items.sort((a, b) => {
        const byImpact = (impactScore[b.impact] || 0) - (impactScore[a.impact] || 0);
        if (byImpact !== 0) return byImpact;
        return geopoliticsTimestamp(b.datetime) - geopoliticsTimestamp(a.datetime);
      });
    }

    return items;
  }, [geoFilter, geopoliticsItems, geoRegionFilter, geoSort, geoQuery]);

  const geopoliticsStats = useMemo(() => {
    const highImpact = geopoliticsItems.filter((x) => x.impact === "High").length;
    const mediumImpact = geopoliticsItems.filter((x) => x.impact === "Medium").length;
    const lowImpact = geopoliticsItems.filter((x) => x.impact === "Low").length;
    const regions = new Set(geopoliticsItems.map((x) => x.region).filter(Boolean));
    const total = geopoliticsItems.length;
    const weightedRisk = highImpact * 3 + mediumImpact * 2 + lowImpact;
    const riskScore = total > 0 ? Math.round((weightedRisk / (total * 3)) * 100) : 0;
    const updatedTs = Math.max(0, ...geopoliticsItems.map((x) => geopoliticsTimestamp(x.datetime)));
    return {
      total,
      highImpact,
      mediumImpact,
      regions: regions.size,
      riskScore,
      updatedTs,
    };
  }, [geopoliticsItems]);
  const geopoliticsExecutiveSummary = useMemo(() => {
    const total = geopoliticsStats.total;
    if (!total) {
      return "No geopolitical signals are active yet. Refresh the feed to establish current global risk posture.";
    }
    const riskLabel =
      geopoliticsStats.riskScore >= 70 ? "elevated and unstable"
      : geopoliticsStats.riskScore >= 40 ? "mixed with two-way volatility"
      : "contained but worth monitoring";
    const dominantTheme = Object.entries(geopoliticsThemeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "cross-regional developments";
    const dominantRegion = geopoliticsRegionCounts[0]?.region || "global markets";
    return `Global geopolitical risk is ${riskLabel}. ${geopoliticsStats.highImpact} high-impact alerts are active across ${geopoliticsStats.regions} regions, with ${dominantTheme.toLowerCase()} leading the tape. Current pressure is concentrated in ${dominantRegion}, which can drive faster sentiment rotation across equities, commodities, and FX.`;
  }, [geopoliticsStats, geopoliticsThemeCounts, geopoliticsRegionCounts]);
  const geopoliticsWatchNarrative = useMemo(() => {
    const lead = filteredGeopoliticsItems[0];
    const second = filteredGeopoliticsItems[1];
    const third = filteredGeopoliticsItems[2];
    const leadText = lead?.headlineDisplay || lead?.headlineOriginal || "No lead catalyst yet.";
    const secondText = second?.headlineDisplay || second?.headlineOriginal || "No second-order catalyst yet.";
    const thirdText = third?.headlineDisplay || third?.headlineOriginal || "No third-order catalyst yet.";
    return {
      changed: leadText,
      market: secondText,
      watch: thirdText,
    };
  }, [filteredGeopoliticsItems]);
  const selectedGlobalCountry = useMemo(
    () => GLOBAL_MARKET_COUNTRIES.find((country) => country.code === globalMarketCountry) || GLOBAL_MARKET_COUNTRIES[0],
    [globalMarketCountry]
  );
  const globalCountryOptions = useMemo(() => {
    const q = String(globalCountryQuery || "").trim().toLowerCase();
    if (!q) return GLOBAL_MARKET_COUNTRIES;
    return GLOBAL_MARKET_COUNTRIES.filter((country) => {
      const haystack = [
        String(country.name || ""),
        String(country.code || ""),
        String(country.iso2 || ""),
        ...(Array.isArray(country.keywords) ? country.keywords : []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [globalCountryQuery]);
  const globalQuickSelectCountries = useMemo(() => {
    const source = globalCountryOptions.length ? globalCountryOptions : GLOBAL_MARKET_COUNTRIES;
    return source.slice(0, 18);
  }, [globalCountryOptions]);
  const selectedCountryRelations = useMemo(() => {
    const rel = geopoliticalRelations?.[selectedGlobalCountry.code] || {};
    return {
      alliesPartners: Array.isArray(rel?.alliesPartners) ? rel.alliesPartners : [],
      tradePartners: Array.isArray(rel?.tradePartners) ? rel.tradePartners : [],
      tensionsSanctions: Array.isArray(rel?.tensionsSanctions) ? rel.tensionsSanctions : [],
      activeConflicts: Array.isArray(rel?.activeConflicts) ? rel.activeConflicts : [],
    };
  }, [selectedGlobalCountry]);
  const relationTypeByIso = useMemo(() => {
    const map = new Map();
    selectedCountryRelations.tradePartners.forEach((x) => map.set(String(x?.code || "").toUpperCase(), "trade"));
    selectedCountryRelations.alliesPartners.forEach((x) => map.set(String(x?.code || "").toUpperCase(), "ally"));
    selectedCountryRelations.tensionsSanctions.forEach((x) => map.set(String(x?.code || "").toUpperCase(), "tension"));
    selectedCountryRelations.activeConflicts.forEach((x) => map.set(String(x?.code || "").toUpperCase(), "conflict"));
    return map;
  }, [selectedCountryRelations]);
  const alliesAndPartnersList = useMemo(
    () => {
      const out = [];
      const seen = new Set();
      [...selectedCountryRelations.alliesPartners, ...selectedCountryRelations.tradePartners].forEach((item) => {
        const code = String(item?.code || "").toUpperCase();
        const name = String(item?.name || "").trim();
        const reason = String(item?.reason || "").trim();
        const key = `${code}|${name}|${reason}`;
        if (!name || seen.has(key)) return;
        seen.add(key);
        out.push({ code, name, reason });
      });
      return out;
    },
    [selectedCountryRelations]
  );
  const selectedCountryRelationStats = useMemo(
    () => ({
      allies: selectedCountryRelations.alliesPartners.length,
      trade: selectedCountryRelations.tradePartners.length,
      tensions: selectedCountryRelations.tensionsSanctions.length,
      conflicts: selectedCountryRelations.activeConflicts.length,
    }),
    [selectedCountryRelations]
  );
  const selectedCountryMarketPulse = useMemo(() => {
    const valid = globalCountryQuotes
      .map((row) => ({ ...row, pct: Number(row?.percentChange) }))
      .filter((row) => Number.isFinite(row.pct));
    if (!valid.length) {
      return { average: null, strongest: null, weakest: null };
    }
    const average = valid.reduce((sum, row) => sum + row.pct, 0) / valid.length;
    const strongest = [...valid].sort((a, b) => b.pct - a.pct)[0];
    const weakest = [...valid].sort((a, b) => a.pct - b.pct)[0];
    return { average, strongest, weakest };
  }, [globalCountryQuotes]);
  const selectedCountryAvgPct =
    typeof selectedCountryMarketPulse.average === "number" &&
    Number.isFinite(selectedCountryMarketPulse.average)
      ? selectedCountryMarketPulse.average
      : null;
  const globalProjection = useMemo(
    () => geoMercator().scale(130).translate([GLOBAL_MAP_WIDTH / 2, GLOBAL_MAP_HEIGHT / 1.5]),
    []
  );
  const globalPath = useMemo(() => geoPath(globalProjection), [globalProjection]);
  const globalMarkers = useMemo(
    () =>
      GLOBAL_MARKET_COUNTRIES.map((country) => {
        const point = globalProjection([country.lon, country.lat]);
        return { ...country, point: Array.isArray(point) ? point : null };
      }).filter((country) => Array.isArray(country.point)),
    [globalProjection]
  );
  const globalCountryNews = useMemo(() => {
    const keywords = selectedGlobalCountry?.keywords || [];
    const filtered = localizedMarketNewsWithSummary.filter((item) => {
      const text = [
        String(item?.headlineOriginal || ""),
        String(item?.headlineDisplay || ""),
        String(item?.source || ""),
      ]
        .join(" ")
        .toLowerCase();
      return keywords.some((keyword) => text.includes(keyword));
    });
    if (filtered.length) return filtered.slice(0, 10);
    return localizedMarketNewsWithSummary.slice(0, 10);
  }, [localizedMarketNewsWithSummary, selectedGlobalCountry]);
  const globalMarketExecutiveSummary = useMemo(() => {
    const lead = globalCountryNews[0];
    const proxyCount = selectedGlobalCountry?.symbols?.length || 0;
    if (!lead) {
      return `Select a country on the map to track its market pulse and local macro headlines in one view.`;
    }
    const leadText = lead.headlineDisplay || lead.headlineOriginal || "";
    return `${selectedGlobalCountry.name} is now in focus. Monitoring ${proxyCount} market proxy ${proxyCount === 1 ? "instrument" : "instruments"} and latest catalysts: ${leadText}`;
  }, [globalCountryNews, selectedGlobalCountry]);
  const marketsOpenNow = useMemo(
    () =>
      GLOBAL_MARKET_SESSIONS.map((session) => ({
        ...session,
        ...getSessionStatus(session, new Date(marketSessionsTick)),
      })),
    [marketSessionsTick]
  );
  const globalMarketStats = useMemo(() => {
    const openSessions = marketsOpenNow.filter((session) => session.isOpen).length;
    const riskCount = selectedCountryRelationStats.tensions + selectedCountryRelationStats.conflicts;
    return {
      proxies: globalCountryQuotes.length,
      headlines: globalCountryNews.length,
      openSessions,
      riskCount,
    };
  }, [globalCountryQuotes.length, globalCountryNews.length, marketsOpenNow, selectedCountryRelationStats]);
  const globalMacroMap = useMemo(() => {
    const out = new Map();
    for (const row of globalMacroRows) out.set(String(row?.key || ""), row);
    return out;
  }, [globalMacroRows]);
  const globalRegime = useMemo(() => {
    const vix = Number(globalMacroMap.get("vix")?.value);
    const dxy = Number(globalMacroMap.get("dxy")?.value);
    const tenYearRaw = Number(globalMacroMap.get("tnx")?.value);
    const tenYear = Number.isFinite(tenYearRaw) ? tenYearRaw / 10 : null;

    let label = "Neutral";
    if (Number.isFinite(vix)) {
      if (vix >= 25) label = "Risk-Off";
      else if (vix >= 20) label = "Caution";
      else if (vix <= 15) label = "Risk-On";
    }

    const summaryParts = [];
    if (Number.isFinite(vix)) summaryParts.push(`VIX ${vix.toFixed(2)}`);
    if (Number.isFinite(tenYear)) summaryParts.push(`10Y ${tenYear.toFixed(2)}%`);
    if (Number.isFinite(dxy)) summaryParts.push(`DXY ${dxy.toFixed(2)}`);

    return {
      label,
      summary: summaryParts.length ? summaryParts.join(" • ") : "Macro strip still loading",
    };
  }, [globalMacroMap]);
  const globalSessionHeadline = useMemo(() => {
    const open = marketsOpenNow.filter((x) => x.isOpen);
    if (!open.length) return "All major sessions are currently closed.";
    const names = open.slice(0, 3).map((x) => x.name.split(" (")[0]);
    return `Open now: ${names.join(", ")}${open.length > 3 ? ` +${open.length - 3} more` : ""}.`;
  }, [marketsOpenNow]);
  useEffect(() => {
    if (!isGlobalMarketMode) return;
    const key = selectedGlobalCountry.code;
    const cached = geoCountrySummaryCacheRef.current.get(key);
    if (cached) {
      setGeoCountrySummary(cached);
      return;
    }
    setGeoCountrySummary("");
    let cancelled = false;
    const loadGeoSummary = async () => {
      try {
        setGeoCountrySummaryLoading(true);
        const res = await fetch("/api/geopolitics-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            country: selectedGlobalCountry.name,
            relations: selectedCountryRelations,
          }),
        });
        const data = await res.json().catch(() => ({}));
        const summary = String(data?.summary || "").trim();
        if (!summary) return;
        geoCountrySummaryCacheRef.current.set(key, summary);
        if (!cancelled) {
          setGeoCountrySummary(summary);
          setGeoCountrySummaryVersion((v) => v + 1);
        }
      } finally {
        if (!cancelled) setGeoCountrySummaryLoading(false);
      }
    };
    loadGeoSummary();
    return () => {
      cancelled = true;
    };
  }, [isGlobalMarketMode, selectedGlobalCountry, selectedCountryRelations]);
  useEffect(() => {
    let cancelled = false;
    const loadWorld = async () => {
      try {
        setGlobalWorldLoading(true);
        setGlobalWorldError("");
        const res = await fetch(GLOBAL_MARKET_GEOJSON_URL, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const features = Array.isArray(data?.features) ? data.features : [];
        if (!cancelled) setGlobalWorldFeatures(features);
      } catch {
        if (!cancelled) {
          setGlobalWorldFeatures([]);
          setGlobalWorldError("Unable to load world map.");
        }
      } finally {
        if (!cancelled) setGlobalWorldLoading(false);
      }
    };
    loadWorld();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!isGlobalMarketMode) return;
    const timer = setInterval(() => setMarketSessionsTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [isGlobalMarketMode]);
  useEffect(() => {
    if (!isGlobalMarketMode) return;
    let cancelled = false;
    const loadMacro = async () => {
      try {
        setGlobalMacroLoading(true);
        const rows = await Promise.all(
          GLOBAL_MACRO_INDICATORS.map(async (item) => {
            try {
              const res = await fetch(`/api/quote?symbol=${encodeURIComponent(item.symbol)}`, {
                cache: "no-store",
                headers: { "cache-control": "no-store" },
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) return { ...item, value: null, percentChange: null };
              return {
                ...item,
                value: Number.isFinite(Number(data?.price)) ? Number(data.price) : null,
                percentChange: Number.isFinite(Number(data?.percentChange)) ? Number(data.percentChange) : null,
              };
            } catch {
              return { ...item, value: null, percentChange: null };
            }
          })
        );
        if (!cancelled) setGlobalMacroRows(rows);
      } finally {
        if (!cancelled) setGlobalMacroLoading(false);
      }
    };
    loadMacro();
    const timer = setInterval(loadMacro, 60000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isGlobalMarketMode]);
  useEffect(() => {
    if (!isGlobalMarketMode) return;
    const symbols = selectedGlobalCountry?.symbols || [];
    if (!symbols.length) {
      setGlobalCountryQuotes([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        setGlobalCountryQuotesLoading(true);
        const rows = await Promise.all(
          symbols.map(async (item) => {
            try {
              const res = await fetch(`/api/quote?symbol=${encodeURIComponent(item.symbol)}`);
              const data = await res.json().catch(() => ({}));
              if (!res.ok) return { ...item, price: null, percentChange: null, error: true };
              return {
                ...item,
                symbol: data?.symbol || item.symbol,
                price: Number.isFinite(Number(data?.price)) ? Number(data.price) : null,
                percentChange: Number.isFinite(Number(data?.percentChange)) ? Number(data.percentChange) : null,
                error: false,
              };
            } catch {
              return { ...item, price: null, percentChange: null, error: true };
            }
          })
        );
        if (!cancelled) setGlobalCountryQuotes(rows);
      } finally {
        if (!cancelled) setGlobalCountryQuotesLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [isGlobalMarketMode, selectedGlobalCountry]);
  const t = (key) => UI_TEXT[language]?.[key] || UI_TEXT.en[key] || key;
  const tx = (text) => resolveLocalizedText(text, language, headlineTranslationCacheRef.current);
  const closeParentDropdown = (event) => {
    event?.currentTarget?.closest("details")?.removeAttribute("open");
  };


  return (
    <div className={`min-h-screen relative overflow-hidden ${isCherry ? "cherry-mode bg-[#fffefc] text-[#3a2530]" : isAzula ? "azula-mode bg-[#020508] text-[#e8f4ff]" : isAlerik ? "alerik-mode bg-[#050505] text-[#f5f0e8]" : isLight ? "light-mode bg-[#fbfdff] text-slate-900" : "dark-mode bg-slate-950 text-white"}`}>
      <div>
        <div className={`pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full blur-3xl ${isCherry ? "bg-rose-100/34" : isAzula ? "bg-[#00d4ff]/14" : isLight ? "bg-sky-200/35" : "bg-cyan-500/12"}`} />
        <div className={`pointer-events-none absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl ${isCherry ? "bg-rose-100/28" : isAzula ? "bg-[#4fc3f7]/12" : isLight ? "bg-blue-200/30" : "bg-blue-500/10"}`} />
        <div className={`pointer-events-none absolute inset-0 ${isCherry ? "bg-[radial-gradient(circle_at_12%_6%,rgba(244,114,182,0.08),transparent_31%),radial-gradient(circle_at_86%_70%,rgba(251,113,133,0.07),transparent_36%),radial-gradient(circle_at_52%_14%,rgba(196,181,253,0.05),transparent_30%),linear-gradient(120deg,rgba(255,255,255,0.985),rgba(255,252,253,0.97),rgba(255,255,255,0.99))]" : isAzula ? "bg-[radial-gradient(circle_at_20%_6%,rgba(0,212,255,0.18),transparent_38%),radial-gradient(circle_at_84%_76%,rgba(79,195,247,0.13),transparent_44%),linear-gradient(180deg,rgba(2,5,8,0.97),rgba(3,11,20,0.95),rgba(2,8,14,0.98))]" : isLight ? "bg-[radial-gradient(circle_at_15%_10%,rgba(125,211,252,0.18),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(147,197,253,0.14),transparent_42%),radial-gradient(circle_at_55%_18%,rgba(59,130,246,0.09),transparent_35%)]" : "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.07),transparent_35%)]"}`}/>

        {isCherry && <SakuraThemeBackground />}
        {isAzula && <AzulaThemeBackground />}

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        {/* HEADER */}
        <div className="text-center mb-10">
          <div className="absolute right-6 top-0 z-40 pointer-events-auto">
            <details className="relative">
              <summary className={`list-none inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer [&::-webkit-details-marker]:hidden ${
                isCherry
                  ? "border-rose-200/65 bg-white/96 text-rose-900"
                  : isLight
                    ? "border-slate-300 bg-white/90 text-slate-800"
                    : "border-white/15 bg-slate-900/60 text-white/85"
              }`}>
                {t("menu")}
                <span className="text-[10px]">▼</span>
              </summary>
              <div className={`absolute right-0 top-full mt-2 w-64 rounded-xl border p-2 shadow-2xl flex flex-col gap-1 ${
                isLight ? "border-slate-300 bg-white/95" : "border-white/15 bg-slate-900/95"
              }`}>
            <div className={`my-1 h-px ${isLight ? "bg-slate-200" : "bg-white/10"}`} />
            <Link
              href="/"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("home")}
            </Link>
            <Link
              href="/market-school"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("marketSchool")}
            </Link>
            <Link
              href="/bots"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("simulator")}
            </Link>
            <Link
              href="/warroom.html"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("warRoom")}
            </Link>
            {authUser && (
              <Link
                href="/portfolio"
                onClick={closeParentDropdown}
                className={`px-3 py-1.5 rounded-lg border text-xs ${
                  isLight
                    ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                    : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
                }`}
              >
                {t("portfolio")}
              </Link>
            )}
            <Link
              href="/about"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("about")}
            </Link>
            <Link
              href="/terms"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("terms")}
            </Link>
            <Link
              href="/privacy"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("privacy")}
            </Link>
            <Link
              href="/cookies"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("cookies")}
            </Link>
            <Link
              href="/disclaimer"
              onClick={closeParentDropdown}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              {t("disclaimer")}
            </Link>
            <div className="relative">
              <button
                onClick={(event) => {
                  closeParentDropdown(event);
                  setSupportOpen((v) => !v);
                }}
                className={`px-3 py-1.5 rounded-lg border text-xs ${
                  isLight
                    ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                    : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
                }`}
              >
                {t("help")}
              </button>
              {supportOpen && (
                <div className={`absolute right-0 top-full mt-2 w-72 rounded-xl border p-3 shadow-2xl z-30 ${
                  isLight ? "border-slate-300 bg-white/95" : "border-white/15 bg-slate-900/95"
                }`}>
                  <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/70"}`}>{t("supportEmail")}</div>
                  <a href="mailto:support@arthastraai.com" className={`block text-sm mt-1 underline ${isLight ? "text-slate-900" : "text-white"}`}>
                    support@arthastraai.com
                  </a>
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText("support@arthastraai.com");
                      } catch {}
                    }}
                    className={`mt-2 px-2.5 py-1.5 rounded-md text-xs ${
                      isLight ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white/90"
                    }`}
                  >
                    {t("copyEmail")}
                  </button>
                </div>
              )}
            </div>
            {authUser ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className={`h-8 min-w-8 px-2 rounded-full border text-xs font-semibold shadow ${
                    isLight ? "border-slate-300 bg-white text-slate-700" : "border-white/20 bg-slate-900/70 text-white"
                  }`}
                  title={displayName}
                >
                  {userInitials}
                </button>
                {userMenuOpen && (
                  <div className={`absolute right-0 top-full mt-2 w-52 rounded-xl border p-2 shadow-2xl z-30 ${
                    isLight ? "border-slate-300 bg-white/95" : "border-white/15 bg-slate-900/95"
                  }`}>
                    <button
                      onClick={() => {
                        setProfilePanelOpen(true);
                        setUserMenuOpen(false);
                        setProfileError("");
                        setProfileNotice("");
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                        isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/90"
                      }`}
                    >
                      Profile
                    </button>
                    <button
                      onClick={() => {
                        setQuizPanelOpen(true);
                        setQuizFollowupMode(false);
                        setQuizDismissed(false);
                        setUserMenuOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                        isLight ? "hover:bg-slate-100 text-slate-700" : "hover:bg-white/10 text-white/90"
                      }`}
                    >
                      Change preferences
                    </button>
                    <button
                      onClick={handleSignOut}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                        isLight ? "hover:bg-red-50 text-red-600" : "hover:bg-white/10 text-red-200"
                      }`}
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="relative">
                <button
                  onClick={(event) => {
                    closeParentDropdown(event);
                    setAuthPanelOpen((v) => !v);
                    setAuthError("");
                    setAuthNotice("");
                  }}
                  className={`px-3 py-1.5 rounded-lg border text-xs ${
                    isLight
                      ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100"
                      : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
                  }`}
                >
                  {t("loginSignup")}
                </button>
                {authPanelOpen && (
                  <div
                    className={`absolute right-0 top-full mt-2 w-[92vw] max-w-xl rounded-2xl border p-4 shadow-2xl z-40 ${
                      isLight ? "border-slate-300 bg-white/95" : "border-white/15 bg-slate-900/95"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>Account Access</div>
                      <button
                        onClick={() => setAuthPanelOpen(false)}
                        className={`px-2.5 py-1 rounded-md text-xs ${
                          isLight ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white/90"
                        }`}
                      >
                        Close
                      </button>
                    </div>
                    <div className={`text-xs mb-3 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                      Optional now. Required later for advanced member-only features.
                    </div>
                    {!supabaseConfigured ? (
                      <div className={`rounded-xl border px-3 py-2 text-sm ${
                        isLight ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-400/30 bg-amber-500/10 text-amber-200"
                      }`}>
                        Auth is not configured yet. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          {authMode === "signup" && (
                            <>
                              <input
                                type="text"
                                value={authFirstName}
                                onChange={(e) => setAuthFirstName(e.target.value)}
                                placeholder="First name"
                                className="w-full px-3 py-2.5 rounded-xl bg-white text-black border border-slate-300 outline-none focus:border-blue-500"
                              />
                              <input
                                type="text"
                                value={authLastName}
                                onChange={(e) => setAuthLastName(e.target.value)}
                                placeholder="Last name"
                                className="w-full px-3 py-2.5 rounded-xl bg-white text-black border border-slate-300 outline-none focus:border-blue-500"
                              />
                            </>
                          )}
                          {authMode !== "reset" && (
                            <input
                              type="email"
                              value={authEmail}
                              onChange={(e) => setAuthEmail(e.target.value)}
                              placeholder="Email"
                              className="w-full px-3 py-2.5 rounded-xl bg-white text-black border border-slate-300 outline-none focus:border-blue-500"
                            />
                          )}
                          {(authMode === "signin" || authMode === "signup" || authMode === "reset") && (
                            <input
                              type="password"
                              value={authPassword}
                              onChange={(e) => setAuthPassword(e.target.value)}
                              placeholder={authMode === "reset" ? "New password (min 8 chars)" : "Password (min 8 chars)"}
                              className="w-full px-3 py-2.5 rounded-xl bg-white text-black border border-slate-300 outline-none focus:border-blue-500"
                            />
                          )}
                          {(authMode === "signup" || authMode === "reset") && (
                            <input
                              type="password"
                              value={authConfirmPassword}
                              onChange={(e) => setAuthConfirmPassword(e.target.value)}
                              placeholder="Confirm password"
                              className="w-full px-3 py-2.5 rounded-xl bg-white text-black border border-slate-300 outline-none focus:border-blue-500"
                            />
                          )}
                          {authMode === "signup" && authSignupCodeSent && (
                            <input
                              type="text"
                              value={authSignupCode}
                              onChange={(e) => setAuthSignupCode(e.target.value)}
                              placeholder="Enter verification code"
                              className="w-full px-3 py-2.5 rounded-xl bg-white text-black border border-slate-300 outline-none focus:border-blue-500"
                            />
                          )}
                        </div>

                        {authError && (
                          <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                            isLight ? "border-red-300 bg-red-50 text-red-700" : "border-red-500/30 bg-red-500/10 text-red-200"
                          }`}>
                            {authError}
                          </div>
                        )}
                        {authNotice && (
                          <div className={`mt-2 rounded-lg border px-3 py-2 text-sm ${
                            isLight ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                          }`}>
                            {authNotice}
                          </div>
                        )}

                        {(authMode === "signin" || (authMode === "signup" && !authSignupCodeSent)) && (
                          <div className="mt-3">
                            <div className="flex items-center gap-2 mb-2">
                              <div className={`h-px flex-1 ${isLight ? "bg-slate-300" : "bg-white/15"}`} />
                              <span className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/55"}`}>or continue with</span>
                              <div className={`h-px flex-1 ${isLight ? "bg-slate-300" : "bg-white/15"}`} />
                            </div>
                            <div className="grid grid-cols-1 gap-2">
                              <button
                                onClick={() => handleOAuthLogin("google")}
                                disabled={authLoading || !authReady}
                                className={`px-3 py-2 rounded-xl text-sm font-medium border disabled:opacity-60 ${
                                  isLight
                                    ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
                                    : "border-white/20 bg-white/5 text-white hover:bg-white/10"
                                }`}
                              >
                                Continue with Google
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {authMode !== "forgot" && (
                            <button
                              onClick={handleAuthSubmit}
                              disabled={authLoading || !authReady}
                              className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm disabled:opacity-60"
                            >
                              {authLoading
                                ? "Please wait..."
                                : authMode === "signup"
                                  ? (authSignupCodeSent ? "Verify Code & Finish" : "Create Account")
                                  : authMode === "reset"
                                    ? "Update Password"
                                    : "Sign In"}
                            </button>
                          )}
                          {authMode === "signin" && (
                            <button
                              onClick={() => {
                                setAuthMode("forgot");
                                setAuthError("");
                                setAuthNotice("");
                              }}
                              className={`px-3 py-2 rounded-xl text-sm ${
                                isLight ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white/90"
                              }`}
                            >
                              Forgot Password
                            </button>
                          )}
                          {authMode === "forgot" && (
                            <>
                              <button
                                onClick={handleForgotPassword}
                                disabled={authLoading || !authReady}
                                className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm disabled:opacity-60"
                              >
                                Send Reset Email
                              </button>
                              <button
                                onClick={() => {
                                  setAuthMode("signin");
                                  setAuthError("");
                                  setAuthNotice("");
                                }}
                                className={`px-3 py-2 rounded-xl text-sm ${
                                  isLight ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white/90"
                                }`}
                              >
                                Back to Sign in
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              setAuthMode((prev) => (prev === "signin" ? "signup" : "signin"));
                              setAuthError("");
                              setAuthNotice("");
                              setAuthFirstName("");
                              setAuthLastName("");
                              setAuthConfirmPassword("");
                              setAuthSignupCode("");
                              setAuthSignupCodeSent(false);
                            }}
                            disabled={authMode === "forgot" || authMode === "reset"}
                            className={`px-3 py-2 rounded-xl text-sm ${
                              isLight ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white/90"
                            }`}
                          >
                            {authMode === "signin" ? "Switch to Sign up" : "Switch to Sign in"}
                          </button>
                          <span className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>
                            {authReady ? (authUser?.email ? `Signed in as ${authUser.email}` : "Guest mode active") : "Checking session..."}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
              </div>
            </details>
          </div>
          <div className="mt-4 flex justify-center">
            <div className="inline-flex items-center gap-5 md:gap-6">
              <div className={`relative shrink-0 ${isAzula ? "azula-logo-thunder" : ""}`}>
                {!isLight && (
                  <>
                    <span className={`pointer-events-none absolute -left-5 top-2 h-3 w-3 rounded-[2px] ${isAzula ? "bg-[#00d4ff]/70 shadow-[0_0_14px_rgba(0,212,255,0.85)]" : "bg-[#d7c07a]/65 shadow-[0_0_14px_rgba(199,164,77,0.8)]"}`} />
                    <span className={`pointer-events-none absolute -left-1 top-12 h-2.5 w-2.5 rounded-[2px] ${isAzula ? "bg-[#4fc3f7]/65 shadow-[0_0_12px_rgba(79,195,247,0.75)]" : "bg-[#e6d9aa]/55 shadow-[0_0_12px_rgba(214,189,116,0.72)]"}`} />
                    <span className={`pointer-events-none absolute -left-4 top-[5.5rem] h-2 w-2 rounded-full ${isAzula ? "bg-[#00d4ff]/65 shadow-[0_0_10px_rgba(0,212,255,0.8)]" : "bg-[#d7c07a]/60 shadow-[0_0_10px_rgba(199,164,77,0.76)]"}`} />
                    <span className={`pointer-events-none absolute right-1 top-[-0.2rem] h-2.5 w-2.5 rounded-[2px] ${isAzula ? "bg-[#4fc3f7]/65 shadow-[0_0_12px_rgba(79,195,247,0.75)]" : "bg-[#d7c07a]/55 shadow-[0_0_12px_rgba(199,164,77,0.72)]"}`} />
                    <span className={`pointer-events-none absolute right-[-0.4rem] top-[4.9rem] h-2 w-2 rounded-full ${isAzula ? "bg-[#00d4ff]/62 shadow-[0_0_10px_rgba(0,212,255,0.7)]" : "bg-[#e6d9aa]/60 shadow-[0_0_10px_rgba(214,189,116,0.66)]"}`} />
                  </>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/arthastra-icon-transparent.svg"
                  alt="Arthastra logo"
                  className="relative z-10 h-24 w-24 md:h-28 md:w-28"
                />
              </div>
              <div className="text-left">
                <h1 className={`text-5xl md:text-6xl font-semibold leading-none tracking-tight ${isCherry ? "bg-gradient-to-r from-rose-900 via-fuchsia-800 to-indigo-800 bg-clip-text text-transparent" : isAzula ? "azula-title-neon text-transparent bg-clip-text bg-gradient-to-r from-[#e8f4ff] via-[#4fc3f7] to-[#00d4ff]" : isLight ? "text-slate-900" : "bg-gradient-to-r from-white via-cyan-100 to-sky-200 bg-clip-text text-transparent"}`}>
                  Arthastra
                </h1>
                <p className={`mt-2 text-3xl md:text-4xl font-medium leading-none tracking-tight ${isCherry ? "text-rose-900" : isAzula ? "text-[#e8f4ff]/95" : isLight ? "text-slate-700" : "text-cyan-100/90"}`}>
                  {t("analyticalInformation")}
                </p>
              </div>
            </div>
          </div>
          <p className={`mt-5 text-lg md:text-xl font-medium ${isCherry ? "text-rose-900/90" : isAzula ? "text-[#cfe9ff]/90" : isLight ? "text-slate-700" : "text-slate-200/90"}`}>{t("clarityLine")}</p>
          <p className={`text-xs mt-3 ${isCherry ? "text-rose-800/80" : isAzula ? "text-[#6a9fcc]" : isLight ? "text-slate-500" : "text-slate-400/80"}`}>{t("founder")}: Deep Patel • {t("coFounder")}: Juan M. Ramirez</p>
          <div className={`mt-5 inline-flex rounded-xl overflow-hidden border ${
            isLight ? "border-slate-300 bg-white/85 shadow-sm" : "border-white/15 bg-slate-900/60"
          }`}>
            <Link
              href="/home"
              className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${
                isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"
              }`}
            >
              {t("home")}
            </Link>
            <button
              onClick={() => setAssetMode("stock")}
              className={`px-3 py-1.5 text-xs font-semibold ${
                assetMode === "stock" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-700" : "bg-transparent text-white/80"
              }`}
            >
              {t("stock")}
            </button>
            <button
              onClick={() => setAssetMode("crypto")}
              className={`px-3 py-1.5 text-xs font-semibold ${
                assetMode === "crypto" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-700" : "bg-transparent text-white/80"
              }`}
            >
              {t("crypto")}
            </button>
            <button
              onClick={() => setAssetMode("metals")}
              className={`px-3 py-1.5 text-xs font-semibold ${
                assetMode === "metals" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-700" : "bg-transparent text-white/80"
              }`}
            >
              {t("metals")}
            </button>
            <button
              onClick={() => setAssetMode("fx")}
              className={`px-3 py-1.5 text-xs font-semibold ${
                assetMode === "fx" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-700" : "bg-transparent text-white/80"
              }`}
            >
              {t("fx")}
            </button>
            <Link
              href="/market-school"
              className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${
                isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"
              }`}
            >
              {t("learn")}
            </Link>
            <Link
              href="/bots"
              className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1 ${
                isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"
              }`}
            >
              {t("simulator")}
              {simulatorAutoPilotActive && <span title="Auto-Pilot active">🤖</span>}
              {Number.isFinite(simulatorReturnPct) && (
                <span
                  className={`rounded-full px-1.5 py-[2px] text-[10px] font-semibold ${
                    simulatorReturnPct >= 0
                      ? isLight ? "bg-emerald-100 text-emerald-700" : "bg-emerald-500/20 text-emerald-300"
                      : isLight ? "bg-rose-100 text-rose-700" : "bg-rose-500/20 text-rose-300"
                  }`}
                >
                  {simulatorReturnPct >= 0 ? "+" : ""}
                  {simulatorReturnPct.toFixed(1)}%
                </span>
              )}
            </Link>
            <button
              onClick={() => setAssetMode("geopolitics")}
              className={`px-3 py-1.5 text-xs font-semibold ${
                assetMode === "geopolitics" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-700" : "bg-transparent text-white/80"
              }`}
            >
              {t("geoPolitics")}
            </button>
            <button
              onClick={() => setAssetMode("globalmarket")}
              className={`px-3 py-1.5 text-xs font-semibold ${
                assetMode === "globalmarket" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-700" : "bg-transparent text-white/80"
              }`}
            >
              {t("globalMarket")}
            </button>
            <Link
              href="/warroom.html"
              className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${
                isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"
              }`}
            >
              {t("warRoom")}
            </Link>
            <Link
              href="/briefing"
              className={`px-3 py-1.5 text-xs font-semibold inline-flex items-center ${
                isLight ? "text-slate-700 hover:bg-slate-100" : "text-white/80 hover:bg-white/10"
              }`}
            >
              {t("briefing")}
            </Link>
          </div>
        </div>

        {welcomeBanner.show && (
          <div className="mb-6">
            <Card title="Welcome">
              <div className="text-sm text-white/90">{welcomeBanner.text}</div>
            </Card>
          </div>
        )}

        

        {authUser && profilePanelOpen && (
          <div className="mb-6">
            <Card
              title="Profile"
              right={
                <button
                  onClick={() => setProfilePanelOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                >
                  Close
                </button>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input
                  type="text"
                  value={profileFirstName}
                  onChange={(e) => setProfileFirstName(e.target.value)}
                  placeholder="First name"
                  className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                />
                <input
                  type="text"
                  value={profileLastName}
                  onChange={(e) => setProfileLastName(e.target.value)}
                  placeholder="Last name"
                  className="w-full px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleSaveProfileName}
                  disabled={profileLoading}
                  className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold disabled:opacity-60"
                >
                  Save name
                </button>
              </div>

              {profileError && (
                <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 text-red-200 px-3 py-2 text-sm">
                  {profileError}
                </div>
              )}
              {profileNotice && (
                <div className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 px-3 py-2 text-sm">
                  {profileNotice}
                </div>
              )}
            </Card>
          </div>
        )}

        {authUser && !quizDismissed && (!quizCompleted || quizFollowupDue) && (
          <div className="mb-6">
            <Card
              title={quizFollowupDue ? "30-Day Profile Follow-up" : "Personalization Quiz"}
              right={
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setQuizPanelOpen(true);
                      if (quizFollowupDue) setQuizFollowupMode(true);
                      setQuizDismissed(false);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs"
                  >
                    {quizFollowupDue ? "Take follow-up" : "Take quiz"}
                  </button>
                  <button
                    onClick={() => {
                      setQuizPanelOpen(false);
                      setQuizDismissed(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                  >
                    Do it later
                  </button>
                </div>
              }
            >
              <div className="text-sm text-white/85">
                {quizFollowupDue
                  ? "It has been 30 days since your last profile update. Complete a quick follow-up for better analytical picks and ASTRA support."
                  : "Complete this optional quiz for better analytical picks and more personalized ASTRA responses."}
              </div>
              {!quizPanelOpen && (
                <div className="mt-2 text-xs text-amber-200/90">
                  Reminder: {quizFollowupDue ? "please confirm if your preferences changed." : "your profile is not complete yet, so analytical guidance is less personalized."}
                </div>
              )}
            </Card>
          </div>
        )}

        {authUser && quizPanelOpen && (
          <div className="mb-6">
            <Card
              title={quizFollowupMode ? "30-Day Profile Follow-up" : "Investor Profile Quiz"}
              right={
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setQuizPanelOpen(false);
                      setQuizDismissed(true);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                  >
                    Do it later
                  </button>
                  <button
                    onClick={submitQuiz}
                    disabled={quizSaving}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs disabled:opacity-60"
                  >
                    {quizSaving ? "Saving..." : "Save Quiz"}
                  </button>
                </div>
              }
            >
              {quizFollowupMode && (
                <div className="mb-4 rounded-lg border border-indigo-400/30 bg-indigo-500/10 p-3">
                  <div className="text-sm text-indigo-100 mb-2">Any preference changes since your last quiz?</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => updateQuizField("followupChange", "no_change")}
                      className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.followupChange === "no_change" ? "border-indigo-300 bg-indigo-400/25 text-indigo-100" : "border-white/15 bg-white/5 text-white/75"}`}
                    >
                      No, same preferences
                    </button>
                    <button
                      onClick={() => updateQuizField("followupChange", "changed")}
                      className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.followupChange === "changed" ? "border-indigo-300 bg-indigo-400/25 text-indigo-100" : "border-white/15 bg-white/5 text-white/75"}`}
                    >
                      Yes, preferences changed
                    </button>
                  </div>
                  {quizAnswers.followupChange === "changed" && (
                    <input
                      value={quizAnswers.followupNotes}
                      onChange={(e) => updateQuizField("followupNotes", e.target.value)}
                      placeholder="What changed? (optional notes)"
                      className="mt-3 w-full px-3 py-2 rounded-lg bg-white text-black"
                    />
                  )}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <label className="space-y-1">
                  <span className="text-white/70">Primary goal</span>
                  <select value={quizAnswers.goal} onChange={(e) => updateQuizField("goal", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="long_term_wealth">Long-term wealth</option>
                    <option value="passive_income">Passive income</option>
                    <option value="active_trading">Active trading</option>
                    <option value="capital_preservation">Capital preservation</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Investment horizon</span>
                  <select value={quizAnswers.horizon} onChange={(e) => updateQuizField("horizon", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="under_6m">Less than 6 months</option>
                    <option value="6m_24m">6 to 24 months</option>
                    <option value="2y_5y">2 to 5 years</option>
                    <option value="5y_plus">5+ years</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">If portfolio drops 20%</span>
                  <select value={quizAnswers.drawdownAction} onChange={(e) => updateQuizField("drawdownAction", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="sell_most">Sell most positions</option>
                    <option value="reduce_risk">Reduce some risk</option>
                    <option value="hold">Hold</option>
                    <option value="buy_more">Buy more</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Risk tolerance</span>
                  <select value={quizAnswers.riskTolerance} onChange={(e) => updateQuizField("riskTolerance", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Income stability / emergency fund</span>
                  <select value={quizAnswers.incomeStability} onChange={(e) => updateQuizField("incomeStability", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="not_stable">Not stable</option>
                    <option value="somewhat_stable">Somewhat stable</option>
                    <option value="stable">Stable</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Experience</span>
                  <select value={quizAnswers.experience} onChange={(e) => updateQuizField("experience", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Analysis style</span>
                  <select value={quizAnswers.analysisStyle} onChange={(e) => updateQuizField("analysisStyle", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="fundamental">Fundamental</option>
                    <option value="technical">Technical</option>
                    <option value="balanced">Balanced</option>
                    <option value="sentiment">News / Sentiment</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Review frequency</span>
                  <select value={quizAnswers.reviewFrequency} onChange={(e) => updateQuizField("reviewFrequency", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly_plus">Quarterly+</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Region focus</span>
                  <select value={quizAnswers.regionFocus} onChange={(e) => updateQuizField("regionFocus", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="us">US</option>
                    <option value="global_developed">Global developed</option>
                    <option value="emerging">Emerging markets</option>
                    <option value="none">No preference</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Liquidity needs</span>
                  <select value={quizAnswers.liquidityNeeds} onChange={(e) => updateQuizField("liquidityNeeds", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="high">Need frequent access</option>
                    <option value="medium">Moderate</option>
                    <option value="low">Long lock-up okay</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-white/70">Ethical preference</span>
                  <select value={quizAnswers.ethicalPreference} onChange={(e) => updateQuizField("ethicalPreference", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="esg">ESG</option>
                    <option value="shariah">Shariah</option>
                    <option value="none">No preference</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                {quizAnswers.ethicalPreference === "other" && (
                  <label className="space-y-1 md:col-span-2">
                    <span className="text-white/70">Ethical preference details (optional)</span>
                    <input value={quizAnswers.ethicalOther} onChange={(e) => updateQuizField("ethicalOther", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black" placeholder="Enter details" />
                  </label>
                )}
                <label className="space-y-1 md:col-span-2">
                  <span className="text-white/70">Day trading interest</span>
                  <select value={quizAnswers.dayTradingInterest} onChange={(e) => updateQuizField("dayTradingInterest", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                    <option value="">Select</option>
                    <option value="no">No</option>
                    <option value="yes_beginner">Yes (beginner)</option>
                    <option value="yes_experienced">Yes (experienced)</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-white/70 mb-2">Preferred asset classes</div>
                  <div className="flex flex-wrap gap-2">
                    {["stocks", "crypto", "metals", "fx"].map((v) => (
                      <button key={v} onClick={() => toggleQuizArrayValue("assetClasses", v)} className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.assetClasses.includes(v) ? "border-blue-400 bg-blue-500/20 text-blue-200" : "border-white/15 bg-white/5 text-white/75"}`}>
                        {v.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-white/70 mb-2">Sector preferences</div>
                  <div className="flex flex-wrap gap-2">
                    {["tech", "healthcare", "financials", "energy", "consumer", "industrial", "none"].map((v) => (
                      <button key={v} onClick={() => toggleQuizArrayValue("sectorPreferences", v)} className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.sectorPreferences.includes(v) ? "border-blue-400 bg-blue-500/20 text-blue-200" : "border-white/15 bg-white/5 text-white/75"}`}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-white/70">Exclude sectors/themes (optional)</span>
                  <input value={quizAnswers.exclusions} onChange={(e) => updateQuizField("exclusions", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black" placeholder="Example: tobacco, leverage, meme coins" />
                </label>
              </div>

              {String(quizAnswers.dayTradingInterest || "").startsWith("yes") && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-white/70 mb-2">Day-trading markets</div>
                    <div className="flex flex-wrap gap-2">
                      {["stocks", "crypto", "fx"].map((v) => (
                        <button key={v} onClick={() => toggleQuizArrayValue("dayTradingMarkets", v)} className={`px-3 py-1.5 rounded-full border text-xs ${quizAnswers.dayTradingMarkets.includes(v) ? "border-indigo-400 bg-indigo-500/20 text-indigo-200" : "border-white/15 bg-white/5 text-white/75"}`}>
                          {v.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="space-y-1">
                    <span className="text-white/70">Time available per day</span>
                    <select value={quizAnswers.dayTradingTime} onChange={(e) => updateQuizField("dayTradingTime", e.target.value)} className="w-full px-3 py-2 rounded-lg bg-white text-black">
                      <option value="">Select</option>
                      <option value="lt_1h">Less than 1 hour</option>
                      <option value="1_3h">1 to 3 hours</option>
                      <option value="3h_plus">3+ hours</option>
                    </select>
                  </label>
                </div>
              )}

              {quizError && <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{quizError}</div>}
            </Card>
          </div>
        )}

        {/* MARKET OVERVIEW */}
        {!isNarrativeMode && (
        <div className="mb-6">
          <Card
            title={isFxMode ? "FX Market Overview" : "Market Overview"}
            right={
              <button
                onClick={fetchOverview}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                Refresh
              </button>
            }
          >
            <div className="overflow-hidden pb-1">
              <div
                className={`${
                  isMetalsMode
                    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
                    : "market-ticker-track flex gap-3 w-max"
                }`}
                style={isMetalsMode ? undefined : { animationDuration: `${Math.max(18, overview.length * 4)}s` }}
              >
                {(isMetalsMode ? overview : overviewLoop).map((o, idx) => {
                  const sparkKey = String(o?.symbol || "").trim().toUpperCase();
                  const sparkInfo = overviewSparklines[sparkKey] || null;
                  const sparkValues = Array.isArray(sparkInfo?.values) ? sparkInfo.values : [];
                  const sparkPoints = sparkValues.length >= 2 ? buildSparklinePolyline(sparkValues, 60, 30, 2) : "";
                  const sparkStroke =
                    sparkInfo?.up == null
                      ? isLight
                        ? "#64748b"
                        : "#94a3b8"
                      : sparkInfo.up
                        ? "#22c55e"
                        : "#ef4444";

                  return (
                    <button
                      type="button"
                      key={`${o.symbol}-${idx}`}
                      onClick={() => handleQuickSelect(o.symbol)}
                      title={`Open ${o.symbol}`}
                      className={`${isMetalsMode ? "w-full min-h-[180px] md:min-h-[200px] p-5" : isFxMode ? "w-36 p-3" : "w-28 p-3"} shrink-0 rounded-xl text-left transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                      isLight
                        ? "bg-white/92 border border-sky-200/70 shadow-[0_10px_22px_-18px_rgba(56,189,248,0.35)]"
                        : "bg-slate-900/70 border border-white/10 shadow-[0_6px_20px_-16px_rgba(14,165,233,0.7)]"
                    }`}>
                    <div className={`${isMetalsMode ? "text-3xl" : isFxMode ? "text-lg" : "text-sm"} font-semibold leading-tight`}>{isMetalsMode ? (o.name || metalNameBySymbol[o.symbol] || o.symbol) : o.symbol}</div>
                    {isMetalsMode && (
                      <div className={`text-base mt-1 ${isLight ? "text-slate-500" : "text-slate-400"}`}>{o.symbol}</div>
                    )}
                    {isFxMode && (
                      <div className={`text-[11px] mt-1 ${isLight ? "text-slate-500" : "text-slate-400"}`}>{o.name || ""}</div>
                    )}
                    <div className={`${isMetalsMode ? "text-2xl mt-5" : isFxMode ? "text-sm mt-2" : "text-xs"} ${isLight ? "text-slate-700" : "text-slate-300/85"}`}>
                      {fmt(o.price) != null ? `${isFxMode ? Number(o.price).toFixed(4) : `$${Number(o.price).toFixed(2)}`}` : "—"}
                    </div>
                    {!isMetalsMode && (
                      <div
                        className={`${isFxMode ? "text-xs" : "text-xs"} ${
                          fmt(o.percent) == null ? (isLight ? "text-slate-500" : "text-slate-400") : o.percent >= 0 ? (isLight ? "text-emerald-600" : "text-green-300") : (isLight ? "text-rose-600" : "text-red-300")
                        }`}
                      >
                        {fmt(o.percent) != null ? `${o.percent >= 0 ? "+" : ""}${Number(o.percent).toFixed(2)}%` : (isFxMode ? "Live FX" : "—")}
                      </div>
                    )}
                    {assetMode === "stock" && !isMetalsMode && !isFxMode && (
                      <div className="mt-2 h-[30px] w-[60px]">
                        {sparkPoints ? (
                          <svg
                            width="60"
                            height="30"
                            viewBox="0 0 60 30"
                            aria-hidden="true"
                            className="block"
                          >
                            <polyline
                              fill="none"
                              stroke={sparkStroke}
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={sparkPoints}
                            />
                          </svg>
                        ) : (
                          <div
                            className={`h-[30px] w-[60px] rounded-md animate-pulse ${
                              isLight ? "bg-slate-200/80" : "bg-white/10"
                            }`}
                          />
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
              </div>
            </div>
          </Card>
        </div>
        )}

        {isFxMode && !isNarrativeMode && (
          <div className="mb-6">
            <Card
              title={tx("Exchange Rate Converter")}
              right={
                <button
                  onClick={convertFx}
                  disabled={fxLoading}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs disabled:opacity-50"
                >
                  {fxLoading ? tx("Converting...") : tx("Convert")}
                </button>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <input
                  value={fxAmount}
                  onChange={(e) => setFxAmount(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && convertFx()}
                  placeholder="Amount (ex: 1)"
                  className="px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
                <input
                  value={fxFrom}
                  onChange={(e) => setFxFrom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && convertFx()}
                  placeholder="From (USD or India)"
                  list="fx-currency-options"
                  className="px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
                <input
                  value={fxTo}
                  onChange={(e) => setFxTo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && convertFx()}
                  placeholder="To (INR or Japan)"
                  list="fx-currency-options"
                  className="px-4 py-3 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
                <button
                  onClick={() => {
                    const a = fxFrom;
                    setFxFrom(fxTo);
                    setFxTo(a);
                  }}
                  className="px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-sm"
                >
                  Swap
                </button>
              </div>
              <datalist id="fx-currency-options">
                {FX_CURRENCY_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code} label={`${c.name} (${c.code})`} />
                ))}
                {FX_CURRENCY_OPTIONS.map((c) => (
                  <option key={`${c.code}-name`} value={c.name} />
                ))}
              </datalist>

              <div className="mt-2 text-xs text-white/60">
                Tip: use code (`INR`) or country/currency name (`India`, `Japanese Yen`, `UK`).
              </div>
              <SummaryPanel
                label={tx("Search Summary")}
                text={fxSearchSummary || tx("No FX summary yet. Convert a pair to see the plain-language summary.")}
                isLight={isLight}
                className="mt-3"
              />

              {fxError && (
                <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {fxError}
                </div>
              )}

              {fxResult && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/60 mb-1">Rate</div>
                    <div className="text-lg font-semibold">
                      1 {fxResult.from} = {Number(fxResult.rate).toFixed(6)} {fxResult.to}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/60 mb-1">Converted</div>
                    <div className="text-lg font-semibold">
                      {Number(fxResult.amount).toFixed(2)} {fxResult.from} = {Number(fxResult.converted).toFixed(4)} {fxResult.to}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="text-xs text-white/60 mb-1">As Of</div>
                    <div className="text-lg font-semibold">{fxResult.asOf || "—"}</div>
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* MOVERS + MARKET NEWS */}
        {!isFxMode && !isNarrativeMode && (
        <div className={`grid grid-cols-1 ${isMetalsMode ? "" : "lg:grid-cols-2"} gap-6 mb-6`}>
          {!isMetalsMode && (
            <Card
              title="Top Gainers / Losers"
              right={
                <button onClick={fetchMovers} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs">
                  Refresh
                </button>
              }
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-green-300 mb-2">Top Gainers</div>
                  <div className="space-y-2">
                    {movers.gainers.slice(0, 5).map((m) => (
                      <button
                        type="button"
                        key={`g-${m.symbol}`}
                        onClick={() => handleQuickSelect(m.symbol)}
                        title={`Search ${m.symbol}`}
                        className="w-full text-left rounded-lg border border-white/10 bg-white/5 p-2 text-xs transition-all duration-200 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/35"
                      >
                        <div className="font-semibold">{m.symbol}</div>
                        <div className="text-white/70">${Number(m.price || 0).toFixed(2)}</div>
                        <div className="text-green-300">
                          {Number(m.percentChange) >= 0 ? "+" : ""}
                          {Number(m.percentChange || 0).toFixed(2)}%
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-red-300 mb-2">Top Losers</div>
                  <div className="space-y-2">
                    {movers.losers.slice(0, 5).map((m) => (
                      <button
                        type="button"
                        key={`l-${m.symbol}`}
                        onClick={() => handleQuickSelect(m.symbol)}
                        title={`Search ${m.symbol}`}
                        className="w-full text-left rounded-lg border border-white/10 bg-white/5 p-2 text-xs transition-all duration-200 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/35"
                      >
                        <div className="font-semibold">{m.symbol}</div>
                        <div className="text-white/70">${Number(m.price || 0).toFixed(2)}</div>
                        <div className="text-red-300">
                          {Number(m.percentChange) >= 0 ? "+" : ""}
                          {Number(m.percentChange || 0).toFixed(2)}%
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          <Card
            title={isMetalsMode ? tx("Metals News") : tx("Market News")}
            right={
              <button
                onClick={fetchMarketNews}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                {tx("Refresh")}
              </button>
            }
          >
            <div className="space-y-3">
              <SummaryPanel label={tx("Summary")} text={marketNewsDigest} isLight={isLight} />
              {localizedMarketNewsWithSummary.slice(0, 6).map((n, idx) => (
                <a
                  key={`${n.url}-${idx}`}
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  className={`block rounded-lg border p-2.5 transition-colors ${isLight ? "border-slate-200 bg-white hover:bg-slate-50" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}
                >
                  <div className={`text-sm font-medium hover:underline ${isLight ? "text-blue-700" : "text-blue-300"}`}>• {n.headlineDisplay}</div>
                  <div className={`mt-1 text-xs leading-relaxed ${isLight ? "text-slate-600" : "text-white/65"}`}>{n.laymanSummary}</div>
                </a>
              ))}
              {localizedMarketNewsWithSummary.length === 0 && (
                <div className="text-sm text-white/60">{isMetalsMode ? tx("No metals headlines yet.") : tx("No market headlines yet.")}</div>
              )}
            </div>
          </Card>
        </div>
        )}

        {/* DAILY PICK + SEARCH ROW */}
        {!isFxMode && !isNarrativeMode && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="space-y-6">
          <Card
            title={tx("ASTRA Today Pick")}
            right={
              <button
                onClick={fetchDailyPick}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                {dailyLoading ? tx("Loading...") : tx("Refresh")}
              </button>
            }
          >
            {(dailyView.recommendation || dailyView.ticker) && (
              <div className="mb-3 flex items-center gap-2">
                <Badge value={dailyView.recommendation} light={isLight} />
                <span className="text-white/80 text-sm">{dailyView.ticker || "—"}</span>
                {dailyView.confidence > 0 && (
                    <span className={`text-[11px] rounded-full border px-2 py-0.5 ${isLight ? "border-blue-300 bg-blue-50 text-blue-700" : "border-blue-400/30 bg-blue-500/15 text-blue-200"}`}>
                      {tx("Confidence")} {dailyView.confidence}%
                    </span>
                )}
                {dailyView.riskLevel && (
                  <span
                    className={`text-[11px] rounded-full border px-2 py-0.5 ${
                      dailyView.riskLevel === "LOW"
                        ? isLight ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-green-400/30 bg-green-500/15 text-green-200"
                        : dailyView.riskLevel === "MEDIUM"
                          ? isLight ? "border-amber-300 bg-amber-50 text-amber-700" : "border-yellow-400/30 bg-yellow-500/15 text-yellow-200"
                          : isLight ? "border-rose-300 bg-rose-50 text-rose-700" : "border-red-400/30 bg-red-500/15 text-red-200"
                    }`}
                  >
                    {tx("Risk")} {dailyView.riskLevel}
                  </span>
                )}
              </div>
            )}

            {dailyLoading ? (
              <div className="text-sm text-white/60 animate-pulse">{tx("Loading today’s pick...")}</div>
            ) : (
              <div className="space-y-3">
                <SummaryPanel label={tx("Layman Summary")} text={dailyLaymanSummary} isLight={isLight} />

                {dailyView.why.length > 0 && (
                  <div>
                    <div className="text-xs text-white/60 mb-1">{tx("Why")}</div>
                    <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                      {dailyView.why.slice(0, 4).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {dailyView.risks.length > 0 && (
                  <div>
                    <div className="text-xs text-white/60 mb-1">{tx("Risks")}</div>
                    <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                      {dailyView.risks.slice(0, 3).map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {dailyView.dayPlan && (
                  <div>
                    <div className="text-xs text-white/60 mb-1">{tx("Day plan")}</div>
                    <div className="text-sm text-white/90">{dailyView.dayPlan}</div>
                  </div>
                )}

                {dailyView.note && <div className="text-xs text-white/55">{dailyView.note}</div>}

                {dailyView.fallbackText && (
                  <div className="text-sm text-white/90 whitespace-pre-line">{dailyView.fallbackText}</div>
                )}
              </div>
            )}
          </Card>
          {dayTraderEligible && (
            <Card
              title={tx("ASTRA Day Trader Pick")}
              right={
                <button
                  onClick={fetchDayTraderPick}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                >
                  {dayTraderLoading ? tx("Loading...") : tx("Refresh")}
                </button>
              }
            >
              {(dayTraderView.recommendation || dayTraderView.ticker) && (
                <div className="mb-3 flex items-center gap-2">
                  <Badge value={dayTraderView.recommendation} light={isLight} />
                  <span className="text-white/80 text-sm">{dayTraderView.ticker || "—"}</span>
                  {dayTraderView.confidence > 0 && (
                    <span className={`text-[11px] rounded-full border px-2 py-0.5 ${isLight ? "border-blue-300 bg-blue-50 text-blue-700" : "border-blue-400/30 bg-blue-500/15 text-blue-200"}`}>
                      {tx("Confidence")} {dayTraderView.confidence}%
                    </span>
                  )}
                </div>
              )}
              {dayTraderLoading ? (
                <div className="text-sm text-white/60 animate-pulse">{tx("Loading day-trader pick...")}</div>
              ) : (
                <div className="space-y-3">
                  {dayTraderView.why.length > 0 && (
                    <div>
                      <div className="text-xs text-white/60 mb-1">{tx("Setup rationale")}</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {dayTraderView.why.slice(0, 4).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {dayTraderView.dayPlan && (
                    <div>
                      <div className="text-xs text-white/60 mb-1">{tx("Trade plan")}</div>
                      <div className="text-sm text-white/90">{dayTraderView.dayPlan}</div>
                    </div>
                  )}
                  {dayTraderView.note && <div className="text-xs text-white/55">{dayTraderView.note}</div>}
                  {dayTraderView.fallbackText && (
                    <div className="text-sm text-white/90 whitespace-pre-line">{dayTraderView.fallbackText}</div>
                  )}
                </div>
              )}
            </Card>
          )}
          {authUser && assetMode === "stock" && false && (
            <Card
              title="Add Your Portfolio"
              right={
                <button
                  onClick={runPortfolioAnalysis}
                  disabled={portfolioLoading || portfolioAnalyzing}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs disabled:opacity-50"
                >
                  {portfolioLoading || portfolioAnalyzing ? "Analyzing..." : "ASTRA Portfolio Analysis"}
                </button>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-3">
                <div className="relative">
                  <input
                    value={portfolioSymbolInput}
                    onChange={(e) => setPortfolioSymbolInput(e.target.value)}
                    onFocus={() => portfolioSuggestions.length > 0 && setPortfolioSuggestionOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addPortfolioHolding();
                    }}
                    placeholder="Symbol or company (AAPL / Apple)"
                    className="w-full px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                  />
                  {portfolioSuggestionOpen && (
                    <div className="absolute z-30 mt-1 w-full rounded-xl border border-white/10 bg-slate-950/95 backdrop-blur-md shadow-2xl overflow-hidden">
                      {portfolioSuggestionLoading ? (
                        <div className="px-3 py-2 text-xs text-white/60">Finding matches...</div>
                      ) : (
                        <div className="max-h-56 overflow-y-auto">
                          {portfolioSuggestions.map((s) => (
                            <button
                              key={`ps-${s.symbol}`}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applyPortfolioSuggestion(s);
                              }}
                              className="w-full text-left px-3 py-2.5 hover:bg-white/10 border-b border-white/5 last:border-b-0"
                            >
                              <div className="text-sm font-semibold text-white">{s.symbol}</div>
                              <div className="text-xs text-white/60 truncate">{s.description || "Company"}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={portfolioQtyInput}
                  onChange={(e) => setPortfolioQtyInput(e.target.value)}
                  placeholder="Quantity"
                  className="px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={portfolioBuyPriceInput}
                  onChange={(e) => setPortfolioBuyPriceInput(e.target.value)}
                  placeholder="Buy price"
                  className="px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
                <input
                  type="date"
                  value={portfolioBuyDateInput}
                  onChange={(e) => setPortfolioBuyDateInput(e.target.value)}
                  className="px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
                />
              </div>
              <div className="mb-3">
                <button
                  onClick={addPortfolioHolding}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm font-semibold"
                >
                  Add Holding
                </button>
              </div>

              <div className="text-[11px] text-white/60 mb-2">
                Add each holding with quantity, buy price, and buy date. ASTRA will analyze real position performance.
              </div>

              {portfolioError && (
                <div className="mb-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {portfolioError}
                </div>
              )}
              {portfolioNotice && (
                <div className="mb-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  {portfolioNotice}
                </div>
              )}

              <div className="overflow-x-auto">
                {portfolioHoldings.length ? (
                  <table className="w-full text-xs">
                    <thead className="text-white/60">
                      <tr className="text-left border-b border-white/10">
                        <th className="py-2 pr-2">Symbol</th>
                        <th className="py-2 pr-2">Qty</th>
                        <th className="py-2 pr-2">Buy Price</th>
                        <th className="py-2 pr-2">Buy Date</th>
                        <th className="py-2 pr-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {portfolioHoldings.map((h) => (
                        <tr key={h.id} className="border-b border-white/5">
                          <td className="py-2 pr-2 font-semibold">{h.symbol}</td>
                          <td className="py-2 pr-2 w-28">
                            <input
                              type="number"
                              min="0"
                              step="0.0001"
                              value={h.quantity}
                              onChange={(e) => updatePortfolioHoldingField(h.id, "quantity", e.target.value)}
                              className="w-full px-2 py-1 rounded-md bg-white text-black border border-white/20"
                            />
                          </td>
                          <td className="py-2 pr-2 w-32">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={h.buyPrice}
                              onChange={(e) => updatePortfolioHoldingField(h.id, "buyPrice", e.target.value)}
                              className="w-full px-2 py-1 rounded-md bg-white text-black border border-white/20"
                            />
                          </td>
                          <td className="py-2 pr-2 w-36">
                            <input
                              type="date"
                              value={h.buyDate || ""}
                              onChange={(e) => updatePortfolioHoldingField(h.id, "buyDate", e.target.value)}
                              className="w-full px-2 py-1 rounded-md bg-white text-black border border-white/20"
                            />
                          </td>
                          <td className="py-2 pr-2">
                            <div className="flex gap-2">
                              <button
                                onClick={() => savePortfolioHolding(h.id)}
                                className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => removePortfolioHolding(h.id)}
                                className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15"
                              >
                                Sold / Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-xs text-white/60">No holdings added yet.</div>
                )}
              </div>
            </Card>
          )}
          </div>

          <Card
            title={`Multi-${assetMode === "crypto" ? "Crypto" : assetMode === "metals" ? "Metals" : "Stock"} Comparison`}
            right={
              <button
                onClick={runComparison}
                disabled={compareLoading}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs disabled:opacity-50"
              >
                {compareLoading ? "Comparing..." : "Compare"}
              </button>
            }
          >
            <div className="flex gap-2 mb-3">
              <input
                value={compareInput}
                onChange={(e) => setCompareInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runComparison()}
                placeholder={assetMode === "crypto" ? "BTC,ETH,SOL" : assetMode === "metals" ? "XAU,XAG,XPT" : "AAPL,MSFT,NVDA"}
                className="flex-1 px-4 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none"
              />
            </div>
            {compareError && (
              <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-400/30 bg-rose-500/10 text-rose-200"}`}>
                {compareError}
              </div>
            )}
            {compareInvalidTickers.length > 0 && (
              <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${isLight ? "border-amber-300 bg-amber-50 text-amber-700" : "border-amber-400/30 bg-amber-500/10 text-amber-200"}`}>
                Invalid tickers: {compareInvalidTickers.map((x) => x.symbol).join(", ")}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className={isLight ? "text-slate-500" : "text-white/60"}>
                  <tr className={`text-left ${isLight ? "border-b border-slate-200" : "border-b border-white/10"}`}>
                    <th className="py-2 pr-2">Ticker</th>
                    <th className="py-2 pr-2">Name</th>
                    <th className="py-2 pr-2">Price</th>
                    <th className="py-2 pr-2">Day $</th>
                    <th className="py-2 pr-2">Change %</th>
                    <th className="py-2 pr-2">Volume</th>
                    <th className="py-2 pr-2">52W High/Low</th>
                    <th className="py-2 pr-2">P/E</th>
                    <th className="py-2 pr-2">Market Cap</th>
                    <th className="py-2 pr-2">Sector</th>
                  </tr>
                </thead>
                <tbody>
                  {compareLoading &&
                    Array.from({ length: Math.max(3, Math.min(6, compareInput.split(",").map((s) => s.trim()).filter(Boolean).length || 3)) }, (_, i) => (
                      <tr key={`skeleton-${i}`} className={`animate-pulse ${isLight ? "border-b border-slate-100" : "border-b border-white/5"}`}>
                        {Array.from({ length: 10 }, (_, j) => (
                          <td key={`sk-${i}-${j}`} className="py-2 pr-2">
                            <div className={`h-3.5 rounded ${isLight ? "bg-slate-200" : "bg-white/10"}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  {!compareLoading && compareRows.map((r) => (
                    <tr key={r.symbol} className={isLight ? "border-b border-slate-100" : "border-b border-white/5"}>
                      <td className="py-2 pr-2 font-semibold">{r.symbol}</td>
                      <td className={`py-2 pr-2 ${isLight ? "text-slate-700" : "text-white/80"}`}>{r.name || "—"}</td>
                      <td className="py-2 pr-2">{fmt(r.price) != null ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                      <td
                        className={`py-2 pr-2 ${
                          fmt(r.change) == null
                            ? isLight ? "text-slate-500" : "text-white/60"
                            : Number(r.change) >= 0
                              ? isLight ? "text-emerald-600" : "text-green-300"
                              : isLight ? "text-rose-600" : "text-red-300"
                        }`}
                      >
                        {fmt(r.change) != null ? `${Number(r.change) >= 0 ? "+" : ""}${Number(r.change).toFixed(2)}` : "—"}
                      </td>
                      <td
                        className={`py-2 pr-2 ${
                          fmt(r.percentChange) == null
                            ? isLight ? "text-slate-500" : "text-white/60"
                            : Number(r.percentChange) >= 0
                              ? isLight ? "text-emerald-600" : "text-green-300"
                              : isLight ? "text-rose-600" : "text-red-300"
                        }`}
                      >
                        {fmt(r.percentChange) != null
                          ? `${Number(r.percentChange) >= 0 ? "+" : ""}${Number(r.percentChange).toFixed(2)}%`
                          : "—"}
                      </td>
                      <td className="py-2 pr-2">{fmt(r.volume) != null ? fmtLarge(r.volume) : "—"}</td>
                      <td className="py-2 pr-2">
                        {fmt(r.week52High) != null || fmt(r.week52Low) != null
                          ? `${fmt(r.week52Low) != null ? Number(r.week52Low).toFixed(2) : "—"} / ${fmt(r.week52High) != null ? Number(r.week52High).toFixed(2) : "—"}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-2">{fmt(r.peRatio) != null ? Number(r.peRatio).toFixed(2) : "—"}</td>
                      <td className="py-2 pr-2">{fmt(r.marketCap) != null ? `$${fmtLarge(r.marketCap)}` : "—"}</td>
                      <td className="py-2 pr-2">{r.sector || "—"}</td>
                    </tr>
                  ))}
                  {!compareLoading && compareRows.length === 0 && (
                    <tr>
                      <td colSpan={10} className={`py-4 text-center ${isLight ? "text-slate-500" : "text-white/60"}`}>
                        Enter tickers and click Compare to load results.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        )}

        {authUser && assetMode === "stock" && false && portfolioAnalysis && (
          <div className="mb-6">
            <Card title="ASTRA Portfolio Analysis">
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-4">
                <div className="rounded-lg border border-cyan-400/30 bg-cyan-500/10 p-3">
                  <div className="text-xs text-cyan-200/90 mb-1">Overall Score</div>
                  <div className="text-2xl font-bold text-cyan-200">{portfolioAnalysis.score}/100</div>
                </div>
                <div className="rounded-lg border border-blue-400/30 bg-blue-500/10 p-3">
                  <div className="text-xs text-blue-200/90 mb-1">Invested</div>
                  <div className="text-lg font-semibold text-blue-200">
                    ${Number(portfolioAnalysis.totalCost || 0).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-lg border border-indigo-400/30 bg-indigo-500/10 p-3">
                  <div className="text-xs text-indigo-200/90 mb-1">Current Value</div>
                  <div className="text-lg font-semibold text-indigo-200">
                    ${Number(portfolioAnalysis.totalValue || 0).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-3">
                  <div className="text-xs text-violet-200/90 mb-1">Total Return</div>
                  <div className={`text-lg font-semibold ${Number(portfolioAnalysis.totalReturnPct) >= 0 ? "text-green-300" : "text-red-300"}`}>
                    {Number(portfolioAnalysis.totalReturnPct) >= 0 ? "+" : ""}
                    {Number(portfolioAnalysis.totalReturnPct || 0).toFixed(2)}%
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3 mb-4">
                  <div className="text-xs text-emerald-200 mb-1">Green Flags</div>
                  <ul className="list-disc pl-5 text-sm text-emerald-100 space-y-1">
                    {(portfolioAnalysis.greenFlags || []).length ? (
                      portfolioAnalysis.greenFlags.slice(0, 4).map((g, i) => <li key={`pg-${i}`}>{g}</li>)
                    ) : (
                      <li>No clear green flags yet.</li>
                    )}
                  </ul>
              </div>

              <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 mb-4">
                <div className="text-xs text-rose-200 mb-1">Red Flags</div>
                <ul className="list-disc pl-5 text-sm text-rose-100 space-y-1">
                  {(portfolioAnalysis.redFlags || []).length ? (
                    portfolioAnalysis.redFlags.slice(0, 4).map((r, i) => <li key={`pr-${i}`}>{r}</li>)
                  ) : (
                    <li>No major red flags detected.</li>
                  )}
                </ul>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-white/60">
                    <tr className="text-left border-b border-white/10">
                      <th className="py-2 pr-2">Symbol</th>
                      <th className="py-2 pr-2">Buy Date</th>
                      <th className="py-2 pr-2">Qty</th>
                      <th className="py-2 pr-2">Buy Price</th>
                      <th className="py-2 pr-2">Price</th>
                      <th className="py-2 pr-2">Day $</th>
                      <th className="py-2 pr-2">Day %</th>
                      <th className="py-2 pr-2">Cost Basis</th>
                      <th className="py-2 pr-2">Market Value</th>
                      <th className="py-2 pr-2">Unrealized P/L</th>
                      <th className="py-2 pr-2">Return %</th>
                      <th className="py-2 pr-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioRows.map((r) => (
                      <tr key={`prow-${r.id || r.symbol}`} className="border-b border-white/5">
                        <td className="py-2 pr-2 font-semibold">{r.symbol}</td>
                        <td className="py-2 pr-2">{r.buyDate || "—"}</td>
                        <td className="py-2 pr-2">{Number(r.quantity || 0)}</td>
                        <td className="py-2 pr-2">{fmt(r.buyPrice) != null ? `$${Number(r.buyPrice).toFixed(2)}` : "—"}</td>
                        <td className="py-2 pr-2">{fmt(r.price) != null ? `$${Number(r.price).toFixed(2)}` : "—"}</td>
                        <td className={`py-2 pr-2 ${Number(r.dayPnL) >= 0 ? "text-green-300" : "text-red-300"}`}>
                          {fmt(r.dayPnL) != null ? `${Number(r.dayPnL) >= 0 ? "+" : ""}${Number(r.dayPnL).toFixed(2)}` : "—"}
                        </td>
                        <td className={`py-2 pr-2 ${Number(r.percentChange) >= 0 ? "text-green-300" : "text-red-300"}`}>
                          {fmt(r.percentChange) != null
                            ? `${Number(r.percentChange) >= 0 ? "+" : ""}${Number(r.percentChange).toFixed(2)}%`
                            : "—"}
                        </td>
                        <td className="py-2 pr-2">{fmt(r.costBasis) != null ? `$${Number(r.costBasis).toFixed(2)}` : "—"}</td>
                        <td className="py-2 pr-2">{fmt(r.marketValue) != null ? `$${Number(r.marketValue).toFixed(2)}` : "—"}</td>
                        <td className={`py-2 pr-2 ${Number(r.unrealizedPnL) >= 0 ? "text-green-300" : "text-red-300"}`}>
                          {fmt(r.unrealizedPnL) != null
                            ? `${Number(r.unrealizedPnL) >= 0 ? "+" : ""}${Number(r.unrealizedPnL).toFixed(2)}`
                            : "—"}
                        </td>
                        <td className={`py-2 pr-2 ${Number(r.unrealizedPct) >= 0 ? "text-green-300" : "text-red-300"}`}>
                          {fmt(r.unrealizedPct) != null
                            ? `${Number(r.unrealizedPct) >= 0 ? "+" : ""}${Number(r.unrealizedPct).toFixed(2)}%`
                            : "—"}
                        </td>
                        <td className="py-2 pr-2 text-white/70">
                          {Number(r.percentChange) <= -4 || Number(r.unrealizedPct) <= -15
                            ? "Red flag"
                            : Number(r.percentChange) >= 2 || Number(r.unrealizedPct) >= 12
                              ? "Green flag"
                              : "Neutral"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* SEARCH */}
        {!isFxMode && !isNarrativeMode && (
        <div className="mb-6">
          <Card
            title={tx("Search")}
            right={
              <button
                onClick={resetAnalysis}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
              >
                {tx("Clear")}
              </button>
            }
          >
            <label className="text-sm text-white/60">
              {assetMode === "crypto"
                ? "Search a crypto name or symbol"
                : assetMode === "metals"
                  ? "Search a metal symbol (XAU, XAG, XPT, XPD)"
                  : "Search a company name or symbol (stock, ETF, fund, bond ETF)"}
            </label>
            <SummaryPanel
              label={tx("Search Summary")}
              text={searchSectionSummary || tx("No summary yet. Run a search to get a plain-language explanation.")}
              isLight={isLight}
              className="mt-3"
            />

            <div className="mt-3 flex gap-2 items-start">
              <div className="flex-1 relative">
                <input
                  type="text"
                  placeholder={
                    assetMode === "crypto"
                      ? 'Try "Bitcoin" or "BTC"'
                      : assetMode === "metals"
                        ? 'Try "XAU" or "XAG"'
                        : 'Try "Apple", "VOO", "FXAIX", or "BND"'
                  }
                  value={ticker}
                  onChange={(e) => {
                    setSuppressSuggestions(false);
                    setTicker(e.target.value);
                  }}
                  onFocus={() => searchSuggestions.length > 0 && setSuggestionOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    if (suggestionOpen && searchSuggestions.length > 0) {
                      e.preventDefault();
                      applySuggestion(searchSuggestions[0]);
                      return;
                    }
                    searchStock();
                  }}
                  className="w-full px-4 py-3 rounded-xl bg-white text-black text-lg
                             border-2 border-white/20 outline-none
                             focus:border-blue-500 focus:ring-4 focus:ring-blue-500/30
                             placeholder:text-gray-500 shadow-lg"
                />

                {suggestionOpen && (
                  <div className="absolute z-30 mt-2 w-full rounded-xl border border-white/10 bg-slate-950/95 backdrop-blur-md shadow-2xl overflow-hidden">
                    {suggestionLoading ? (
                      <div className="px-3 py-2 text-xs text-white/60">Finding matches...</div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto">
                        {searchSuggestions.map((s) => (
                          <button
                            key={s.symbol}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              applySuggestion(s);
                            }}
                            className="w-full text-left px-3 py-2.5 hover:bg-white/10 border-b border-white/5 last:border-b-0"
                          >
                            <div className="text-sm font-semibold text-white">{s.symbol}</div>
                            <div className="text-xs text-white/60 truncate">{s.description || "Company"}</div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => searchStock()}
                disabled={loading}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 transition-colors
                           font-semibold shadow-lg disabled:opacity-50"
              >
                {loading ? "Loading..." : "Search"}
              </button>
            </div>

            {errorMsg && (
              <div className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {errorMsg}
              </div>
            )}

            {usingTicker && (
              <div className="text-xs text-white/50 mt-2">
                Using {assetMode === "stock" ? "ticker" : "asset"}: <span className="text-white/70">{usingTicker}</span>
              </div>
            )}

            {searchHistory.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-white/50 mb-2">Recent</div>
                <div className="flex flex-wrap gap-2">
                  {searchHistory.map((sym) => (
                    <button
                      key={sym}
                      onClick={() => {
                        setTicker(sym);
                        searchStock(sym);
                      }}
                      className="px-2.5 py-1 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-xs"
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
        )}

        {isNewsMode && (
          <div className="mb-6">
            <Card
              title={tx("World Market Impact News")}
              right={
                <button
                  onClick={fetchMarketNews}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs"
                >
                  {tx("Refresh")}
                </button>
              }
            >
              <SummaryPanel label={tx("Summary")} text={marketNewsDigest} isLight={isLight} className="mb-4" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {localizedMarketNewsWithSummary.slice(0, 24).map((n, idx) => (
                  <a
                    key={`${n.url}-${idx}`}
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group block rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10 transition-all"
                  >
                    <div className="flex gap-3">
                      <div className="relative w-20 h-20 shrink-0 rounded-lg overflow-hidden border border-white/10">
                        <div className="absolute inset-0 bg-gradient-to-br from-blue-600/35 via-cyan-500/20 to-slate-800/30" />
                        <div className="absolute inset-0 flex items-center justify-center">
                          {faviconUrlFor(n.url) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={faviconUrlFor(n.url)}
                              alt="Source"
                              className="h-9 w-9 rounded-full bg-white/90 p-1.5 ring-1 ring-white/30"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded-full bg-white/20" />
                          )}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm text-blue-300 group-hover:underline line-clamp-3">{n.headlineDisplay}</div>
                        <div className="mt-1 text-xs text-white/70 line-clamp-3">{n.laymanSummary}</div>
                        <div className="mt-2 text-[11px] text-white/50">
                          {[n.source || safeDomainFromUrl(n.url), n.datetime].filter(Boolean).join(" • ") || "Global feed"}
                        </div>
                        <div className="mt-1 text-[11px] text-white/40 truncate">{safeDomainFromUrl(n.url)}</div>
                      </div>
                    </div>
                  </a>
                ))}
                {localizedMarketNewsWithSummary.length === 0 && <div className="text-sm text-white/60">{tx("No world-impact headlines yet.")}</div>}
              </div>
            </Card>
          </div>
        )}

        {isGlobalMarketMode && (
          <div className="mb-6">
            <Card
              title={tx("Global Market Map")}
              right={
                <button
                  onClick={fetchMarketNews}
                  className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white"}`}
                >
                  {tx("Refresh")}
                </button>
              }
            >
              <div
                className={`mb-4 rounded-xl border p-3 md:p-4 ${
                  isLight ? "border-slate-200 bg-slate-50/80" : "border-white/12 bg-white/[0.03]"
                }`}
              >
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-slate-900/50"}`}>
                    <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/75"}`}>Global Regime</div>
                    <div
                      className={`text-lg font-semibold ${
                        globalRegime.label === "Risk-On"
                          ? "text-emerald-500"
                          : globalRegime.label === "Risk-Off"
                            ? "text-rose-500"
                            : globalRegime.label === "Caution"
                              ? "text-amber-500"
                              : isLight
                                ? "text-slate-900"
                                : "text-white"
                      }`}
                    >
                      {globalRegime.label}
                    </div>
                    <div className={`text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>{globalRegime.summary}</div>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-slate-900/50"}`}>
                    <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/75"}`}>Sessions Pulse</div>
                    <div className={`text-lg font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{globalMarketStats.openSessions} Open</div>
                    <div className={`text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>{globalSessionHeadline}</div>
                  </div>
                  <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-slate-900/50"}`}>
                    <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/75"}`}>Country Focus Risk</div>
                    <div className={`text-lg font-semibold ${globalMarketStats.riskCount > 0 ? "text-rose-500" : isLight ? "text-slate-900" : "text-white"}`}>
                      {globalMarketStats.riskCount > 0 ? "Elevated" : "Stable"}
                    </div>
                    <div className={`text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>
                      {selectedGlobalCountry.name}: {selectedCountryRelationStats.tensions} tensions, {selectedCountryRelationStats.conflicts} conflicts.
                    </div>
                  </div>
                </div>
              </div>
              <div
                className={`sticky top-2 z-20 mb-4 rounded-xl border px-2 py-2 backdrop-blur-md ${
                  isLight
                    ? "border-slate-200 bg-white/95 shadow-sm"
                    : "border-cyan-400/20 bg-slate-950/85 shadow-[0_10px_30px_-18px_rgba(8,145,178,0.6)]"
                }`}
              >
                <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5">
                  {GLOBAL_MACRO_INDICATORS.map((indicator) => {
                    const row = globalMacroRows.find((x) => x.key === indicator.key);
                    const pct = Number(row?.percentChange);
                    const up = Number.isFinite(pct) && pct > 0;
                    const down = Number.isFinite(pct) && pct < 0;
                    const arrow = up ? "▲" : down ? "▼" : "•";
                    const changeText = Number.isFinite(pct) ? `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%` : "—";
                    return (
                      <div
                        key={`macro-${indicator.key}`}
                        className={`rounded-lg border px-2 py-1.5 ${
                          isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"
                        }`}
                      >
                        <div className={`text-[10px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/75"}`}>
                          {indicator.label}
                        </div>
                        <div className={`text-sm font-semibold leading-tight ${isLight ? "text-slate-900" : "text-white"}`}>
                          {formatMacroIndicatorValue(indicator.symbol, row?.value)}
                        </div>
                        <div
                          className={`text-[11px] font-semibold leading-tight ${
                            up ? "text-emerald-500" : down ? "text-rose-500" : isLight ? "text-slate-500" : "text-white/60"
                          }`}
                        >
                          {arrow} {changeText}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {globalMacroLoading && (
                  <div className={`mt-1 text-[10px] ${isLight ? "text-slate-500" : "text-white/55"}`}>Updating macro strip...</div>
                )}
              </div>
              <div
                className={`mb-4 rounded-xl border px-2 py-2 ${
                  isLight ? "border-slate-200 bg-white/95" : "border-white/12 bg-slate-900/60"
                }`}
              >
                <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                  Markets Open Now
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
                  {marketsOpenNow.map((session) => (
                    <div
                      key={`session-${session.key}`}
                      className={`rounded-lg border px-2.5 py-2 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className={`text-xs font-semibold ${isLight ? "text-slate-800" : "text-white/90"}`}>{session.name}</div>
                        <div className="inline-flex items-center gap-1.5">
                          <span className={`h-2 w-2 rounded-full ${session.isOpen ? "bg-emerald-500" : "bg-slate-400"}`} />
                          <span className={`text-[10px] font-semibold ${session.isOpen ? "text-emerald-500" : isLight ? "text-slate-500" : "text-white/60"}`}>
                            {session.isOpen ? "OPEN" : "CLOSED"}
                          </span>
                        </div>
                      </div>
                      <div className={`mt-1 text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>
                        Local time: {session.localTime} ({session.label})
                      </div>
                      <div className={`text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>
                        {session.isOpen ? `Closes in ${formatCountdown(session.minutesUntil)}` : `Opens in ${formatCountdown(session.minutesUntil)}`}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <SummaryPanel label={tx("Executive Brief")} text={globalMarketExecutiveSummary} isLight={isLight} className="mb-4" />
              <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className={`text-[10px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/70"}`}>Proxies Tracked</div>
                  <div className={`text-lg font-semibold leading-tight ${isLight ? "text-slate-900" : "text-white"}`}>{globalMarketStats.proxies}</div>
                </div>
                <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className={`text-[10px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/70"}`}>Country Headlines</div>
                  <div className={`text-lg font-semibold leading-tight ${isLight ? "text-slate-900" : "text-white"}`}>{globalMarketStats.headlines}</div>
                </div>
                <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className={`text-[10px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/70"}`}>Sessions Open</div>
                  <div className={`text-lg font-semibold leading-tight ${isLight ? "text-slate-900" : "text-white"}`}>{globalMarketStats.openSessions} / {marketsOpenNow.length}</div>
                </div>
                <div className={`rounded-lg border px-3 py-2 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className={`text-[10px] uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/70"}`}>Geo Risk Links</div>
                  <div className={`text-lg font-semibold leading-tight ${globalMarketStats.riskCount > 0 ? "text-rose-500" : isLight ? "text-slate-900" : "text-white"}`}>{globalMarketStats.riskCount}</div>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className={`lg:col-span-3 rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className={`text-xs font-semibold uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                      Interactive World Map
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setGlobalMapZoom((z) => Math.max(1, Number((z - 0.2).toFixed(2))))}
                        className={`text-[11px] px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
                      >
                        -
                      </button>
                      <button
                        onClick={() => setGlobalMapZoom(1)}
                        className={`text-[11px] px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
                      >
                        Fit
                      </button>
                      <button
                        onClick={() => setGlobalMapZoom((z) => Math.min(2.4, Number((z + 0.2).toFixed(2))))}
                        className={`text-[11px] px-2 py-1 rounded-md border ${isLight ? "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
                      >
                        +
                      </button>
                      <button
                        onClick={() => setGlobalMarketCountry("US")}
                        className={`text-[11px] px-2.5 py-1 rounded-md border ${isLight ? "border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10"}`}
                      >
                        Reset Focus
                      </button>
                    </div>
                  </div>
                  <div className={`relative h-[360px] rounded-xl overflow-hidden border ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-slate-950/45"}`}>
                    <svg viewBox={`0 0 ${GLOBAL_MAP_WIDTH} ${GLOBAL_MAP_HEIGHT}`} className="h-full w-full">
                      <defs>
                        <linearGradient id="gm-ocean" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor={isLight ? "#f8fafc" : "#0b1223"} />
                          <stop offset="100%" stopColor={isLight ? "#e2e8f0" : "#111b31"} />
                        </linearGradient>
                        <radialGradient id="gm-hotspot" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={isLight ? "#60a5fa" : "#38bdf8"} stopOpacity="0.38" />
                          <stop offset="100%" stopColor={isLight ? "#60a5fa" : "#38bdf8"} stopOpacity="0" />
                        </radialGradient>
                        <filter id="gm-glow">
                          <feGaussianBlur stdDeviation="2.2" result="blur" />
                          <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      <rect x="0" y="0" width={GLOBAL_MAP_WIDTH} height={GLOBAL_MAP_HEIGHT} fill="url(#gm-ocean)" />
                      {Array.from({ length: 11 }, (_, idx) => (
                        <line
                          key={`lat-${idx}`}
                          x1="0"
                          y1={40 + idx * 44}
                          x2={GLOBAL_MAP_WIDTH}
                          y2={40 + idx * 44}
                          stroke={isLight ? "#94a3b8" : "#1e293b"}
                          strokeOpacity={0.18}
                          strokeWidth="1"
                        />
                      ))}
                      {Array.from({ length: 13 }, (_, idx) => (
                        <line
                          key={`lon-${idx}`}
                          x1={40 + idx * 76}
                          y1="0"
                          x2={40 + idx * 76}
                          y2={GLOBAL_MAP_HEIGHT}
                          stroke={isLight ? "#94a3b8" : "#1e293b"}
                          strokeOpacity={0.14}
                          strokeWidth="1"
                        />
                      ))}
                      <g
                        transform={`translate(${GLOBAL_MAP_WIDTH / 2} ${GLOBAL_MAP_HEIGHT / 2}) scale(${globalMapZoom}) translate(${-GLOBAL_MAP_WIDTH / 2} ${-GLOBAL_MAP_HEIGHT / 2})`}
                        style={{ transition: "transform 260ms ease" }}
                      >
                        {globalWorldFeatures.map((feature, idx) => {
                          const d = globalPath(feature);
                          if (!d) return null;
                          const iso2 = geoFeatureIso2(feature);
                          const matched = GLOBAL_MARKET_COUNTRIES.find(
                            (country) => String(country.iso2 || country.code || "").toUpperCase() === iso2
                          );
                          const active = String(iso2 || "").toUpperCase() === String(selectedGlobalCountry.iso2 || "").toUpperCase();
                          const relationType = relationTypeByIso.get(String(iso2 || "").toUpperCase()) || "neutral";
                          const fillColor = active ? "#2563eb" : relationColor(relationType, isLight);
                          const centroid = relationType === "conflict" ? globalPath.centroid(feature) : null;
                          return (
                            <g key={`country-${idx}`}>
                              <path
                                d={d}
                                fill={fillColor}
                                stroke={active ? (isLight ? "#1d4ed8" : "#93c5fd") : isLight ? "#e2e8f0" : "#334155"}
                                strokeWidth={active ? 2 : 0.7}
                                className={matched ? "cursor-pointer" : ""}
                                style={{ transition: "fill 360ms ease, stroke 360ms ease" }}
                                onClick={() => {
                                  if (matched) setGlobalMarketCountry(matched.code);
                                }}
                              />
                              {relationType === "conflict" &&
                                Array.isArray(centroid) &&
                                Number.isFinite(centroid[0]) &&
                                Number.isFinite(centroid[1]) && (
                                  <text
                                    x={centroid[0]}
                                    y={centroid[1]}
                                    textAnchor="middle"
                                    fontSize="12"
                                    fill="#fecaca"
                                    className="pointer-events-none select-none"
                                  >
                                    ⚠
                                  </text>
                                )}
                            </g>
                          );
                        })}
                        {globalMarkers.map((country) => {
                          const [x, y] = country.point;
                          const active = country.code === selectedGlobalCountry.code;
                          return (
                            <g key={`marker-${country.code}`}>
                              {active && (
                                <>
                                  <circle cx={x} cy={y} r={36} fill="url(#gm-hotspot)" />
                                  <circle cx={x} cy={y} r={22} stroke={isLight ? "#2563eb" : "#7dd3fc"} strokeOpacity="0.35" strokeWidth="2" fill="none" />
                                </>
                              )}
                              <circle
                                cx={x}
                                cy={y}
                                r={active ? 10 : 7}
                                fill={active ? "#2563eb" : isLight ? "#334155" : "#67e8f9"}
                                opacity={active ? 0.95 : 0.78}
                                filter={active ? "url(#gm-glow)" : undefined}
                                className="cursor-pointer transition-all"
                                onClick={() => setGlobalMarketCountry(country.code)}
                              />
                              <text
                                x={x + 11}
                                y={y - 9}
                                fontSize={active ? 11 : 10}
                                fill={active ? "#e2e8f0" : isLight ? "#334155" : "#cbd5e1"}
                                className="pointer-events-none select-none"
                              >
                                {country.code}
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    </svg>
                    {globalWorldLoading && (
                      <div className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xs ${isLight ? "text-slate-600" : "text-white/70"}`}>
                        Loading geographic map...
                      </div>
                    )}
                    {globalWorldError && (
                      <div className="absolute bottom-2 left-2 rounded-md bg-rose-500/20 px-2 py-1 text-[11px] text-rose-200">
                        {globalWorldError}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className={`${isLight ? "text-slate-500" : "text-white/60"}`}>Relations:</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Allies / Partners</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Tensions / Sanctions</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-[#7f1d1d]" /> Active Conflict ⚠</span>
                    <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-blue-400" /> Trade Partners</span>
                    <span className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-full ${isLight ? "bg-gray-300" : "bg-slate-600"}`} /> Neutral</span>
                  </div>
                  <div className="mt-3">
                    <input
                      value={globalCountryQuery}
                      onChange={(e) => setGlobalCountryQuery(e.target.value)}
                      placeholder="Search country or code (e.g., Japan, JP, UAE)"
                      className={`w-full rounded-lg border px-2.5 py-2 text-xs outline-none ${
                        isLight
                          ? "border-slate-300 bg-white text-slate-900 focus:border-slate-500"
                          : "border-white/15 bg-slate-900/55 text-white placeholder:text-white/45 focus:border-cyan-400/50"
                      }`}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {globalQuickSelectCountries.map((country) => (
                      <button
                        key={`chip-${country.code}`}
                        onClick={() => setGlobalMarketCountry(country.code)}
                        className={`px-2.5 py-1 rounded-full text-[11px] border transition ${
                          country.code === selectedGlobalCountry.code
                            ? "bg-blue-600 text-white border-blue-500"
                            : isLight
                              ? "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                              : "bg-white/5 text-white/80 border-white/15 hover:bg-white/10"
                        }`}
                      >
                        {country.code} · {country.name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={`lg:col-span-2 rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.03]"}`}>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <div className={`text-xs uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>Country Focus</div>
                      <div className={`text-lg font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{selectedGlobalCountry.name}</div>
                    </div>
                    <select
                      value={selectedGlobalCountry.code}
                      onChange={(e) => setGlobalMarketCountry(e.target.value)}
                      className={`px-2 py-1.5 rounded-lg text-xs border outline-none ${
                        isLight ? "border-slate-300 bg-white text-slate-900 focus:border-slate-500" : "border-white/15 bg-slate-900/60 text-white focus:border-cyan-400/50"
                      }`}
                    >
                      {globalCountryOptions.map((country) => (
                        <option key={country.code} value={country.code}>{country.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className={`mb-3 rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                      Country Intelligence Snapshot
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className={`rounded-md border px-2 py-1.5 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.04]"}`}>
                        <div className={`text-[10px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Allies + Trade</div>
                        <div className={`text-sm font-semibold ${isLight ? "text-emerald-700" : "text-emerald-300"}`}>
                          {selectedCountryRelationStats.allies + selectedCountryRelationStats.trade}
                        </div>
                      </div>
                      <div className={`rounded-md border px-2 py-1.5 ${isLight ? "border-slate-200 bg-white" : "border-white/10 bg-white/[0.04]"}`}>
                        <div className={`text-[10px] ${isLight ? "text-slate-500" : "text-white/60"}`}>Tension + Conflict</div>
                        <div className={`text-sm font-semibold ${isLight ? "text-rose-700" : "text-rose-300"}`}>
                          {selectedCountryRelationStats.tensions + selectedCountryRelationStats.conflicts}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5">
                      <div className={`text-[11px] ${isLight ? "text-slate-600" : "text-white/72"}`}>
                        Market pulse:{" "}
                        <span className={`${selectedCountryAvgPct != null && selectedCountryAvgPct >= 0 ? "text-emerald-500" : selectedCountryAvgPct != null ? "text-rose-500" : isLight ? "text-slate-600" : "text-white/75"} font-semibold`}>
                          {selectedCountryAvgPct != null
                            ? `${selectedCountryAvgPct > 0 ? "+" : ""}${selectedCountryAvgPct.toFixed(2)}% avg`
                            : "No live proxy move"}
                        </span>
                      </div>
                      {selectedCountryMarketPulse.strongest && (
                        <div className={`text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>
                          Strongest: {selectedCountryMarketPulse.strongest.symbol}{" "}
                          <span className="text-emerald-500">
                            +{Number(selectedCountryMarketPulse.strongest.pct).toFixed(2)}%
                          </span>
                        </div>
                      )}
                      {selectedCountryMarketPulse.weakest && (
                        <div className={`text-[11px] ${isLight ? "text-slate-600" : "text-white/70"}`}>
                          Weakest: {selectedCountryMarketPulse.weakest.symbol}{" "}
                          <span className="text-rose-500">
                            {Number(selectedCountryMarketPulse.weakest.pct).toFixed(2)}%
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 mb-3">
                    {globalCountryQuotesLoading && (
                      <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Loading market proxies...</div>
                    )}
                    {!globalCountryQuotesLoading && globalCountryQuotes.map((row) => (
                      <div key={row.symbol} className={`rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-white/[0.04]"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className={`text-xs font-semibold ${isLight ? "text-slate-700" : "text-white/85"}`}>{row.label}</div>
                            <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/55"}`}>{row.symbol}</div>
                          </div>
                          <div className="text-right">
                            <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                              {Number.isFinite(row.price) ? `$${Number(row.price).toFixed(2)}` : "—"}
                            </div>
                            <div className={`text-xs ${Number(row.percentChange) >= 0 ? "text-emerald-500" : "text-rose-500"}`}>
                              {Number.isFinite(row.percentChange) ? `${row.percentChange > 0 ? "+" : ""}${Number(row.percentChange).toFixed(2)}%` : "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className={`mb-3 rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                      Geopolitical Summary
                    </div>
                    <div className={`text-xs leading-relaxed ${isLight ? "text-slate-700" : "text-white/78"}`}>
                      {geoCountrySummaryLoading
                        ? "Generating geopolitical standing summary..."
                        : geoCountrySummary || "No summary available for this country yet."}
                    </div>
                  </div>

                  <div className={`mb-3 rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                      ALLIES & PARTNERS
                    </div>
                    <div className="space-y-2">
                      {alliesAndPartnersList.length ? (
                        alliesAndPartnersList.map((item, idx) => (
                          <div key={`ally-${item.code}-${idx}`} className="text-xs">
                            <div className={`inline-flex items-center gap-1.5 font-semibold ${isLight ? "text-slate-800" : "text-white/90"}`}>
                              <span className="h-2 w-2 rounded-full bg-green-500" />
                              {item.name}
                            </div>
                            <div className={`${isLight ? "text-slate-600" : "text-white/70"}`}>{item.reason}</div>
                          </div>
                        ))
                      ) : (
                        <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>No major allies/partners listed.</div>
                      )}
                    </div>
                  </div>

                  <div className={`mb-3 rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                      TENSIONS & SANCTIONS
                    </div>
                    <div className="space-y-2">
                      {selectedCountryRelations.tensionsSanctions.length ? (
                        selectedCountryRelations.tensionsSanctions.map((item, idx) => (
                          <div key={`tension-${item.code}-${idx}`} className="text-xs">
                            <div className={`inline-flex items-center gap-1.5 font-semibold ${isLight ? "text-slate-800" : "text-white/90"}`}>
                              <span className="h-2 w-2 rounded-full bg-red-500" />
                              {item.name}
                            </div>
                            <div className={`${isLight ? "text-slate-600" : "text-white/70"}`}>{item.reason}</div>
                          </div>
                        ))
                      ) : (
                        <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>No major sanctions or direct tensions listed.</div>
                      )}
                    </div>
                  </div>

                  <div className={`mb-3 rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50/80" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                      ACTIVE CONFLICTS
                    </div>
                    <div className="space-y-2">
                      {selectedCountryRelations.activeConflicts.length ? (
                        selectedCountryRelations.activeConflicts.map((item, idx) => (
                          <div key={`conflict-${item.code}-${idx}`} className="text-xs">
                            <div className={`inline-flex items-center gap-1.5 font-semibold ${isLight ? "text-slate-800" : "text-white/90"}`}>
                              <span className="text-[#7f1d1d]">⚠</span>
                              {item.name}
                            </div>
                            <div className={`${isLight ? "text-slate-600" : "text-white/70"}`}>{item.reason}</div>
                          </div>
                        ))
                      ) : (
                        <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>No active military conflicts listed for this profile.</div>
                      )}
                    </div>
                  </div>

                  <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                    {selectedGlobalCountry.name} News
                  </div>
                  <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                    {globalCountryNews.map((item, idx) => (
                      <a
                        key={`${item.url}-${idx}`}
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className={`block rounded-lg border p-2 ${isLight ? "border-slate-200 bg-slate-50 hover:bg-slate-100" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.09]"}`}
                      >
                        <div className={`text-xs font-medium leading-relaxed ${isLight ? "text-blue-700" : "text-blue-300"}`}>{item.headlineDisplay}</div>
                        <div className={`mt-1 text-[11px] ${isLight ? "text-slate-600" : "text-white/68"}`}>{item.laymanSummary}</div>
                        <div className={`mt-1 text-[10px] ${isLight ? "text-slate-500" : "text-white/55"}`}>
                          {[item.source || safeDomainFromUrl(item.url), geopoliticsAgeLabel(item.datetime)].filter(Boolean).join(" • ") || "Global feed"}
                        </div>
                      </a>
                    ))}
                    {globalCountryNews.length === 0 && (
                      <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>No country-specific headlines yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {isGeoPoliticsMode && (
          <div className="mb-6">
            <Card
              title={tx("Geo Politics Intelligence")}
              right={
                <button
                  onClick={fetchMarketNews}
                  className={`px-3 py-1.5 rounded-lg text-xs ${isLight ? "bg-slate-100 hover:bg-slate-200 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white"}`}
                >
                  {tx("Refresh")}
                </button>
              }
            >
              <p className={`text-sm mb-4 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                Real-time geopolitical intelligence focused on conflict escalation, policy shifts, sanctions, logistics corridors, and macro risk transmission into markets.
              </p>
              <SummaryPanel label={tx("Executive Brief")} text={geopoliticsExecutiveSummary} isLight={isLight} className="mb-3" />
              <SummaryPanel label={tx("Summary")} text={marketNewsDigest} isLight={isLight} className="mb-4" />

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-5">
                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white/90" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Headlines Tracked</div>
                  <div className={`text-2xl font-semibold mt-1 ${isLight ? "text-slate-900" : "text-white"}`}>{geopoliticsStats.total}</div>
                </div>
                <div className={`rounded-xl border p-3 ${isLight ? "border-rose-200 bg-rose-50" : "border-rose-400/30 bg-rose-500/10"}`}>
                  <div className={`text-xs ${isLight ? "text-rose-700" : "text-rose-200/90"}`}>High-Impact Alerts</div>
                  <div className={`text-2xl font-semibold mt-1 ${isLight ? "text-rose-700" : "text-rose-200"}`}>{geopoliticsStats.highImpact}</div>
                </div>
                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white/90" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-xs ${isLight ? "text-slate-500" : "text-white/60"}`}>Regions In Focus</div>
                  <div className={`text-2xl font-semibold mt-1 ${isLight ? "text-slate-900" : "text-white"}`}>{geopoliticsStats.regions}</div>
                </div>
                <div className={`rounded-xl border p-3 ${isLight ? "border-amber-200 bg-amber-50" : "border-amber-400/30 bg-amber-500/10"}`}>
                  <div className={`text-xs ${isLight ? "text-amber-700" : "text-amber-200/90"}`}>Risk Gauge</div>
                  <div className={`text-2xl font-semibold mt-1 ${isLight ? "text-amber-700" : "text-amber-200"}`}>{geopoliticsStats.riskScore}</div>
                  <div className={`text-[11px] mt-0.5 ${isLight ? "text-amber-700/80" : "text-amber-100/70"}`}>/100 composite</div>
                </div>
              </div>
              <div className={`mb-5 rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white/90" : "border-white/10 bg-white/5"}`}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className={`text-xs font-semibold uppercase tracking-wide ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                    Strategic Lens
                  </div>
                  <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/60"}`}>
                    Risk posture {geopoliticsStats.riskScore}/100
                  </div>
                </div>
                <div className={`h-2.5 rounded-full overflow-hidden mb-3 ${isLight ? "bg-slate-200" : "bg-white/10"}`}>
                  <div
                    className={`${geopoliticsStats.riskScore >= 70 ? "bg-rose-500" : geopoliticsStats.riskScore >= 40 ? "bg-amber-500" : "bg-emerald-500"} h-full rounded-full transition-all`}
                    style={{ width: `${Math.max(4, geopoliticsStats.riskScore)}%` }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div className={`rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50/70" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>What Changed</div>
                    <div className={`text-xs leading-relaxed ${isLight ? "text-slate-700" : "text-white/78"}`}>{geopoliticsWatchNarrative.changed}</div>
                  </div>
                  <div className={`rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50/70" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>Why Markets Care</div>
                    <div className={`text-xs leading-relaxed ${isLight ? "text-slate-700" : "text-white/78"}`}>{geopoliticsWatchNarrative.market}</div>
                  </div>
                  <div className={`rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-slate-50/70" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className={`text-[11px] font-semibold uppercase tracking-wide mb-1 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>What To Watch Next</div>
                    <div className={`text-xs leading-relaxed ${isLight ? "text-slate-700" : "text-white/78"}`}>{geopoliticsWatchNarrative.watch}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                {GEO_POLITICS_THEMES.map((theme) => (
                  <div
                    key={theme.title}
                    className={`rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white/90" : "border-white/10 bg-white/5"}`}
                  >
                    <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                      {theme.title} · {geopoliticsThemeCounts[theme.title] || 0}
                    </div>
                    <div className={`text-sm ${isLight ? "text-slate-700" : "text-white/85"}`}>{theme.detail}</div>
                  </div>
                ))}
              </div>

              <div className="mb-5 grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white/90" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                    Top Flashpoints
                  </div>
                  <div className="space-y-2.5">
                    {geopoliticsWatchlist.map((watch) => (
                      <div key={watch.key} className={`rounded-lg border px-3 py-2 ${isLight ? "border-slate-200 bg-slate-50/60" : "border-white/10 bg-white/[0.04]"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <div className={`text-sm font-semibold ${isLight ? "text-slate-800" : "text-white/90"}`}>{watch.key}</div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${watch.hits > 0 ? (isLight ? "border-rose-300 bg-rose-50 text-rose-700" : "border-rose-400/35 bg-rose-500/15 text-rose-200") : (isLight ? "border-slate-300 bg-white text-slate-600" : "border-white/20 bg-white/5 text-white/70")}`}>
                            {watch.hits} hits
                          </span>
                        </div>
                        <div className={`text-xs mt-1 line-clamp-2 ${isLight ? "text-slate-600" : "text-white/65"}`}>
                          {watch.top?.headlineDisplay || watch.top?.headlineOriginal || "No active signal right now."}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white/90" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${isLight ? "text-slate-500" : "text-cyan-200/80"}`}>
                    Regional Heat
                  </div>
                  <div className="space-y-2.5">
                    {geopoliticsRegionCounts.map((entry) => (
                      <div key={entry.region}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className={isLight ? "text-slate-700" : "text-white/80"}>{entry.region}</span>
                          <span className={isLight ? "text-slate-500" : "text-white/60"}>{entry.count}</span>
                        </div>
                        <div className={`h-2 rounded-full overflow-hidden ${isLight ? "bg-slate-200" : "bg-white/10"}`}>
                          <div
                            className={`h-full rounded-full ${isLight ? "bg-slate-700" : "bg-cyan-300/80"}`}
                            style={{ width: `${Math.max(8, Math.round((entry.count / Math.max(1, geopoliticsStats.total)) * 100))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                    {geopoliticsRegionCounts.length === 0 && (
                      <div className={`text-sm ${isLight ? "text-slate-500" : "text-white/60"}`}>No regional distribution yet.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className={`mb-4 rounded-xl border p-3 ${isLight ? "border-slate-200 bg-white/90" : "border-white/10 bg-white/5"}`}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <input
                    value={geoQuery}
                    onChange={(e) => setGeoQuery(e.target.value)}
                    placeholder="Search headlines, themes, regions..."
                    className={`px-3 py-2 rounded-lg text-sm border outline-none ${
                      isLight ? "border-slate-300 bg-white text-slate-900 focus:border-slate-500" : "border-white/15 bg-slate-900/60 text-white focus:border-cyan-400/50"
                    }`}
                  />
                  <select
                    value={geoRegionFilter}
                    onChange={(e) => setGeoRegionFilter(e.target.value)}
                    className={`px-3 py-2 rounded-lg text-sm border outline-none ${
                      isLight ? "border-slate-300 bg-white text-slate-900 focus:border-slate-500" : "border-white/15 bg-slate-900/60 text-white focus:border-cyan-400/50"
                    }`}
                  >
                    {geoRegionOptions.map((region) => (
                      <option key={region} value={region}>{region === "all" ? "All Regions" : region}</option>
                    ))}
                  </select>
                  <select
                    value={geoSort}
                    onChange={(e) => setGeoSort(e.target.value)}
                    className={`px-3 py-2 rounded-lg text-sm border outline-none ${
                      isLight ? "border-slate-300 bg-white text-slate-900 focus:border-slate-500" : "border-white/15 bg-slate-900/60 text-white focus:border-cyan-400/50"
                    }`}
                  >
                    <option value="impact">Sort: Impact Priority</option>
                    <option value="latest">Sort: Newest First</option>
                    <option value="oldest">Sort: Oldest First</option>
                  </select>
                  <div className={`px-3 py-2 rounded-lg text-xs border flex items-center ${isLight ? "border-slate-300 bg-slate-50 text-slate-600" : "border-white/15 bg-white/[0.04] text-white/65"}`}>
                    Updated {geopoliticsAgeLabel(geopoliticsStats.updatedTs) || "N/A"}
                  </div>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-2">
                {["all", "high", "Conflict Zones", "Trade & Sanctions", "Energy & Shipping"].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setGeoFilter(filter)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
                      geoFilter === filter
                        ? isLight
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-blue-600 text-white border-blue-500"
                        : isLight
                          ? "bg-white text-slate-700 border-slate-300 hover:bg-slate-100"
                          : "bg-white/5 text-white/80 border-white/15 hover:bg-white/10"
                    }`}
                  >
                    {filter === "all" ? "All" : filter === "high" ? "High Impact" : filter}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredGeopoliticsItems.slice(0, 24).map((n) => (
                  <a
                    key={n.id}
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`group block rounded-xl border p-3 transition-all ${isLight ? "border-slate-200 bg-white hover:bg-slate-50" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                  >
                    <div className="flex gap-3">
                      <div className={`relative w-20 h-20 shrink-0 rounded-lg overflow-hidden border ${isLight ? "border-slate-200" : "border-white/10"}`}>
                        <div className={`absolute inset-0 ${isLight ? "bg-gradient-to-br from-blue-100 via-sky-100 to-slate-100" : "bg-gradient-to-br from-blue-600/35 via-cyan-500/20 to-slate-800/30"}`} />
                        <div className="absolute inset-0 flex items-center justify-center">
                          {faviconUrlFor(n.url) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={faviconUrlFor(n.url)}
                              alt="Source"
                              className="h-9 w-9 rounded-full bg-white/90 p-1.5 ring-1 ring-white/30"
                            />
                          ) : (
                            <div className={`h-9 w-9 rounded-full ${isLight ? "bg-slate-200" : "bg-white/20"}`} />
                          )}
                        </div>
                      </div>
                      <div className="min-w-0">
                        <div className={`text-sm group-hover:underline line-clamp-3 ${isLight ? "text-blue-700" : "text-blue-300"}`}>{n.headlineDisplay}</div>
                        <div className={`mt-1 text-xs leading-relaxed line-clamp-3 ${isLight ? "text-slate-600" : "text-white/68"}`}>{n.laymanSummary}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${isLight ? "border-slate-300 text-slate-600 bg-white" : "border-white/20 text-white/75 bg-white/5"}`}>
                            {n.theme}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${isLight ? "border-slate-300 text-slate-600 bg-white" : "border-white/20 text-white/75 bg-white/5"}`}>
                            {n.region}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            n.impact === "High"
                              ? isLight
                                ? "border-rose-300 text-rose-700 bg-rose-50"
                                : "border-rose-400/40 text-rose-200 bg-rose-500/15"
                              : n.impact === "Medium"
                                ? isLight
                                  ? "border-amber-300 text-amber-700 bg-amber-50"
                                  : "border-amber-400/40 text-amber-200 bg-amber-500/15"
                                : isLight
                                  ? "border-emerald-300 text-emerald-700 bg-emerald-50"
                                  : "border-emerald-400/40 text-emerald-200 bg-emerald-500/15"
                          }`}>
                            {n.impact} Impact
                          </span>
                        </div>
                        <div className={`mt-2 text-[11px] ${isLight ? "text-slate-500" : "text-white/50"}`}>
                          {[n.source || safeDomainFromUrl(n.url), geopoliticsAgeLabel(n.datetime)].filter(Boolean).join(" • ") || "Global feed"}
                        </div>
                        <div className={`mt-1 text-[11px] truncate ${isLight ? "text-slate-400" : "text-white/40"}`}>{safeDomainFromUrl(n.url)}</div>
                      </div>
                    </div>
                  </a>
                ))}
                {filteredGeopoliticsItems.length === 0 && (
                  <div className={`text-sm ${isLight ? "text-slate-600" : "text-white/60"}`}>No headlines match your current filters.</div>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* COMPANY */}
        {!isNarrativeMode && company?.name && (
          <div className="mb-6">
            <Card title={assetMode === "stock" ? "Company" : "Market Asset"}>
              <div className="flex items-center gap-3">
                {company.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.logo} alt={`${company.name} logo`} className="h-10 w-10 rounded bg-white p-1" />
                )}
                <div>
                  <div className="text-lg font-semibold">{company.name}</div>
                  <div className="text-sm text-white/60 mt-1">
                    {company.exchange ? `${company.exchange}` : ""}{" "}
                    {company.finnhubIndustry ? `• ${company.finnhubIndustry}` : ""}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-xs text-white/70">
                    <div>Sector: {company.sector || company.finnhubIndustry || "—"}</div>
                    <div>Industry: {company.finnhubIndustry || "—"}</div>
                    <div>
                      Market Cap: $
                      {fmt(company.marketCapitalization) != null
                        ? `${fmtLarge(Number(company.marketCapitalization) * 1e6)}`
                        : fmt(fundamentals?.marketCap) != null
                          ? fmtLarge(fundamentals.marketCap)
                          : "—"}
                    </div>
                    <div>IPO: {company.ipo || "—"}</div>
                  </div>
                </div>
              </div>

              {company.weburl && (
                <a
                  href={company.weburl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block mt-3 text-sm text-blue-300 hover:underline"
                >
                  Company website
                </a>
              )}
            </Card>
          </div>
        )}

        {assetMode === "stock" && !isNarrativeMode && sectorInfo && (
          <div className="mb-6">
            <Card title="Sector Analysis">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="text-white/60 text-xs mb-1">Detected Sector</div>
                  <div className="font-semibold">{sectorInfo.sector}</div>
                  <div className="text-white/70 text-xs mt-1">Benchmark ETF: {sectorInfo.benchmark}</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                  <div className="text-white/60 text-xs mb-1">Sector Daily Move</div>
                  <div className={`font-semibold ${Number(sectorInfo.percentChange) >= 0 ? "text-green-300" : "text-red-300"}`}>
                    {fmt(sectorInfo.percentChange) != null
                      ? `${Number(sectorInfo.percentChange) >= 0 ? "+" : ""}${Number(sectorInfo.percentChange).toFixed(2)}%`
                      : "—"}
                  </div>
                  <div className="text-white/70 text-xs mt-1">
                    ETF Price: {fmt(sectorInfo.price) != null ? `$${Number(sectorInfo.price).toFixed(2)}` : "—"}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* QUOTE + CHART */}
        {!isNarrativeMode && (result || chartLoading || (chartPoints?.length > 0)) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {result && (
              <Card
                title="Quote"
                right={null}
              >
                <div className="text-xl font-semibold">{result.symbol}</div>
                <div className="text-3xl font-bold mt-1">{result.price}</div>

                {result.change && (
                  <div className={`text-sm mt-1 ${result.change.startsWith("+") ? "text-green-400" : "text-red-400"}`}>
                    {result.change}
                  </div>
                )}

                <div className="mt-3 space-y-1">
                  {fmt(result.high) != null && <div className="text-white/70 text-sm">High: ${result.high}</div>}
                  {fmt(result.low) != null && <div className="text-white/70 text-sm">Low: ${result.low}</div>}
                  {fmt(result.open) != null && <div className="text-white/70 text-sm">Open: ${result.open}</div>}
                  {fmt(result.previousClose) != null && <div className="text-white/70 text-sm">Prev Close: ${result.previousClose}</div>}
                  <div className="text-white/70 text-sm">
                    Volume: {fmt(latestVolume) != null ? fmtLarge(latestVolume) : "—"}
                  </div>
                  <div className="text-white/70 text-sm">
                    P/E Ratio: {fmt(fundamentals?.peRatio) != null ? Number(fundamentals.peRatio).toFixed(2) : "—"}
                  </div>
                  <div className="text-white/70 text-sm">
                    52W Range:{" "}
                    {fmt(fundamentals?.week52Low) != null && fmt(fundamentals?.week52High) != null
                      ? `$${Number(fundamentals.week52Low).toFixed(2)} - $${Number(fundamentals.week52High).toFixed(2)}`
                      : "—"}
                  </div>
                  <div className={`text-sm ${trendDelta >= 0 ? "text-green-300" : "text-red-300"}`}>
                    Trend: {trendLabel} {chartPoints.length > 1 ? `(${trendDelta >= 0 ? "+" : ""}${trendPct.toFixed(2)}%)` : ""}
                  </div>
                </div>

                <div className="text-white/50 text-xs pt-3">{result.info}</div>
              </Card>
            )}

            {(result || chartLoading || chartPoints?.length > 0) && (
              <Card
                title={`${assetMode === "crypto" ? "Crypto" : assetMode === "metals" ? "Metals" : "Stock"} Chart`}
                right={
                  <div className="inline-flex rounded-lg overflow-hidden border border-white/10">
                    {["1D", "1W", "1M", "1Y"].map((r) => (
                      <button
                        key={r}
                        onClick={() => setChartRange(r)}
                        className={`px-2 py-1 text-[11px] ${chartRange === r ? "bg-blue-600 text-white" : "bg-white/5 text-white/80"}`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                }
              >
                {chartLoading ? (
                  <div className="text-sm text-white/60 animate-pulse">Loading chart...</div>
                ) : (
                  <>
                    {chartPoints?.length > 0 ? (
                      <>
                        <canvas ref={chartRef} className="w-full h-[180px] rounded-xl bg-black/30" />
                        <div className="text-xs text-white/50 mt-2">
                          Data source: {assetMode === "stock" ? "Finnhub/Stooq" : assetMode === "metals" ? "Yahoo/Alpha Vantage" : "CoinGecko"} candles. Educational view.
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-white/60">No chart data for this range. Try another range.</div>
                    )}
                  </>
                )}
              </Card>
            )}
          </div>
        )}

        {assetMode === "crypto" && !isNarrativeMode && (result || company?.name) && (
          <div className="mb-6">
            <Card title="Crypto Investor Checklist">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                <div className={`rounded-xl border p-3 ${isLight ? "border-sky-200 bg-sky-50" : "border-sky-400/30 bg-sky-500/12"}`}>
                  <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Real-World Utility</div>
                  <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                    {company?.finnhubIndustry || "Digital Asset"}
                  </div>
                  <div className={`text-xs mt-1 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                    {company?.utilitySummary || "Check if this token solves a real user or business problem."}
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${isLight ? "border-emerald-200 bg-emerald-50" : "border-emerald-400/30 bg-emerald-500/12"}`}>
                  <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Market Cap</div>
                  <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                    ${fmtLarge(fundamentals?.marketCap)}
                  </div>
                  <div className={`text-xs mt-1 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                    Size proxy: larger caps are usually less fragile than micro caps.
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${isLight ? "border-violet-200 bg-violet-50" : "border-violet-400/30 bg-violet-500/12"}`}>
                  <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Liquidity (24h Volume)</div>
                  <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                    ${fmtLarge(latestVolume)}
                  </div>
                  <div className={`text-xs mt-1 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                    Volume / market cap: {fmt(volumeToMarketCapPct) != null ? `${volumeToMarketCapPct.toFixed(2)}%` : "—"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Trend Confirmation</div>
                  <div className={`text-sm font-semibold ${trendDelta >= 0 ? (isLight ? "text-emerald-700" : "text-green-300") : (isLight ? "text-rose-700" : "text-red-300")}`}>
                    {trendLabel} {chartPoints.length > 1 ? `(${trendDelta >= 0 ? "+" : ""}${trendPct.toFixed(2)}%)` : ""}
                  </div>
                  <div className={`text-xs mt-1 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                    Investors usually align entries with trend instead of fighting it.
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Volatility Check</div>
                  <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                    Intraday range: {fmt(intradayRangePct) != null ? `${intradayRangePct.toFixed(2)}%` : "—"}
                  </div>
                  <div className={`text-xs mt-1 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                    Wider ranges generally mean bigger risk and wider stop sizing.
                  </div>
                </div>
                <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>News & Sentiment</div>
                  <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                    {news.length} recent headline{news.length === 1 ? "" : "s"}
                  </div>
                  <div className={`text-xs mt-1 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                    Momentum can change quickly around exchange, regulation, or ETF headlines.
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className={`rounded-xl border p-3 ${isLight ? "border-cyan-200 bg-cyan-50" : "border-cyan-400/30 bg-cyan-500/12"}`}>
                  <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>1) On-Chain Usage (Available Proxies)</div>
                  <div className={`space-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    <div>24h Volume: ${fmtLarge(latestVolume)}</div>
                    <div>Volume / Market Cap: {fmt(volumeToMarketCapPct) != null ? `${volumeToMarketCapPct.toFixed(2)}%` : "—"}</div>
                    <div>Community Reach: {fmtLarge(fundamentals?.twitterFollowers)} X • {fmtLarge(fundamentals?.redditSubscribers)} Reddit</div>
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Note: active addresses / TVL not in current feed yet.</div>
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Why this matters: higher real usage and liquidity usually means better durability and easier execution.</div>
                  </div>
                </div>

                <div className={`rounded-xl border p-3 ${isLight ? "border-indigo-200 bg-indigo-50" : "border-indigo-400/30 bg-indigo-500/12"}`}>
                  <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>2) Tokenomics & Supply Pressure</div>
                  <div className={`space-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    <div>Circulating Supply: {fmtLarge(fundamentals?.circulatingSupply)}</div>
                    <div>Max Supply: {fmtLarge(fundamentals?.maxSupply)}</div>
                    <div>Circulating / Max: {fmt(circulatingToMaxPct) != null ? `${circulatingToMaxPct.toFixed(2)}%` : "—"}</div>
                    <div>FDV: ${fmtLarge(fundamentals?.fdv)} • FDV/MCap: {fmt(fdvToMarketCapRatio) != null ? `${fdvToMarketCapRatio.toFixed(2)}x` : "—"}</div>
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Why this matters: future token unlock pressure can dilute holders and cap upside.</div>
                  </div>
                </div>

                <div className={`rounded-xl border p-3 ${isLight ? "border-rose-200 bg-rose-50" : "border-rose-400/30 bg-rose-500/12"}`}>
                  <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>3) Holder Concentration Risk</div>
                  <div className={`space-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    <div>Top wallet concentration: Not connected</div>
                    <div>Exchange wallet concentration: Not connected</div>
                    <div>Whale transfer alerts: Not connected</div>
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Can be added via on-chain provider integration.</div>
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Why this matters: high concentration increases dump/manipulation risk.</div>
                  </div>
                </div>

                <div className={`rounded-xl border p-3 ${isLight ? "border-emerald-200 bg-emerald-50" : "border-emerald-400/30 bg-emerald-500/12"}`}>
                  <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>4) Security & Governance Risk</div>
                  <div className={`space-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    <div>Developer Score: {fmt(fundamentals?.developerScore) != null ? Number(fundamentals.developerScore).toFixed(2) : "—"}</div>
                    <div>Liquidity Score: {fmt(fundamentals?.liquidityScore) != null ? Number(fundamentals.liquidityScore).toFixed(2) : "—"}</div>
                    <div>Sentiment Upvotes: {fmt(fundamentals?.sentimentUpVotesPct) != null ? `${Number(fundamentals.sentimentUpVotesPct).toFixed(1)}%` : "—"}</div>
                    <div>Public Interest Score: {fmt(fundamentals?.publicInterestScore) != null ? Number(fundamentals.publicInterestScore).toFixed(2) : "—"}</div>
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Why this matters: stronger security/developer signals can reduce protocol failure risk.</div>
                  </div>
                </div>

                <div className={`rounded-xl border p-3 ${isLight ? "border-amber-200 bg-amber-50" : "border-amber-400/30 bg-amber-500/12"}`}>
                  <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>5) Revenue Quality / Project Health</div>
                  <div className={`space-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    <div>GitHub Stars: {fmtLarge(fundamentals?.githubStars)} • Forks: {fmtLarge(fundamentals?.githubForks)}</div>
                    <div>Commits (4w): {fmtLarge(fundamentals?.githubCommits4w)}</div>
                    <div>Issue Close Rate: {fmt(issueCloseRatePct) != null ? `${issueCloseRatePct.toFixed(1)}%` : "—"}</div>
                    {fundamentals?.githubRepo ? (
                      <a href={fundamentals.githubRepo} target="_blank" rel="noreferrer" className={`${isLight ? "text-blue-700" : "text-blue-300"} underline`}>
                        View primary GitHub repo
                      </a>
                    ) : (
                      <div>GitHub repo: —</div>
                    )}
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Why this matters: active and responsive development often supports long-term project quality.</div>
                  </div>
                </div>

                <div className={`rounded-xl border p-3 ${isLight ? "border-violet-200 bg-violet-50" : "border-violet-400/30 bg-violet-500/12"}`}>
                  <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>6) Catalyst & Event Tracker</div>
                  <div className={`space-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    {news.length > 0 ? (
                      news.slice(0, 3).map((n, idx) => (
                        <div key={`cat-${idx}`} className="truncate">• {n.headline}</div>
                      ))
                    ) : (
                      <div>No near-term catalyst headlines loaded.</div>
                    )}
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Track upgrades, ETF decisions, listings, and unlock calendars.</div>
                    <div className={`${isLight ? "text-slate-600" : "text-white/60"}`}>Why this matters: catalysts can quickly reprice crypto up or down.</div>
                  </div>
                </div>

                <div className={`rounded-xl border p-3 md:col-span-2 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>7) Relative Valuation Comps</div>
                  <div className={`grid grid-cols-1 md:grid-cols-3 gap-3 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/20"}`}>
                      <div className={`${isLight ? "text-slate-500" : "text-white/60"} text-xs mb-1`}>Market Cap Rank</div>
                      <div className="font-semibold">#{fmtLarge(fundamentals?.marketCapRank)}</div>
                    </div>
                    <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/20"}`}>
                      <div className={`${isLight ? "text-slate-500" : "text-white/60"} text-xs mb-1`}>Distance from ATH</div>
                      <div className="font-semibold">{fmt(fundamentals?.athChangePct) != null ? `${Number(fundamentals.athChangePct).toFixed(2)}%` : "—"}</div>
                    </div>
                    <div className={`rounded-lg border p-3 ${isLight ? "border-slate-200 bg-slate-50" : "border-white/10 bg-black/20"}`}>
                      <div className={`${isLight ? "text-slate-500" : "text-white/60"} text-xs mb-1`}>Distance from ATL</div>
                      <div className="font-semibold">{fmt(fundamentals?.atlChangePct) != null ? `${Number(fundamentals.atlChangePct).toFixed(2)}%` : "—"}</div>
                    </div>
                  </div>
                  <div className={`mt-2 text-xs ${isLight ? "text-slate-600" : "text-white/60"}`}>Why this matters: relative valuation helps compare upside/downside versus other crypto assets.</div>
                </div>

                <div className={`rounded-xl border p-3 md:col-span-2 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                  <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>ASTRA Investor Brief</div>
                  <div className={`space-y-1.5 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    <div>
                      1) Start with utility: confirm this asset solves a real problem and has growing adoption.
                    </div>
                    <div>
                      2) Check liquidity + tokenomics together: deep volume with manageable dilution risk is healthier.
                    </div>
                    <div>
                      3) Use trend and volatility for position sizing: {trendLabel} with intraday range {fmt(intradayRangePct) != null ? `${intradayRangePct.toFixed(2)}%` : "—"}.
                    </div>
                    <div>
                      4) Let catalysts and security signals adjust conviction before entering/exiting.
                    </div>
                  </div>
                  <div className={`mt-3 mb-2 h-px ${isLight ? "bg-slate-200" : "bg-white/10"}`} />
                  <div className={`text-[11px] font-semibold uppercase tracking-wide mb-2 ${isLight ? "text-slate-600" : "text-white/70"}`}>Data Guide (What Each Metric Means)</div>
                  <div className={`grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                    <div><span className="font-semibold">24h Volume:</span> Dollar value traded in last 24h; higher generally means better liquidity.</div>
                    <div><span className="font-semibold">Volume / Market Cap:</span> Trading activity relative to size; very low can mean weak participation.</div>
                    <div><span className="font-semibold">Community Reach:</span> Social footprint (X/Reddit); useful for attention, not proof of fundamentals.</div>
                    <div><span className="font-semibold">Circulating Supply:</span> Tokens currently in public market circulation.</div>
                    <div><span className="font-semibold">Total Supply:</span> Existing minted supply (can be above circulating if some tokens are locked).</div>
                    <div><span className="font-semibold">Max Supply:</span> Hard cap of tokens if defined by protocol.</div>
                    <div><span className="font-semibold">Circulating / Max:</span> Percent already released; lower percent can imply more future dilution risk.</div>
                    <div><span className="font-semibold">FDV:</span> Fully Diluted Valuation, market value if all max tokens were circulating.</div>
                    <div><span className="font-semibold">FDV/MCap:</span> Dilution pressure signal; much above 1.0 can indicate future supply overhang.</div>
                    <div><span className="font-semibold">ATH / ATL:</span> All-time high/low prices used to judge cycle position and downside memory.</div>
                    <div><span className="font-semibold">Developer Score:</span> Composite dev activity indicator from data provider.</div>
                    <div><span className="font-semibold">Community Score:</span> Composite social/community activity indicator from data provider.</div>
                    <div><span className="font-semibold">Liquidity Score:</span> Market depth/quality proxy from data provider.</div>
                    <div><span className="font-semibold">Coin Score:</span> Broad quality signal from provider (market + community + developer inputs).</div>
                    <div><span className="font-semibold">Sentiment Upvotes:</span> Positive-vote share from crowd sentiment sources.</div>
                    <div><span className="font-semibold">Public Interest Score:</span> Search/attention proxy; useful for momentum context.</div>
                    <div><span className="font-semibold">GitHub Stars/Forks/Subscribers/Commits:</span> Open-source activity and ecosystem engagement proxies.</div>
                    <div><span className="font-semibold">GitHub Repo:</span> Main public codebase link used for project activity validation.</div>
                    <div><span className="font-semibold">Issue Close Rate:</span> Closed issues / total issues; shows maintenance responsiveness.</div>
                    <div><span className="font-semibold">Market Cap Rank:</span> Relative size rank among all cryptocurrencies.</div>
                    <div><span className="font-semibold">Distance from ATH/ATL:</span> Current position vs historical extremes; helps frame cycle risk/reward.</div>
                  </div>
                  <div className={`mt-3 text-xs ${isLight ? "text-slate-600" : "text-white/60"}`}>
                    Quick read bands: Volume/MCap below 2% often weak, 2%-10% normal, above 10% strong activity.
                    FDV/MCap near 1.0 is cleaner supply profile; above 1.5 can imply heavier future dilution.
                    Circulating/Max above 70% generally lower unlock risk than early-stage low-circulation tokens.
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}

        {assetMode === "stock" && !isNarrativeMode && (fundInsightsLoading || fundInsights?.isFund) && (
          <div className="mb-6">
            <Card title="Fundamental Data (Fund / ETF / Mutual Fund)">
              {fundInsightsLoading ? (
                <div className={`text-sm animate-pulse ${isLight ? "text-slate-600" : "text-white/60"}`}>Loading fund fundamentals...</div>
              ) : (
                <>
                  <div className={`text-xs mb-4 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                    {fundInsights?.overview?.name || fundInsights?.symbol || "—"} • {fundInsights?.overview?.quoteType || "FUND"}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                    <div className={`rounded-xl border p-3 ${isLight ? "border-sky-200 bg-sky-50" : "border-sky-400/30 bg-sky-500/12"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Total Assets</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>${fmtLarge(fundInsights?.overview?.totalAssets)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-emerald-200 bg-emerald-50" : "border-emerald-400/30 bg-emerald-500/12"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Expense Ratio</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fmtPctPlain(fundInsights?.overview?.expenseRatio)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-violet-200 bg-violet-50" : "border-violet-400/30 bg-violet-500/12"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Net Expense Ratio</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fmtPctPlain(fundInsights?.overview?.netExpenseRatio)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-amber-200 bg-amber-50" : "border-amber-400/30 bg-amber-500/12"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Dividend Yield</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fmtPctPlain(fundInsights?.overview?.yieldPct)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>YTD Return</div>
                      <div className={`text-sm font-semibold ${Number(fundInsights?.overview?.ytdReturnPct) >= 0 ? (isLight ? "text-emerald-700" : "text-green-300") : (isLight ? "text-rose-700" : "text-red-300")}`}>{fmtPctSigned(fundInsights?.overview?.ytdReturnPct)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>1Y Return</div>
                      <div className={`text-sm font-semibold ${Number(fundInsights?.overview?.oneYearReturnPct) >= 0 ? (isLight ? "text-emerald-700" : "text-green-300") : (isLight ? "text-rose-700" : "text-red-300")}`}>{fmtPctSigned(fundInsights?.overview?.oneYearReturnPct)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>3Y Return</div>
                      <div className={`text-sm font-semibold ${Number(fundInsights?.overview?.threeYearReturnPct) >= 0 ? (isLight ? "text-emerald-700" : "text-green-300") : (isLight ? "text-rose-700" : "text-red-300")}`}>{fmtPctSigned(fundInsights?.overview?.threeYearReturnPct)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>5Y Return</div>
                      <div className={`text-sm font-semibold ${Number(fundInsights?.overview?.fiveYearReturnPct) >= 0 ? (isLight ? "text-emerald-700" : "text-green-300") : (isLight ? "text-rose-700" : "text-red-300")}`}>{fmtPctSigned(fundInsights?.overview?.fiveYearReturnPct)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>10Y Return</div>
                      <div className={`text-sm font-semibold ${Number(fundInsights?.overview?.tenYearReturnPct) >= 0 ? (isLight ? "text-emerald-700" : "text-green-300") : (isLight ? "text-rose-700" : "text-red-300")}`}>{fmtPctSigned(fundInsights?.overview?.tenYearReturnPct)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Category</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fundInsights?.overview?.category || "—"}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Fund Family</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fundInsights?.overview?.fundFamily || "—"}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Benchmark</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fundInsights?.overview?.benchmark || "—"}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Holdings Count</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fmtLarge(fundInsights?.overview?.numberOfHoldings)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>NAV</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>${fmtLarge(fundInsights?.overview?.navPrice)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Premium / Discount to NAV</div>
                      <div className={`text-sm font-semibold ${Number(fundInsights?.overview?.premiumToNavPct) >= 0 ? (isLight ? "text-emerald-700" : "text-green-300") : (isLight ? "text-rose-700" : "text-red-300")}`}>{fmtPctSigned(fundInsights?.overview?.premiumToNavPct)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Average Daily Volume</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fmtLarge(fundInsights?.overview?.avgDailyVolume)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Turnover Ratio</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>{fmtPctPlain(fundInsights?.overview?.turnoverRatio)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>Top Holdings</div>
                      {Array.isArray(fundInsights?.topHoldings) && fundInsights.topHoldings.length > 0 ? (
                        <div className="space-y-1.5">
                          {fundInsights.topHoldings.slice(0, 10).map((row, idx) => (
                            <div key={`${row.symbol}-${idx}`} className="flex items-center justify-between text-sm">
                              <div className={isLight ? "text-slate-700" : "text-white/80"}>
                                {row.symbol || row.name || "—"} {row.name ? `• ${row.name}` : ""}
                              </div>
                              <div className={isLight ? "text-slate-900 font-medium" : "text-white"}>
                                {fmtPctPlain(row.weightPct)}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className={`text-sm ${isLight ? "text-slate-500" : "text-white/50"}`}>Top holdings data unavailable.</div>
                      )}
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>Allocation Breakdown</div>
                      <div className="space-y-3">
                        <div>
                          <div className={`text-[11px] uppercase mb-1 ${isLight ? "text-slate-500" : "text-white/55"}`}>Sector</div>
                          {Array.isArray(fundInsights?.sectorAllocation) && fundInsights.sectorAllocation.length > 0 ? (
                            <div className="space-y-1">
                              {fundInsights.sectorAllocation.slice(0, 5).map((row, idx) => (
                                <div key={`sector-${idx}`} className="flex items-center justify-between text-sm">
                                  <span className={isLight ? "text-slate-700" : "text-white/80"}>{row.name}</span>
                                  <span className={isLight ? "text-slate-900 font-medium" : "text-white"}>{fmtPctPlain(row.weightPct)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className={`text-sm ${isLight ? "text-slate-500" : "text-white/50"}`}>—</div>
                          )}
                        </div>
                        <div>
                          <div className={`text-[11px] uppercase mb-1 ${isLight ? "text-slate-500" : "text-white/55"}`}>Country</div>
                          {Array.isArray(fundInsights?.countryAllocation) && fundInsights.countryAllocation.length > 0 ? (
                            <div className="space-y-1">
                              {fundInsights.countryAllocation.slice(0, 5).map((row, idx) => (
                                <div key={`country-${idx}`} className="flex items-center justify-between text-sm">
                                  <span className={isLight ? "text-slate-700" : "text-white/80"}>{row.name}</span>
                                  <span className={isLight ? "text-slate-900 font-medium" : "text-white"}>{fmtPctPlain(row.weightPct)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className={`text-sm ${isLight ? "text-slate-500" : "text-white/50"}`}>—</div>
                          )}
                        </div>
                        <div>
                          <div className={`text-[11px] uppercase mb-1 ${isLight ? "text-slate-500" : "text-white/55"}`}>Bond Ratings</div>
                          {Array.isArray(fundInsights?.bondRatings) && fundInsights.bondRatings.length > 0 ? (
                            <div className="space-y-1">
                              {fundInsights.bondRatings.slice(0, 5).map((row, idx) => (
                                <div key={`bond-${idx}`} className="flex items-center justify-between text-sm">
                                  <span className={isLight ? "text-slate-700" : "text-white/80"}>{row.name}</span>
                                  <span className={isLight ? "text-slate-900 font-medium" : "text-white"}>{fmtPctPlain(row.weightPct)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className={`text-sm ${isLight ? "text-slate-500" : "text-white/50"}`}>—</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                    <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>ASTRA Fundamental Summary (Fund)</div>
                    <div className={`space-y-1.5 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                      <div>
                        Expense ratio ({fmtPctPlain(fundInsights?.overview?.expenseRatio)}) is the annual fee drag. Lower expense ratios generally preserve more investor return.
                      </div>
                      <div>
                        Net assets (${fmtLarge(fundInsights?.overview?.totalAssets)}) indicate fund scale and liquidity depth. Larger funds are often easier to trade.
                      </div>
                      <div>
                        NAV premium/discount formula: (Market Price - NAV) / NAV = {fmtPctSigned(fundInsights?.overview?.premiumToNavPct)}.
                        Premium means market price above NAV; discount means below NAV.
                      </div>
                      <div>
                        Performance view: YTD {fmtPctSigned(fundInsights?.overview?.ytdReturnPct)}, 1Y {fmtPctSigned(fundInsights?.overview?.oneYearReturnPct)},
                        3Y {fmtPctSigned(fundInsights?.overview?.threeYearReturnPct)}, 5Y {fmtPctSigned(fundInsights?.overview?.fiveYearReturnPct)}.
                        Compare these against the benchmark ({fundInsights?.overview?.benchmark || "not available"}).
                      </div>
                      <div>
                        Concentration risk can be checked via top holdings and sector/country weights. If one holding or sector dominates, portfolio volatility risk usually rises.
                      </div>
                      <div>
                        Bond-focused funds should also review bond ratings and duration; lower-rated bonds generally add yield and credit risk, while higher duration increases rate sensitivity.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {assetMode === "stock" && !isNarrativeMode && !fundInsights?.isFund && (secFundamentalsLoading || secFundamentals) && (
          <div className="mb-6">
            <Card
              title="Fundamental Data"
            >
              {secFundamentalsLoading ? (
                <div className={`text-sm animate-pulse ${isLight ? "text-slate-600" : "text-white/60"}`}>Loading fundamentals...</div>
              ) : (
                <>
                  <div className={`text-xs mb-4 ${isLight ? "text-slate-600" : "text-white/70"}`}>
                    {secFundamentals?.companyName || "—"} • CIK: {secFundamentals?.cik || "—"}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                    <div className={`rounded-xl border p-3 ${isLight ? "border-sky-200 bg-sky-50" : "border-sky-400/30 bg-sky-500/12"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Revenue</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>${fmtLarge(secFundamentals?.fundamentals?.revenue)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-emerald-200 bg-emerald-50" : "border-emerald-400/30 bg-emerald-500/12"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Net Income</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>${fmtLarge(secFundamentals?.fundamentals?.netIncome)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-violet-200 bg-violet-50" : "border-violet-400/30 bg-violet-500/12"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Operating Cash Flow</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>${fmtLarge(secFundamentals?.fundamentals?.operatingCashFlow)}</div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-amber-200 bg-amber-50" : "border-amber-400/30 bg-amber-500/12"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Free Cash Flow</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>${fmtLarge(secFundamentals?.fundamentals?.freeCashFlow)}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Short-Term Liquidity (Current Ratio)</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmt(secFundamentals?.highlights?.currentRatio) != null ? Number(secFundamentals.highlights.currentRatio).toFixed(2) : "—"}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Debt / Equity</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmt(secFundamentals?.highlights?.debtToEquity) != null ? Number(secFundamentals.highlights.debtToEquity).toFixed(2) : "—"}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Net Margin</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmtPct(secFundamentals?.highlights?.netMargin)}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Return on Assets (ROA)</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmtPct(secFundamentals?.highlights?.returnOnAssets)}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Return on Equity (ROE)</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmtPct(secFundamentals?.highlights?.returnOnEquity)}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Operating Margin</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmtPct(secFundamentals?.highlights?.operatingMargin)}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Free Cash Flow Margin</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmtPct(secFundamentals?.highlights?.freeCashFlowMargin)}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Interest Coverage</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmt(secFundamentals?.highlights?.interestCoverage) != null ? Number(secFundamentals.highlights.interestCoverage).toFixed(2) : "—"}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Revenue Growth (YoY)</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmtPct(secFundamentals?.highlights?.revenueGrowthYoY)}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Net Income Growth (YoY)</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {fmtPct(secFundamentals?.highlights?.netIncomeGrowthYoY)}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>Price / Sales (P/S)</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {(() => {
                          const marketCap =
                            fmt(company?.marketCapitalization) != null
                              ? Number(company.marketCapitalization) * 1e6
                              : fmt(fundamentals?.marketCap) != null
                                ? Number(fundamentals.marketCap)
                                : null;
                          const revenue = secFundamentals?.fundamentals?.revenue;
                          if (marketCap == null || !revenue) return "—";
                          return Number(marketCap / revenue).toFixed(2);
                        })()}
                      </div>
                    </div>
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className={`text-[11px] uppercase tracking-wide ${isLight ? "text-slate-600" : "text-white/65"}`}>EV / EBITDA</div>
                      <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>
                        {(() => {
                          const marketCap =
                            fmt(company?.marketCapitalization) != null
                              ? Number(company.marketCapitalization) * 1e6
                              : fmt(fundamentals?.marketCap) != null
                                ? Number(fundamentals.marketCap)
                                : null;
                          const totalDebt = secFundamentals?.fundamentals?.totalDebt;
                          const cash = secFundamentals?.fundamentals?.cash;
                          const ebitda = secFundamentals?.fundamentals?.ebitda;
                          if (marketCap == null || ebitda == null || ebitda === 0) return "—";
                          const ev = marketCap + (totalDebt || 0) - (cash || 0);
                          return Number(ev / ebitda).toFixed(2);
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3">
                    <div className={`rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className={`text-xs font-semibold ${isLight ? "text-slate-700" : "text-white/85"}`}>Balance Sheet Snapshot</div>
                        <a
                          href={`https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(secFundamentals?.cik || secFundamentals?.symbol || "")}&owner=exclude`}
                          target="_blank"
                          rel="noreferrer"
                          className={`text-[11px] underline ${isLight ? "text-blue-700" : "text-blue-300"}`}
                        >
                          View full financials
                        </a>
                      </div>
                      <div className={`space-y-1 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                        <div>Assets: ${fmtLarge(secFundamentals?.fundamentals?.assets)}</div>
                        <div>Liabilities: ${fmtLarge(secFundamentals?.fundamentals?.liabilities)}</div>
                        <div>Equity: ${fmtLarge(secFundamentals?.fundamentals?.equity)}</div>
                        <div>Total Debt: ${fmtLarge(secFundamentals?.fundamentals?.totalDebt)}</div>
                        <div>Cash: ${fmtLarge(secFundamentals?.fundamentals?.cash)}</div>
                        <div>Shares Outstanding: {fmtLarge(secFundamentals?.fundamentals?.sharesOutstanding)}</div>
                      </div>
                    </div>
                  </div>

                  <div className={`mt-3 rounded-xl border p-3 ${isLight ? "border-slate-300 bg-white" : "border-white/10 bg-white/5"}`}>
                    <div className={`text-xs font-semibold mb-2 ${isLight ? "text-slate-700" : "text-white/85"}`}>ASTRA Fundamental Summary</div>
                    <div className={`space-y-1.5 text-sm ${isLight ? "text-slate-700" : "text-white/75"}`}>
                      <div>
                        Revenue (${fmtLarge(secFundamentals?.fundamentals?.revenue)}) and Net Income (${fmtLarge(secFundamentals?.fundamentals?.netIncome)}) show business scale and profitability.
                      </div>
                      <div>
                        Net Margin formula: Net Income / Revenue = {fmtPct(secFundamentals?.highlights?.netMargin)}. Higher margins usually mean stronger operating efficiency.
                      </div>
                      <div>
                        Short-Term Liquidity formula (Current Ratio): Current Assets / Current Liabilities = {fmt(secFundamentals?.highlights?.currentRatio) != null ? Number(secFundamentals.highlights.currentRatio).toFixed(2) : "—"}.
                        Above 1.0 generally means healthier short-term liquidity.
                      </div>
                      <div>
                        Debt to Equity formula: Total Debt / Equity = {fmt(secFundamentals?.highlights?.debtToEquity) != null ? Number(secFundamentals.highlights.debtToEquity).toFixed(2) : "—"}.
                        Lower leverage usually means lower balance-sheet risk.
                      </div>
                      <div>
                        Return on Assets formula: Net Income / Total Assets = {fmtPct(secFundamentals?.highlights?.returnOnAssets)}.
                        This shows how effectively the company converts assets into earnings.
                      </div>
                      <div>
                        Return on Equity formula: Net Income / Equity = {fmtPct(secFundamentals?.highlights?.returnOnEquity)}.
                        This reflects shareholder return efficiency.
                      </div>
                      <div>
                        Operating Margin formula: Operating Income / Revenue = {fmtPct(secFundamentals?.highlights?.operatingMargin)}.
                        This shows profitability from core operations before financing/taxes.
                      </div>
                      <div>
                        Free Cash Flow formula: Operating Cash Flow - Capital Expenditures = ${fmtLarge(secFundamentals?.fundamentals?.freeCashFlow)}.
                        Positive free cash flow supports reinvestment, debt repayment, and resilience.
                      </div>
                      <div>
                        Free Cash Flow Margin formula: Free Cash Flow / Revenue = {fmtPct(secFundamentals?.highlights?.freeCashFlowMargin)}.
                        This shows how much real cash is generated per dollar of sales.
                      </div>
                      <div>
                        Interest Coverage formula: Operating Income / Interest Expense = {fmt(secFundamentals?.highlights?.interestCoverage) != null ? Number(secFundamentals.highlights.interestCoverage).toFixed(2) : "—"}.
                        Higher coverage indicates better ability to service debt.
                      </div>
                      <div>
                        Revenue Growth (YoY) = {fmtPct(secFundamentals?.highlights?.revenueGrowthYoY)} and Net Income Growth (YoY) = {fmtPct(secFundamentals?.highlights?.netIncomeGrowthYoY)}.
                        Growth trends indicate expansion momentum and earnings quality.
                      </div>
                      <div>
                        Price / Sales formula: Market Cap / Revenue = {(() => {
                          const marketCap =
                            fmt(company?.marketCapitalization) != null
                              ? Number(company.marketCapitalization) * 1e6
                              : fmt(fundamentals?.marketCap) != null
                                ? Number(fundamentals.marketCap)
                                : null;
                          const revenue = secFundamentals?.fundamentals?.revenue;
                          if (marketCap == null || !revenue) return "—";
                          return Number(marketCap / revenue).toFixed(2);
                        })()}.
                        Useful for comparing valuation against top-line scale.
                      </div>
                      <div>
                        EV / EBITDA formula: (Market Cap + Total Debt - Cash) / EBITDA = {(() => {
                          const marketCap =
                            fmt(company?.marketCapitalization) != null
                              ? Number(company.marketCapitalization) * 1e6
                              : fmt(fundamentals?.marketCap) != null
                                ? Number(fundamentals.marketCap)
                                : null;
                          const totalDebt = secFundamentals?.fundamentals?.totalDebt;
                          const cash = secFundamentals?.fundamentals?.cash;
                          const ebitda = secFundamentals?.fundamentals?.ebitda;
                          if (marketCap == null || ebitda == null || ebitda === 0) return "—";
                          const ev = marketCap + (totalDebt || 0) - (cash || 0);
                          return Number(ev / ebitda).toFixed(2);
                        })()}.
                        Common cross-company valuation measure for capital-intensive businesses.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {/* ANALYTICAL INFORMATION */}
        {!isNarrativeMode && (analysisLoading || analysisObj) && (
          <div className="mb-6">
            <Card
              title={tx("ASTRA Analysis")}
              right={
                <div className="flex items-center gap-2">
                  <button
                    onClick={copyAnalysis}
                    className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11px]"
                  >
                    {tx("Copy")}
                  </button>
                  <button
                    onClick={shareAnalysis}
                    className="px-2.5 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11px]"
                  >
                    {tx("Share")}
                  </button>
                  <Badge value={analysisView.recommendation} light={isLight} />
                </div>
              }
            >
              {analysisLoading ? (
                <div className="text-white/50 text-sm animate-pulse">{tx("Analyzing...")}</div>
              ) : (
                <>
                  {analysisView.ticker && (
                    <div className="text-sm text-white/80 mb-3 flex flex-wrap items-center gap-2">
                      <span>Ticker: {analysisView.ticker}</span>
                      {analysisView.aiScore > 0 && (
                        <span className="text-[11px] rounded-full border border-cyan-400/30 bg-cyan-500/15 text-cyan-200 px-2 py-0.5">
                          {tx("Analytical Score")} {analysisView.aiScore}/100
                        </span>
                      )}
                      {analysisView.confidence > 0 && (
                        <span className="text-[11px] rounded-full border border-blue-400/30 bg-blue-500/15 text-blue-200 px-2 py-0.5">
                          {tx("Confidence")} {analysisView.confidence}%
                        </span>
                      )}
                      {analysisView.horizon && (
                        <span className="text-[11px] rounded-full border border-indigo-400/30 bg-indigo-500/15 text-indigo-200 px-2 py-0.5">
                          Horizon {analysisView.horizon === "LONG_TERM" ? "Long Term" : "Short Term"}
                        </span>
                      )}
                      {analysisView.riskLevel && (
                        <span
                          className={`text-[11px] rounded-full border px-2 py-0.5 ${
                            analysisView.riskLevel === "LOW"
                              ? "border-green-400/30 bg-green-500/15 text-green-200"
                              : analysisView.riskLevel === "MEDIUM"
                                ? "border-yellow-400/30 bg-yellow-500/15 text-yellow-200"
                                : "border-red-400/30 bg-red-500/15 text-red-200"
                          }`}
                        >
                          {tx("Risk")} {analysisView.riskLevel}
                        </span>
                      )}
                    </div>
                  )}

                  {(analysisView.shortSummary || analysisView.longSummary) && (
                    <div className="mb-4">
                      <div className="inline-flex rounded-lg overflow-hidden border border-white/10 mb-2">
                        <button
                          onClick={() => setAnalysisViewMode("short")}
                          className={`px-2.5 py-1 text-[11px] ${analysisViewMode === "short" ? "bg-blue-600 text-white" : "bg-white/5 text-white/80"}`}
                        >
                          {tx("Short")}
                        </button>
                        <button
                          onClick={() => setAnalysisViewMode("long")}
                          className={`px-2.5 py-1 text-[11px] ${analysisViewMode === "long" ? "bg-blue-600 text-white" : "bg-white/5 text-white/80"}`}
                        >
                          {tx("Detailed")}
                        </button>
                      </div>
                      <div className="text-sm text-white/90 whitespace-pre-line">
                        {analysisViewMode === "long"
                          ? analysisView.longSummary || analysisView.shortSummary
                          : analysisView.shortSummary || analysisView.longSummary}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="text-xs text-white/60 mb-1">{tx("Bull vs Bear Probability")}</div>
                      <div className="text-sm text-green-300">{tx("Bull")}: {analysisView.bullProbability}%</div>
                      <div className="text-sm text-red-300">{tx("Bear")}: {analysisView.bearProbability}%</div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                      <div className="text-xs text-white/60 mb-1">{tx("Risk Assessment")}</div>
                      <div className="text-sm text-white/90">
                        {analysisView.riskExplanation || "Risk reflects volatility, valuation, and event exposure."}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-4">
                    <div className="text-xs text-white/60 mb-2">{tx("Analytical Reasoning Categories")}</div>
                    <div className="space-y-2 text-sm">
                      {[
                        ["Fundamental", analysisView.reasoningCategories.fundamental],
                        ["Technical", analysisView.reasoningCategories.technical],
                        ["Sentiment", analysisView.reasoningCategories.sentiment],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <div className="flex justify-between text-xs text-white/70">
                            <span>{label}</span>
                            <span>{Number(value).toFixed(0)}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-white/10 mt-1">
                            <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${value}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {analysisView.strengths.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">{tx("Strengths")}</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {analysisView.strengths.slice(0, 4).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysisView.why.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">{tx("Why")}</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {analysisView.why.slice(0, 6).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysisView.risks.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs text-white/60 mb-2">{tx("Risks")}</div>
                      <ul className="list-disc pl-5 text-sm text-white/90 space-y-1">
                        {analysisView.risks.slice(0, 3).map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {analysisView.dayPlan && (
                    <div className="mb-2">
                      <div className="text-xs text-white/60 mb-2">{tx("Day plan")}</div>
                      <div className="text-sm text-white/90">{analysisView.dayPlan}</div>
                    </div>
                  )}

                  {analysisView.outlook && (
                    <div className="mb-2">
                      <div className="text-xs text-white/60 mb-2">{tx("Outlook")}</div>
                      <div className="text-sm text-white/90">{analysisView.outlook}</div>
                    </div>
                  )}

                  {analysisView.note && <div className="text-xs text-white/55 mt-4">{analysisView.note}</div>}

                  {analysisView.fallbackText && (
                    <div className="text-xs text-white/50 mt-4 whitespace-pre-line">{analysisView.fallbackText}</div>
                  )}
                </>
              )}
            </Card>
          </div>
        )}

        {/* NEWS */}
        {!isNarrativeMode && news.length > 0 && (
          <div className="mb-6">
            <Card title={tx("Latest News")}>
              <div className="space-y-3">
                {latestNewsDigest && <SummaryPanel label={tx("Summary")} text={latestNewsDigest} isLight={isLight} />}
                {localizedNewsWithSummary.map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noreferrer" className={`block rounded-lg border p-2.5 ${isLight ? "border-slate-200 bg-white hover:bg-slate-50" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.07]"}`}>
                    <div className={`text-sm font-medium hover:underline ${isLight ? "text-blue-700" : "text-blue-300"}`}>• {n.headlineDisplay}</div>
                    <div className={`mt-1 text-xs leading-relaxed ${isLight ? "text-slate-600" : "text-white/65"}`}>{n.laymanSummary}</div>
                  </a>
                ))}
              </div>
            </Card>
          </div>
        )}

          <p className="text-center text-[11px] text-white/40 mt-8">
            For informational purposes only. This platform does not provide financial, investment, legal, tax, or accounting advice. All decisions and outcomes are solely your responsibility.
          </p>
        </div>
      </div>

      {/* FLOATING ASTRA CHAT */}
      <div className="fixed bottom-5 right-5 z-50">
        {chatOpen ? (
          <div
            className={`w-[92vw] max-w-sm sm:max-w-md rounded-2xl shadow-2xl overflow-hidden ${
              isLight ? "border border-slate-300 bg-white" : "border border-white/15 bg-[#0e1015]"
            }`}
          >
            <div className={`flex items-center justify-between px-4 py-3 ${isLight ? "border-b border-slate-200 bg-slate-50" : "border-b border-white/10 bg-white/[0.04]"}`}>
              <div>
                <div className={`text-sm font-semibold ${isLight ? "text-slate-900" : "text-white"}`}>ASTRA Virtual Assistant</div>
                <div className={`text-[11px] ${isLight ? "text-slate-500" : "text-white/55"}`}>
                  {usingTicker ? `Context (${currentTabLabel}): ${usingTicker}` : "Context optional. Ask anything."}
                </div>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className={`h-8 w-8 rounded-full ${isLight ? "bg-slate-200 hover:bg-slate-300 text-slate-700" : "bg-white/10 hover:bg-white/15 text-white/80"}`}
                aria-label="Close chat"
              >
                x
              </button>
            </div>

            <div className="h-80 overflow-y-auto p-3 space-y-3">
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line leading-relaxed ${
                      m.role === "user"
                        ? "bg-blue-600 text-white"
                        : isLight
                          ? "bg-slate-100 text-slate-900 border border-slate-200"
                          : "bg-white/10 text-white/90 border border-white/10"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex justify-start">
                  <div
                    className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                      isLight ? "bg-slate-100 text-slate-600 border border-slate-200" : "bg-white/10 text-white/75 border border-white/10"
                    }`}
                  >
                    ASTRA is thinking...
                  </div>
                </div>
              )}
            </div>

            <div className={`p-3 flex gap-2 ${isLight ? "border-t border-slate-200" : "border-t border-white/10"}`}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
                placeholder={chatInputPlaceholder}
                className="flex-1 px-3 py-2 rounded-xl bg-white text-black border-2 border-white/20 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              />
              <button
                onClick={sendChatMessage}
                disabled={chatLoading || !chatInput.trim()}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold disabled:opacity-50"
              >
                Send
              </button>
            </div>
            <div className={`px-3 pb-3 text-[10px] leading-relaxed ${isLight ? "text-slate-500" : "text-white/45"}`}>
              For informational purposes only. This platform does not provide financial, investment, legal, tax, or accounting advice. All decisions and outcomes are solely your responsibility.
            </div>
          </div>
        ) : (
          <button
            onClick={() => setChatOpen(true)}
            className="h-14 w-14 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold tracking-wide shadow-xl border border-blue-400/40"
          >
            ASTRA
          </button>
        )}
      </div>
    </div>
  );
}
