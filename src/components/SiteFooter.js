"use client";

import Link from "next/link";

function openCookieSettings() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("open-cookie-settings"));
  }
}

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-300/60 bg-white/95 text-slate-700">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="text-xs flex flex-wrap items-center justify-center gap-2">
          <Link href="/terms" className="hover:underline">Terms of Service</Link>
          <span>|</span>
          <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
          <span>|</span>
          <Link href="/cookies" className="hover:underline">Cookie Policy</Link>
          <span>|</span>
          <Link href="/disclaimer" className="hover:underline">Disclaimer</Link>
          <span>|</span>
          <button type="button" onClick={openCookieSettings} className="underline hover:text-slate-900">
            Cookie Settings
          </button>
          <span>|</span>
          <Link href="/home?investors=1" className="font-bold hover:underline" style={{color:'#b8860b'}}>&#9733; FOR INVESTORS</Link>
        </div>
        <div className="mt-2 border-t border-slate-200/80 pt-2 text-center text-[11px] text-slate-500">
          © 2026 Arthastra AI. All rights reserved. Not financial advice. For educational purposes only.
        </div>
      </div>
    </footer>
  );
}
