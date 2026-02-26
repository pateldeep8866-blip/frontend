"use client";

import Link from "next/link";

export default function LegalPageShell({
  title,
  effectiveDate,
  lastUpdated,
  children,
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto max-w-5xl px-6 py-10 md:py-14">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href="/" className="px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70">Home</Link>
            <Link href="/about" className="px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70">About</Link>
            <Link href="/terms" className="px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70">Terms</Link>
            <Link href="/privacy" className="px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70">Privacy</Link>
            <Link href="/cookies" className="px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70">Cookies</Link>
            <Link href="/disclaimer" className="px-3 py-1.5 rounded-lg border border-white/15 bg-slate-900/60 text-white/85 hover:bg-slate-800/70">Disclaimer</Link>
          </div>
          <Link href="/" className="text-xs underline text-cyan-300 hover:text-cyan-200">Back to home</Link>
        </div>

        <article className="rounded-2xl border border-white/12 bg-slate-900/55 p-6 md:p-7">
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-slate-400">Effective Date: {effectiveDate}</p>
          <p className="mt-1 text-sm text-slate-400">Last Updated: {lastUpdated}</p>
          <div className="mt-6 space-y-6 text-sm leading-relaxed text-slate-300">
            {children}
          </div>
        </article>
      </div>
    </div>
  );
}
