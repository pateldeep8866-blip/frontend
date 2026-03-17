/**
 * Goal Planner Projection Utilities
 *
 * Calculates realistic investment projection ranges based on risk level,
 * market preference, duration, and monthly contributions.
 *
 * ⚠️ These are estimates based on historical averages — not financial guarantees.
 * Replace the RETURN_RANGES table with AI/signal-based values when ready.
 */

// ── Return rate assumptions ──────────────────────────────────────────────────
// Annualized [low%, high%] based on broad historical market data.
// Conservative: capital-preservation focused
// Moderate:     balanced growth
// Aggressive:   high-growth, high-variance

const RETURN_RANGES = {
  conservative: {
    stocks: [0.04, 0.07],
    etfs:   [0.04, 0.07],
    crypto: [0.03, 0.09],
    gold:   [0.03, 0.06],
    mixed:  [0.04, 0.07],
  },
  moderate: {
    stocks: [0.07, 0.13],
    etfs:   [0.06, 0.11],
    crypto: [0.08, 0.22],
    gold:   [0.05, 0.09],
    mixed:  [0.07, 0.12],
  },
  aggressive: {
    stocks: [0.10, 0.22],
    etfs:   [0.09, 0.18],
    crypto: [0.15, 0.50],
    gold:   [0.06, 0.13],
    mixed:  [0.10, 0.25],
  },
};

// ── Volatility labels ────────────────────────────────────────────────────────
const RISK_LABELS = {
  conservative: "Low Volatility",
  moderate:     "Medium Volatility",
  aggressive:   "High Volatility",
};

