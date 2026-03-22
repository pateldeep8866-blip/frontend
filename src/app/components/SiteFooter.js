"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n/LanguageContext";

function openCookieSettings() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("open-cookie-settings"));
  }
}

export default function SiteFooter() {
  const { t } = useLanguage();
  return (
    <footer className="border-t border-slate-300/60 bg-white/90 text-slate-700">
      <div className="mx-auto max-w-6xl px-4 py-4 text-xs flex flex-wrap items-center justify-center gap-2">
        <Link href="/terms" className="hover:underline">
          {t("footerTerms")}
        </Link>
        <span>|</span>
        <Link href="/privacy" className="hover:underline">
          {t("footerPrivacy")}
        </Link>
        <span>|</span>
        <Link href="/cookies" className="hover:underline">
          {t("footerCookies")}
        </Link>
        <span>|</span>
        <Link href="/disclaimer" className="hover:underline">
          {t("footerDisclaimer")}
        </Link>
        <span>|</span>
        <button
          type="button"
          onClick={openCookieSettings}
          className="underline hover:text-slate-900"
        >
          {t("footerCookieSettings")}
        </button>
      </div>
    </footer>
  );
}
