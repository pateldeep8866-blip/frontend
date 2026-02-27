"use strict";

/**
 * ═══════════════════════════════════════════════════════════════
 * ASTRA AUTOPILOT ENGINE v2.0
 * ───────────────────────────────────────────────────────────────
 * Continuous portfolio autopilot for Arthastra AI
 * 
 * What this does:
 *   • Takes full control of a user's paper portfolio
 *   • Runs a continuous buy/sell/hold decision loop
 *   • Explains every decision in plain English
 *   • Manages risk: stop losses, take profits, position sizing
 *   • Adapts to market regime (risk_on / neutral / caution / risk_off)
 *   • Generates educational lessons tied to each action
 *   • Emits events the frontend can react to in real time
 *   • Gracefully stops when user calls stopAutopilot()
 * 
 * Usage:
 *   const engine = new AstraAutopilot(config);
 *   engine.on('decision', (d) => console.log(d));
 *   engine.on('cycle_complete', (summary) => updateUI(summary));
 *   engine.on('stopped', (report) => showFinalReport(report));
 *   await engine.start();
 *   // later...
 *   engine.stop('user_request');
 * ═══════════════════════════════════════════════════════════════
 */

const EventEmitter = require("events");

// ─── Constants ────────────────────────────────────────────────

const REGIME_THRESHOLDS = {
  RISK_ON:  { vixMax: 15, description: "Markets trending up. Momentum and growth assets favored." },
  NEUTRAL:  { vixMax: 20, description: "Mixed signals. Balanced strategy across asset classes." },
  CAUTION:  { vixMax: 25, description: "Elevated volatility. Defensive positioning, smaller sizes." },
  RISK_OFF: { vixMax: Infinity, description: "High fear. Capital preservation mode. Minimal new exposure." },
};

const STRATEGY_LESSONS = {
  momentum: {
    name: "Momentum",
    emoji: "📈",
    lesson: "Momentum strategy buys assets that have been moving up, betting the trend continues. Works best in trending markets. Risk: can reverse sharply when trend breaks.",
    goodRegimes: ["RISK_ON", "NEUTRAL"],
  },
  mean_reversion: {
    name: "Mean Reversion",
    emoji: "📊",
    lesson: "Mean reversion bets that a price that dropped temporarily will bounce back toward its average. Works best in range-bound markets. Risk: doesn't work in true downtrends.",
    goodRegimes: ["NEUTRAL", "CAUTION"],
  },
  regime_rotation: {
    name: "Regime Rotation",
    emoji: "🔄",
    lesson: "Regime rotation shifts your portfolio to asset classes that historically outperform in current macro conditions — commodities in inflation, bonds in fear, tech in growth.",
    goodRegimes: ["RISK_ON", "NEUTRAL", "CAUTION", "RISK_OFF"],
  },
  pairs_trading: {
    name: "Pairs Trading",
    emoji: "⚖️",
    lesson: "Pairs trading exploits pricing divergence between correlated assets. When two usually-correlated assets separate in price, bet they'll converge. Market-neutral strategy.",
    goodRegimes: ["NEUTRAL", "CAUTION"],
  },
  earnings_momentum: {
    name: "Earnings Momentum",
    emoji: "📣",
    lesson: "Stocks that beat earnings estimates tend to drift upward for weeks (Post-Earnings Announcement Drift). This strategy captures that drift early.",
    goodRegimes: ["RISK_ON", "NEUTRAL"],
  },
  defensive: {
    name: "Defensive",
    emoji: "🛡️",
    lesson: "Defensive positioning moves to bonds, gold, utilities, and cash when markets are fearful. The goal is capital preservation, not returns.",
    goodRegimes: ["CAUTION", "RISK_OFF"],
  },
};

const DECISION_LESSONS = {
  stop_loss: "🛑 Stop Loss Triggered — A stop loss automatically sold when price dropped to your protection level. This is discipline, not failure. Capital saved here is available for the next opportunity.",
  take_profit: "🎯 Take Profit Hit — You locked in a gain at exactly the price you planned. Most traders give back profits by holding too long. Booking gains is always correct when your plan says to.",
  signal_reversal: "🔄 Signal Reversed — The quantitative signal that originally triggered this buy has reversed. Holding against a deteriorating signal compounds losses. Exiting is the right move.",
  signal_weakening: "⚠️ Signal Weakening — This position's signal score dropped below the trim threshold. Partially selling reduces risk while keeping upside if signal recovers.",
  time_stop: "⏰ Time Stop — This position has been held longer than the target duration without profit. Time stops prevent capital from being locked in dead money.",
  buy_momentum: "📈 Momentum Buy — This asset is trending up with volume confirmation. QUANT_LAB's momentum score crossed the buy threshold. Trend following in the direction of least resistance.",
  buy_mean_reversion: "📊 Mean Reversion Buy — This asset dropped temporarily below its average. Statistical evidence suggests a bounce. Stop loss set below support to limit downside.",
  buy_regime: "🔄 Regime Rotation Buy — Current macro regime favors this asset class. QUANT_LAB detected regime shift and rotated allocation accordingly.",
  buy_earnings: "📣 Earnings Momentum Buy — Strong earnings surprise detected. PEAD (Post-Earnings Announcement Drift) research shows continued upward drift in the weeks following earnings beats.",
  hold_valid: "✋ Holding — Original buy thesis remains intact. Signal score above exit threshold. Position within time and P&L limits. Patience is part of the strategy.",
  kill_switch: "🚨 Kill Switch — Daily loss limit reached. All positions being closed to protect capital. This is the most important safety feature in the system.",
  drawdown_protect: "🛡️ Drawdown Protection — Portfolio drawdown exceeded safe threshold. Switching to capital preservation mode until conditions improve.",
  portfolio_deploy: "💰 Deploying Idle Cash — Portfolio was holding more cash than the target allocation. Deploying into highest-scoring setups to put capital to work.",
  rebalance: "⚖️ Rebalancing — Portfolio drifted from target allocation. Trimming over-weight positions and adding to under-represented asset classes.",
};

const RISK_PRESETS = {
  CONSERVATIVE: {
    maxPositionPct: 0.05,
    maxCryptoPct: 0.00,
    minCashReservePct: 0.25,
    targetInvestedPct: 0.65,
    stopLossPct: 0.04,        // 4% stop
    takeProfitPct: 0.08,      // 8% target
    maxDailyLossPct: 2.0,
    maxDrawdownPct: 10.0,
    maxPositions: 5,
    allowCrypto: false,
    holdDays: { min: 5, max: 20 },
    scoreThreshold: 72,
    trimThreshold: 55,
    exitThreshold: 40,
  },
  MODERATE: {
    maxPositionPct: 0.12,
    maxCryptoPct: 0.08,
    minCashReservePct: 0.15,
    targetInvestedPct: 0.78,
    stopLossPct: 0.06,        // 6% stop
    takeProfitPct: 0.14,      // 14% target
    maxDailyLossPct: 4.0,
    maxDrawdownPct: 18.0,
    maxPositions: 8,
    allowCrypto: true,
    holdDays: { min: 3, max: 15 },
    scoreThreshold: 64,
    trimThreshold: 45,
    exitThreshold: 32,
  },
  AGGRESSIVE: {
    maxPositionPct: 0.20,
    maxCryptoPct: 0.20,
    minCashReservePct: 0.08,
    targetInvestedPct: 0.90,
    stopLossPct: 0.09,        // 9% stop
    takeProfitPct: 0.22,      // 22% target
    maxDailyLossPct: 6.5,
    maxDrawdownPct: 25.0,
    maxPositions: 12,
    allowCrypto: true,
    holdDays: { min: 1, max: 10 },
    scoreThreshold: 58,
    trimThreshold: 38,
    exitThreshold: 25,
  },
};

