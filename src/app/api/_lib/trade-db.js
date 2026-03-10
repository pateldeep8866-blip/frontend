import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = process.env.TRADES_DB_PATH || "/Users/juanramirez/NOVA/NOVA_LAB/data/trades.db";
let db = null;

function nowIso() {
  return new Date().toISOString();
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeAction(action) {
  const v = String(action || "").toUpperCase();
  return ["BUY", "SELL", "HOLD"].includes(v) ? v : "HOLD";
}

function normalizeSource(source) {
  return String(source || "").toLowerCase() === "astra_autopilot" ? "astra_autopilot" : "manual";
}

function ensureTradeColumns(conn) {
  const cols = conn.prepare("PRAGMA table_info(trades)").all().map((r) => String(r.name || ""));
  if (!cols.includes("strategy_name")) conn.exec("ALTER TABLE trades ADD COLUMN strategy_name TEXT;");
  if (!cols.includes("strategy_conviction")) conn.exec("ALTER TABLE trades ADD COLUMN strategy_conviction REAL;");
  if (!cols.includes("hold_days_target")) conn.exec("ALTER TABLE trades ADD COLUMN hold_days_target INTEGER;");
}

function ensureSystemLog(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS system_log (
      log_id TEXT PRIMARY KEY,
      created_utc TEXT,
      event_type TEXT,
      ticker TEXT,
      action TEXT,
      confidence INTEGER,
      reason TEXT,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_system_log_created ON system_log(created_utc);
  `);
}

export function ensureDb() {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      trade_id TEXT PRIMARY KEY,
      created_utc TEXT,
      source TEXT,
      ticker TEXT,
      action TEXT,
      shares REAL,
      entry_price REAL,
      total_value REAL,
      quant_composite_score REAL,
      quant_signal TEXT,
      quant_momentum REAL,
      quant_mean_reversion REAL,
      market_regime TEXT,
      vix_at_entry REAL,
      dxy_at_entry REAL,
      sector_performance TEXT,
      weight_momentum REAL DEFAULT 0.55,
      weight_mean_reversion REAL DEFAULT 0.35,
      weight_volatility REAL DEFAULT 0.07,
      weight_range REAL DEFAULT 0.03,
      user_risk_level TEXT,
      strategy_name TEXT,
      strategy_conviction REAL,
      hold_days_target INTEGER,
      reasoning TEXT,
      confidence INTEGER,
      stop_loss REAL,
      take_profit REAL
    );

    CREATE TABLE IF NOT EXISTS trade_outcomes (
      outcome_id TEXT PRIMARY KEY,
      trade_id TEXT,
      evaluated_utc TEXT,
      days_held INTEGER,
      exit_price REAL,
      return_pct REAL,
      return_1d REAL,
      return_5d REAL,
      return_21d REAL,
      hit_stop_loss INTEGER,
      hit_take_profit INTEGER,
      outcome TEXT,
      market_regime_during_hold TEXT,
      vix_during_hold_avg REAL,
      FOREIGN KEY (trade_id) REFERENCES trades(trade_id)
    );

    CREATE TABLE IF NOT EXISTS weight_history (
      version_id TEXT PRIMARY KEY,
      created_utc TEXT,
      weight_momentum REAL,
      weight_mean_reversion REAL,
      weight_volatility REAL,
      weight_range REAL,
      trigger TEXT,
      sample_size INTEGER,
      sharpe_improvement REAL,
      hit_rate_improvement REAL,
      validated INTEGER,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS learning_runs (
      run_id TEXT PRIMARY KEY,
      created_utc TEXT,
      trades_analyzed INTEGER,
      regimes_covered TEXT,
      proposed_weights TEXT,
      current_weights TEXT,
      improvement_pct REAL,
      passed_validation INTEGER,
      deployed INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_trades_created ON trades(created_utc);
    CREATE INDEX IF NOT EXISTS idx_trades_ticker ON trades(ticker);
    CREATE INDEX IF NOT EXISTS idx_trade_outcomes_trade_id ON trade_outcomes(trade_id);
  `);

  ensureTradeColumns(db);
  ensureSystemLog(db);

  const count = Number(db.prepare("SELECT COUNT(*) AS c FROM weight_history").get()?.c || 0);
  if (count === 0) {
    db.prepare(`
      INSERT INTO weight_history (
        version_id, created_utc, weight_momentum, weight_mean_reversion,
        weight_volatility, weight_range, trigger, sample_size,
        sharpe_improvement, hit_rate_improvement, validated, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "v1", nowIso(), 0.55, 0.35, 0.07, 0.03, "manual", 0, 0, 0, 1, "Initial default weights"
    );
  }

  return db;
}

// fetchYahooQuote, fetchYahooChart, pickCloseAtOrAfter, calcDirectionalReturn
// moved to trade-service.js

export function insertTrade(raw) {
  const conn = ensureDb();
  const tradeId = String(raw?.trade_id || randomUUID());
  const created = String(raw?.created_utc || nowIso());
  const ticker = String(raw?.ticker || "").toUpperCase();
  const action = normalizeAction(raw?.action);
  const confidence = Math.round(toNum(raw?.confidence, 0));

  function logEvent(event_type, reason, detail = null) {
    conn.prepare(`
      INSERT INTO system_log (log_id, created_utc, event_type, ticker, action, confidence, reason, detail)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), nowIso(), event_type, ticker, action, confidence, reason, detail);
  }

  // Gate 1: Confidence floor
  // FIX 2026-03-09: picks <60 confidence had 0% win rate, -4.59% avg return. Floor set to 70.
  if (action !== "HOLD" && confidence < 70) {
    logEvent("PICK_REJECTED", "confidence_below_floor",
      `confidence=${confidence} below threshold of 70. Pre-fix: 29 picks at <60 conf had 0% win rate, -4.59% avg return.`);
    return null;
  }

  // Gate 2 + 3: Dedupe + direction lock
  // FIX 2026-03-09: ASTRA emitted same signal every loop cycle (XOM BUY x17/day).
  // Also generated conflicting BUY+SELL same ticker same day (XLK BUY 0% vs XLK SELL 100%).
  if (action !== "HOLD") {
    const today = created.slice(0, 10);
    const existing = conn.prepare(`
      SELECT action FROM trades
      WHERE ticker = ?
        AND DATE(created_utc) = ?
        AND action IN ('BUY','SELL')
      LIMIT 1
    `).get(ticker, today);

    if (existing) {
      if (existing.action === action) {
        logEvent("PICK_REJECTED", "duplicate_same_day",
          `${action} ${ticker} already logged on ${today}.`);
        return null;
      } else {
        logEvent("PICK_REJECTED", "direction_conflict",
          `Cannot ${action} ${ticker} — conflicting ${existing.action} already exists on ${today}.`);
        return null;
      }
    }
  }

  const sectorPerf = raw?.sector_performance == null
    ? null
    : typeof raw.sector_performance === "string"
      ? raw.sector_performance
      : JSON.stringify(raw.sector_performance);

  conn.prepare(`
    INSERT INTO trades (
      trade_id, created_utc, source, ticker, action, shares, entry_price, total_value,
      quant_composite_score, quant_signal, quant_momentum, quant_mean_reversion,
      market_regime, vix_at_entry, dxy_at_entry, sector_performance,
      weight_momentum, weight_mean_reversion, weight_volatility, weight_range,
      user_risk_level, strategy_name, strategy_conviction, hold_days_target,
      reasoning, confidence, stop_loss, take_profit
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `).run(
    tradeId, created,
    normalizeSource(raw?.source), ticker, action,
    toNum(raw?.shares, 0), toNum(raw?.entry_price, 0), toNum(raw?.total_value, 0),
    toNum(raw?.quant_composite_score, null),
    raw?.quant_signal ? String(raw.quant_signal) : null,
    toNum(raw?.quant_momentum, null), toNum(raw?.quant_mean_reversion, null),
    raw?.market_regime ? String(raw.market_regime) : null,
    toNum(raw?.vix_at_entry, null), toNum(raw?.dxy_at_entry, null), sectorPerf,
    toNum(raw?.weight_momentum, 0.55), toNum(raw?.weight_mean_reversion, 0.35),
    toNum(raw?.weight_volatility, 0.07), toNum(raw?.weight_range, 0.03),
    raw?.user_risk_level ? String(raw.user_risk_level) : null,
    raw?.strategy_name ? String(raw.strategy_name) : null,
    toNum(raw?.strategy_conviction, null),
    Math.round(toNum(raw?.hold_days_target, 0)),
    raw?.reasoning ? String(raw.reasoning) : null,
    confidence,
    toNum(raw?.stop_loss, null), toNum(raw?.take_profit, null)
  );

  logEvent("PICK_ACCEPTED", "passed_all_gates", `confidence=${confidence}, action=${action}`);
  return conn.prepare("SELECT * FROM trades WHERE trade_id = ?").get(tradeId);
}