// ── Suggested portfolio allocations ─────────────────────────────────────────
// Each entry: { label, pct, color }
export const ALLOCATIONS = {
  conservative: {
    stocks: [
      { label: "Dividend Stocks",    pct: 40, color: "#3b82f6" },
      { label: "Bond ETFs",          pct: 30, color: "#10b981" },
      { label: "Index ETFs",         pct: 20, color: "#8b5cf6" },
      { label: "Cash / Stable",      pct: 10, color: "#64748b" },
    ],
    etfs: [
      { label: "Bond ETFs",          pct: 40, color: "#10b981" },
      { label: "Equity ETFs",        pct: 35, color: "#3b82f6" },
      { label: "Gold / Commodities", pct: 15, color: "#f59e0b" },
      { label: "Cash",               pct: 10, color: "#64748b" },
    ],
    crypto: [
      { label: "Stablecoins / DeFi", pct: 40, color: "#10b981" },
      { label: "Bond / Equity ETFs", pct: 30, color: "#3b82f6" },
      { label: "Gold",               pct: 20, color: "#f59e0b" },
      { label: "BTC (small position)",pct: 10, color: "#f97316" },
    ],
    gold: [
      { label: "Physical Gold / GLD",pct: 50, color: "#f59e0b" },
      { label: "Silver / Metals",    pct: 20, color: "#94a3b8" },
      { label: "Bond ETFs",          pct: 20, color: "#10b981" },
      { label: "Cash",               pct: 10, color: "#64748b" },
    ],
    mixed: [
      { label: "ETFs / Index Funds", pct: 35, color: "#3b82f6" },
      { label: "Bonds",              pct: 30, color: "#10b981" },
      { label: "Gold",               pct: 20, color: "#f59e0b" },
      { label: "Dividend Stocks",    pct: 15, color: "#8b5cf6" },
    ],
  },
  moderate: {
    stocks: [
      { label: "Growth Stocks",      pct: 50, color: "#3b82f6" },
      { label: "Index ETFs",         pct: 25, color: "#8b5cf6" },
      { label: "Bonds",              pct: 15, color: "#10b981" },
      { label: "Cash",               pct: 10, color: "#64748b" },
    ],
    etfs: [
      { label: "Equity ETFs (S&P, QQQ)", pct: 55, color: "#3b82f6" },
      { label: "Bond ETFs",          pct: 25, color: "#10b981" },
      { label: "Sector ETFs",        pct: 15, color: "#8b5cf6" },
      { label: "Cash",               pct:  5, color: "#64748b" },
    ],
    crypto: [
      { label: "BTC / ETH",          pct: 40, color: "#f97316" },
      { label: "Growth Stocks",      pct: 30, color: "#3b82f6" },
      { label: "Equity ETFs",        pct: 20, color: "#8b5cf6" },
      { label: "Stablecoins",        pct: 10, color: "#10b981" },
    ],
    gold: [
      { label: "Gold / GLD ETF",     pct: 40, color: "#f59e0b" },
      { label: "Growth Stocks",      pct: 30, color: "#3b82f6" },
      { label: "Bonds",              pct: 20, color: "#10b981" },
      { label: "Silver / Metals",    pct: 10, color: "#94a3b8" },
    ],
    mixed: [
      { label: "Stocks",             pct: 40, color: "#3b82f6" },
      { label: "ETFs",               pct: 25, color: "#8b5cf6" },
      { label: "Bonds",              pct: 15, color: "#10b981" },
      { label: "Crypto",             pct: 10, color: "#f97316" },
      { label: "Gold",               pct: 10, color: "#f59e0b" },
    ],
  },
  aggressive: {
    stocks: [
      { label: "Tech / Growth Stocks",pct: 60, color: "#3b82f6" },
      { label: "Small Cap / Emerging",pct: 20, color: "#8b5cf6" },
      { label: "Crypto",             pct: 15, color: "#f97316" },
      { label: "ETFs",               pct:  5, color: "#64748b" },
    ],
    etfs: [
      { label: "Leveraged ETFs",     pct: 40, color: "#3b82f6" },
      { label: "Sector ETFs (Tech/AI)",pct:35, color: "#8b5cf6" },
      { label: "Crypto ETFs",        pct: 15, color: "#f97316" },
      { label: "Cash",               pct: 10, color: "#64748b" },
    ],
    crypto: [
      { label: "BTC / ETH",          pct: 50, color: "#f97316" },
      { label: "Alt Coins (SOL etc)",pct: 25, color: "#8b5cf6" },
      { label: "Growth Stocks",      pct: 20, color: "#3b82f6" },
      { label: "Stablecoins (buffer)",pct: 5, color: "#10b981" },
    ],
    gold: [
      { label: "Gold Miners (GDX)",  pct: 40, color: "#f59e0b" },
      { label: "Growth Stocks",      pct: 30, color: "#3b82f6" },
      { label: "Physical Gold / GLD",pct: 20, color: "#d97706" },
      { label: "Crypto",             pct: 10, color: "#f97316" },
    ],
    mixed: [
      { label: "Growth Stocks",      pct: 35, color: "#3b82f6" },
      { label: "Crypto",             pct: 30, color: "#f97316" },
      { label: "Sector ETFs",        pct: 20, color: "#8b5cf6" },
      { label: "Gold / Commodities", pct: 10, color: "#f59e0b" },
      { label: "Cash",               pct:  5, color: "#64748b" },
    ],
  },
};

// ── Strategy descriptions ────────────────────────────────────────────────────
const STRATEGY_DESCRIPTIONS = {
  conservative: {
    stocks: "Focus on stable, dividend-paying companies with proven track records. Capital preservation comes first, with steady income from dividends and modest appreciation over time.",
    etfs:   "A diversified foundation using broad-market ETFs and bond funds. Low cost, low volatility — tracks market indices for predictable long-term growth with minimal active management.",
    crypto: "Minimal crypto exposure weighted toward stablecoins and DeFi yields. The bulk stays in traditional hedges to dampen volatility. Suitable if you want crypto exposure without major risk.",
    gold:   "Preserve purchasing power through precious metals and commodity-backed instruments. Gold historically performs well during market downturns and inflationary periods.",
    mixed:  "A defensive blend across asset classes to reduce concentration risk. Each allocation hedges against the others, prioritizing stability and downside protection first.",
  },
  moderate: {
    stocks: "Balance growth and stability with a mix of large-cap growth stocks and index ETFs. Positioned for market upside while bonds provide a buffer during downturns.",
    etfs:   "Core-satellite approach: broad-market ETFs as the foundation, supplemented by sector ETFs for targeted growth. Low-cost, well-diversified, and easy to maintain.",
    crypto: "Measured crypto exposure in established assets (BTC/ETH) paired with growth stocks. Captures digital asset upside while traditional holdings reduce overall portfolio swings.",
    gold:   "Gold's inflation-hedging properties blended with equity growth potential. A useful strategy in uncertain macro environments where both inflation and equity risk are elevated.",
    mixed:  "Classic multi-asset portfolio spreading risk across five categories. Designed to participate in multiple market cycles without over-concentrating in any single area.",
  },
  aggressive: {
    stocks: "High-conviction positioning in technology, AI, and high-growth sectors. Accepts higher short-term volatility in exchange for potential outsized long-term capital gains.",
    etfs:   "Leveraged and thematic ETFs targeting high-growth sectors. Higher risk profile — best suited for long time horizons and investors who can tolerate significant drawdowns.",
    crypto: "Maximum digital asset exposure in dominant coins and high-potential alts. Extremely volatile — only suitable if you can withstand 50–80% short-term drawdowns without panic selling.",
    gold:   "Gold mining equities amplify gold price moves. Combined with growth stocks and crypto for investors seeking inflation protection alongside aggressive growth potential.",
    mixed:  "High-growth across multiple frontiers — equities, crypto, and sector bets. Aims for maximum returns over a 5+ year horizon with full acceptance of significant drawdowns.",
  },
};

