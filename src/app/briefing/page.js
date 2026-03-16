"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SakuraThemeBackground from "@/components/SakuraThemeBackground";

// ── Helpers ────────────────────────────────────────────────────────────────

function safeDomain(rawUrl) {
  try { return new URL(String(rawUrl || "")).hostname.replace(/^www\./, ""); } catch { return ""; }
}

function toShortDate(value) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function toTimeAgo(value) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 48) return toShortDate(value);
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "Just now";
}

function fmtNextPublish(iso) {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isToday) return `Today at ${time}`;
  if (isTomorrow) return `Tomorrow at ${time}`;
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }) + ` at ${time}`;
}

function sectionByKey(data, key) {
  const rows = Array.isArray(data?.sections) ? data.sections : [];
  return rows.find((s) => s.key === key) || { key, title: key, items: [] };
}

function cleanText(t) {
  // Frontend safety net: strip any leftover HTML entities or tags that slipped through
  return String(t || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d{1,6});/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return " "; } })
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return " "; } })
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/&ndash;/gi, "–").replace(/&mdash;/gi, "—")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ").trim();
}

function dekFromItem(item) {
  const raw = cleanText(String(item?.summary || "").trim());
  if (raw) return raw;
  const h = cleanText(String(item?.headline || "").trim());
  return h.length > 180 ? `${h.slice(0, 177).trim()}...` : h;
}

