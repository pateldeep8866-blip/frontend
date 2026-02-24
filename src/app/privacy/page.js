"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
const AZULA_FLAME_IDS = Array.from({ length: 8 }, (_, index) => index + 1);
const AZULA_LIGHTNING_IDS = Array.from({ length: 8 }, (_, index) => index + 1);

const PRIVACY_TEXT = {
  en: {
    backHome: "Back Home",
    dark: "Dark",
    light: "Light",
    sakura: "Sakura",
    azula: "Azula",
    title: "Privacy Policy",
    effectiveDate: "Effective Date: February 24, 2026",
    lastUpdated: "Last Updated: February 24, 2026",
  },
  es: {
    backHome: "Inicio",
    dark: "Oscuro",
    light: "Claro",
    sakura: "Sakura",
    azula: "Azula",
    title: "Politica de Privacidad",
    effectiveDate: "Fecha efectiva: 24 de febrero de 2026",
    lastUpdated: "Ultima actualizacion: 24 de febrero de 2026",
  },
  fr: {
    backHome: "Accueil",
    dark: "Sombre",
    light: "Clair",
    sakura: "Sakura",
    azula: "Azula",
    title: "Politique de Confidentialite",
    effectiveDate: "Date d'effet : 24 fevrier 2026",
    lastUpdated: "Derniere mise a jour : 24 fevrier 2026",
  },
  hi: {
    backHome: "होम",
    dark: "डार्क",
    light: "लाइट",
    sakura: "सकुरा",
    azula: "अज़ूला",
    title: "प्राइवेसी पॉलिसी",
    effectiveDate: "प्रभावी तिथि: 24 फरवरी 2026",
    lastUpdated: "आखिरी अपडेट: 24 फरवरी 2026",
  },
};

