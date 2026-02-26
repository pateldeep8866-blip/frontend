"use client";

import LegalPageShell from "../../components/LegalPageShell";

export default function CookiesPage() {
  return (
    <LegalPageShell
      title="Cookie Policy"
      effectiveDate="February 26, 2026"
      lastUpdated="February 26, 2026"
    >
      <section>
        <h2 className="text-base font-semibold text-white">1. WHAT ARE COOKIES</h2>
        <p className="mt-2">Cookies are small text files stored on your device when you visit a website. Similar technologies include web beacons, pixels, and local storage.</p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">2. CATEGORIES WE USE</h2>
        <p className="mt-2 font-semibold">Category 1: Strictly Necessary</p>
        <p className="mt-1">Always active. Cannot be disabled.</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Session authentication</li>
          <li>Security tokens</li>
          <li>Load balancing</li>
          <li>Consent preference storage</li>
        </ul>

        <p className="mt-3 font-semibold">Category 2: Functional</p>
        <p className="mt-1">On by default. You can disable.</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Language preferences</li>
          <li>UI preferences (dark mode, layout)</li>
          <li>Saved simulator settings</li>
          <li>Remember-me functionality</li>
        </ul>

        <p className="mt-3 font-semibold">Category 3: Analytics</p>
        <p className="mt-1">On by default. You can disable.</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Google Analytics (page views, session data, user flows)</li>
          <li>Error and performance tracking</li>
          <li>Feature usage analytics</li>
          <li>A/B testing</li>
        </ul>
        <p className="mt-1">Opt out: tools.google.com/dlpage/gaoptout</p>

        <p className="mt-3 font-semibold">Category 4: Advertising</p>
        <p className="mt-1 font-semibold">OFF BY DEFAULT. Requires your explicit opt-in.</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Google Ads / DoubleClick</li>
          <li>Meta Pixel (Facebook/Instagram)</li>
          <li>Retargeting cookies</li>
          <li>Interest-based advertising</li>
          <li>Affiliate tracking</li>
          <li>Conversion tracking</li>
        </ul>
        <p className="mt-1">These cookies may share your data with advertising networks and may track you across other websites.</p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">3. THIRD-PARTY COOKIES</h2>
        <p className="mt-2">Providers that may set cookies:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Google Analytics and Google Ads</li>
          <li>Meta (Facebook)</li>
          <li>Cloudflare</li>
          <li>Financial data providers</li>
          <li>Affiliate tracking partners</li>
        </ul>
        <p className="mt-2">We do not control third-party cookies.</p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">4. COOKIE DURATIONS</h2>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>Session cookies: deleted on browser close</li>
          <li>Authentication: 30 days</li>
          <li>Analytics: 13-26 months</li>
          <li>Advertising: 30-90 days</li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">5. HOW TO MANAGE COOKIES</h2>
        <p className="mt-2 font-semibold">Our Consent Tool:</p>
        <p className="mt-1">Click "Cookie Settings" in the footer at any time to manage preferences.</p>

        <p className="mt-2 font-semibold">Browser Controls:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Chrome: Settings &gt; Privacy &gt; Cookies</li>
          <li>Firefox: Options &gt; Privacy &gt; Cookies</li>
          <li>Safari: Preferences &gt; Privacy</li>
          <li>Edge: Settings &gt; Privacy &gt; Cookies</li>
        </ul>

        <p className="mt-2 font-semibold">Industry Opt-Out:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Google: adssettings.google.com</li>
          <li>NAI: optout.networkadvertising.org</li>
          <li>DAA: optout.aboutads.info</li>
        </ul>
      </section>

      <section><h2 className="text-base font-semibold text-white">6. DO NOT TRACK</h2><p className="mt-2">We currently do not alter data collection in response to Do Not Track signals.</p></section>
      <section><h2 className="text-base font-semibold text-white">7. CONTACT</h2><p className="mt-2">privacy@arthastraai.com<br />arthastraai.com</p></section>
    </LegalPageShell>
  );
}