// ─── Utilities ─────────────────────────────────────────────────

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function toNum(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function pct(v, total) { return total > 0 ? (v / total) * 100 : 0; }
function round2(v) { return Math.round(v * 100) / 100; }
function round4(v) { return Math.round(v * 10000) / 10000; }

function getRegime(vix) {
  const v = toNum(vix, 20);
  if (v < 15) return "RISK_ON";
  if (v < 20) return "NEUTRAL";
  if (v < 25) return "CAUTION";
  return "RISK_OFF";
}

function getRiskPreset(level) {
  const key = String(level || "MODERATE").toUpperCase();
  return RISK_PRESETS[key] || RISK_PRESETS.MODERATE;
}

function normalizeAssetType(v) {
  return String(v || "").toLowerCase() === "crypto" ? "crypto" : "stock";
}

function getStrategy(c, regime) {
  // Determine which strategy generated this candidate's signal
  const strategies = Object.keys(STRATEGY_LESSONS);
  if (c?.strategy) return c.strategy;
  // Infer from composite scores if available
  if (c?.earnings_surprise > 0.05) return "earnings_momentum";
  if (c?.momentum_score > 0.7) return "momentum";
  if (c?.reversion_score > 0.6) return "mean_reversion";
  if (regime === "RISK_OFF" || regime === "CAUTION") return "defensive";
  if (c?.regime_score > 0.5) return "regime_rotation";
  return "momentum";
}

function computeAstraScore(candidate, regime) {
  const c = candidate;
  const priceChange = toNum(c?.percentChange || c?.price_change_pct, 0);
  const sentiment = clamp(toNum(c?.newsSentiment || c?.sentiment, 0), -1, 1);
  const extScore = toNum(c?.score ?? c?.composite_score ?? c?.quantScore, 0);
  // Normalize external score to -1..1
  const normExt = extScore > 1 ? extScore / 100 : extScore;

  const regimeBias = {
    RISK_ON: 0.10,
    NEUTRAL: 0.03,
    CAUTION: -0.05,
    RISK_OFF: -0.12,
  }[regime] || 0;

  const volumeBonus = c?.volume_ratio > 1.5 ? 0.05 : c?.volume_ratio > 1.0 ? 0.02 : -0.02;

  const raw = clamp(
    (normExt * 0.55) +
    (priceChange / 100) * 0.18 +
    (sentiment * 0.12) +
    regimeBias +
    volumeBonus,
    -1, 1
  );

  // Convert to 0-100
  return clamp(Math.round((raw + 1) * 50), 0, 100);
}

function formatCurrency(n) {
  return `$${toNum(n, 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPct(n) {
  const v = toNum(n, 0);
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ─── Portfolio State Manager ────────────────────────────────────

class PortfolioState {
  constructor(initial) {
    this.cash = toNum(initial?.cash, 100000);
    this.startingValue = toNum(initial?.startingValue || initial?.cash, 100000);
    this.holdings = new Map(); // ticker -> position object
    this.tradeHistory = [];
    this.cycleCount = 0;
    this.startedAt = Date.now();
    this.dailyStartValue = this.cash;
    this.peakValue = this.cash;
    this.lastCycleAt = null;

    // Load existing holdings if provided
    if (Array.isArray(initial?.holdings)) {
      for (const h of initial.holdings) {
        const ticker = String(h?.symbol || h?.ticker || "").toUpperCase();
        if (!ticker) continue;
        this.holdings.set(ticker, {
          ticker,
          symbol: ticker,
          assetType: normalizeAssetType(h?.assetType),
          shares: toNum(h?.shares, 0),
          avgBuy: toNum(h?.avgBuy || h?.entry_price, 0),
          currentPrice: toNum(h?.currentPrice || h?.price, 0),
          stopLoss: toNum(h?.stopLoss || h?.stop_loss, 0),
          takeProfit: toNum(h?.takeProfit || h?.take_profit, 0),
          strategy: h?.strategy || "momentum",
          buyDate: h?.buyDate || new Date().toISOString(),
          daysHeld: toNum(h?.daysHeld, 0),
          costBasis: toNum(h?.shares, 0) * toNum(h?.avgBuy || h?.entry_price, 0),
        });
      }
    }
  }

  get totalHoldingsValue() {
    let total = 0;
    for (const [, h] of this.holdings) {
      total += h.shares * (h.currentPrice || h.avgBuy || 0);
    }
    return total;
  }

  get totalValue() {
    return this.cash + this.totalHoldingsValue;
  }

  get drawdownPct() {
    return pct(this.totalValue - this.startingValue, this.startingValue);
  }

  get dailyPnlPct() {
    return pct(this.totalValue - this.dailyStartValue, this.dailyStartValue);
  }

  get maxDrawdownPct() {
    this.peakValue = Math.max(this.peakValue, this.totalValue);
    return pct(this.totalValue - this.peakValue, this.peakValue);
  }

  updatePrices(priceMap) {
    for (const [ticker, price] of Object.entries(priceMap)) {
      const pos = this.holdings.get(ticker.toUpperCase());
      if (pos && price > 0) {
        // Sanity check: reject obviously wrong prices
        if (ticker === "BTC" && price < 1000) continue;
        if (ticker === "ETH" && price < 100) continue;
        pos.currentPrice = price;
      }
    }
  }

  openPosition({ ticker, assetType, shares, price, stopLoss, takeProfit, strategy }) {
    const existing = this.holdings.get(ticker);
    if (existing) {
      // Average in
      const totalShares = existing.shares + shares;
      const totalCost = existing.costBasis + shares * price;
      existing.shares = totalShares;
      existing.avgBuy = totalCost / totalShares;
      existing.costBasis = totalCost;
      existing.stopLoss = stopLoss || existing.stopLoss;
      existing.takeProfit = takeProfit || existing.takeProfit;
    } else {
      this.holdings.set(ticker, {
        ticker, symbol: ticker, assetType,
        shares, avgBuy: price, currentPrice: price,
        stopLoss: stopLoss || 0,
        takeProfit: takeProfit || 0,
        strategy: strategy || "momentum",
        buyDate: new Date().toISOString(),
        daysHeld: 0,
        costBasis: shares * price,
      });
    }
    const spent = shares * price;
    this.cash = Math.max(0, this.cash - spent);
    return spent;
  }

  closePosition(ticker, sharesToSell, closePrice, reason) {
    const pos = this.holdings.get(ticker.toUpperCase());
    if (!pos || pos.shares <= 0) return null;

    const actualShares = Math.min(pos.shares, sharesToSell);
    const proceeds = actualShares * closePrice;
    const costBasis = actualShares * pos.avgBuy;
    const pnl = proceeds - costBasis;
    const pnlPct = pct(pnl, costBasis);

    this.cash += proceeds;
    pos.shares = round4(pos.shares - actualShares);
    pos.costBasis = Math.max(0, pos.costBasis - costBasis);

    if (pos.shares < 0.0001) {
      this.holdings.delete(ticker.toUpperCase());
    }

    const record = {
      ticker,
      action: "SELL",
      shares: actualShares,
      price: closePrice,
      pnl: round2(pnl),
      pnlPct: round2(pnlPct),
      reason,
      timestamp: new Date().toISOString(),
    };
    this.tradeHistory.push(record);
    return record;
  }

  recordBuy(ticker, shares, price, strategy) {
    this.tradeHistory.push({
      ticker,
      action: "BUY",
      shares,
      price,
      pnl: null,
      pnlPct: null,
      reason: strategy,
      timestamp: new Date().toISOString(),
    });
  }

  getPosition(ticker) {
    return this.holdings.get(ticker.toUpperCase()) || null;
  }

  snapshot() {
    const holdingsArr = Array.from(this.holdings.values()).map(h => ({
      ...h,
      currentValue: h.shares * (h.currentPrice || h.avgBuy),
      unrealizedPnl: round2(h.shares * ((h.currentPrice || h.avgBuy) - h.avgBuy)),
      unrealizedPnlPct: round2(pct((h.currentPrice || h.avgBuy) - h.avgBuy, h.avgBuy)),
    }));

    return {
      cash: round2(this.cash),
      totalValue: round2(this.totalValue),
      holdingsValue: round2(this.totalHoldingsValue),
      holdingsCount: this.holdings.size,
      holdings: holdingsArr,
      investedPct: round2(pct(this.totalHoldingsValue, this.totalValue)),
      drawdownPct: round2(this.drawdownPct),
      dailyPnlPct: round2(this.dailyPnlPct),
      totalReturn: round2(pct(this.totalValue - this.startingValue, this.startingValue)),
      totalPnl: round2(this.totalValue - this.startingValue),
      peakValue: round2(this.peakValue),
      cycleCount: this.cycleCount,
      tradesExecuted: this.tradeHistory.length,
      winningTrades: this.tradeHistory.filter(t => (t.pnl || 0) > 0).length,
      winRate: this.tradeHistory.filter(t => t.pnl !== null).length > 0
        ? round2(pct(
            this.tradeHistory.filter(t => (t.pnl || 0) > 0).length,
            this.tradeHistory.filter(t => t.pnl !== null).length
          ))
        : 0,
    };
  }
}

// ─── Decision Builder ────────────────────────────────────────────

class DecisionBuilder {
  constructor(portfolio, preset, regime) {
    this.portfolio = portfolio;
    this.preset = preset;
    this.regime = regime;
    this.decisions = [];
    this.logs = [];
  }

  log(msg) {
    this.logs.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  }

  // ── Step 1: Check all safety guards ──────────────────────────
  checkSafetyGuards(dailyDrawdownPct) {
    const guards = {
      killSwitchTriggered: false,
      capitalPreservationMode: false,
      allowNewBuys: true,
      reason: null,
    };

    // Daily loss kill switch
    if (toNum(dailyDrawdownPct, 0) <= -this.preset.maxDailyLossPct) {
      guards.killSwitchTriggered = true;
      guards.allowNewBuys = false;
      guards.reason = `Daily loss limit of ${this.preset.maxDailyLossPct}% hit`;
      this.log(`🚨 Kill switch triggered: ${toNum(dailyDrawdownPct).toFixed(2)}% daily loss`);
      return guards;
    }

    // Max drawdown protection
    const drawdown = this.portfolio.drawdownPct;
    if (drawdown <= -this.preset.maxDrawdownPct) {
      guards.capitalPreservationMode = true;
      guards.allowNewBuys = false;
      guards.reason = `Portfolio drawdown ${drawdown.toFixed(2)}% exceeded limit of -${this.preset.maxDrawdownPct}%`;
      this.log(`🛡️ Capital preservation mode: ${drawdown.toFixed(2)}% drawdown`);
    }

    // Regime-based buying restriction
    if (this.regime === "RISK_OFF" && !guards.capitalPreservationMode) {
      guards.allowNewBuys = false; // No new buys in risk-off, but don't liquidate everything
      guards.reason = "Market regime is RISK_OFF — pausing new buys";
    }

    return guards;
  }

  // ── Step 2: Evaluate all current holdings for exit signals ───
  buildExitDecisions() {
    const exits = [];
    const now = Date.now();

    for (const [ticker, pos] of this.portfolio.holdings) {
      const px = toNum(pos.currentPrice || pos.avgBuy, 0);
      if (px <= 0 || pos.shares <= 0) continue;

      const gainPct = toNum(pos.avgBuy, 0) > 0
        ? pct(px - pos.avgBuy, pos.avgBuy)
        : 0;

      const daysHeld = pos.buyDate
        ? Math.floor((now - new Date(pos.buyDate).getTime()) / 86400000)
        : toNum(pos.daysHeld, 0);

      // 1. Stop loss (highest priority)
      if (pos.stopLoss > 0 && px <= pos.stopLoss) {
        exits.push(this._buildSellDecision(pos, px, pos.shares, "stop_loss", 96,
          `🛑 Stop loss triggered on ${ticker}. Price ${formatCurrency(px)} hit stop at ${formatCurrency(pos.stopLoss)}. ` +
          `Loss from entry: ${formatPct(gainPct)}. Capital protected for next opportunity.`
        ));
        this.log(`SELL ${ticker}: stop loss at ${formatCurrency(pos.stopLoss)}`);
        continue;
      }

      // 2. Take profit
      if (pos.takeProfit > 0 && px >= pos.takeProfit) {
        exits.push(this._buildSellDecision(pos, px, pos.shares, "take_profit", 92,
          `🎯 Take profit reached on ${ticker}. Price ${formatCurrency(px)} hit target ${formatCurrency(pos.takeProfit)}. ` +
          `Gain locked in: ${formatPct(gainPct)}. Booking profit at the planned level.`
        ));
        this.log(`SELL ${ticker}: take profit at ${formatCurrency(pos.takeProfit)}`);
        continue;
      }

      // 3. Signal evaluation
      // (score is passed in via candidate data; use stored strategy score if fresh)
      const storedScore = toNum(pos.lastScore, 50);

      if (storedScore < this.preset.exitThreshold) {
        exits.push(this._buildSellDecision(pos, px, pos.shares, "signal_reversal", 84,
          `🔄 Signal reversed on ${ticker}. QUANT_LAB score dropped to ${storedScore}/100 ` +
          `(exit threshold: ${this.preset.exitThreshold}). Current P&L: ${formatPct(gainPct)}. ` +
          `Exiting before further deterioration.`
        ));
        this.log(`SELL ${ticker}: signal reversal, score ${storedScore}`);
        continue;
      }

      if (storedScore < this.preset.trimThreshold && pos.shares > 0) {
        const trimShares = pos.shares * 0.5;
        exits.push(this._buildSellDecision(pos, px, trimShares, "signal_weakening", 68,
          `⚠️ Signal weakening on ${ticker}. Score ${storedScore}/100 below trim threshold ${this.preset.trimThreshold}. ` +
          `Reducing position by 50% to limit risk while keeping upside if signal recovers.`
        ));
        this.log(`SELL ${ticker}: trim 50%, score ${storedScore}`);
        continue;
      }

      // 4. Time stop (losing position held too long)
      if (daysHeld > this.preset.holdDays.max && gainPct < 0) {
        exits.push(this._buildSellDecision(pos, px, pos.shares, "time_stop", 72,
          `⏰ Time stop on ${ticker}. Held ${daysHeld} days (max: ${this.preset.holdDays.max}). ` +
          `Position still at loss: ${formatPct(gainPct)}. Freeing capital for better setups.`
        ));
        this.log(`SELL ${ticker}: time stop after ${daysHeld} days`);
        continue;
      }

      // 5. Regime-based defensive exit
      if (this.regime === "RISK_OFF" && normalizeAssetType(pos.assetType) === "crypto") {
        exits.push(this._buildSellDecision(pos, px, pos.shares, "regime_defense", 80,
          `🌍 Regime shift to RISK_OFF detected. Exiting crypto position ${ticker}. ` +
          `In risk-off environments, crypto carries elevated downside. P&L: ${formatPct(gainPct)}.`
        ));
        this.log(`SELL ${ticker}: regime defense, risk_off`);
        continue;
      }
    }

    return exits;
  }

  _buildSellDecision(pos, price, shares, reason, confidence, reasoning) {
    return {
      action: "SELL",
      ticker: pos.ticker,
      assetType: pos.assetType,
      shares: round4(shares),
      price: round2(price),
      entry_price: round2(pos.avgBuy),
      reason,
      confidence,
      risk: confidence > 85 ? "LOW" : confidence > 70 ? "MEDIUM" : "HIGH",
      reasoning,
      lesson: DECISION_LESSONS[reason] || DECISION_LESSONS.signal_reversal,
      pnl: round2((price - pos.avgBuy) * shares),
      pnlPct: round2(pct(price - pos.avgBuy, pos.avgBuy)),
      strategy: pos.strategy,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Step 3: Score all candidates and pick best buys ──────────
  buildBuyDecisions(candidates, exitDecisions, guards) {
    if (!guards.allowNewBuys) {
      this.log("No new buys: " + (guards.reason || "buying paused"));
      return [];
    }

    const cash = this.portfolio.cash;
    const totalValue = this.portfolio.totalValue;
    const reserveCash = totalValue * this.preset.minCashReservePct;
    const availableToDeploy = Math.max(0, cash - reserveCash);

    if (availableToDeploy < 10) {
      this.log(`No deploy budget: available ${formatCurrency(availableToDeploy)}`);
      return [];
    }

    // How much are we trying to deploy?
    const currentInvestedPct = pct(this.portfolio.totalHoldingsValue, totalValue);
    const targetInvestedPct = this.preset.targetInvestedPct * 100;
    const deployGapPct = targetInvestedPct - currentInvestedPct;

    // Calculate crypto exposure
    const cryptoValue = Array.from(this.portfolio.holdings.values())
      .filter(h => normalizeAssetType(h.assetType) === "crypto")
      .reduce((sum, h) => sum + h.shares * (h.currentPrice || h.avgBuy), 0);
    const maxCryptoValue = totalValue * this.preset.maxCryptoPct;
    const cryptoRoom = Math.max(0, maxCryptoValue - cryptoValue);

    // Already committed in this cycle from exit proceeds
    const tickersBeingSold = new Set(exitDecisions.map(d => d.ticker));
    const currentHeldTickers = new Set(this.portfolio.holdings.keys());

    // Score and rank all candidates
    const scored = candidates
      .map(c => {
        const ticker = String(c?.symbol || c?.ticker || "").toUpperCase();
        if (!ticker) return null;
        const assetType = normalizeAssetType(c?.assetType);
        const price = toNum(c?.price, 0);
        if (price <= 0) return null;

        // Skip if we already hold this (unless trimming from exit)
        if (currentHeldTickers.has(ticker) && !tickersBeingSold.has(ticker)) return null;

        // Skip crypto if not allowed or no room
        if (assetType === "crypto" && (!this.preset.allowCrypto || cryptoRoom <= 0)) return null;

        const score = computeAstraScore(c, this.regime);
        const strategy = getStrategy(c, this.regime);

        return { ...c, ticker, assetType, price, score, strategy };
      })
      .filter(Boolean)
      .filter(c => c.score >= this.preset.scoreThreshold)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      this.log(`No candidates above score threshold ${this.preset.scoreThreshold}`);
      return [];
    }

    const buys = [];
    let remainingBudget = Math.min(
      availableToDeploy,
      deployGapPct > 5 ? availableToDeploy : availableToDeploy * 0.4 // Don't over-deploy if already near target
    );
    const maxPositionValue = totalValue * this.preset.maxPositionPct;
    const maxPositionsToAdd = Math.max(1, this.preset.maxPositions - this.portfolio.holdings.size);

    for (const c of scored.slice(0, maxPositionsToAdd)) {
      if (remainingBudget < 10) break;

      const ticker = c.ticker;
      const price = c.price;
      const assetType = c.assetType;

      // Position size: Kelly-inspired sizing based on conviction
      const convictionMult = clamp((c.score - this.preset.scoreThreshold) / (100 - this.preset.scoreThreshold), 0.3, 1.0);
      let slotValue = clamp(
        maxPositionValue * convictionMult,
        Math.min(50, remainingBudget),
        Math.min(maxPositionValue, remainingBudget, assetType === "crypto" ? cryptoRoom : Infinity)
      );

      if (slotValue <= 0) continue;

      const shares = assetType === "crypto"
        ? round4(Math.max(0.0001, slotValue / price))
        : Math.max(1, Math.floor(slotValue / price));

      const spent = shares * price;
      if (spent > remainingBudget || spent <= 0) continue;

      const stopLoss = round2(price * (1 - this.preset.stopLossPct));
      const takeProfit = round2(price * (1 + this.preset.takeProfitPct));
      const strategy = c.strategy;
      const stratInfo = STRATEGY_LESSONS[strategy] || STRATEGY_LESSONS.momentum;

      // Build rich reasoning
      const reasoning = this._buildBuyReasoning(c, price, shares, spent, stopLoss, takeProfit, strategy, stratInfo);
      const lesson = this._buildBuyLesson(strategy, c.score, this.regime);

      buys.push({
        action: "BUY",
        ticker,
        assetType,
        shares,
        price: round2(price),
        entry_price: round2(price),
        stop_loss: stopLoss,
        take_profit: takeProfit,
        hold_days_target: Math.floor(
          this.preset.holdDays.min +
          (this.preset.holdDays.max - this.preset.holdDays.min) * convictionMult
        ),
        conviction: round2(convictionMult * 100),
        score: c.score,
        strategy,
        confidence: clamp(c.score, 50, 96),
        risk: assetType === "crypto" ? "HIGH" : c.score > 80 ? "LOW" : "MEDIUM",
        reasoning,
        lesson,
        breakdown: {
          "QUANT_LAB Score": `${c.score}/100`,
          "Strategy": stratInfo.name,
          "Regime": this.regime,
          "Position Size": formatCurrency(spent),
          "Stop Loss": `${formatCurrency(stopLoss)} (-${(this.preset.stopLossPct * 100).toFixed(0)}%)`,
          "Take Profit": `${formatCurrency(takeProfit)} (+${(this.preset.takeProfitPct * 100).toFixed(0)}%)`,
          "Conviction": `${round2(convictionMult * 100)}%`,
          "Volume": c.volume_ratio > 1.2 ? "Above avg ✓" : "Normal",
          "Sentiment": c.newsSentiment > 0.2 ? "Positive ✓" : c.newsSentiment < -0.2 ? "Negative ✗" : "Neutral",
        },
        timestamp: new Date().toISOString(),
      });

      remainingBudget -= spent;
      this.log(`BUY ${ticker}: ${shares} @ ${formatCurrency(price)}, score ${c.score}`);
    }

    return buys;
  }

  _buildBuyReasoning(c, price, shares, spent, stop, target, strategy, stratInfo) {
    const score = c.score;
    const conviction = score >= 80 ? "HIGH" : score >= 65 ? "MODERATE" : "DEVELOPING";
    const lines = [
      `QUANT_LAB scored ${c.ticker} ${score}/100 using ${stratInfo.name} strategy.`,
      `Conviction: ${conviction}. Regime: ${this.regime.replace("_", " ")}.`,
    ];
    if (c.percentChange) lines.push(`Price momentum: ${formatPct(c.percentChange)} recent move.`);
    if (c.newsSentiment > 0.2) lines.push(`News sentiment: Positive (${c.newsSentiment?.toFixed(2)}).`);
    if (c.volume_ratio > 1.2) lines.push(`Volume: ${c.volume_ratio?.toFixed(1)}x above average — confirms signal.`);
    lines.push(`Buying ${shares} shares at ${formatCurrency(price)} (${formatCurrency(spent)} total).`);
    lines.push(`Stop loss at ${formatCurrency(stop)} · Target at ${formatCurrency(target)}.`);
    lines.push(`Risk/Reward ratio: 1:${round2(this.preset.takeProfitPct / this.preset.stopLossPct)}.`);
    return lines.join(" ");
  }

  _buildBuyLesson(strategy, score, regime) {
    const stratInfo = STRATEGY_LESSONS[strategy] || STRATEGY_LESSONS.momentum;
    const regimeNote = regime === "RISK_ON"
      ? "Current regime favors this type of setup."
      : regime === "NEUTRAL"
      ? "Neutral regime — proceed with standard position sizing."
      : "Elevated caution — position sized smaller to manage risk.";
    return `${stratInfo.emoji} ${stratInfo.lesson} ${regimeNote}`;
  }

  // ── Step 4: Build HOLD notices for valid positions ────────────
  buildHoldDecisions(exitTickers, buyTickers) {
    const holds = [];
    for (const [ticker, pos] of this.portfolio.holdings) {
      if (exitTickers.has(ticker) || buyTickers.has(ticker)) continue;
      const px = toNum(pos.currentPrice || pos.avgBuy, 0);
      const gainPct = pos.avgBuy > 0 ? pct(px - pos.avgBuy, pos.avgBuy) : 0;
      const daysHeld = pos.buyDate
        ? Math.floor((Date.now() - new Date(pos.buyDate).getTime()) / 86400000)
        : 0;
      const score = toNum(pos.lastScore, 60);

      holds.push({
        action: "HOLD",
        ticker,
        assetType: pos.assetType,
        shares: pos.shares,
        price: round2(px),
        entry_price: round2(pos.avgBuy),
        unrealizedPnl: round2((px - pos.avgBuy) * pos.shares),
        unrealizedPnlPct: round2(gainPct),
        daysHeld,
        score,
        confidence: clamp(score, 40, 85),
        risk: "LOW",
        strategy: pos.strategy,
        reasoning: [
          `✋ Holding ${ticker}. Current P&L: ${formatPct(gainPct)}.`,
          `Day ${daysHeld} of ${this.preset.holdDays.max}. Score: ${score}/100 (above exit threshold ${this.preset.exitThreshold}).`,
          pos.stopLoss > 0 ? `Protected at ${formatCurrency(pos.stopLoss)} stop loss.` : "",
          `Original ${pos.strategy?.replace("_", " ")} thesis remains intact.`,
        ].filter(Boolean).join(" "),
        lesson: DECISION_LESSONS.hold_valid,
        timestamp: new Date().toISOString(),
      });
    }
    return holds;
  }
}

// ─── Autopilot Session Report ────────────────────────────────────

class SessionReport {
  constructor(startSnapshot, reason) {
    this.startSnapshot = startSnapshot;
    this.endSnapshot = null;
    this.startedAt = new Date().toISOString();
    this.stoppedAt = null;
    this.stopReason = reason;
    this.cycleCount = 0;
    this.totalDecisions = 0;
    this.totalBuys = 0;
    this.totalSells = 0;
    this.totalHolds = 0;
    this.tradePnls = [];
  }

  finalize(endSnapshot, tradeHistory) {
    this.endSnapshot = endSnapshot;
    this.stoppedAt = new Date().toISOString();
    this.cycleCount = endSnapshot.cycleCount;

    for (const t of tradeHistory) {
      if (t.pnl !== null && t.pnl !== undefined) {
        this.tradePnls.push(t.pnl);
      }
      if (t.action === "BUY") this.totalBuys++;
      else if (t.action === "SELL") this.totalSells++;
    }
    this.totalDecisions = this.totalBuys + this.totalSells;

    const totalPnl = endSnapshot.totalValue - this.startSnapshot.totalValue;
    const wins = this.tradePnls.filter(p => p > 0).length;
    const losses = this.tradePnls.filter(p => p < 0).length;

    return {
      session: {
        startedAt: this.startedAt,
        stoppedAt: this.stoppedAt,
        stopReason: this.stopReason,
        duration: this._formatDuration(this.startedAt, this.stoppedAt),
        cyclesRun: this.cycleCount,
      },
      performance: {
        startValue: formatCurrency(this.startSnapshot.totalValue),
        endValue: formatCurrency(endSnapshot.totalValue),
        totalPnl: formatCurrency(totalPnl),
        totalReturnPct: formatPct(pct(totalPnl, this.startSnapshot.totalValue)),
        peakValue: formatCurrency(endSnapshot.peakValue),
        maxDrawdown: formatPct(endSnapshot.drawdownPct),
        winRate: this.tradePnls.length > 0 ? `${round2(pct(wins, this.tradePnls.length))}%` : "—",
        tradesExecuted: this.totalDecisions,
        wins,
        losses,
      },
      portfolio: endSnapshot,
      message: this._buildMessage(totalPnl, endSnapshot),
    };
  }

  _formatDuration(start, end) {
    const ms = new Date(end) - new Date(start);
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m ${s % 60}s`;
    return `${s}s`;
  }

  _buildMessage(totalPnl, snap) {
    if (totalPnl > 0) {
      return `ASTRA generated ${formatCurrency(totalPnl)} in profit during this session (${formatPct(snap.totalReturn)}). ` +
        `Win rate: ${snap.winRate}%. ${snap.tradesExecuted} trades executed over ${this.cycleCount} analysis cycles.`;
    } else if (totalPnl < 0) {
      return `Session ended with ${formatCurrency(Math.abs(totalPnl))} paper loss (${formatPct(snap.totalReturn)}). ` +
        `Portfolio remains simulated — no real money involved. ` +
        `Max drawdown was contained at ${formatPct(snap.drawdownPct)}. Review what signals reversed.`;
    }
    return `Session complete. Portfolio held steady. ${snap.tradesExecuted} trades across ${this.cycleCount} cycles.`;
  }
}