// ── Core math ────────────────────────────────────────────────────────────────
/**
 * Future value with regular monthly contributions (compound growth + annuity).
 * Formula: FV = P(1+r)^n  +  PMT * [((1+r)^n - 1) / r]
 * where r = monthly rate, n = number of months
 */
function futureValue(principal, annualRate, months, monthlyContribution = 0) {
  if (months === 0) return principal;
  const r = annualRate / 12;
  if (r === 0) return principal + monthlyContribution * months;
  const growth = Math.pow(1 + r, months);
  return principal * growth + monthlyContribution * ((growth - 1) / r);
}

/** Pick natural milestone checkpoints within the given duration. */
function getMilestoneMonths(totalMonths) {
  const candidates = [1, 3, 6, 12, 24, 36, 60];
  return candidates.filter((m) => m < totalMonths);
}

// ── Public API ───────────────────────────────────────────────────────────────
/**
 * calculateProjection — main entry point.
 *
 * @param {object} params
 * @param {number} params.initialAmount        Starting investment (USD)
 * @param {number} params.durationMonths       Investment horizon (months)
 * @param {"conservative"|"moderate"|"aggressive"} params.riskLevel
 * @param {"stocks"|"etfs"|"crypto"|"gold"|"mixed"} params.marketPreference
 * @param {number} [params.monthlyContribution=0]  Monthly add-on (USD)
 * @param {"steady"|"growth"} [params.targetStyle="steady"]
 *        "growth" shifts the optimistic rate up ~15% to model a higher-upside scenario
 *
 * @returns {{
 *   projectedLow: number,
 *   projectedHigh: number,
 *   totalContributed: number,
 *   annualRateLow: number,
 *   annualRateHigh: number,
 *   volatility: string,
 *   allocation: Array<{label:string, pct:number, color:string}>,
 *   milestones: Array<{month:number, label:string, low:number, high:number, isFinal?:boolean}>,
 *   strategySummary: string,
 * }}
 */
