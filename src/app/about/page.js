"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "es", label: "Espanol" },
  { code: "fr", label: "Francais" },
  { code: "hi", label: "Hindi" },
];

const ABOUT_TEXT = {
  en: {
    backHome: "Back Home",
    dark: "Dark",
    light: "Light",
    sakura: "Sakura",
    aboutTitle: "About Arthastra",
    clarity: "Clarity in Every Market.",
    intro:
      "At ArthastraAI, AI stands for Analytical Information. We provide structured analytical information across stocks, crypto, metals, FX, and global market trends.",
    foundersPhoto: "Founders Photo",
    mission: "Our Mission",
    missionBody:
      "Arthastra helps everyday investors make informed decisions through structured analytical insights across stocks, crypto, metals, FX, and global market news.",
    founders: "Founders",
    founder: "Founder",
    coFounder: "Co-founder",
    founderNote:
      "Built to provide clear market context, disciplined frameworks, and practical next steps.",
    covers: "What ASTRA Covers",
    legal: "Legal Notice",
    legalBody:
      "For informational purposes only. This platform does not provide financial, investment, legal, tax, or accounting advice. All decisions and outcomes are solely your responsibility.",
  },
  es: {
    backHome: "Inicio",
    dark: "Oscuro",
    light: "Claro",
    sakura: "Sakura",
    aboutTitle: "Acerca de Arthastra",
    clarity: "Claridad en cada mercado.",
    intro:
      "En ArthastraAI, AI significa Informacion Analitica. Brindamos informacion estructurada sobre acciones, cripto, metales, FX y tendencias globales.",
    foundersPhoto: "Foto de fundadores",
    mission: "Nuestra mision",
    missionBody:
      "Arthastra ayuda a inversionistas a tomar decisiones informadas con analisis estructurado en acciones, cripto, metales, FX y noticias globales.",
    founders: "Fundadores",
    founder: "Fundador",
    coFounder: "Cofundador",
    founderNote:
      "Construido para ofrecer contexto claro del mercado y marcos de accion practicos.",
    covers: "Que cubre ASTRA",
    legal: "Aviso legal",
    legalBody:
      "Solo con fines informativos. Esta plataforma no ofrece asesoramiento financiero, legal, fiscal ni contable.",
  },
  fr: {
    backHome: "Accueil",
    dark: "Sombre",
    light: "Clair",
    sakura: "Sakura",
    aboutTitle: "A propos d'Arthastra",
    clarity: "Clarte sur chaque marche.",
    intro:
      "Chez ArthastraAI, AI signifie Information Analytique. Nous fournissons des informations structurees sur actions, crypto, metaux, FX et tendances mondiales.",
    foundersPhoto: "Photo des fondateurs",
    mission: "Notre mission",
    missionBody:
      "Arthastra aide les investisseurs a prendre des decisions informees grace a une analyse structuree des marches.",
    founders: "Fondateurs",
    founder: "Fondateur",
    coFounder: "Cofondateur",
    founderNote:
      "Concu pour offrir un contexte de marche clair et des actions pratiques.",
    covers: "Ce que couvre ASTRA",
    legal: "Mention legale",
    legalBody:
      "A des fins informatives uniquement. Cette plateforme ne fournit pas de conseil financier, juridique, fiscal ou comptable.",
  },
  hi: {
    backHome: "होम",
    dark: "डार्क",
    light: "लाइट",
    sakura: "सकुरा",
    aboutTitle: "Arthastra के बारे में",
    clarity: "हर बाजार में स्पष्टता।",
    intro:
      "ArthastraAI में AI का अर्थ विश्लेषणात्मक जानकारी है। हम स्टॉक, क्रिप्टो, मेटल्स, एफएक्स और ग्लोबल ट्रेंड्स पर संरचित जानकारी देते हैं।",
    foundersPhoto: "फाउंडर्स फोटो",
    mission: "हमारा मिशन",
    missionBody:
      "Arthastra निवेशकों को स्पष्ट और संरचित विश्लेषण के साथ बेहतर निर्णय लेने में मदद करता है।",
    founders: "संस्थापक",
    founder: "संस्थापक",
    coFounder: "सह-संस्थापक",
    founderNote:
      "स्पष्ट मार्केट संदर्भ और व्यावहारिक फ्रेमवर्क देने के लिए बनाया गया।",
    covers: "ASTRA क्या कवर करता है",
    legal: "कानूनी सूचना",
    legalBody:
      "यह केवल जानकारी के लिए है। यह प्लेटफॉर्म वित्तीय, कानूनी, टैक्स या अकाउंटिंग सलाह नहीं देता।",
  },
};

