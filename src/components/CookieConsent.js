"use client";

import { useEffect, useState } from "react";

const CONSENT_COOKIE = "arthastra_consent";
const VERSION = "1.0";
const MAX_AGE = 60 * 60 * 24 * 365;

const DEFAULT_PREFS = {
  necessary: true,
  functional: true,
  analytics: true,
  advertising: false,
};

function readCookie(name) {
  if (typeof document === "undefined") return null;
  const token = document.cookie
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${name}=`));
  if (!token) return null;
  try {
    return JSON.parse(decodeURIComponent(token.slice(name.length + 1)));
  } catch {
    return null;
  }
}

function writeCookie(payload) {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(payload));
  document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
}

function loadAnalyticsIfAllowed(consent) {
  if (!consent?.analytics || typeof document === "undefined") return;
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!gaId || document.getElementById("arthastra-ga-script")) return;
  const script = document.createElement("script");
  script.id = "arthastra-ga-script";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${gaId}`;
  document.head.appendChild(script);
}

function loadAdsIfAllowed(consent) {
  if (!consent?.advertising || typeof document === "undefined") return;
  const gAdsId = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  if (gAdsId && !document.getElementById("arthastra-ads-script")) {
    const script = document.createElement("script");
    script.id = "arthastra-ads-script";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${gAdsId}`;
    document.head.appendChild(script);
  }
  const metaPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (metaPixelId && !document.getElementById("arthastra-meta-pixel")) {
    const script = document.createElement("script");
    script.id = "arthastra-meta-pixel";
    script.innerHTML = `
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq('init', '${metaPixelId}');
      fbq('track', 'PageView');
    `;
    document.head.appendChild(script);
  }
}

function applyConsent(consent) {
  if (typeof window === "undefined") return;
  window.__arthastraConsent = consent;
  loadAnalyticsIfAllowed(consent);
  loadAdsIfAllowed(consent);
}

export default function CookieConsent() {
  const [ready, setReady] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);

  useEffect(() => {
    const existing = readCookie(CONSENT_COOKIE);
    if (existing && typeof existing === "object") {
      const merged = { ...DEFAULT_PREFS, ...existing, necessary: true };
      setPrefs(merged);
      applyConsent(merged);
    } else {
      setShowBanner(true);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    const reopen = () => setShowModal(true);
    window.addEventListener("open-cookie-settings", reopen);
    return () => window.removeEventListener("open-cookie-settings", reopen);
  }, []);

  const save = (next) => {
    const payload = {
      necessary: true,
      functional: Boolean(next.functional),
      analytics: Boolean(next.analytics),
      advertising: Boolean(next.advertising),
      timestamp: new Date().toISOString(),
      version: VERSION,
    };
    setPrefs(payload);
    writeCookie(payload);
    applyConsent(payload);
    setShowBanner(false);
    setShowModal(false);
  };

  if (!ready) return null;

  return (
    <>
      {showBanner && (
        <div className="fixed inset-x-0 bottom-0 z-[90] p-3">
          <div className="mx-auto max-w-5xl rounded-2xl border border-slate-300 bg-white p-4 shadow-2xl">
            <h3 className="text-base md:text-lg font-semibold text-slate-900">
              We use cookies to power your experience
            </h3>
            <p className="mt-2 text-sm text-slate-700 leading-relaxed">
              Arthastra AI uses cookies and similar technologies to keep you logged in, understand how you use the platform, and (with your consent) deliver personalized ads. Some cookies are required for the platform to work. Others help us improve and fund the platform through advertising.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() =>
                  save({
                    necessary: true,
                    functional: true,
                    analytics: true,
                    advertising: true,
                  })
                }
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                Accept All Cookies
              </button>
              <button
                onClick={() =>
                  save({
                    necessary: true,
                    functional: true,
                    analytics: true,
                    advertising: false,
                  })
                }
                className="px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-slate-800 text-sm font-semibold"
              >
                Decline Non-Essential
              </button>
              <button
                onClick={() => setShowModal(true)}
                className="px-2 py-1 text-sm underline text-slate-700 hover:text-slate-900"
              >
                Manage My Preferences
              </button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
          <button
            className="absolute inset-0 bg-black/45"
            onClick={() => setShowModal(false)}
            aria-label="Close cookie settings"
          />
          <div className="relative w-full max-w-2xl rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-slate-900">Manage Cookie Preferences</h3>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Strictly Necessary</div>
                    <div className="text-xs text-slate-600 mt-1">Required for the platform to function. Enables login, security, and sessions.</div>
                  </div>
                  <span className="text-xs font-semibold text-blue-700">Always On</span>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Functional</div>
                    <div className="text-xs text-slate-600 mt-1">Remembers your preferences and settings like dark mode and simulator layout.</div>
                  </div>
                  <input type="checkbox" checked={Boolean(prefs.functional)} onChange={(e) => setPrefs((p) => ({ ...p, functional: e.target.checked }))} />
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Analytics</div>
                    <div className="text-xs text-slate-600 mt-1">Helps us understand how you use Arthastra AI so we can improve it. Data is aggregated. Provider: Google Analytics.</div>
                  </div>
                  <input type="checkbox" checked={Boolean(prefs.analytics)} onChange={(e) => setPrefs((p) => ({ ...p, analytics: e.target.checked }))} />
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Advertising</div>
                    <div className="text-xs text-slate-600 mt-1">Used to show relevant ads on and off Arthastra AI. May share data with Google and Meta. May track you across other websites.</div>
                  </div>
                  <input type="checkbox" checked={Boolean(prefs.advertising)} onChange={(e) => setPrefs((p) => ({ ...p, advertising: e.target.checked }))} />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => save(prefs)}
                className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                Save My Preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
