"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const CONSENT_COOKIE = "arthastra_consent";
const CONSENT_VERSION = "1.0";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DEFAULT_PREFS = {
  necessary: true,
  functional: true,
  analytics: true,
  advertising: false,
};

function readCookie(name) {
  if (typeof document === "undefined") return null;
  const hit = document.cookie
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${name}=`));
  if (!hit) return null;
  try {
    return JSON.parse(decodeURIComponent(hit.slice(name.length + 1)));
  } catch {
    return null;
  }
}

function writeConsentCookie(payload) {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(payload));
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

function loadGoogleAnalytics() {
  if (typeof document === "undefined") return;
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!gaId || document.getElementById("arthastra-ga-script")) return;

  const script = document.createElement("script");
  script.id = "arthastra-ga-script";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };
  window.gtag("js", new Date());
  window.gtag("config", gaId, { anonymize_ip: true });
}

function loadAdvertisingScripts() {
  if (typeof document === "undefined") return;
  const gAdsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  if (gAdsId && !document.getElementById("arthastra-gads-script")) {
    const adsScript = document.createElement("script");
    adsScript.id = "arthastra-gads-script";
    adsScript.async = true;
    adsScript.src = `https://www.googletagmanager.com/gtag/js?id=${gAdsId}`;
    document.head.appendChild(adsScript);
  }

  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (metaPixelId && !document.getElementById("arthastra-meta-pixel")) {
    const pixelScript = document.createElement("script");
    pixelScript.id = "arthastra-meta-pixel";
    pixelScript.innerHTML = `
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${metaPixelId}');
      fbq('track', 'PageView');
    `;
    document.head.appendChild(pixelScript);
  }
}

function applyConsent(consent) {
  if (typeof window === "undefined") return;
  window.__arthastraConsent = consent;
  if (consent.analytics) loadGoogleAnalytics();
  if (consent.advertising) loadAdvertisingScripts();
}

export default function CookieConsentManager() {
  const [ready, setReady] = useState(false);
  const [bannerOpen, setBannerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  useEffect(() => {
    const existing = readCookie(CONSENT_COOKIE);
    if (existing && typeof existing === "object") {
      const normalized = { ...DEFAULT_PREFS, ...existing, necessary: true };
      setPrefs(normalized);
      applyConsent(normalized);
      setBannerOpen(false);
    } else {
      setBannerOpen(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const openHandler = () => setModalOpen(true);
    window.addEventListener("open-cookie-settings", openHandler);
    return () => window.removeEventListener("open-cookie-settings", openHandler);
  }, []);

  const saveConsent = (nextPrefs) => {
    const payload = {
      necessary: true,
      functional: Boolean(nextPrefs.functional),
      analytics: Boolean(nextPrefs.analytics),
      advertising: Boolean(nextPrefs.advertising),
      timestamp: new Date().toISOString(),
      version: CONSENT_VERSION,
    };
    setPrefs(payload);
    writeConsentCookie(payload);
    applyConsent(payload);
    setBannerOpen(false);
    setModalOpen(false);
  };

  const footerLinks = useMemo(
    () => (
      <div className="mt-3 text-xs text-slate-500 flex flex-wrap items-center gap-2">
        <Link href="/privacy" className="underline hover:text-slate-700">
          Privacy Policy
        </Link>
        <span>|</span>
        <Link href="/cookies" className="underline hover:text-slate-700">
          Cookie Policy
        </Link>
        <span>|</span>
        <Link href="/terms" className="underline hover:text-slate-700">
          Terms of Service
        </Link>
      </div>
    ),
    []
  );

  if (!ready) return null;

  return (
    <>
      {bannerOpen && (
        <div className="fixed inset-x-0 bottom-0 z-[90] px-3 pb-3">
          <div className="mx-auto max-w-4xl rounded-2xl border border-slate-300 bg-white shadow-2xl p-4 md:p-5">
            <h3 className="text-base md:text-lg font-semibold text-slate-900">We use cookies to power your experience</h3>
            <p className="mt-2 text-sm text-slate-700 leading-relaxed">
              Arthastra uses cookies and similar technologies to keep you logged in, understand how you use the platform, show you relevant content, and (with your consent) deliver personalized ads. Some cookies are necessary for the platform to work. Others help us improve and fund the platform through advertising.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => saveConsent({ necessary: true, functional: true, analytics: true, advertising: true })}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                Accept All Cookies
              </button>
              <button
                onClick={() => saveConsent({ necessary: true, functional: false, analytics: false, advertising: false })}
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-sm font-semibold"
              >
                Decline Non-Essential
              </button>
              <button onClick={() => setModalOpen(true)} className="px-2 py-1 text-sm underline text-slate-700 hover:text-slate-900">
                Manage My Preferences
              </button>
            </div>
            {footerLinks}
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/45" onClick={() => setModalOpen(false)} aria-label="Close cookie settings" />
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-300 bg-white shadow-2xl p-5">
            <h3 className="text-lg font-semibold text-slate-900">Cookie Preferences</h3>
            <p className="mt-1 text-sm text-slate-600">Choose which cookies Arthastra can use.</p>

            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/70">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Strictly Necessary</div>
                    <div className="text-xs text-slate-600 mt-1">These cookies are required for the platform to function. They enable core features like login, security, and session management. The platform cannot function without these cookies.</div>
                  </div>
                  <span className="text-xs font-semibold text-blue-700">Always On</span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Functional</div>
                    <div className="text-xs text-slate-600 mt-1">These cookies remember your preferences and settings, such as your saved layout, dark mode preference, and simulator settings. Disabling these may affect your experience.</div>
                  </div>
                  <input type="checkbox" checked={Boolean(prefs.functional)} onChange={(e) => setPrefs((p) => ({ ...p, functional: e.target.checked }))} />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Analytics & Performance</div>
                    <div className="text-xs text-slate-600 mt-1">These cookies help us understand how users interact with Arthastra. We use this data to improve the platform. Analytics data is aggregated and does not identify you personally. Providers include Google Analytics.</div>
                  </div>
                  <input type="checkbox" checked={Boolean(prefs.analytics)} onChange={(e) => setPrefs((p) => ({ ...p, analytics: e.target.checked }))} />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-3 bg-slate-50/70">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Advertising & Targeting</div>
                    <div className="text-xs text-slate-600 mt-1">These cookies are used to show you relevant advertisements on and off the Arthastra platform. They may be set by us or our advertising partners including Google and Meta. These cookies build a profile of your interests and may track you across other websites. Your data may be shared with advertising partners.</div>
                  </div>
                  <input type="checkbox" checked={Boolean(prefs.advertising)} onChange={(e) => setPrefs((p) => ({ ...p, advertising: e.target.checked }))} />
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button onClick={() => setModalOpen(false)} className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-sm font-semibold text-slate-700">
                Cancel
              </button>
              <button onClick={() => saveConsent(prefs)} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold">
                Save My Preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