export default function AboutPage() {
  const [theme, setTheme] = useState("dark");
  const [language, setLanguage] = useState("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (saved === "light" || saved === "dark" || saved === "cherry") setTheme(saved);
    } catch {}
    try {
      const lang = localStorage.getItem("site_language");
      if (LANGUAGE_OPTIONS.some((x) => x.code === lang)) setLanguage(lang);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("theme_mode", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem("site_language", language);
    } catch {}
  }, [language]);

  const isCherry = theme === "cherry";
  const isLight = theme === "light" || isCherry;

  const pageClass = isCherry
    ? "cherry-mode min-h-screen relative overflow-hidden bg-[#fffefc] text-[#3a2530]"
    : isLight
      ? "min-h-screen relative overflow-hidden bg-gradient-to-br from-white via-blue-50 to-cyan-50 text-slate-900"
      : "min-h-screen relative overflow-hidden bg-slate-950 text-white";

  const cardClass = isCherry
    ? "rounded-2xl border border-rose-200/60 bg-white/90 backdrop-blur-sm p-6 shadow-[0_10px_36px_rgba(190,24,93,0.12)]"
    : isLight
      ? "rounded-2xl border border-blue-200/80 bg-white/85 backdrop-blur-sm p-6 shadow-[0_10px_40px_rgba(59,130,246,0.12)]"
      : "rounded-2xl border border-white/12 bg-slate-900/55 p-6";

  const chipClass = isCherry
    ? "rounded-xl border border-rose-200/70 bg-rose-50/70 p-3 text-rose-900"
    : isLight
      ? "rounded-xl border border-blue-200 bg-blue-50/80 p-3 text-slate-700"
      : "rounded-xl border border-white/10 bg-white/5 p-3 text-slate-300";
  const t = (key) => ABOUT_TEXT[language]?.[key] || ABOUT_TEXT.en[key] || key;

  return (
    <div className={pageClass}>
      <div
        className={`pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full blur-3xl ${
          isCherry ? "bg-rose-200/28" : isLight ? "bg-blue-300/35" : "bg-cyan-500/12"
        }`}
      />
      <div
        className={`pointer-events-none absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl ${
          isCherry ? "bg-rose-200/24" : isLight ? "bg-cyan-300/30" : "bg-blue-500/10"
        }`}
      />
      <div
        className={`pointer-events-none absolute inset-0 ${
          isCherry
            ? "bg-[radial-gradient(circle_at_16%_12%,rgba(244,114,182,0.12),transparent_34%),radial-gradient(circle_at_84%_72%,rgba(251,113,133,0.1),transparent_36%)]"
            : isLight
              ? "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.12),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(6,182,212,0.12),transparent_35%)]"
              : "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.07),transparent_35%)]"
        }`}
      />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 py-10 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-lg border text-xs ${
              isLight
                ? "border-slate-300 bg-white/85 text-slate-700 hover:bg-slate-100"
                : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
            }`}
          >
            {t("backHome")}
          </Link>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme("dark")}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                theme === "dark"
                  ? "bg-blue-600 text-white border-blue-500"
                  : isLight
                    ? "border-slate-300 bg-white/85 text-slate-700"
                    : "border-white/15 bg-slate-900/60 text-white/85"
              }`}
            >
              {t("dark")}
            </button>
            <button
              onClick={() => setTheme("light")}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                theme === "light"
                  ? "bg-blue-600 text-white border-blue-500"
                  : isLight
                    ? "border-slate-300 bg-white/85 text-slate-700"
                    : "border-white/15 bg-slate-900/60 text-white/85"
              }`}
            >
              {t("light")}
            </button>
            <button
              onClick={() => setTheme("cherry")}
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                theme === "cherry"
                  ? "bg-rose-600 text-white border-rose-500"
                  : isLight
                    ? "border-rose-200 bg-white/90 text-rose-800"
                    : "border-white/15 bg-slate-900/60 text-white/85"
              }`}
            >
              {t("sakura")}
            </button>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/90 text-slate-700"
                  : "border-white/15 bg-slate-900/60 text-white/85"
              }`}
            >
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
            <a
              href="mailto:support@arthastraai.com"
              className={`px-3 py-1.5 rounded-lg border text-xs ${
                isLight
                  ? "border-slate-300 bg-white/85 text-slate-700 hover:bg-slate-100"
                  : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"
              }`}
            >
              support@arthastraai.com
            </a>
          </div>
        </div>

        <div className="text-center mb-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/arthastra-icon-transparent.svg"
            alt="Arthastra logo"
            className="mx-auto h-20 w-20 md:h-24 md:w-24"
          />
          <h1
            className={`mt-4 text-4xl md:text-6xl font-semibold tracking-tight bg-gradient-to-r bg-clip-text text-transparent ${
              isCherry
                ? "from-rose-900 via-fuchsia-800 to-indigo-800"
                : isLight
                  ? "from-slate-900 via-blue-700 to-cyan-600"
                  : "from-white via-cyan-100 to-sky-200"
            }`}
          >
            {t("aboutTitle")}
          </h1>
          <p className={`mt-3 text-lg ${isCherry ? "text-rose-900/80" : isLight ? "text-slate-600" : "text-slate-300"}`}>
            {t("clarity")}
          </p>
          <p className={`mt-2 text-sm ${isCherry ? "text-rose-900/70" : isLight ? "text-slate-500" : "text-slate-400"}`}>
            {t("intro")}
          </p>
        </div>

        <section className={`${cardClass} mb-6`}>
          <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
            {t("foundersPhoto")}
          </h2>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/founders-team.jpg"
              alt="Deep Patel and Juan M. Ramirez"
              className="w-full h-auto object-cover"
            />
          </div>
          <p className={`text-xs mt-3 ${isCherry ? "text-rose-900/65" : isLight ? "text-slate-500" : "text-slate-400"}`}>
            Deep Patel and Juan M. Ramirez
          </p>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <section className={cardClass}>
            <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
              {t("mission")}
            </h2>
            <p className={`text-sm leading-relaxed ${isCherry ? "text-rose-900/75" : isLight ? "text-slate-600" : "text-slate-300"}`}>
              {t("missionBody")}
            </p>
          </section>
          <section className={cardClass}>
            <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
              {t("founders")}
            </h2>
            <p className={`text-sm ${isCherry ? "text-rose-900/80" : isLight ? "text-slate-700" : "text-slate-300"}`}>{t("founder")}: Deep Patel</p>
            <p className={`text-sm mt-1 ${isCherry ? "text-rose-900/80" : isLight ? "text-slate-700" : "text-slate-300"}`}>
              {t("coFounder")}: Juan M. Ramirez
            </p>
            <p className={`text-xs mt-3 ${isCherry ? "text-rose-900/65" : isLight ? "text-slate-500" : "text-slate-400"}`}>
              {t("founderNote")}
            </p>
          </section>
        </div>

        <section className={`${cardClass} mb-6`}>
          <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
            {t("covers")}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <div className={chipClass}>Stock analytics and trends</div>
            <div className={chipClass}>Crypto market monitoring</div>
            <div className={chipClass}>Precious metals tracking</div>
            <div className={chipClass}>FX conversion and overview</div>
            <div className={chipClass}>World-impact market news</div>
            <div className={chipClass}>ASTRA assistant Q&amp;A support</div>
          </div>
        </section>

        <section className={cardClass}>
          <h2 className={`text-sm font-semibold mb-3 ${isLight ? "text-slate-800" : "text-slate-100"}`}>
            {t("legal")}
          </h2>
          <p className={`text-xs leading-relaxed ${isCherry ? "text-rose-900/65" : isLight ? "text-slate-500" : "text-slate-400"}`}>
            {t("legalBody")}
          </p>
        </section>
      </div>
    </div>
  );
}
