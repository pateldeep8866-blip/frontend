"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import translations, { RTL_LANGUAGES } from "./translations";

const SUPPORTED_CODES = new Set(Object.keys(translations));

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState("en");

  // Read from localStorage on mount (localStorage is not available server-side)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("site_language");
      if (saved && SUPPORTED_CODES.has(saved)) {
        setLanguageState(saved);
      }
    } catch {}
  }, []);

  // Sync document dir/lang and persist whenever language changes
  useEffect(() => {
    try {
      localStorage.setItem("site_language", language);
    } catch {}
    const isRTL = RTL_LANGUAGES.has(language);
    document.documentElement.setAttribute("lang", language);
    document.documentElement.setAttribute("dir", isRTL ? "rtl" : "ltr");
  }, [language]);

  // Sync across browser tabs
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== "site_language") return;
      const next = e.newValue;
      if (next && SUPPORTED_CODES.has(next)) setLanguageState(next);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setLanguage = useCallback((code) => {
    if (SUPPORTED_CODES.has(code)) setLanguageState(code);
  }, []);

  const t = useCallback(
    (key) => translations[language]?.[key] ?? translations.en[key] ?? key,
    [language]
  );

  const isRTL = RTL_LANGUAGES.has(language);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, isRTL }}>
      {children}
    </LanguageContext.Provider>
  );
}

/** Primary hook — use this in all components and pages */
export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used inside <LanguageProvider>");
  return ctx;
}