export function getTradeHistory(limit = 500) {
  const conn = ensureDb();
  const lim = Math.max(1, Math.min(5000, Number(limit) || 500));
  return conn.prepare(`
    SELECT t.*, o.*
    FROM trades t
    LEFT JOIN trade_outcomes o ON o.trade_id = t.trade_id
    ORDER BY t.created_utc DESC
    LIMIT ?
  `).all(lim);
}

export function getWeightHistory(limit = 200) {
  const conn = ensureDb();
  const lim = Math.max(1, Math.min(5000, Number(limit) || 200));
  return conn.prepare(`
    SELECT * FROM weight_history
    ORDER BY created_utc DESC
    LIMIT ?
  `).all(lim);
}

export function getLatestWeight() {
  const conn = ensureDb();
  return conn.prepare(`
    SELECT * FROM weight_history ORDER BY created_utc DESC LIMIT 1
  `).get() || null;
}

// evaluatePendingTradeOutcomes moved to trade-service.js

export function logAdminEvent(event_type, reason, detail = null) {
  const conn = ensureDb();
  conn.prepare(`
    INSERT INTO system_log (log_id, created_utc, event_type, ticker, action, confidence, reason, detail)
    VALUES (?, ?, ?, null, null, null, ?, ?)
  `).run(randomUUID(), nowIso(), String(event_type), String(reason), detail ? String(detail) : null);
}