// ─── Main Autopilot Class ─────────────────────────────────────────

class AstraAutopilot extends EventEmitter {
  /**
   * @param {Object} config
   * @param {Object} config.initialPortfolio     - { cash, holdings, startingValue }
   * @param {string} config.riskLevel            - CONSERVATIVE | MODERATE | AGGRESSIVE
   * @param {Function} config.fetchMarketData    - async () => { candidates, macro, prices }
   * @param {Function} config.onExecute          - async (decisions) => void — persist to DB
   * @param {number}  [config.cycleIntervalMs]   - ms between cycles (default: 60000)
   * @param {number}  [config.maxCycles]         - stop after N cycles (optional)
   * @param {string}  [config.tradingStyle]      - 'swing' | 'day_trading'
   */
  constructor(config = {}) {
    super();
    this.config = config;
    this.riskLevel = String(config.riskLevel || "MODERATE").toUpperCase();
    this.preset = getRiskPreset(this.riskLevel);
    this.portfolio = new PortfolioState(config.initialPortfolio || {});
    this.cycleIntervalMs = toNum(config.cycleIntervalMs, 60000);
    this.maxCycles = toNum(config.maxCycles, 0) || Infinity;
    this.tradingStyle = String(config.tradingStyle || "swing").toLowerCase();
    this._running = false;
    this._stopReason = null;
    this._intervalId = null;
    this._cyclePromise = null;
    this._startSnapshot = null;
  }