export function calculateProjection({
  initialAmount,
  durationMonths,
  riskLevel = "moderate",
  marketPreference = "stocks",
  monthlyContribution = 0,
  targetStyle = "steady",
}) {
  const [lowRate, highRate] = RETURN_RANGES[riskLevel][marketPreference];

  // "growth" style bumps the optimistic ceiling slightly (not the floor)
  const effectiveLow  = lowRate;
  const effectiveHigh = targetStyle === "growth" ? highRate * 1.15 : highRate;

  const projectedLow  = futureValue(initialAmount, effectiveLow,  durationMonths, monthlyContribution);
  const projectedHigh = futureValue(initialAmount, effectiveHigh, durationMonths, monthlyContribution);
  const totalContributed = initialAmount + monthlyContribution * durationMonths;

  // Build milestone list
  const milestoneMonths = getMilestoneMonths(durationMonths);
  const milestones = milestoneMonths.map((m) => ({
    month: m,
    label: m < 12 ? `${m}mo` : m % 12 === 0 ? `${m / 12}yr` : `${(m / 12).toFixed(1)}yr`,
    low:   Math.round(futureValue(initialAmount, effectiveLow,  m, monthlyContribution)),
    high:  Math.round(futureValue(initialAmount, effectiveHigh, m, monthlyContribution)),
  }));

  // Always include the final target as the last milestone
  milestones.push({
    month:   durationMonths,
    label:   durationMonths < 12
      ? `${durationMonths}mo`
      : durationMonths % 12 === 0
        ? `${durationMonths / 12}yr`
        : `${(durationMonths / 12).toFixed(1)}yr`,
    low:     Math.round(projectedLow),
    high:    Math.round(projectedHigh),
    isFinal: true,
  });

  return {
    projectedLow:    Math.round(projectedLow),
    projectedHigh:   Math.round(projectedHigh),
    totalContributed: Math.round(totalContributed),
    annualRateLow:   Math.round(effectiveLow  * 1000) / 10,  // e.g. 7.0
    annualRateHigh:  Math.round(effectiveHigh * 1000) / 10,  // e.g. 13.0
    volatility:      RISK_LABELS[riskLevel],
    allocation:      ALLOCATIONS[riskLevel][marketPreference],
    milestones,
    strategySummary: STRATEGY_DESCRIPTIONS[riskLevel][marketPreference],
  };
}