function computeSharpe(rows) {
  if (!rows.length) return null;
  const vals = rows.map((r) => toNum(r?.return_pct, null)).filter((v) => v != null);
  if (!vals.length) return null;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
  if (variance <= 0) return null;
  return mean / Math.sqrt(variance);
}

export function getPerformanceStats() {
  const conn = ensureDb();
  const totalTrades = Number(conn.prepare("SELECT COUNT(*) AS c FROM trades").get()?.c || 0);
  const dataStart = conn.prepare("SELECT MIN(created_utc) AS m FROM trades").get()?.m || null;
  const outcomes = conn.prepare(`
    SELECT t.trade_id, t.market_regime, o.return_pct, o.return_5d, o.outcome
    FROM trades t
    JOIN trade_outcomes o ON o.trade_id = t.trade_id
    WHERE t.action IN ('BUY','SELL')
  `).all();
  const totalEvaluated = outcomes.length;
  const wins = outcomes.filter((r) => String(r.outcome) === "WIN").length;
  const winRate = totalEvaluated > 0 ? wins / totalEvaluated : 0;
  const byRegimeRows = conn.prepare(`
    SELECT
      COALESCE(t.market_regime, 'unknown') AS regime,
      COUNT(*) AS n,
      SUM(CASE WHEN o.outcome = 'WIN' THEN 1 ELSE 0 END) AS wins,
      AVG(o.return_pct) AS avg_return,
      AVG(o.return_5d) AS avg_return_5d
    FROM trades t
    JOIN trade_outcomes o ON o.trade_id = t.trade_id
    WHERE t.action IN ('BUY','SELL')
    GROUP BY COALESCE(t.market_regime, 'unknown')
  `).all();
  const byRegime = byRegimeRows.map((r) => ({
    regime: String(r.regime),
    trades: Number(r.n || 0),
    win_rate: Number(r.n || 0) > 0 ? Number(r.wins || 0) / Number(r.n || 0) : 0,
    avg_return: toNum(r.avg_return, 0),
    avg_return_5d: toNum(r.avg_return_5d, 0),
  }));
  const best = [...byRegime].sort((a, b) => Number(b.avg_return || 0) - Number(a.avg_return || 0))[0] || null;
  const worst = [...byRegime].sort((a, b) => Number(a.avg_return || 0) - Number(b.avg_return || 0))[0] || null;
  const latestWeights = conn.prepare(`SELECT * FROM weight_history ORDER BY created_utc DESC LIMIT 1`).get() || null;
  const latestRun = conn.prepare(`SELECT * FROM learning_runs ORDER BY created_utc DESC LIMIT 1`).get() || null;
  const avg5d = outcomes.length
    ? outcomes.map((r) => toNum(r.return_5d, null)).filter((v) => v != null).reduce((s, v, _, arr) => s + v / arr.length, 0)
    : 0;
  const riskOn = byRegime.find((x) => x.regime === "risk_on") || null;
  const riskOff = byRegime.find((x) => x.regime === "risk_off") || null;
  return {
    total_trades_logged: totalTrades,
    data_collection_started: dataStart,
    evaluated_trades: totalEvaluated,
    win_rate: winRate,
    win_rate_risk_on: riskOn?.win_rate ?? null,
    win_rate_risk_off: riskOff?.win_rate ?? null,
    average_5d_return: avg5d,
    by_regime: byRegime,
    best_performing_conditions: best,
    worst_performing_conditions: worst,
    current_weight_version: latestWeights?.version_id || "v1",
    last_weight_update: latestWeights?.created_utc || null,
    sharpe_ratio: computeSharpe(outcomes),
    next_learning_run: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    progress: {
      current: totalTrades,
      target: 200,
      pct: Math.min(100, (totalTrades / 200) * 100),
    },
    latest_learning_run: latestRun ? {
      run_id: latestRun.run_id,
      created_utc: latestRun.created_utc,
      trades_analyzed: Number(latestRun.trades_analyzed || 0),
      improvement_pct: toNum(latestRun.improvement_pct, 0),
      passed_validation: Number(latestRun.passed_validation || 0),
      deployed: Number(latestRun.deployed || 0),
    } : null,
  };
}