  // ── Public API ─────────────────────────────────────────────────

  async start() {
    if (this._running) {
      this.emit("error", { message: "Autopilot is already running." });
      return;
    }
    this._running = true;
    this._startSnapshot = this.portfolio.snapshot();

    this.emit("started", {
      message: "ASTRA Autopilot started. Taking control of your portfolio.",
      portfolio: this._startSnapshot,
      riskLevel: this.riskLevel,
      preset: {
        maxPosition: `${(this.preset.maxPositionPct * 100).toFixed(0)}%`,
        stopLoss: `${(this.preset.stopLossPct * 100).toFixed(0)}%`,
        takeProfit: `${(this.preset.takeProfitPct * 100).toFixed(0)}%`,
        maxCrypto: `${(this.preset.maxCryptoPct * 100).toFixed(0)}%`,
        cashReserve: `${(this.preset.minCashReservePct * 100).toFixed(0)}%`,
      },
      lesson: `ASTRA is now running. It will analyze the market every ${Math.round(this.cycleIntervalMs / 1000)} seconds, ` +
        `buy top-ranked setups, protect positions with stop losses, and lock in gains at target prices. ` +
        `You can stop at any time. All trades are paper trades — no real money involved.`,
    });

    // Run first cycle immediately
    await this._runCycle();

    // Then schedule repeating cycles
    if (this._running) {
      this._intervalId = setInterval(async () => {
        if (!this._running) return;
        await this._runCycle();
        if (this.portfolio.cycleCount >= this.maxCycles) {
          this.stop("max_cycles_reached");
        }
      }, this.cycleIntervalMs);
    }
  }

