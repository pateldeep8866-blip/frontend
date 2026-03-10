/**
 * trade-service.js
 * Business logic layer: external price fetching, outcome evaluation.
 * Imports the DB connection from trade-db.js — does NOT define schema or queries.
 */

import { randomUUID } from "node:crypto";
import { ensureDb } from "./trade-db.js";

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ─── external data ────────────────────────────────────────────────────────────

async function fetchYahooQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  const row = data?.quoteResponse?.result?.[0] || {};
  return {
    price: toNum(row?.regularMarketPrice),
    changePct: toNum(row?.regularMarketChangePercent),
  };
}

async function fetchYahooChart(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  const result = data?.chart?.result?.[0] || {};
  const ts    = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const close = Array.isArray(result?.indicators?.quote?.[0]?.close)
    ? result.indicators.quote[0].close : [];
  const rows = [];
  for (let i = 0; i < Math.min(ts.length, close.length); i++) {
    const px = toNum(close[i]);
    if (px == null) continue;
    rows.push({ t: Number(ts[i]) * 1000, c: px });
  }
  return rows;
}

// ─── calculation helpers ──────────────────────────────────────────────────────

function pickCloseAtOrAfter(rows, tsMs) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  for (const row of rows) {
    if (Number(row.t) >= tsMs && Number.isFinite(Number(row.c))) return Number(row.c);
  }
  const last = rows[rows.length - 1];
  return Number.isFinite(Number(last?.c)) ? Number(last.c) : null;
}

function calcDirectionalReturn(action, entry, exit) {
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit)) return null;
  if (action === "SELL") return (entry - exit) / entry;
  return (exit - entry) / entry;
}

// ─── outcome evaluation ───────────────────────────────────────────────────────

export async function evaluatePendingTradeOutcomes() {
  const conn = ensureDb();
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;

  const pending = conn.prepare(`
    SELECT t.*
    FROM trades t
    LEFT JOIN trade_outcomes o ON o.trade_id = t.trade_id
    WHERE o.trade_id IS NULL
      AND t.created_utc <= ?
      AND t.action IN ('BUY','SELL')
    ORDER BY t.created_utc ASC
    LIMIT 500
  `).all(new Date(cutoffMs).toISOString());

  let inserted = 0;
  for (const trade of pending) {
    const ticker = String(trade?.ticker || "").toUpperCase();
    if (!ticker) continue;
    try {
      const [quote, chart, vixQuote] = await Promise.all([
        fetchYahooQuote(ticker),
        fetchYahooChart(ticker),
        fetchYahooQuote("^VIX"),
      ]);
      const entry = toNum(trade?.entry_price, 0);
      const exit  = toNum(quote?.price, null);
      if (entry <= 0 || exit == null) continue;

      const createdMs = new Date(String(trade.created_utc)).getTime();
      const day1  = pickCloseAtOrAfter(chart, createdMs + 1  * 86400000);
      const day5  = pickCloseAtOrAfter(chart, createdMs + 5  * 86400000);
      const day21 = pickCloseAtOrAfter(chart, createdMs + 21 * 86400000);

      const retPct  = calcDirectionalReturn(String(trade.action || "BUY"), entry, exit);
      const ret1d   = day1  == null ? null : calcDirectionalReturn(String(trade.action || "BUY"), entry, day1);
      const ret5d   = day5  == null ? null : calcDirectionalReturn(String(trade.action || "BUY"), entry, day5);
      const ret21d  = day21 == null ? null : calcDirectionalReturn(String(trade.action || "BUY"), entry, day21);

      const stop     = toNum(trade?.stop_loss, null);
      const target   = toNum(trade?.take_profit, null);
      const isBuy    = String(trade.action || "BUY") !== "SELL";
      const hitStop  = stop   == null ? 0 : (isBuy ? Number(exit <= stop)   : Number(exit >= stop));
      const hitTarget= target == null ? 0 : (isBuy ? Number(exit >= target) : Number(exit <= target));
      const outcome  = retPct == null ? "NEUTRAL" : retPct > 0.002 ? "WIN" : retPct < -0.002 ? "LOSS" : "NEUTRAL";

      conn.prepare(`
        INSERT INTO trade_outcomes (
          outcome_id, trade_id, evaluated_utc, days_held, exit_price,
          return_pct, return_1d, return_5d, return_21d,
          hit_stop_loss, hit_take_profit, outcome,
          market_regime_during_hold, vix_during_hold_avg
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(), trade.trade_id, new Date().toISOString(),
        Math.max(1, Math.floor((Date.now() - createdMs) / 86400000)),
        exit, retPct, ret1d, ret5d, ret21d, hitStop, hitTarget, outcome,
        trade.market_regime || "unknown", toNum(vixQuote?.price, null)
      );
      inserted++;
    } catch { /* skip individual failures */ }
  }
  return { evaluated: inserted, pending: pending.length };
}
