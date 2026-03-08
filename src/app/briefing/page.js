"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function safeDomainFromUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function toLocalDate(value) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleString();
}

function faviconUrlFor(rawUrl) {
  const domain = safeDomainFromUrl(rawUrl);
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function sectionByKey(data, key) {
  const rows = Array.isArray(data?.sections) ? data.sections : [];
  return rows.find((s) => s.key === key) || { key, title: key, items: [] };
}

function dekFromItem(item) {
  const raw = String(item?.summary || "").trim();
  if (raw) return raw;
  const h = String(item?.headline || "").trim();
  if (!h) return "";
  return h.length > 180 ? `${h.slice(0, 177).trim()}...` : h;
}

function fmtPulseValue(p) {
  const v = Number(p?.value);
  if (!Number.isFinite(v)) return "--";
  if (p?.key === "btc") return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (p?.key === "wti" || p?.key === "gold") return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (p?.key === "us10y") return `${v.toFixed(2)}${p?.suffix || ""}`;
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPulseDelta(p) {
  const d = Number(p?.changePct);
  if (!Number.isFinite(d)) return "--";
  const sign = d > 0 ? "+" : "";
  return `${sign}${d.toFixed(2)}%`;
}

export default function BriefingPage() {
  const [theme, setTheme] = useState("dark");
  const [cadence, setCadence] = useState("daily");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (["dark", "light", "cherry", "azula", "alerik"].includes(saved)) setTheme(saved);
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
    return () => {
      active = false;
    };
  }, [cadence]);

  const isLight = theme === "light" || theme === "cherry" || theme === "azula";
  const pageClass = isLight ? "bg-[#f7f4ef] text-[#1f1b16]" : "bg-[#050a1a] text-[#f3f8ff]";
  const shellClass = isLight ? "border-[#d9d0c3] bg-[#fffdf8]" : "border-[#1c355f] bg-[linear-gradient(180deg,#07152f_0%,#050f23_100%)]";
  const strokeClass = isLight ? "border-[#d9d0c3]" : "border-[#17345f]";
  const mutedClass = isLight ? "text-[#6b655d]" : "text-[#98a6bf]";
  const accentClass = isLight ? "text-[#7f2d0f]" : "text-[#8ee7ff]";

  const sections = useMemo(() => {
    const us = sectionByKey(data, "us");
    const global = sectionByKey(data, "global");
    const crypto = sectionByKey(data, "crypto");
    const geopolitics = sectionByKey(data, "geopolitics");
    const war = sectionByKey(data, "war");
    return { us, global, crypto, geopolitics, war };
  }, [data]);

  const hero = useMemo(() => {
    const ordered = [sections.us, sections.global, sections.crypto, sections.geopolitics, sections.war];
    for (const s of ordered) {
      if (Array.isArray(s?.items) && s.items.length > 0) return s.items[0];
    }
    return null;
  }, [sections]);

  const topDeck = useMemo(() => {
    const pool = [
      ...(sections.us?.items || []),
      ...(sections.global?.items || []),
      ...(sections.crypto?.items || []),
      ...(sections.geopolitics?.items || []),
      ...(sections.war?.items || []),
    ].slice(0, 6);
    if (!hero) return pool;
    return pool.filter((x) => x.url !== hero.url).slice(0, 5);
  }, [sections, hero]);

  const visibleSections = useMemo(
    () => [sections.us, sections.global, sections.crypto, sections.geopolitics, sections.war].filter((s) => Array.isArray(s?.items) && s.items.length > 0),
    [sections]
  );

  const pulse = Array.isArray(data?.pulse) ? data.pulse : [];
  const astraSummary = Array.isArray(data?.summary?.bullets) ? data.summary.bullets : [];
  const astraDeck = String(data?.summary?.deck || "").trim();
  const astraHighlights = Array.isArray(data?.summary?.highlights) ? data.summary.highlights : [];

  return (
    <div className={`min-h-screen relative overflow-hidden ${pageClass}`}>
      <div className="pointer-events-none absolute inset-0 opacity-[0.14] [background-image:radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.06),transparent_36%),radial-gradient(circle_at_80%_0%,rgba(0,180,255,0.08),transparent_28%),repeating-linear-gradient(0deg,rgba(148,163,184,0.07),rgba(148,163,184,0.07) 1px,transparent 1px,transparent 28px)]" />
      <main className="relative z-10 mx-auto w-full max-w-7xl px-5 py-8 md:py-10">
        <section className={`rounded-2xl border shadow-[0_20px_80px_-40px_rgba(0,0,0,0.55)] ${shellClass}`}>
          <header className="px-6 md:px-8 pt-6 pb-4">
            <div className={`border-t ${strokeClass}`} />
            <div className="flex flex-wrap items-center justify-between gap-3 py-3">
              <p className={`text-[11px] tracking-[0.28em] uppercase ${accentClass}`}>ASTRA PRESS DESK</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCadence("daily")}
                  className={`px-3 py-1.5 rounded text-xs border ${cadence === "daily" ? "bg-blue-600 text-white border-blue-500" : isLight ? "bg-[#fffdf8] text-[#3b342c] border-[#cfc5b8]" : "bg-white/5 text-white/80 border-white/20"}`}
                >
                  Daily
                </button>
                <button
                  onClick={() => setCadence("weekly")}
                  className={`px-3 py-1.5 rounded text-xs border ${cadence === "weekly" ? "bg-blue-600 text-white border-blue-500" : isLight ? "bg-[#fffdf8] text-[#3b342c] border-[#cfc5b8]" : "bg-white/5 text-white/80 border-white/20"}`}
                >
                  Weekly
                </button>
                <Link
                  href="/home"
                  className={`px-3 py-1.5 rounded text-xs border ${isLight ? "bg-[#fffdf8] text-[#3b342c] border-[#cfc5b8]" : "bg-white/5 text-white/80 border-white/20"}`}
                >
                  Back Home
                </Link>
              </div>
            </div>
            <div className={`border-b ${strokeClass} pb-4`}>
              <h1 className="text-[40px] md:text-[56px] leading-[0.95] font-semibold tracking-tight" style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>
                ASTRA Briefing
              </h1>
              <div className={`mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs ${mutedClass}`}>
                <span>{cadence === "weekly" ? "Weekly Paper Edition" : "Daily Brief Edition"}</span>
                <span>•</span>
                <span>{data?.generatedAt ? toLocalDate(data.generatedAt) : ""}</span>
                <span>•</span>
                <span>Markets · Crypto · Geopolitics · Conflict</span>
              </div>
            </div>
          </header>

          <div className="px-6 md:px-8 pb-8">
            {loading && <div className={`text-sm ${mutedClass}`}>Publishing today&apos;s paper...</div>}
            {error && <div className="text-sm text-rose-400">{error}</div>}

            {!loading && !error && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
                <section className={`xl:col-span-8 rounded-xl border ${strokeClass} overflow-hidden`}>
                  {hero ? (
                    <>
                      <div className={`relative h-64 md:h-80 border-b ${strokeClass}`}>
                        {String(hero?.image || "").startsWith("http") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={hero.image} alt={hero.headline || "Lead story"} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                        ) : (
                          <div className={`absolute inset-0 ${isLight ? "bg-gradient-to-br from-[#ece6da] via-[#d8cdbc] to-[#c2b49f]" : "bg-gradient-to-br from-[#1f3458] via-[#0b2448] to-[#06152e]"}`} />
                        )}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
                        {pulse.length > 0 && (
                          <div className="absolute left-4 right-4 top-4">
                            <div className={`rounded-lg border ${strokeClass} ${isLight ? "bg-[#fffdf8]/92" : "bg-[#071226]/82"} backdrop-blur-sm p-2`}>
                              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                                {pulse.map((p) => {
                                  const d = Number(p?.changePct);
                                  const deltaClass = Number.isFinite(d)
                                    ? d > 0
                                      ? "text-emerald-400"
                                      : d < 0
                                        ? "text-rose-400"
                                        : mutedClass
                                    : mutedClass;
                                  return (
                                    <div key={p.key} className={`rounded border ${strokeClass} px-2 py-1.5 ${isLight ? "bg-[#f7f1e7]" : "bg-white/5"}`}>
                                      <div className={`text-[10px] uppercase tracking-wide ${mutedClass}`}>{p.label}</div>
                                      <div className="text-sm font-semibold">{fmtPulseValue(p)}</div>
                                      <div className={`text-[11px] ${deltaClass}`}>{fmtPulseDelta(p)}</div>
                                    </div>
                                  );
                                })}
                              </div>
                              {String(data?.theme || "").trim() && <p className={`mt-2 text-[11px] leading-relaxed ${mutedClass}`}>{data.theme}</p>}
                            </div>
                          </div>
                        )}
                        <div className="absolute left-4 right-4 bottom-4">
                          <p className="text-[10px] uppercase tracking-[0.2em] text-cyan-200">Front Page</p>
                          <a href={hero.url} target="_blank" rel="noreferrer" className="block mt-1 text-2xl md:text-3xl leading-tight font-semibold text-white hover:underline" style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>
                            {hero.headline}
                          </a>
                          <p className="mt-1 text-xs text-white/80">{[hero.source || safeDomainFromUrl(hero.url), toLocalDate(hero.datetime)].filter(Boolean).join(" • ")}</p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className={`p-6 text-sm ${mutedClass}`}>No lead story available.</div>
                  )}

                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                    {topDeck.map((item, idx) => (
                      <a key={`lead-side-${idx}`} href={item.url} target="_blank" rel="noreferrer" className={`rounded-lg border ${strokeClass} p-3 hover:border-cyan-400/60 transition-colors`}>
                        <div className="grid grid-cols-[92px_1fr] gap-3">
                          <div className={`h-16 rounded overflow-hidden border ${strokeClass} ${isLight ? "bg-[#f1ece3]" : "bg-white/5"}`}>
                            {String(item?.image || "").startsWith("http") ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.image} alt={item.headline || "News image"} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={faviconUrlFor(item.url)} alt="source" className="w-6 h-6 opacity-75" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className={`text-[10px] uppercase tracking-wide ${mutedClass}`}>{item.source || safeDomainFromUrl(item.url)}</div>
                            <div className={`mt-1 text-sm leading-snug ${accentClass} line-clamp-2`}>{item.headline}</div>
                            <p className={`mt-1 text-xs ${mutedClass} line-clamp-3`}>{dekFromItem(item)}</p>
                          </div>
                        </div>
                      </a>
                    ))}
                    {topDeck.length === 0 && <div className={`text-sm ${mutedClass}`}>No additional headlines in this cycle.</div>}
                  </div>
                </section>

                <aside className={`xl:col-span-4 rounded-xl border ${strokeClass} p-4`}>
                  <h2 className="text-sm font-semibold tracking-wide uppercase">Inside This Edition</h2>
                  <div className={`mt-2 border-t ${strokeClass}`} />
                  {visibleSections.map((sec, idx) => (
                    <div key={`rail-${sec.key}`} className={`py-3 ${idx < visibleSections.length - 1 ? `border-b ${strokeClass}` : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-base font-semibold" style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>{sec.title}</p>
                        <span className={`text-xs ${mutedClass}`}>{sec.items.length}</span>
                      </div>
                      <p className={`mt-1 text-xs ${mutedClass} line-clamp-3`}>{dekFromItem(sec.items[0])}</p>
                    </div>
                  ))}
                  {visibleSections.length === 0 && <p className={`pt-3 text-sm ${mutedClass}`}>No sections with publishable stories right now.</p>}
                </aside>

                {visibleSections.map((section) => (
                  <section key={section.key} className={`xl:col-span-6 rounded-xl border ${strokeClass} p-4`}>
                    <div className="flex items-end justify-between gap-2">
                      <h3 className="text-2xl leading-none font-semibold" style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>{section.title}</h3>
                      <span className={`text-xs ${mutedClass}`}>{(section.items || []).length} item(s)</span>
                    </div>
                    <div className={`mt-2 border-t ${strokeClass}`} />
                    <ul className="mt-3 space-y-3">
                      {(Array.isArray(section.items) ? section.items : []).map((item, idx) => (
                        <li key={`${section.key}-${idx}`} className={`border-b ${strokeClass} pb-3`}>
                          <div className="grid grid-cols-[144px_1fr] gap-3">
                            <div className={`h-24 rounded overflow-hidden border ${strokeClass} ${isLight ? "bg-[#f1ece3]" : "bg-white/5"}`}>
                              {String(item?.image || "").startsWith("http") ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={item.image} alt={item.headline || "News image"} className="w-full h-full object-cover" loading="lazy" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={faviconUrlFor(item.url)} alt="source" className="w-7 h-7 opacity-75" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                {item.carryover && (
                                  <span className={`inline-flex text-[10px] px-1.5 py-0.5 rounded border ${isLight ? "border-amber-400 text-amber-700 bg-amber-50" : "border-amber-400/40 text-amber-200 bg-amber-500/15"}`}>
                                    Carryover
                                  </span>
                                )}
                                <span className={`text-[10px] uppercase tracking-wide ${mutedClass}`}>{item.source || safeDomainFromUrl(item.url) || "Source"}</span>
                              </div>
                              <a href={item.url} target="_blank" rel="noreferrer" className={`${accentClass} text-lg leading-snug hover:underline line-clamp-2`} style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>
                                {item.headline}
                              </a>
                              <p className={`mt-1 text-sm ${mutedClass} line-clamp-4`}>
                                {dekFromItem(item)}
                              </p>
                              <p className={`mt-1 text-xs ${mutedClass}`}>{toLocalDate(item.datetime) || "Time unavailable"}</p>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {visibleSections.length === 0 && (
                  <section className={`xl:col-span-12 rounded-xl border ${strokeClass} p-8 text-center`}>
                    <h3 className="text-2xl font-semibold" style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>Edition in Progress</h3>
                    <p className={`mt-2 text-sm ${mutedClass}`}>No publishable stories were found for this cycle. Try switching cadence or check back later.</p>
                  </section>
                )}

                {astraSummary.length > 0 && (
                  <section className={`xl:col-span-12 rounded-xl border ${strokeClass} p-5`}>
                    <h3 className="text-2xl leading-none font-semibold" style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>
                      {data?.summary?.title || "ASTRA Summary"}
                    </h3>
                    <div className={`mt-2 border-t ${strokeClass}`} />
                    {astraDeck && <p className={`mt-3 text-sm leading-relaxed ${mutedClass}`}>{astraDeck}</p>}

                    {astraHighlights.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                        {astraHighlights.map((h, idx) => (
                          <div key={`astra-hi-${idx}`} className={`rounded-lg border ${strokeClass} p-3 ${isLight ? "bg-[#f7f1e7]/70" : "bg-white/[0.03]"}`}>
                            <div className={`text-[10px] uppercase tracking-wide ${mutedClass}`}>{h.section}</div>
                            <div className={`mt-1 text-base leading-snug ${accentClass}`} style={{ fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif" }}>
                              {h.headline}
                            </div>
                            <p className={`mt-1 text-xs leading-relaxed ${mutedClass}`}>{h.context}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    <ul className="mt-3 space-y-2">
                      {astraSummary.map((line, idx) => (
                        <li key={`astra-summary-${idx}`} className={`text-sm leading-relaxed ${mutedClass}`}>
                          {idx + 1}. {line}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