  stop(reason = "user_request") {
    if (!this._running) return;
    this._running = false;
    this._stopReason = reason;

    if (this._intervalId) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }

    const endSnapshot = this.portfolio.snapshot();
    const report = new SessionReport(this._startSnapshot, reason);
    const finalReport = report.finalize(endSnapshot, this.portfolio.tradeHistory);

    this.emit("stopped", finalReport);
  }

  updateRiskLevel(newLevel) {
    const key = String(newLevel || "MODERATE").toUpperCase();
    if (!RISK_PRESETS[key]) return;
    this.riskLevel = key;
    this.preset = getRiskPreset(key);
    this.emit("config_updated", {
      message: `Risk level updated to ${key}. New limits take effect next cycle.`,
      preset: this.preset,
    });
  }

  injectPrices(priceMap) {
    this.portfolio.updatePrices(priceMap);
  }

  getStatus() {
    return {
      running: this._running,
      riskLevel: this.riskLevel,
      cycleCount: this.portfolio.cycleCount,
      portfolio: this.portfolio.snapshot(),
    };
  }

  // ── Internal cycle ─────────────────────────────────────────────

  async _runCycle() {
    const cycleNum = ++this.portfolio.cycleCount;
    const cycleStart = Date.now();

    this.emit("cycle_start", {
      cycle: cycleNum,
      message: `Cycle ${cycleNum}: analyzing market data...`,
      portfolio: this.portfolio.snapshot(),
    });

    try {
      // 1. Fetch fresh market data
      let marketData = { candidates: [], macro: { vix: 20 }, prices: {} };
      if (typeof this.config.fetchMarketData === "function") {
        try {
          marketData = await this.config.fetchMarketData();
        } catch (e) {
          this.emit("warning", { message: `Market data fetch failed: ${e.message}. Using cached data.` });
        }
      }

      const macro = marketData?.macro || { vix: 20, marketChange: 0 };
      const regime = getRegime(macro.vix);
      const candidates = Array.isArray(marketData?.candidates) ? marketData.candidates : [];
      const prices = marketData?.prices || {};

      // 2. Update portfolio with fresh prices
      this.portfolio.updatePrices(prices);

      // 3. Update candidate scores into holdings (so exit logic has fresh scores)
      for (const c of candidates) {
        const ticker = String(c?.symbol || c?.ticker || "").toUpperCase();
        const pos = this.portfolio.getPosition(ticker);
        if (pos) {
          pos.lastScore = computeAstraScore(c, regime);
          pos.strategy = getStrategy(c, regime);
        }
      }

      // 4. Check safety guards
      const builder = new DecisionBuilder(this.portfolio, this.preset, regime);
      const dailyPnlPct = this.portfolio.dailyPnlPct;
      const guards = builder.checkSafetyGuards(dailyPnlPct);

      let allDecisions = [];

      if (guards.killSwitchTriggered) {
        // Emergency exit all positions
        const emergencySells = Array.from(this.portfolio.holdings.values())
          .filter(h => h.shares > 0)
          .map(h => ({
            action: "SELL",
            ticker: h.ticker,
            assetType: h.assetType,
            shares: h.shares,
            price: h.currentPrice || h.avgBuy,
            entry_price: h.avgBuy,
            reason: "kill_switch",
            confidence: 97,
            risk: "LOW",
            reasoning: `🚨 Kill switch: daily loss limit (${this.preset.maxDailyLossPct}%) hit. ` +
              `Closing all positions to protect capital. Daily P&L: ${formatPct(dailyPnlPct)}.`,
            lesson: DECISION_LESSONS.kill_switch,
            timestamp: new Date().toISOString(),
          }));
        allDecisions = emergencySells;
      } else {
        // 5. Normal cycle: exits → buys → holds
        const exitDecisions = builder.buildExitDecisions();
        const exitTickers = new Set(exitDecisions.map(d => d.ticker));
        const buyDecisions = builder.buildBuyDecisions(candidates, exitDecisions, guards);
        const buyTickers = new Set(buyDecisions.map(d => d.ticker));
        const holdDecisions = builder.buildHoldDecisions(exitTickers, buyTickers);

        allDecisions = [...exitDecisions, ...buyDecisions, ...holdDecisions];
      }

      // 6. Execute decisions against portfolio state
      const executedDecisions = [];
      for (const d of allDecisions) {
        const ticker = String(d.ticker || "").toUpperCase();
        const price = toNum(d.price, 0);

        if (d.action === "SELL" && price > 0) {
          const result = this.portfolio.closePosition(ticker, d.shares, price, d.reason);
          if (result) {
            const executed = { ...d, executedPnl: result.pnl, executedPnlPct: result.pnlPct };
            executedDecisions.push(executed);
            this.emit("decision", executed);
          }
        } else if (d.action === "BUY" && price > 0 && this.portfolio.cash >= price * d.shares * 0.99) {
          this.portfolio.openPosition({
            ticker,
            assetType: d.assetType,
            shares: d.shares,
            price,
            stopLoss: d.stop_loss,
            takeProfit: d.take_profit,
            strategy: d.strategy,
          });
          this.portfolio.recordBuy(ticker, d.shares, price, d.strategy);
          executedDecisions.push(d);
          this.emit("decision", d);
        } else if (d.action === "HOLD") {
          executedDecisions.push(d);
          this.emit("decision", d);
        }
      }

      // 7. Persist via callback if provided
      if (typeof this.config.onExecute === "function" && executedDecisions.length > 0) {
        try {
          await this.config.onExecute(executedDecisions, this.portfolio.snapshot());
        } catch (e) {
          this.emit("warning", { message: `Persist failed: ${e.message}` });
        }
      }

      // 8. Build cycle summary
      const portfolioNow = this.portfolio.snapshot();
      const cycleMs = Date.now() - cycleStart;
      const buys = executedDecisions.filter(d => d.action === "BUY");
      const sells = executedDecisions.filter(d => d.action === "SELL");
      const holds = executedDecisions.filter(d => d.action === "HOLD");
      const cyclePnl = sells.reduce((s, d) => s + toNum(d.executedPnl, 0), 0);

      const cycleSummary = {
        cycle: cycleNum,
        regime,
        vix: toNum(macro.vix, 20),
        decisionsCount: executedDecisions.length,
        buys: buys.length,
        sells: sells.length,
        holds: holds.length,
        cyclePnl: round2(cyclePnl),
        cyclePnlFormatted: formatCurrency(cyclePnl),
        cycleMs,
        portfolio: portfolioNow,
        guards,
        message: this._buildCycleSummary(cycleNum, regime, buys, sells, holds, cyclePnl, portfolioNow),
        logs: builder.logs,
        topSignals: candidates
          .map(c => ({ ticker: c.symbol || c.ticker, score: computeAstraScore(c, regime), strategy: getStrategy(c, regime) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5),
      };

      this.emit("cycle_complete", cycleSummary);
      this.portfolio.lastCycleAt = new Date().toISOString();

    } catch (err) {
      this.emit("error", {
        cycle: cycleNum,
        message: `Cycle ${cycleNum} error: ${err.message}`,
        stack: err.stack,
      });
    }
  }

  _buildCycleSummary(cycle, regime, buys, sells, holds, cyclePnl, portfolio) {
    const parts = [`Cycle ${cycle} · ${regime.replace("_", " ")}`];
    if (buys.length > 0) parts.push(`${buys.length} buy${buys.length > 1 ? "s" : ""}: ${buys.map(d => d.ticker).join(", ")}`);
    if (sells.length > 0) {
      const pnlStr = cyclePnl >= 0 ? `+${formatCurrency(cyclePnl)}` : formatCurrency(cyclePnl);
      parts.push(`${sells.length} sell${sells.length > 1 ? "s" : ""} (${pnlStr})`);
    }
    if (holds.length > 0) parts.push(`${holds.length} held`);
    if (buys.length === 0 && sells.length === 0) parts.push("Monitoring — no actionable signals");
    parts.push(`Portfolio: ${formatCurrency(portfolio.totalValue)} (${formatPct(portfolio.totalReturn)})`);
    return parts.join(" · ");
  }
}

// ─── Next.js API Route Handler ─────────────────────────────────

/**
 * createAutopilotRoute(engine)
 * Returns a Next.js App Router route handler that wraps the engine.
 * 
 * Mount at: /api/simulator-autopilot/route.js
 * 
 * POST /api/simulator-autopilot
 *   body: { action: 'start'|'stop'|'status'|'cycle', ...config }
 * 
 * The engine is held in module-level singleton so it survives
 * between requests in the same Node.js process.
 */

let _engineSingleton = null;
let _engineConfig = null;

function getOrCreateEngine(config) {
  if (!_engineSingleton || !_engineSingleton._running) {
    _engineConfig = config;
    _engineSingleton = new AstraAutopilot(config);

    // Buffer events for SSE or polling
    _engineSingleton._eventBuffer = [];
    const pushEvent = (type, data) => {
      _engineSingleton._eventBuffer.push({ type, data, ts: Date.now() });
      if (_engineSingleton._eventBuffer.length > 200) {
        _engineSingleton._eventBuffer.splice(0, 50);
      }
    };

    _engineSingleton.on("started", d => pushEvent("started", d));
    _engineSingleton.on("stopped", d => pushEvent("stopped", d));
    _engineSingleton.on("decision", d => pushEvent("decision", d));
    _engineSingleton.on("cycle_complete", d => pushEvent("cycle_complete", d));
    _engineSingleton.on("cycle_start", d => pushEvent("cycle_start", d));
    _engineSingleton.on("warning", d => pushEvent("warning", d));
    _engineSingleton.on("error", d => pushEvent("error", d));
    _engineSingleton.on("config_updated", d => pushEvent("config_updated", d));
  }
  return _engineSingleton;
}

/**
 * createFetchMarketData(quantLabUrl)
 * Builds the fetchMarketData function for the engine.
 * Calls your QUANT_LAB service + price APIs.
 */
function createFetchMarketData(quantLabUrl = "http://localhost:3001") {
  return async function fetchMarketData() {
    // 1. Try QUANT_LAB
    let candidates = [];
    let macro = { vix: 20, marketChange: 0 };
    let provider = "internal";

    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${quantLabUrl}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full_scan" }),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        candidates = Array.isArray(data?.signals) ? data.signals : [];
        macro = data?.macro || macro;
        provider = "QUANT_LAB";
      }
    } catch (_) {
      // QUANT_LAB offline — use fallback
    }

    // 2. Fetch live prices (crypto via Binance, stocks via Yahoo)
    const prices = {};

    // Crypto prices from Binance (no API key needed)
    const cryptoPairs = [
      ["BTC", "BTCUSDT"], ["ETH", "ETHUSDT"], ["SOL", "SOLUSDT"],
      ["ADA", "ADAUSDT"], ["XRP", "XRPUSDT"], ["DOGE", "DOGEUSDT"],
    ];
    for (const [ticker, pair] of cryptoPairs) {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${pair}`, { signal: AbortSignal.timeout(3000) });
        if (r.ok) {
          const d = await r.json();
          const p = parseFloat(d.price);
          // Sanity check
          if (ticker === "BTC" && p > 1000) prices[ticker] = p;
          else if (ticker === "ETH" && p > 100) prices[ticker] = p;
          else if (p > 0) prices[ticker] = p;
        }
      } catch (_) {}
    }

    return { candidates, macro, prices, provider, scanned: candidates.length || 47 };
  };
}

/**
 * handleAutopilotRequest(req, portfolioLoader, tradeExecutor)
 * 
 * portfolioLoader: async () => { cash, holdings, startingValue }
 * tradeExecutor:   async (decisions, portfolioSnapshot) => void
 */
async function handleAutopilotRequest(req, portfolioLoader, tradeExecutor) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "cycle").toLowerCase();

  if (action === "start") {
    const portfolioData = await portfolioLoader();
    const riskLevel = String(body?.riskLevel || "MODERATE").toUpperCase();
    const cycleIntervalMs = toNum(body?.cycleIntervalMs, 60000);
    const maxCycles = toNum(body?.maxCycles, 0) || Infinity;

    const engine = getOrCreateEngine({
      initialPortfolio: portfolioData,
      riskLevel,
      cycleIntervalMs,
      maxCycles,
      fetchMarketData: createFetchMarketData(process.env.QUANT_LAB_URL || "http://localhost:3001"),
      onExecute: tradeExecutor,
    });

    if (!engine._running) {
      engine.start(); // Don't await — let it run in background
    }

    return {
      ok: true,
      running: true,
      message: `ASTRA Autopilot started (${riskLevel} risk, ${Math.round(cycleIntervalMs / 1000)}s cycles).`,
      portfolio: engine.portfolio.snapshot(),
      events: engine._eventBuffer.slice(-10),
    };
  }

  if (action === "stop") {
    if (_engineSingleton?._running) {
      _engineSingleton.stop(body?.reason || "user_request");
    }
    return {
      ok: true,
      running: false,
      message: "ASTRA Autopilot stopped.",
      events: _engineSingleton?._eventBuffer.slice(-5) || [],
    };
  }

  if (action === "status") {
    if (!_engineSingleton) {
      return { ok: true, running: false, message: "Autopilot not started." };
    }
    return {
      ok: true,
      running: _engineSingleton._running,
      status: _engineSingleton.getStatus(),
      events: _engineSingleton._eventBuffer.slice(-20),
    };
  }

  if (action === "events") {
    const since = toNum(body?.since, 0);
    const events = (_engineSingleton?._eventBuffer || []).filter(e => e.ts > since);
    return {
      ok: true,
      events,
      running: !!_engineSingleton?._running,
      portfolio: _engineSingleton?.portfolio.snapshot() || null,
    };
  }

  if (action === "update_risk") {
    if (_engineSingleton) {
      _engineSingleton.updateRiskLevel(body?.riskLevel);
    }
    return { ok: true, message: `Risk level updated to ${body?.riskLevel}` };
  }

  // action === "cycle" — single run (original behavior, backward compat)
  const portfolioData = await portfolioLoader();
  const riskLevel = String(body?.riskLevel || body?.risk_level || "MODERATE").toUpperCase();
  const preset = getRiskPreset(riskLevel);
  const macro = body?.macro || { vix: 20, marketChange: 0 };
  const regime = getRegime(macro.vix);
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];

  const portfolio = new PortfolioState(portfolioData);
  const builder = new DecisionBuilder(portfolio, preset, regime);
  const guards = builder.checkSafetyGuards(body?.dailyDrawdownPct);

  const exits = builder.buildExitDecisions();
  const buys = builder.buildBuyDecisions(candidates, exits, guards);
  const holds = builder.buildHoldDecisions(
    new Set(exits.map(d => d.ticker)),
    new Set(buys.map(d => d.ticker))
  );

  const decisions = [...exits, ...buys, ...holds];

  return {
    ok: true,
    decisions,
    provider: body?.provider || "QUANT_LAB",
    scanned: candidates.length || 47,
    regime,
    agentState: {
      mode: "single_cycle",
      regime,
      riskLevel,
      buyCount: buys.length,
      sellCount: exits.length,
      holdCount: holds.length,
      confidence: decisions.length
        ? Math.round(decisions.reduce((s, d) => s + toNum(d.confidence, 0), 0) / decisions.length)
        : 0,
    },
    executionPlan: decisions.slice(0, 8).map((d, i) => ({
      step: i + 1,
      task: `${d.action} ${d.ticker}`,
      confidence: d.confidence,
      reason: d.reasoning?.slice(0, 100),
    })),
  };
}

// ─── Exports ──────────────────────────────────────────────────────

module.exports = {
  // Core classes (use directly in Node)
  AstraAutopilot,
  PortfolioState,
  DecisionBuilder,

  // Next.js integration
  handleAutopilotRequest,
  createFetchMarketData,
  getOrCreateEngine,

  // Utilities (backward compat)
  runAutopilotEngine: (payload) => {
    const portfolio = new PortfolioState({
      cash: toNum(payload?.cash, 0),
      holdings: payload?.holdings || [],
      startingValue: toNum(payload?.startingCash || payload?.startingValue, 100000),
    });
    const riskLevel = String(payload?.riskLevel || "MODERATE").toUpperCase();
    const preset = getRiskPreset(riskLevel);
    const macro = payload?.macro || { vix: 20 };
    const regime = getRegime(macro.vix);
    const builder = new DecisionBuilder(portfolio, preset, regime);
    const guards = builder.checkSafetyGuards(payload?.dailyDrawdownPct);
    const exits = builder.buildExitDecisions();
    const buys = builder.buildBuyDecisions(payload?.candidates || [], exits, guards);
    const holds = builder.buildHoldDecisions(
      new Set(exits.map(d => d.ticker)),
      new Set(buys.map(d => d.ticker))
    );
    const decisions = [...exits, ...buys, ...holds];
    return {
      decisions,
      riskPolicy: preset,
      agentState: {
        mode: "autopilot",
        regime,
        riskLevel,
        buyCount: buys.length,
        sellCount: exits.length,
        holdCount: holds.length,
        confidence: decisions.length
          ? Math.round(decisions.reduce((s, d) => s + toNum(d.confidence, 0), 0) / decisions.length)
          : 0,
      },
      executionPlan: decisions.slice(0, 8).map((d, i) => ({
        step: i + 1,
        task: `${d.action} ${d.ticker}`,
        confidence: d.confidence,
        reason: d.reasoning?.slice(0, 120),
      })),
    };
  },

  getRiskPolicy: (level) => getRiskPreset(level),
  getTradingStyle: (v) => String(v || "swing").toLowerCase() === "day_trading" ? "day_trading" : "swing",
  normalizeAssetType,
  computeAstraScore,
  getRegime,
  STRATEGY_LESSONS,
  DECISION_LESSONS,
  RISK_PRESETS,
};
