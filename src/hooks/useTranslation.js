/**
 * Convenience re-export.  Import useTranslation anywhere you need
 * { t, language, setLanguage, isRTL } without knowing the context path.
 *
 * Usage:
 *   import { useTranslation } from "@/hooks/useTranslation";
 *   const { t, language, setLanguage, isRTL } = useTranslation();
 */
export { useLanguage as useTranslation } from "@/lib/i18n/LanguageContext";