export default function PrivacyPage() {
  const [theme, setTheme] = useState("dark");
  const [language, setLanguage] = useState("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (saved === "light" || saved === "dark" || saved === "cherry" || saved === "azula") setTheme(saved);
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
  const isAzula = theme === "azula";
  const isLight = theme === "light" || isCherry || isAzula;
  const t = (key) => PRIVACY_TEXT[language]?.[key] || PRIVACY_TEXT.en[key] || key;

  const pageClass = isCherry
    ? "cherry-mode min-h-screen relative overflow-hidden bg-[#fffefc] text-[#3a2530]"
    : isAzula
      ? "azula-mode min-h-screen relative overflow-hidden bg-[#fafbfd] text-slate-900"
    : isLight
      ? "min-h-screen relative overflow-hidden bg-[#fbfdff] text-slate-900"
      : "min-h-screen relative overflow-hidden bg-slate-950 text-white";

  const cardClass = isCherry
    ? "rounded-2xl border border-rose-200/60 bg-white/92 p-6 md:p-7 shadow-[0_14px_34px_-20px_rgba(190,24,93,0.2)]"
    : isAzula
      ? "rounded-2xl border border-sky-200/70 bg-white/92 p-6 md:p-7 shadow-[0_14px_34px_-20px_rgba(14,116,144,0.18)]"
    : isLight
      ? "rounded-2xl border border-slate-200 bg-white/90 p-6 md:p-7 shadow-[0_14px_34px_-20px_rgba(59,130,246,0.16)]"
      : "rounded-2xl border border-white/12 bg-slate-900/55 p-6 md:p-7";

  const headingClass = isLight ? "text-slate-900" : "text-white";
  const textClass = isCherry ? "text-rose-900/80" : isAzula ? "text-sky-950/85" : isLight ? "text-slate-700" : "text-slate-300";
  const mutedTextClass = isCherry ? "text-rose-900/65" : isAzula ? "text-sky-900/65" : isLight ? "text-slate-500" : "text-slate-400";

  return (
    <div className={pageClass}>
      <div className={`pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full blur-3xl ${isCherry ? "bg-rose-100/34" : isAzula ? "bg-sky-300/32" : isLight ? "bg-sky-200/35" : "bg-cyan-500/12"}`} />
      <div className={`pointer-events-none absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl ${isCherry ? "bg-rose-100/28" : isAzula ? "bg-blue-300/30" : isLight ? "bg-blue-200/30" : "bg-blue-500/10"}`} />
      <div className={`pointer-events-none absolute inset-0 ${isCherry ? "bg-[radial-gradient(circle_at_12%_6%,rgba(244,114,182,0.08),transparent_31%),radial-gradient(circle_at_86%_70%,rgba(251,113,133,0.07),transparent_36%)]" : isAzula ? "bg-[radial-gradient(circle_at_15%_10%,rgba(56,189,248,0.2),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(37,99,235,0.18),transparent_42%)]" : isLight ? "bg-[radial-gradient(circle_at_15%_10%,rgba(125,211,252,0.18),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(147,197,253,0.14),transparent_42%)]" : "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.07),transparent_35%)]"}`} />
      {isAzula && (
        <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden azula-scene" aria-hidden="true">
          {AZULA_FLAME_IDS.map((flameId) => (
            <span key={`privacy-azula-flame-${flameId}`} className={`azula-flame azula-flame-${flameId}`} />
          ))}
          {AZULA_LIGHTNING_IDS.map((boltId) => (
            <span key={`privacy-azula-bolt-${boltId}`} className={`azula-lightning azula-lightning-${boltId}`} />
          ))}
        </div>
      )}

      <div className="relative z-10 mx-auto w-full max-w-5xl px-6 py-10 md:py-14">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-8">
          <Link
            href="/"
            className={`px-3 py-1.5 rounded-lg border text-xs ${isLight ? "border-slate-300 bg-white/90 text-slate-700 hover:bg-slate-100" : "border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70"}`}
          >
            {t("backHome")}
          </Link>
          <div className={`inline-flex rounded-xl overflow-hidden border ${isLight ? "border-slate-300 bg-white/90" : "border-white/15 bg-slate-900/60"}`}>
            <button
              onClick={() => setTheme("dark")}
              className={`px-3 py-1.5 text-xs font-semibold ${theme === "dark" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-800" : "bg-transparent text-white/85"}`}
            >
              {t("dark")}
            </button>
            <button
              onClick={() => setTheme("light")}
              className={`px-3 py-1.5 text-xs font-semibold ${theme === "light" ? "bg-blue-600 text-white" : isLight ? "bg-transparent text-slate-800" : "bg-transparent text-white/85"}`}
            >
              {t("light")}
            </button>
            <button
              onClick={() => setTheme("cherry")}
              className={`px-3 py-1.5 text-xs font-semibold ${theme === "cherry" ? "bg-rose-600 text-white" : isLight ? "bg-transparent text-rose-800" : "bg-transparent text-white/85"}`}
            >
              {t("sakura")}
            </button>
            <button
              onClick={() => setTheme("azula")}
              className={`px-3 py-1.5 text-xs font-semibold ${theme === "azula" ? "bg-sky-600 text-white" : isLight ? "bg-transparent text-sky-800" : "bg-transparent text-white/85"}`}
            >
              {t("azula")}
            </button>
          </div>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={`px-2.5 py-1.5 rounded-lg border text-xs ${
              isLight ? "border-slate-300 bg-white/90 text-slate-700" : "border-white/15 bg-slate-900/60 text-white/85"
            }`}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className={cardClass}>
          <h1 className={`text-3xl md:text-4xl font-semibold tracking-tight ${headingClass}`}>{t("title")}</h1>
          <p className={`mt-2 text-sm ${mutedTextClass}`}>{t("effectiveDate")}</p>
          <p className={`mt-1 text-sm ${mutedTextClass}`}>{t("lastUpdated")}</p>
          <p className={`mt-4 text-sm leading-relaxed ${textClass}`}>
            Welcome to Arthastra AI. We respect your privacy and are committed to protecting your personal information.
            This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use
            https://www.arthastraai.com (the Service).
          </p>

          <div className="mt-6 space-y-6">
            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>1. Information We Collect</h2>
              <div className={`mt-2 text-sm leading-relaxed ${textClass} space-y-2`}>
                <p><span className="font-semibold">A. Information You Provide:</span> name, email, account credentials, messages, and any details you submit voluntarily.</p>
                <p><span className="font-semibold">B. Automatically Collected Information:</span> IP address, browser, device, operating system, pages visited, time on page, referring URLs, and usage activity.</p>
                <p><span className="font-semibold">C. Cookies and Tracking Technologies:</span> we may use cookies, analytics tools, and tracking pixels. You can disable cookies in your browser settings.</p>
              </div>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>2. How We Use Your Information</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                We use information to operate and maintain the Service, improve performance and user experience, monitor
                usage and technical issues, communicate with users, provide support, send updates if you opt in, and
                comply with legal obligations. We do not sell personal information.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>3. How We Share Information</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                We may share information with hosting providers, cloud infrastructure services, analytics providers,
                payment processors (if applicable), and legal authorities when required by law. These third parties
                are expected to safeguard your information.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>4. Data Retention</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                We retain information only as long as needed to provide the Service, comply with legal obligations,
                resolve disputes, and enforce agreements. You may request deletion of your data at any time.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>5. Data Security</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                We use reasonable administrative, technical, and physical safeguards to protect information.
                No internet transmission or storage method is 100% secure.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>6. Your Rights</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                Depending on your location, you may have rights to access, correct, delete, restrict, or object to
                processing, and withdraw consent. To exercise rights, contact{" "}
                <a href="mailto:privacy@arthastraai.com" className="underline">privacy@arthastraai.com</a>.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>7. International Users</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                If you access the Service from outside the United States, your information may be transferred to and
                processed in the United States, where data protection laws may differ.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>8. Children&apos;s Privacy</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                The Service is not intended for children under 13 (or the minimum legal age in your jurisdiction).
                We do not knowingly collect personal information from children.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>9. Changes to This Policy</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                We may update this Privacy Policy from time to time. Changes will be posted on this page with an
                updated Last Updated date.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>10. Contact Us</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                Arthastra AI<br />
                Email: <a href="mailto:privacy@arthastraai.com" className="underline">privacy@arthastraai.com</a><br />
                Website: <a href="https://www.arthastraai.com" className="underline">arthastraai.com</a>
              </p>
            </section>
          </div>

          <p className={`mt-8 text-xs ${mutedTextClass}`}>
            This policy is provided for transparency and does not replace formal legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}
