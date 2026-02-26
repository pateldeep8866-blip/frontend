"use client";

import Link from "next/link";

function openCookieSettings() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("open-cookie-settings"));
  }
}

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-300/60 bg-white/90 text-slate-700">
      <div className="mx-auto max-w-6xl px-4 py-4 text-xs flex flex-wrap items-center justify-center gap-2">
        <Link href="/terms" className="hover:underline">
          Terms of Service
        </Link>
        <span>|</span>
        <Link href="/privacy" className="hover:underline">
          Privacy Policy
        </Link>
        <span>|</span>
        <Link href="/cookies" className="hover:underline">
          Cookie Policy
        </Link>
        <span>|</span>
        <Link href="/disclaimer" className="hover:underline">
          Disclaimer
        </Link>
        <span>|</span>
        <button
          type="button"
          onClick={openCookieSettings}
          className="underline hover:text-slate-900"
        >
          Cookie Settings
        </button>
      </div>
    </footer>
  );
}
