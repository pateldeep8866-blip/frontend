"use client";

import { useEffect, useState } from "react";

const SESSION_KEY = "arthastra_disclaimer_dismissed";

export default function GlobalDisclaimerBanner() {
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    try {
      const dismissed = sessionStorage.getItem(SESSION_KEY) === "1";
      setHidden(dismissed);
    } catch {
      setHidden(false);
    }
  }, []);

  if (hidden) return null;

  return (
    <div className="sticky top-0 z-[85] border-b border-amber-300/50 bg-amber-50/95 text-amber-900">
      <div className="mx-auto max-w-7xl px-3 py-1.5 text-xs flex items-center justify-between gap-3">
        <span>
          ⚠️ Arthastra AI is a paper trading simulator for educational purposes only. Not financial advice. ASTRA and QUANT_LAB signals are simulated tools, not investment recommendations.
        </span>
        <button
          type="button"
          className="shrink-0 rounded px-2 py-0.5 border border-amber-400/60 hover:bg-amber-100"
          onClick={() => {
            try {
              sessionStorage.setItem(SESSION_KEY, "1");
            } catch {}
            setHidden(true);
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
