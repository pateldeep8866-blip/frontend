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

const TERMS_TEXT = {
  en: { backHome: "Back Home", dark: "Dark", light: "Light", sakura: "Sakura", title: "Terms of Service", effectiveDate: "Effective Date: February 24, 2026" },
  es: { backHome: "Inicio", dark: "Oscuro", light: "Claro", sakura: "Sakura", title: "Terminos de Servicio", effectiveDate: "Fecha efectiva: 24 de febrero de 2026" },
  fr: { backHome: "Accueil", dark: "Sombre", light: "Clair", sakura: "Sakura", title: "Conditions d'utilisation", effectiveDate: "Date d'effet : 24 fevrier 2026" },
  hi: { backHome: "होम", dark: "डार्क", light: "लाइट", sakura: "सकुरा", title: "सेवा की शर्तें", effectiveDate: "प्रभावी तिथि: 24 फरवरी 2026" },
};

export default function TermsPage() {
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
      ? "min-h-screen relative overflow-hidden bg-[#fbfdff] text-slate-900"
      : "min-h-screen relative overflow-hidden bg-slate-950 text-white";

  const cardClass = isCherry
    ? "rounded-2xl border border-rose-200/60 bg-white/92 p-6 md:p-7 shadow-[0_14px_34px_-20px_rgba(190,24,93,0.2)]"
    : isLight
      ? "rounded-2xl border border-slate-200 bg-white/90 p-6 md:p-7 shadow-[0_14px_34px_-20px_rgba(59,130,246,0.16)]"
      : "rounded-2xl border border-white/12 bg-slate-900/55 p-6 md:p-7";

  const headingClass = isLight ? "text-slate-900" : "text-white";
  const textClass = isCherry ? "text-rose-900/80" : isLight ? "text-slate-700" : "text-slate-300";
  const mutedTextClass = isCherry ? "text-rose-900/65" : isLight ? "text-slate-500" : "text-slate-400";
  const t = (key) => TERMS_TEXT[language]?.[key] || TERMS_TEXT.en[key] || key;

  return (
    <div className={pageClass}>
      <div className={`pointer-events-none absolute -top-24 -left-20 h-80 w-80 rounded-full blur-3xl ${isCherry ? "bg-rose-100/34" : isLight ? "bg-sky-200/35" : "bg-cyan-500/12"}`} />
      <div className={`pointer-events-none absolute top-1/3 -right-28 h-96 w-96 rounded-full blur-3xl ${isCherry ? "bg-rose-100/28" : isLight ? "bg-blue-200/30" : "bg-blue-500/10"}`} />
      <div className={`pointer-events-none absolute inset-0 ${isCherry ? "bg-[radial-gradient(circle_at_12%_6%,rgba(244,114,182,0.08),transparent_31%),radial-gradient(circle_at_86%_70%,rgba(251,113,133,0.07),transparent_36%)]" : isLight ? "bg-[radial-gradient(circle_at_15%_10%,rgba(125,211,252,0.18),transparent_40%),radial-gradient(circle_at_80%_70%,rgba(147,197,253,0.14),transparent_42%)]" : "bg-[radial-gradient(circle_at_20%_10%,rgba(59,130,246,0.08),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(14,165,233,0.07),transparent_35%)]"}`} />

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
          <p className={`mt-4 text-sm leading-relaxed ${textClass}`}>
            Arthastra AI is an educational and informational research platform. It is not a broker-dealer,
            not an investment adviser, and does not make investment decisions for users.
          </p>

          <div className="mt-6 space-y-6">
            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>1. Service Description</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                Arthastra AI aggregates publicly available financial information and presents analytical insights
                for user exploration. Output is informational only and is provided to support independent research.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>2. No Financial Advice (Critical Disclaimer)</h2>
              <p className={`mt-2 text-sm leading-relaxed font-semibold ${textClass}`}>
                Content is for educational and informational purposes only. Nothing on the platform constitutes
                financial advice, investment recommendations, or a solicitation to buy or sell any security.
              </p>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                Arthastra AI owes no fiduciary duty and does not create any broker-dealer, advisory, or client relationship.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>3. User Responsibility</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                Users are solely responsible for all decisions and outcomes resulting from their use of the platform.
                Arthastra AI is not liable for trading losses, missed opportunities, or any financial consequences.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>4. No Guarantees / No Warranty</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                The service is provided on an “as is” and “as available” basis without warranties of accuracy,
                completeness, timeliness, reliability, or uninterrupted availability. Data may be delayed,
                incomplete, unavailable, or incorrect.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>5. Limitation of Liability</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                To the maximum extent permitted by law, Arthastra AI is not liable for indirect, incidental,
                consequential, special, exemplary, or punitive damages. If liability is imposed, total liability
                is limited to the amount paid by you to use the service in the prior twelve months (or USD $100,
                whichever is lower).
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>6. Intellectual Property</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                Arthastra AI retains all rights in its software, branding, and platform systems. Users retain ownership
                of their submitted inputs but grant a limited license for processing and service operation.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>7. Acceptable Use</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                You may not scrape, reverse engineer, abuse, automate in unauthorized ways, use the service for illegal
                market manipulation, or use the service to violate securities laws or regulations.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>8. Privacy & Data Use</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                We may collect account details, usage logs, and operational telemetry to provide and improve the service.
                We do not sell personal data. For privacy questions, contact{" "}
                <a href="mailto:support@arthastraai.com" className="underline">support@arthastraai.com</a>.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>9. Risk Disclosure</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                Investing involves risk, including possible loss of principal. Past performance does not guarantee
                future results. Platform analytics are not predictive guarantees.
              </p>
            </section>

            <section>
              <h2 className={`text-base font-semibold ${headingClass}`}>10. Governing Law & Disputes</h2>
              <p className={`mt-2 text-sm leading-relaxed ${textClass}`}>
                These terms are governed by Wisconsin law, excluding conflict-of-law rules. You agree to resolve disputes
                through binding individual arbitration where legally permitted, and waive participation in class actions
                to the extent enforceable.
              </p>
            </section>
          </div>

          <p className={`mt-8 text-xs ${mutedTextClass}`}>
            This page is provided for product policy clarity and does not replace formal legal counsel.
          </p>
        </div>
      </div>
    </div>
  );
}
