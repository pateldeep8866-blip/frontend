"use client";

import LegalPageShell from "../../components/LegalPageShell";

export default function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      effectiveDate="February 26, 2026"
      lastUpdated="February 26, 2026"
    >
      <p>This Privacy Policy describes how Arthastra AI, operated by Juan M. Ramirez and Deep Patel, collects, uses, shares, and protects your personal information when you use arthastraai.com.</p>

      <section>
        <h2 className="text-base font-semibold text-white">1. INFORMATION WE COLLECT</h2>
        <p className="mt-2 font-semibold">A. Information You Provide:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Name, email, username, password</li>
          <li>Profile information</li>
          <li>Support messages and feedback</li>
        </ul>
        <p className="mt-2 font-semibold">B. Automatically Collected:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>IP address, browser type, device information</li>
          <li>Pages visited, clicks, session duration, referring URLs</li>
          <li>General location from IP address (city/country level)</li>
          <li>Simulator activity including ASTRA interactions and QUANT_LAB signal usage</li>
        </ul>
        <p className="mt-2 font-semibold">C. Cookies and Tracking:</p>
        <p className="mt-1">We use cookies, pixels, and similar technologies. See Cookie Policy for full details. Categories:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Strictly necessary (always active)</li>
          <li>Functional (active by default)</li>
          <li>Analytics (active by default)</li>
          <li>Advertising (requires opt-in)</li>
        </ul>
        <p className="mt-2 font-semibold">D. From Third Parties:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Analytics providers</li>
          <li>Advertising networks</li>
          <li>Market data providers</li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">2. HOW WE USE YOUR INFORMATION</h2>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>Operate and maintain the Platform</li>
          <li>Improve and personalize your experience</li>
          <li>Process transactions</li>
          <li>Send administrative communications</li>
          <li>Send marketing emails (where you opt in)</li>
          <li>Serve relevant advertisements (where consented)</li>
          <li>Conduct analytics and research</li>
          <li>Detect fraud and unauthorized activity</li>
          <li>Comply with legal obligations</li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">3. HOW WE SHARE YOUR INFORMATION</h2>
        <p className="mt-2">We do not sell your personal information.</p>
        <p className="mt-2">We may share with:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Service providers (hosting, analytics, email, payment)</li>
          <li>Advertising partners (with consent)</li>
          <li>Affiliate and referral partners (brokers who pay referral fees)</li>
          <li>Business transfer recipients in case of merger or acquisition</li>
          <li>Legal authorities when required by law</li>
        </ul>
        <p className="mt-2 font-semibold">Affiliate Disclosure:</p>
        <p className="mt-1">We may participate in affiliate programs with financial services companies including brokers and investment platforms. If you click an affiliate link we may receive compensation. This does not affect ASTRA signals or QUANT_LAB analysis.</p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">4. ADVERTISING DATA SHARING</h2>
        <p className="mt-2">With your consent we may share:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Hashed email addresses</li>
          <li>Device identifiers</li>
          <li>Behavioral and usage data</li>
        </ul>
        <p className="mt-2">With advertising partners including:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Google Ads</li>
          <li>Meta (Facebook/Instagram)</li>
          <li>Other advertising networks</li>
        </ul>
        <p className="mt-2">You can opt out via our Cookie Settings at any time.</p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">5. DATA RETENTION</h2>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>Account data: until deletion plus 30 days</li>
          <li>Usage and analytics: up to 36 months aggregated</li>
          <li>Simulator data: up to 24 months</li>
          <li>Legal records: as required by law</li>
        </ul>
        <p className="mt-2">Request deletion at any time: privacy@arthastraai.com</p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">6. DATA SECURITY</h2>
        <p className="mt-2">We use:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>TLS/HTTPS encryption in transit</li>
          <li>Encryption at rest for sensitive data</li>
          <li>Access controls limiting employee access</li>
          <li>Regular security monitoring</li>
        </ul>
        <p className="mt-2">No electronic storage is 100% secure.</p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">7. YOUR RIGHTS</h2>
        <p className="mt-2 font-semibold">All Users:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Access your personal data</li>
          <li>Correct inaccurate data</li>
          <li>Request deletion</li>
          <li>Opt out of marketing emails</li>
          <li>Manage cookie preferences</li>
        </ul>
        <p className="mt-2 font-semibold">California Residents (CCPA/CPRA):</p>
        <p className="mt-1">Right to know, delete, correct, and opt out of sharing of personal information. Contact: privacy@arthastraai.com Subject: California Privacy Request</p>
        <p className="mt-2 font-semibold">European Users (GDPR):</p>
        <p className="mt-1">Rights of access, rectification, erasure, restriction, portability, and objection. Contact: privacy@arthastraai.com</p>
      </section>

      <section><h2 className="text-base font-semibold text-white">8. CHILDREN'S PRIVACY</h2><p className="mt-2">The Platform is not for children under 13. We do not knowingly collect data from children.</p></section>
      <section><h2 className="text-base font-semibold text-white">9. INTERNATIONAL TRANSFERS</h2><p className="mt-2">Your data may be processed in the United States where data protection laws may differ.</p></section>
      <section><h2 className="text-base font-semibold text-white">10. CHANGES TO THIS POLICY</h2><p className="mt-2">We will notify you of material changes by email or prominent notice on the Platform.</p></section>
      <section><h2 className="text-base font-semibold text-white">11. CONTACT</h2><p className="mt-2">privacy@arthastraai.com<br />arthastraai.com</p></section>
    </LegalPageShell>
  );
}
