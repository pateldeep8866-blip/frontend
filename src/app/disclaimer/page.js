"use client";

import LegalPageShell from "../../components/LegalPageShell";

export default function DisclaimerPage() {
  return (
    <LegalPageShell
      title="Financial Disclaimer"
      effectiveDate="February 26, 2026"
      lastUpdated="February 26, 2026"
    >
      <section>
        <h2 className="text-base font-semibold text-white">1. NOT FINANCIAL ADVICE</h2>
        <p className="mt-2">All content, tools, signals, analysis, simulations, ASTRA outputs, QUANT_LAB signals, educational materials, and any other information provided by Arthastra AI is for EDUCATIONAL AND INFORMATIONAL PURPOSES ONLY.</p>
        <p className="mt-2">The Content does not constitute:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Financial or investment advice</li>
          <li>A recommendation to buy, sell, or hold any security or cryptocurrency</li>
          <li>A solicitation to buy or sell any security</li>
          <li>Tax or legal advice</li>
          <li>A guarantee of any outcome</li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">2. NOT A REGISTERED PROFESSIONAL</h2>
        <p className="mt-2">Arthastra AI is NOT:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>A registered investment adviser</li>
          <li>A broker-dealer registered with FINRA or the SEC</li>
          <li>A fiduciary</li>
          <li>A licensed financial planner or analyst</li>
        </ul>
        <p className="mt-2">No use of Arthastra AI creates any advisory, client, or fiduciary relationship.</p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">3. SIMULATED RESULTS DISCLOSURE</h2>
        <p className="mt-2 font-semibold">SIMULATED TRADING RESULTS HAVE INHERENT LIMITATIONS AND DO NOT REPRESENT ACTUAL TRADING.</p>
        <p className="mt-2">Simulations cannot account for:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Liquidity constraints</li>
          <li>Bid-ask spreads</li>
          <li>Slippage</li>
          <li>Brokerage commissions</li>
          <li>Taxes</li>
          <li>Real-world execution constraints</li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">4. ASTRA AND QUANT_LAB DISCLOSURE</h2>
        <p className="mt-2">ASTRA is an automated decision-support tool for the Arthastra AI simulator. QUANT_LAB is a quantitative research engine. Both are educational tools:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Their outputs are simulated signals, not real financial advice</li>
          <li>Accuracy in simulation does not guarantee accuracy in real markets</li>
          <li>They do not account for your personal financial situation</li>
          <li>They are not registered investment advisers or broker-dealers</li>
          <li>Using their outputs with real money is done entirely at your own risk</li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">5. RISK OF REAL TRADING</h2>
        <p className="mt-2">If you trade real securities based on anything you see on this Platform:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>You do so entirely at your own risk</li>
          <li>You may lose all invested capital</li>
          <li>Arthastra AI bears no responsibility for real-world trading outcomes</li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-white">6. INDEPENDENT VERIFICATION</h2>
        <p className="mt-2">Before any real financial decision:</p>
        <ul className="mt-1 list-disc pl-5 space-y-1">
          <li>Consult a licensed financial adviser</li>
          <li>Conduct your own due diligence</li>
          <li>Consider your personal risk tolerance</li>
          <li>Consult a tax professional</li>
          <li>Read all relevant prospectuses and disclosures</li>
        </ul>
      </section>

      <section><h2 className="text-base font-semibold text-white">7. MARKET DATA</h2><p className="mt-2">Market data may be delayed, incomplete, or inaccurate. Do not rely on Platform data for real trading decisions.</p></section>
      <section><h2 className="text-base font-semibold text-white">8. CONTACT</h2><p className="mt-2">legal@arthastraai.com<br />arthastraai.com</p></section>
    </LegalPageShell>
  );
}