function fmtPulseValue(p) {
  const v = Number(p?.value);
  if (!Number.isFinite(v)) return "--";
  if (["btc", "eth"].includes(p?.key)) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (["wti", "gold", "silver", "copper", "natgas"].includes(p?.key)) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (["sp500", "nasdaq"].includes(p?.key)) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (p?.key === "us10y") return `${v.toFixed(2)}${p?.suffix || ""}`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function fmtPulseDelta(p) {
  const d = Number(p?.changePct);
  if (!Number.isFinite(d)) return "--";
  return `${d > 0 ? "+" : ""}${d.toFixed(2)}%`;
}

function editionNumber() {
  return String(Math.floor((Date.now() - new Date("2024-01-01").getTime()) / 86400000) + 1).padStart(4, "0");
}

function todayLong() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

const PULSE_GROUPS = [
  { label: "Equities", keys: ["sp500", "nasdaq", "vix"] },
  { label: "Rates & FX", keys: ["us10y", "dxy", "eurusd", "gbpusd", "usdjpy"] },
  { label: "Commodities", keys: ["wti", "natgas", "gold", "silver", "copper"] },
  { label: "Crypto", keys: ["btc", "eth"] },
];

const SECTION_ORDER = ["us", "global", "crypto", "fx", "metals", "energy", "funds", "geopolitics", "war"];

const SECTION_COLOR = {
  us: "#1a3a6b", global: "#1a5c1a", crypto: "#4a1a6b", fx: "#6b5a1a",
  metals: "#5c3d1a", energy: "#6b1a1a", funds: "#1a4a4a", geopolitics: "#3a1a6b", war: "#6b1a2a",
};

// ── Sub-components ─────────────────────────────────────────────────────────

function ArticlePhoto({ item, section, className = "" }) {
  const hasImg = String(item?.image || "").startsWith("http");
  const color = SECTION_COLOR[section] || "#333";
  const initial = (item?.source || safeDomain(item?.url) || "?")[0].toUpperCase();
  if (hasImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.image} alt={item.headline || "Article image"} className={`w-full h-full object-cover ${className}`} loading="lazy" />
    );
  }
  return (
    <div className={`w-full h-full flex items-center justify-center ${className}`} style={{ background: color }}>
      <span className="text-white text-3xl font-black opacity-50" style={{ fontFamily: "ui-serif, Georgia, serif" }}>{initial}</span>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function BriefingPage() {
  const [theme, setTheme] = useState("dark");
  const [cadence, setCadence] = useState("daily");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (["dark", "light", "cherry", "azula", "alerik", "lylah"].includes(saved)) setTheme(saved);
    } catch {}
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/briefing?cadence=${encodeURIComponent(cadence)}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
        if (!active) return;
        setData(body);
      } catch (e) {
        if (!active) return;
        setError(String(e?.message || "Failed to load briefing"));
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [cadence]);

  const isCherry = theme === "cherry";
  const isAzula = theme === "azula";
  const isLylah = theme === "lylah";
  const isLight = theme === "light" || isCherry || isAzula || isLylah;
  const pageClass = isLylah ? "lylah-mode bg-[#faf8ff] text-[#120228]" : isLight ? "bg-[#f7f4ef] text-[#1f1b16]" : "bg-[#050a1a] text-[#f3f8ff]";
  const shellClass = isLight ? "border-[#d9d0c3] bg-[#fffdf8]" : "border-[#1c355f] bg-[linear-gradient(180deg,#07152f_0%,#050f23_100%)]";
  const strokeClass = isLight ? "border-[#d9d0c3]" : "border-[#17345f]";
  const mutedClass = isLight ? "text-[#6b655d]" : "text-[#98a6bf]";
  const accentClass = isLight ? "text-[#7f2d0f]" : "text-[#8ee7ff]";

  const np = isLight
    ? {
        bg: "#f5f0e8", text: "#1a1208", paper: "#faf7f0",
        rule: "#1a1208", ruleLight: "#c8bfad", muted: "#5a5040",
        accent: "#8b0000", sectionBg: "#1a1208", sectionText: "#f5f0e8",
        ticker: { bg: "#1a1208", text: "#f5f0e8", border: "#3a2e1e" },
        up: "#1a5c1a", down: "#8b0000", pullBg: "#1a1208", pullText: "#f5f0e8",
      }
    : {
        bg: "#0d0d0f", text: "#e8e0d0", paper: "#111115",
        rule: "#e8e0d0", ruleLight: "#2e2a22", muted: "#8a8070",
        accent: "#c8a86a", sectionBg: "#e8e0d0", sectionText: "#0d0d0f",
        ticker: { bg: "#e8e0d0", text: "#0d0d0f", border: "#2e2a22" },
        up: "#4caf72", down: "#e05555", pullBg: "#e8e0d0", pullText: "#0d0d0f",
      };

  const serif = { fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" };

  const allSections = useMemo(() => {
    if (!data?.sections) return [];
    return SECTION_ORDER.map((k) => sectionByKey(data, k)).filter((s) => Array.isArray(s?.items) && s.items.length > 0);
  }, [data]);

  const hero = useMemo(() => {
    for (const key of ["us", "global", "energy", "geopolitics", "war", "crypto", "fx", "metals", "funds"]) {
      const sec = allSections.find((s) => s.key === key);
      if (sec?.items?.length > 0) return { item: sec.items[0], section: sec.key };
    }
    return null;
  }, [allSections]);

  const frontPageDeck = useMemo(() => {
    const pool = allSections.flatMap((s) => s.items.map((item) => ({ item, section: s.key }))).slice(0, 8);
    if (!hero) return pool.slice(0, 6);
    return pool.filter((x) => x.item.url !== hero.item.url).slice(0, 6);
  }, [allSections, hero]);

  const pulse = Array.isArray(data?.pulse) ? data.pulse : [];
  const pulseMap = new Map(pulse.map((p) => [p.key, p]));
  const astraSummary = Array.isArray(data?.summary?.bullets) ? data.summary.bullets : [];
  const astraDeck = String(data?.summary?.deck || "").trim();
  const astraHighlights = Array.isArray(data?.summary?.highlights) ? data.summary.highlights : [];

  return (
    <div style={{ minHeight: "100vh", background: np.bg, color: np.text }}>
      {isCherry && <SakuraThemeBackground />}

      {/* ── TICKER ───────────────────────────────────────────────────────── */}
      <div style={{ background: np.ticker.bg, color: np.ticker.text, borderBottom: `1px solid ${np.ticker.border}` }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 0, overflowX: "auto" }} className="no-scrollbar">
            {PULSE_GROUPS.map((group, gi) => (
              <div key={group.label} style={{ display: "flex", alignItems: "center", padding: "6px 0", borderRight: gi < PULSE_GROUPS.length - 1 ? `1px solid ${np.ticker.border}` : "none", marginRight: 12, paddingRight: 12, gap: 16, flexShrink: 0 }}>
                <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", opacity: 0.5, whiteSpace: "nowrap" }}>{group.label}</span>
                {group.keys.map((key) => {
                  const p = pulseMap.get(key);
                  if (!p) return null;
                  const d = Number(p?.changePct);
                  const upDown = Number.isFinite(d) ? (d > 0 ? np.up : d < 0 ? np.down : np.muted) : np.muted;
                  const arrow = Number.isFinite(d) ? (d > 0 ? "▲" : d < 0 ? "▼" : "—") : "";
                  return (
                    <div key={key} style={{ display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.15em", opacity: 0.65 }}>{p.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmtPulseValue(p)}</span>
                      <span style={{ fontSize: 10, color: upDown, fontVariantNumeric: "tabular-nums" }}>{arrow} {fmtPulseDelta(p)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingLeft: 12, borderLeft: `1px solid ${np.ticker.border}`, flexShrink: 0 }}>
              <button
                onClick={() => setCadence("daily")}
                style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", padding: "4px 8px", opacity: cadence === "daily" ? 1 : 0.45, textDecoration: cadence === "daily" ? "underline" : "none", background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
              >Daily</button>
              <span style={{ opacity: 0.3 }}>|</span>
              <button
                onClick={() => setCadence("weekly")}
                style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", padding: "4px 8px", opacity: cadence === "weekly" ? 1 : 0.45, textDecoration: cadence === "weekly" ? "underline" : "none", background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
              >Weekly</button>
              <span style={{ opacity: 0.3 }}>|</span>
              <Link
                href="/home"
                style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", padding: "4px 10px", background: np.ticker.text, color: np.ticker.bg, textDecoration: "none", whiteSpace: "nowrap" }}
              >
                ← Home
              </Link>
            </div>
          </div>
        </div>
      </div>

      <main style={{ maxWidth: 1400, margin: "0 auto", padding: "0 16px" }}>

        {/* ── MASTHEAD ─────────────────────────────────────────────────────── */}
        <div style={{ paddingTop: 24, paddingBottom: 8, textAlign: "center" }}>
          <div style={{ borderTop: `3px solid ${np.rule}`, marginBottom: 2 }} />
          <div style={{ borderTop: `1px solid ${np.rule}`, marginBottom: 20 }} />

          <h1 style={{ ...serif, fontSize: "clamp(48px, 10vw, 104px)", lineHeight: 1, fontWeight: 900, letterSpacing: "-0.02em", margin: 0 }}>
            THE ARTHASTRA
          </h1>

          {/* Edition info row */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <div style={{ flex: 1, borderTop: `1px solid ${np.rule}` }} />
            <div style={{ display: "flex", alignItems: "center", gap: 12, color: np.muted, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", flexWrap: "wrap", justifyContent: "center" }}>
              <span>{todayLong()}</span>
              <span>·</span>
              <span style={{ fontWeight: 700, color: np.text }}>{cadence === "weekly" ? "Weekly Edition" : "Daily Edition"}</span>
              <span>·</span>
              <span>No. {editionNumber()}</span>
              {data?.generatedAt && <><span>·</span><span>Published {toTimeAgo(data.generatedAt)}</span></>}
              {data?.nextPublishAt && <><span>·</span><span style={{ color: np.accent }}>Next: {fmtNextPublish(data.nextPublishAt)}</span></>}
            </div>
            <div style={{ flex: 1, borderTop: `1px solid ${np.rule}` }} />
          </div>

          {/* Section tabs row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginTop: 10, flexWrap: "wrap" }}>
            {["U.S. Markets", "Global Mkts", "Crypto", "FX", "Metals", "Energy", "Funds", "Geopolitics", "War & Conflict"].map((label) => (
              <span key={label} style={{ fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", color: np.muted }}>{label}</span>
            ))}
          </div>

          <div style={{ borderTop: `3px solid ${np.rule}`, marginTop: 12 }} />
        </div>

        {/* ── LOADING / ERROR ───────────────────────────────────────────────── */}
        {loading && (
          <div style={{ padding: "80px 0", textAlign: "center", color: np.muted }}>
            <p style={{ ...serif, fontSize: 28, fontWeight: 900 }}>Setting type…</p>
            <p style={{ fontSize: 11, letterSpacing: "0.25em", textTransform: "uppercase", marginTop: 8 }}>
              {cadence === "daily" ? "Compiling today's Arthastra — covers last 24 hours" : "Compiling this week's Arthastra — covers last 7 days"}
            </p>
          </div>
        )}
        {error && <div style={{ padding: 32, textAlign: "center", color: "#e05555", fontSize: 14 }}>{error}</div>}

        {!loading && !error && (
          <>
            {/* ── FRONT PAGE ─────────────────────────────────────────────────── */}
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0,3fr) minmax(0,6fr) minmax(0,3fr)", gap: 0, marginTop: 16 }}
              className="front-page-grid">

              {/* LEFT RAIL — Section index */}
              <aside style={{ borderRight: `1px solid ${np.rule}`, paddingRight: 16 }} className="hide-mobile">
                <div style={{ background: np.sectionBg, color: np.sectionText, padding: "4px 8px", fontSize: 10, fontWeight: 900, letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 12 }}>
                  In This Edition
                </div>
                {allSections.map((sec) => (
                  <div key={`idx-${sec.key}`} style={{ padding: "10px 0", borderBottom: `1px solid ${np.ruleLight}` }}>
                    <p style={{ ...serif, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", margin: "0 0 3px 0" }}>{sec.title}</p>
                    <p style={{ ...serif, fontSize: 11, lineHeight: 1.4, color: np.muted, margin: 0, WebkitLineClamp: 2, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" }}>
                      {dekFromItem(sec.items[0])?.split("Why it matters:")[0].trim()}
                    </p>
                    <p style={{ fontSize: 9, color: np.muted, opacity: 0.6, marginTop: 3 }}>{sec.items.length} stor{sec.items.length === 1 ? "y" : "ies"}</p>
                  </div>
                ))}
                {String(data?.theme || "").trim() && (
                  <div style={{ marginTop: 12, padding: 10, border: `1px solid ${np.rule}` }}>
                    <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", color: np.muted, marginBottom: 4 }}>Edition Theme</p>
                    <p style={{ ...serif, fontSize: 11, lineHeight: 1.5, margin: 0 }}>{data.theme}</p>
                  </div>
                )}
              </aside>

              {/* CENTER — Hero story */}
              <div style={{ borderRight: `1px solid ${np.rule}`, padding: "0 20px" }} className="hero-col">
                {hero ? (
                  <>
                    <div style={{ background: np.sectionBg, color: np.sectionText, padding: "4px 8px", fontSize: 10, fontWeight: 900, letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 12, textAlign: "center" }}>
                      Front Page
                    </div>
                    <a href={hero.item.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                      <h2 style={{ ...serif, fontSize: "clamp(22px, 3vw, 36px)", lineHeight: 1.05, fontWeight: 900, margin: "0 0 6px 0", textAlign: "center" }}>
                        {cleanText(hero.item.headline)}
                      </h2>
                    </a>
                    <p style={{ ...serif, textAlign: "center", fontSize: 11, color: np.muted, margin: "0 0 10px 0" }}>
                      By {hero.item.source || safeDomain(hero.item.url)} — {toShortDate(hero.item.datetime)}
                    </p>

                    <div style={{ borderTop: `1px solid ${np.rule}`, marginBottom: 12 }} />

                    {/* Hero image */}
                    <div style={{ width: "100%", height: 280, overflow: "hidden", marginBottom: 12 }}>
                      <ArticlePhoto item={hero.item} section={hero.section} />
                    </div>

                    {/* Hero dek — show the summary up to "Why it matters" */}
                    {dekFromItem(hero.item) && (
                      <p style={{ ...serif, fontSize: 14, lineHeight: 1.7, color: np.muted, textAlign: "justify", margin: "0 0 6px 0" }}>
                        {dekFromItem(hero.item).split("Why it matters:")[0].trim()}
                      </p>
                    )}
                    {/* Why it matters */}
                    {dekFromItem(hero.item).includes("Why it matters:") && (
                      <p style={{ ...serif, fontSize: 12, lineHeight: 1.6, color: np.accent, margin: "4px 0 0 0", fontStyle: "italic" }}>
                        {dekFromItem(hero.item).split("Why it matters:")[1]?.split("What to watch:")[0]?.trim()}
                      </p>
                    )}

                    <div style={{ borderTop: `2px solid ${np.rule}`, marginTop: 16, marginBottom: 0 }} />

                    {/* Front page sub-stories 2-col */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                      {frontPageDeck.slice(0, 4).map((x, idx) => (
                        <a
                          key={`fp-${idx}`}
                          href={x.item.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "block", padding: "12px 8px", borderBottom: `1px solid ${np.ruleLight}`, borderRight: idx % 2 === 0 ? `1px solid ${np.ruleLight}` : "none", textDecoration: "none", color: "inherit" }}
                        >
                          {/* Small thumbnail */}
                          <div style={{ width: "100%", height: 90, overflow: "hidden", marginBottom: 6 }}>
                            <ArticlePhoto item={x.item} section={x.section} />
                          </div>
                          <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", color: np.accent, margin: "0 0 3px 0" }}>
                            {x.item.source || safeDomain(x.item.url)} · {x.section.toUpperCase()}
                          </p>
                          <p style={{ ...serif, fontSize: 13, fontWeight: 900, lineHeight: 1.25, margin: 0 }}>{cleanText(x.item.headline)}</p>
                          <p style={{ ...serif, fontSize: 11, lineHeight: 1.45, color: np.muted, margin: "4px 0 0 0", WebkitLineClamp: 3, overflow: "hidden", display: "-webkit-box", WebkitBoxOrient: "vertical" }}>
                            {dekFromItem(x.item).split("Why it matters:")[0].trim()}
                          </p>
                        </a>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ padding: "64px 0", textAlign: "center", color: np.muted, ...serif }}>No lead story available.</div>
                )}
              </div>

              {/* RIGHT RAIL */}
              <aside style={{ paddingLeft: 16 }} className="hide-mobile">
                <div style={{ background: np.sectionBg, color: np.sectionText, padding: "4px 8px", fontSize: 10, fontWeight: 900, letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 12 }}>
                  Also This Edition
                </div>
                {frontPageDeck.slice(4).map((x, idx) => (
                  <a
                    key={`rail-${idx}`}
                    href={x.item.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "block", paddingBottom: 10, marginBottom: 0, borderBottom: `1px solid ${np.ruleLight}`, paddingTop: 10, textDecoration: "none", color: "inherit" }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 8 }}>
                      <div style={{ width: 72, height: 52, overflow: "hidden", flexShrink: 0 }}>
                        <ArticlePhoto item={x.item} section={x.section} />
                      </div>
                      <div>
                        <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", color: np.accent, margin: "0 0 2px 0" }}>{x.item.source || safeDomain(x.item.url)}</p>
                        <p style={{ ...serif, fontSize: 12, fontWeight: 900, lineHeight: 1.3, margin: 0 }}>{cleanText(x.item.headline)}</p>
                      </div>
                    </div>
                  </a>
                ))}

                {/* Market snapshot box */}
                {pulse.length > 0 && (
                  <div style={{ marginTop: 16, border: `1px solid ${np.rule}`, padding: 10 }}>
                    <p style={{ ...serif, fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", textAlign: "center", borderBottom: `1px solid ${np.rule}`, paddingBottom: 6, marginBottom: 8, margin: "0 0 8px 0" }}>
                      Market Snapshot
                    </p>
                    {["sp500", "nasdaq", "vix", "us10y", "dxy", "wti", "gold", "btc"].map((key) => {
                      const p = pulseMap.get(key);
                      if (!p) return null;
                      const d = Number(p?.changePct);
                      const upDown = Number.isFinite(d) ? (d > 0 ? np.up : d < 0 ? np.down : np.muted) : np.muted;
                      return (
                        <div key={`snap-${key}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "4px 0", borderBottom: `1px solid ${np.ruleLight}`, fontSize: 11 }}>
                          <span style={{ ...serif, fontWeight: 700 }}>{p.label}</span>
                          <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                            <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{fmtPulseValue(p)}</span>
                            <span style={{ fontSize: 10, color: upDown, fontVariantNumeric: "tabular-nums" }}>{fmtPulseDelta(p)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </aside>
            </div>

            {/* ── SECTION DIVIDER ─────────────────────────────────────────────── */}
            <div style={{ marginTop: 24 }}>
              <div style={{ borderTop: `3px solid ${np.rule}` }} />
              <div style={{ borderTop: `1px solid ${np.rule}`, marginTop: 2 }} />
            </div>

            {/* ── SECTION PAGES ────────────────────────────────────────────────── */}
            {allSections.map((section, sIdx) => (
              <div key={section.key} style={{ marginTop: 24, paddingBottom: sIdx < allSections.length - 1 ? 24 : 0, borderBottom: sIdx < allSections.length - 1 ? `1px solid ${np.rule}` : "none" }}>
                {/* Section nameplate */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <div style={{ background: np.sectionBg, color: np.sectionText, padding: "5px 16px", fontSize: 13, fontWeight: 900, letterSpacing: "0.25em", textTransform: "uppercase", flexShrink: 0, ...serif }}>
                    {section.title}
                  </div>
                  <div style={{ flex: 1, borderTop: `1px solid ${np.rule}` }} />
                  <span style={{ fontSize: 9, color: np.muted, flexShrink: 0, letterSpacing: "0.1em" }}>
                    {cadence === "daily" ? "Last 24 Hours" : "Last 7 Days"} · {section.items.length} article{section.items.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {/* Articles grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 0 }}
                  className="section-articles-grid">
                  {(Array.isArray(section.items) ? section.items : []).map((item, idx) => (
                    <div
                      key={`${section.key}-${idx}`}
                      style={{
                        padding: "0 16px 20px 0",
                        borderRight: `1px solid ${np.ruleLight}`,
                        marginRight: 0,
                      }}
                      className="article-col"
                    >
                      {/* Photo for every article */}
                      <div style={{ width: "100%", height: idx === 0 ? 160 : 100, overflow: "hidden", marginBottom: 8 }}>
                        <ArticlePhoto item={item} section={section.key} />
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        {item.carryover && (
                          <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase", padding: "1px 5px", border: `1px solid ${np.rule}`, color: np.muted }}>
                            Carryover
                          </span>
                        )}
                        <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", color: np.accent }}>
                          {item.source || safeDomain(item.url) || "Source"}
                        </span>
                      </div>

                      <a href={item.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                        <h4 style={{ ...serif, fontSize: idx === 0 ? 18 : 15, fontWeight: 900, lineHeight: 1.2, margin: "0 0 6px 0" }}>
                          {cleanText(item.headline)}
                        </h4>
                      </a>

                      <div style={{ borderTop: `1px solid ${np.ruleLight}`, marginBottom: 6 }} />

                      <p style={{ ...serif, fontSize: 12, lineHeight: 1.65, color: np.muted, margin: 0, textAlign: "justify" }}>
                        {dekFromItem(item).split("Why it matters:")[0].trim()}
                      </p>

                      {/* Why it matters inline */}
                      {dekFromItem(item).includes("Why it matters:") && (
                        <p style={{ ...serif, fontSize: 11, lineHeight: 1.5, color: np.accent, margin: "5px 0 0 0", fontStyle: "italic" }}>
                          {dekFromItem(item).split("Why it matters:")[1]?.split("What to watch:")[0]?.trim()}
                        </p>
                      )}

                      {/* What to watch */}
                      {dekFromItem(item).includes("What to watch:") && (
                        <p style={{ fontSize: 10, lineHeight: 1.5, color: np.muted, margin: "4px 0 0 0", opacity: 0.75 }}>
                          <span style={{ fontWeight: 700 }}>Watch: </span>
                          {dekFromItem(item).split("What to watch:")[1]?.split("Market lens:")[0]?.trim()}
                        </p>
                      )}

                      <p style={{ ...serif, fontSize: 10, color: np.muted, opacity: 0.6, margin: "6px 0 0 0" }}>{toTimeAgo(item.datetime)}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {allSections.length === 0 && (
              <div style={{ padding: "80px 0", textAlign: "center" }}>
                <p style={{ ...serif, fontSize: 28, fontWeight: 900 }}>Edition in Progress</p>
                <p style={{ fontSize: 13, color: np.muted, marginTop: 8 }}>No publishable stories found. Try switching cadence or check back later.</p>
              </div>
            )}

            {/* ── ASTRA MARKET INTELLIGENCE ──────────────────────────────────── */}
            {astraSummary.length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ borderTop: `3px solid ${np.rule}` }} />
                <div style={{ borderTop: `1px solid ${np.rule}`, marginTop: 2 }} />

                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 0, marginTop: 20 }}
                  className="astra-grid">

                  <div style={{ borderRight: `1px solid ${np.rule}`, paddingRight: 24 }}>
                    <div style={{ background: np.sectionBg, color: np.sectionText, display: "inline-block", padding: "5px 16px", fontSize: 13, fontWeight: 900, letterSpacing: "0.25em", textTransform: "uppercase", marginBottom: 16, ...serif }}>
                      {data?.summary?.title || "Arthastra Intelligence"}
                    </div>
                    {astraDeck && (
                      <p style={{ ...serif, fontSize: 14, lineHeight: 1.7, color: np.muted, marginBottom: 16, textAlign: "justify" }}>{astraDeck}</p>
                    )}
                    {astraHighlights.length > 0 && (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                        {astraHighlights.map((h, idx) => (
                          <div
                            key={`astra-hi-${idx}`}
                            style={{ padding: "12px 12px", borderBottom: `1px solid ${np.ruleLight}`, borderRight: idx % 2 === 0 ? `1px solid ${np.ruleLight}` : "none" }}
                          >
                            <p style={{ fontSize: 9, fontWeight: 900, letterSpacing: "0.15em", textTransform: "uppercase", color: np.accent, margin: "0 0 4px 0" }}>{h.section}</p>
                            <p style={{ ...serif, fontSize: 13, fontWeight: 900, lineHeight: 1.3, margin: "0 0 5px 0" }}>{cleanText(h.headline)}</p>
                            <div style={{ borderTop: `1px solid ${np.ruleLight}`, marginBottom: 5 }} />
                            <p style={{ ...serif, fontSize: 11, lineHeight: 1.6, color: np.muted, margin: 0 }}>{h.context}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ paddingLeft: 20 }}>
                    <p style={{ ...serif, fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", textTransform: "uppercase", borderBottom: `1px solid ${np.rule}`, paddingBottom: 6, marginBottom: 12 }}>
                      Key Signals This Edition
                    </p>
                    <ol style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {astraSummary.map((line, idx) => (
                        <li key={`astra-bullet-${idx}`} style={{ ...serif, borderBottom: `1px solid ${np.ruleLight}`, paddingBottom: 10, paddingTop: idx === 0 ? 0 : 10, fontSize: 12, lineHeight: 1.6, color: np.text }}>
                          <span style={{ fontSize: 9, fontWeight: 900, color: np.accent, marginRight: 6 }}>{String(idx + 1).padStart(2, "0")}</span>
                          {line}
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            )}

            {/* ── FOOTER ───────────────────────────────────────────────────────── */}
            <div style={{ marginTop: 32, marginBottom: 24 }}>
              <div style={{ borderTop: `3px solid ${np.rule}` }} />
              <div style={{ borderTop: `1px solid ${np.rule}`, marginTop: 2 }} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                <p style={{ ...serif, fontSize: 10, color: np.muted, letterSpacing: "0.1em", margin: 0 }}>
                  The Arthastra — Analytical Intelligence for Markets & World Affairs
                </p>
                <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                  <Link href="/home" style={{ ...serif, fontSize: 11, color: np.text, letterSpacing: "0.1em", textDecoration: "none", fontWeight: 700, padding: "4px 12px", border: `1px solid ${np.rule}` }}>
                    ← Back to Home
                  </Link>
                  {data?.nextPublishAt && (
                    <span style={{ ...serif, fontSize: 10, color: np.accent, letterSpacing: "0.1em" }}>
                      Next Edition: {fmtNextPublish(data.nextPublishAt)}
                    </span>
                  )}
                </div>
                <p style={{ ...serif, fontSize: 10, color: np.muted, letterSpacing: "0.1em", margin: 0 }}>
                  Edition {editionNumber()} · {todayLong()}
                </p>
              </div>
            </div>
          </>
        )}
      </main>

      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

        @media (max-width: 900px) {
          .front-page-grid { grid-template-columns: 1fr !important; }
          .hide-mobile { display: none !important; }
          .hero-col { padding: 0 !important; border-right: none !important; }
          .astra-grid { grid-template-columns: 1fr !important; }
        }

        @media (max-width: 640px) {
          .section-articles-grid { grid-template-columns: 1fr !important; }
        }

        .article-col:last-child { border-right: none !important; }
      `}</style>
    </div>
  );
}