/** Format a number as compact currency: 1500 → "$1.5k", 1200000 → "$1.2M" */
export function fmtCompact(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

/** Format a number as full dollar string: 12345 → "$12,345" */
export function fmtDollar(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

// ── Ticker suggestions per allocation bucket ─────────────────────────────────
// Each entry: { sym, name, homeRef, mode }
//   sym     — Yahoo Finance symbol (used for price fetching)
//   name    — display name shown in the UI
//   homeRef — symbol passed to /home?company= (crypto uses base only, e.g. "BTC")
//   mode    — "stock" | "crypto" (sets ?mode= in the deep-link)
// Buckets with no tradeable ticker (cash, stablecoins) are omitted intentionally.

export const TICKER_SUGGESTIONS = {
  // ── Stocks ──────────────────────────────────────────────────────────────
  "Dividend Stocks": [
    { sym: "JNJ",  name: "Johnson & Johnson", homeRef: "JNJ",  mode: "stock" },
    { sym: "KO",   name: "Coca-Cola",          homeRef: "KO",   mode: "stock" },
    { sym: "PG",   name: "Procter & Gamble",   homeRef: "PG",   mode: "stock" },
    { sym: "VZ",   name: "Verizon",            homeRef: "VZ",   mode: "stock" },
  ],
  "Growth Stocks": [
    { sym: "NVDA", name: "Nvidia",             homeRef: "NVDA", mode: "stock" },
    { sym: "MSFT", name: "Microsoft",          homeRef: "MSFT", mode: "stock" },
    { sym: "AAPL", name: "Apple",              homeRef: "AAPL", mode: "stock" },
    { sym: "AMZN", name: "Amazon",             homeRef: "AMZN", mode: "stock" },
  ],
  "Tech / Growth Stocks": [
    { sym: "NVDA",  name: "Nvidia",            homeRef: "NVDA",  mode: "stock" },
    { sym: "MSFT",  name: "Microsoft",         homeRef: "MSFT",  mode: "stock" },
    { sym: "META",  name: "Meta Platforms",    homeRef: "META",  mode: "stock" },
    { sym: "GOOGL", name: "Alphabet",          homeRef: "GOOGL", mode: "stock" },
  ],
  "Small Cap / Emerging": [
    { sym: "IWM", name: "iShares Russell 2000", homeRef: "IWM", mode: "stock" },
    { sym: "EEM", name: "iShares MSCI Emerging", homeRef: "EEM", mode: "stock" },
    { sym: "VWO", name: "Vanguard Emerging Mkts", homeRef: "VWO", mode: "stock" },
  ],
  "Stocks": [
    { sym: "SPY",  name: "S&P 500 ETF",        homeRef: "SPY",  mode: "stock" },
    { sym: "NVDA", name: "Nvidia",              homeRef: "NVDA", mode: "stock" },
    { sym: "MSFT", name: "Microsoft",           homeRef: "MSFT", mode: "stock" },
    { sym: "AAPL", name: "Apple",               homeRef: "AAPL", mode: "stock" },
  ],

  // ── ETFs ────────────────────────────────────────────────────────────────
  "ETFs / Index Funds": [
    { sym: "SPY",  name: "SPDR S&P 500",        homeRef: "SPY",  mode: "stock" },
    { sym: "QQQ",  name: "Invesco QQQ (Nasdaq)", homeRef: "QQQ",  mode: "stock" },
    { sym: "VTI",  name: "Vanguard Total Stock", homeRef: "VTI",  mode: "stock" },
    { sym: "SCHB", name: "Schwab US Broad Mkt",  homeRef: "SCHB", mode: "stock" },
  ],
  "Index ETFs": [
    { sym: "SPY",  name: "SPDR S&P 500",         homeRef: "SPY",  mode: "stock" },
    { sym: "QQQ",  name: "Invesco QQQ (Nasdaq)",  homeRef: "QQQ",  mode: "stock" },
    { sym: "VTI",  name: "Vanguard Total Stock",  homeRef: "VTI",  mode: "stock" },
  ],
  "Equity ETFs": [
    { sym: "SPY",  name: "SPDR S&P 500",         homeRef: "SPY",  mode: "stock" },
    { sym: "QQQ",  name: "Invesco QQQ",           homeRef: "QQQ",  mode: "stock" },
    { sym: "VTI",  name: "Vanguard Total Stock",  homeRef: "VTI",  mode: "stock" },
  ],
  "Equity ETFs (S&P, QQQ)": [
    { sym: "SPY",  name: "SPDR S&P 500",         homeRef: "SPY",  mode: "stock" },
    { sym: "QQQ",  name: "Invesco QQQ",           homeRef: "QQQ",  mode: "stock" },
    { sym: "VOO",  name: "Vanguard S&P 500",      homeRef: "VOO",  mode: "stock" },
  ],
  "Bond / Equity ETFs": [
    { sym: "AGG",  name: "iShares Core US Bond",  homeRef: "AGG",  mode: "stock" },
    { sym: "SPY",  name: "SPDR S&P 500",          homeRef: "SPY",  mode: "stock" },
    { sym: "BND",  name: "Vanguard Total Bond",   homeRef: "BND",  mode: "stock" },
  ],
  "ETFs": [
    { sym: "SPY",  name: "SPDR S&P 500",          homeRef: "SPY",  mode: "stock" },
    { sym: "QQQ",  name: "Invesco QQQ",            homeRef: "QQQ",  mode: "stock" },
    { sym: "VTI",  name: "Vanguard Total Stock",   homeRef: "VTI",  mode: "stock" },
  ],
  "Sector ETFs": [
    { sym: "XLK",  name: "Technology Select SPDR", homeRef: "XLK",  mode: "stock" },
    { sym: "XLF",  name: "Financial Select SPDR",  homeRef: "XLF",  mode: "stock" },
    { sym: "XLV",  name: "Health Care Select SPDR",homeRef: "XLV",  mode: "stock" },
  ],
  "Sector ETFs (Tech/AI)": [
    { sym: "XLK",  name: "Technology Select SPDR", homeRef: "XLK",  mode: "stock" },
    { sym: "SOXX", name: "iShares Semiconductor",  homeRef: "SOXX", mode: "stock" },
    { sym: "BOTZ", name: "Global X Robotics & AI", homeRef: "BOTZ", mode: "stock" },
  ],
  "Leveraged ETFs": [
    { sym: "TQQQ", name: "ProShares UltraPro QQQ", homeRef: "TQQQ", mode: "stock" },
    { sym: "UPRO", name: "ProShares UltraPro S&P500", homeRef: "UPRO", mode: "stock" },
    { sym: "SOXL", name: "Direxion Semi 3x Bull",  homeRef: "SOXL", mode: "stock" },
  ],
  "Crypto ETFs": [
    { sym: "GBTC", name: "Grayscale Bitcoin Trust",  homeRef: "GBTC", mode: "stock" },
    { sym: "ETHA", name: "iShares Ethereum ETF",     homeRef: "ETHA", mode: "stock" },
    { sym: "BITB", name: "Bitwise Bitcoin ETF",      homeRef: "BITB", mode: "stock" },
  ],

  // ── Bonds ────────────────────────────────────────────────────────────────
  "Bond ETFs": [
    { sym: "TLT",  name: "iShares 20+ Year Treasury", homeRef: "TLT", mode: "stock" },
    { sym: "AGG",  name: "iShares Core US Bond",      homeRef: "AGG", mode: "stock" },
    { sym: "BND",  name: "Vanguard Total Bond",       homeRef: "BND", mode: "stock" },
  ],
  "Bonds": [
    { sym: "TLT",  name: "iShares 20+ Year Treasury", homeRef: "TLT", mode: "stock" },
    { sym: "AGG",  name: "iShares Core US Bond",      homeRef: "AGG", mode: "stock" },
    { sym: "SHY",  name: "iShares 1-3 Year Treasury", homeRef: "SHY", mode: "stock" },
  ],

  // ── Gold / Metals ────────────────────────────────────────────────────────
  "Gold / GLD ETF": [
    { sym: "GLD",  name: "SPDR Gold Shares",           homeRef: "GLD",  mode: "stock" },
    { sym: "IAU",  name: "iShares Gold Trust",         homeRef: "IAU",  mode: "stock" },
  ],
  "Physical Gold / GLD": [
    { sym: "GLD",  name: "SPDR Gold Shares",           homeRef: "GLD",  mode: "stock" },
    { sym: "IAU",  name: "iShares Gold Trust",         homeRef: "IAU",  mode: "stock" },
    { sym: "SGOL", name: "Aberdeen Physical Gold ETF", homeRef: "SGOL", mode: "stock" },
  ],
  "Gold": [
    { sym: "GLD",  name: "SPDR Gold Shares",           homeRef: "GLD",  mode: "stock" },
    { sym: "IAU",  name: "iShares Gold Trust",         homeRef: "IAU",  mode: "stock" },
  ],
  "Gold / Commodities": [
    { sym: "GLD",  name: "SPDR Gold Shares",           homeRef: "GLD",  mode: "stock" },
    { sym: "IAU",  name: "iShares Gold Trust",         homeRef: "IAU",  mode: "stock" },
    { sym: "DJP",  name: "iPath Bloomberg Commodity",  homeRef: "DJP",  mode: "stock" },
  ],
  "Silver / Metals": [
    { sym: "SLV",  name: "iShares Silver Trust",       homeRef: "SLV",  mode: "stock" },
    { sym: "PSLV", name: "Sprott Physical Silver",     homeRef: "PSLV", mode: "stock" },
  ],
  "Gold Miners (GDX)": [
    { sym: "GDX",  name: "VanEck Gold Miners ETF",     homeRef: "GDX",  mode: "stock" },
    { sym: "GDXJ", name: "VanEck Junior Gold Miners",  homeRef: "GDXJ", mode: "stock" },
    { sym: "NEM",  name: "Newmont Corp",               homeRef: "NEM",  mode: "stock" },
  ],

  // ── Crypto ───────────────────────────────────────────────────────────────
  "BTC / ETH": [
    { sym: "BTC-USD", name: "Bitcoin",  homeRef: "BTC", mode: "crypto" },
    { sym: "ETH-USD", name: "Ethereum", homeRef: "ETH", mode: "crypto" },
  ],
  "BTC (small position)": [
    { sym: "BTC-USD", name: "Bitcoin",  homeRef: "BTC", mode: "crypto" },
  ],
  "Alt Coins (SOL etc)": [
    { sym: "SOL-USD",  name: "Solana",    homeRef: "SOL",  mode: "crypto" },
    { sym: "BNB-USD",  name: "BNB",       homeRef: "BNB",  mode: "crypto" },
    { sym: "AVAX-USD", name: "Avalanche", homeRef: "AVAX", mode: "crypto" },
  ],
  "Crypto": [
    { sym: "BTC-USD", name: "Bitcoin",  homeRef: "BTC", mode: "crypto" },
    { sym: "ETH-USD", name: "Ethereum", homeRef: "ETH", mode: "crypto" },
    { sym: "SOL-USD", name: "Solana",   homeRef: "SOL", mode: "crypto" },
  ],
};
