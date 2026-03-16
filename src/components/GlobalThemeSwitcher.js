"use client";

import { useEffect, useState } from "react";

const THEME_OPTIONS = [
  { key: "dark", label: "Dark" },
  { key: "light", label: "Light" },
  { key: "cherry", label: "Sakura" },
  { key: "azula", label: "Azula" },
  { key: "alerik", label: "Alerik" },
  { key: "lylah", label: "Lylah" },
];

export default function GlobalThemeSwitcher() {
  const [theme, setTheme] = useState("dark");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("theme_mode");
      if (saved && THEME_OPTIONS.some((opt) => opt.key === saved)) {
        setTheme(saved);
      }
    } catch {}
  }, []);

  const onThemeChange = (next) => {
    if (!THEME_OPTIONS.some((opt) => opt.key === next)) return;
    setTheme(next);
    try {
      localStorage.setItem("theme_mode", next);
      window.dispatchEvent(new Event("theme-updated"));
      window.location.reload();
    } catch {}
  };

  return (
    <div className="pointer-events-auto fixed left-4 top-14 z-[140]">
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => onThemeChange(e.target.value)}
        className="rounded-lg border border-white/20 bg-[#0b1020]/90 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_10px_rgba(0,0,0,0.28)] backdrop-blur"
      >
        {THEME_OPTIONS.map((opt) => (
          <option key={opt.key} value={opt.key}>
            Theme: {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