export function getDbMeta() {
  ensureDb();
  return { db_path: DB_PATH };
}

export function cleanupBadCryptoTrades() {
  const conn = ensureDb();
  const targets = conn.prepare(`
    SELECT trade_id FROM trades
    WHERE (ticker = 'BTC' OR ticker = 'ETH') AND entry_price < 100
  `).all();
  const tradeIds = targets.map((r) => String(r.trade_id || "")).filter(Boolean);
  if (!tradeIds.length) return { deletedTrades: 0, deletedOutcomes: 0 };
  let deletedOutcomes = 0;
  const deleteOutcomeStmt = conn.prepare("DELETE FROM trade_outcomes WHERE trade_id = ?");
  const deleteTradeStmt = conn.prepare("DELETE FROM trades WHERE trade_id = ?");
  for (const tradeId of tradeIds) {
    const outResult = deleteOutcomeStmt.run(tradeId);
    const tradeResult = deleteTradeStmt.run(tradeId);
    deletedOutcomes += Number(outResult?.changes || 0);
    if (!tradeResult?.changes) continue;
  }
  return { deletedTrades: tradeIds.length, deletedOutcomes };
}

export function getStrategyPerformance() {
  const conn = ensureDb();
  const rows = conn.prepare(`
    SELECT
      t.strategy_name,
      COUNT(*) as total_trades,
      AVG(CASE WHEN o.return_5d > 0 THEN 1.0 ELSE 0.0 END) as win_rate,
      AVG(o.return_5d) as avg_return_5d,
      AVG(o.return_21d) as avg_return_21d
    FROM trades t
    LEFT JOIN trade_outcomes o ON t.trade_id = o.trade_id
    WHERE t.strategy_name IS NOT NULL
    GROUP BY t.strategy_name
    ORDER BY win_rate DESC
  `).all();
  const byRegime = conn.prepare(`
    SELECT t.strategy_name, COALESCE(t.market_regime,'unknown') as regime,
           COUNT(*) as total, AVG(o.return_5d) as avg_return
    FROM trades t
    LEFT JOIN trade_outcomes o ON t.trade_id = o.trade_id
    WHERE t.strategy_name IS NOT NULL
    GROUP BY t.strategy_name, COALESCE(t.market_regime,'unknown')
  `).all();
  const activeSet = new Set(
    conn.prepare(`
      SELECT DISTINCT strategy_name FROM trades
      WHERE strategy_name IS NOT NULL AND created_utc >= datetime('now','-7 days')
    `).all().map((r) => String(r.strategy_name || ""))
  );
  return rows.map((r) => {
    const name = String(r.strategy_name || "unknown");
    const regimes = byRegime.filter((x) => String(x.strategy_name || "") === name);
    const best = [...regimes].sort((a,b) => Number(b.avg_return || -999) - Number(a.avg_return || -999))[0] || null;
    const worst = [...regimes].sort((a,b) => Number(a.avg_return || 999) - Number(b.avg_return || 999))[0] || null;
    return {
      strategy_name: name,
      total_trades: Number(r.total_trades || 0),
      win_rate: Number(r.win_rate || 0),
      avg_return_5d: Number(r.avg_return_5d || 0),
      avg_return_21d: Number(r.avg_return_21d || 0),
      best_regime: best?.regime || null,
      worst_regime: worst?.regime || null,
      active: activeSet.has(name),
    };
  });
}

export function getSystemLog(limit = 200) {
  const conn = ensureDb();
  const lim = Math.max(1, Math.min(2000, Number(limit) || 200));
  return conn.prepare(`
    SELECT * FROM system_log ORDER BY created_utc DESC LIMIT ?
  `).all(lim);
}
