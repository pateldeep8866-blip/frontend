import { NextResponse } from "next/server";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { STATIC_BRIEFING, STATIC_PICKS } from "../_lib/static-picks.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_PATH = process.env.TRADES_DB_PATH || "/Users/juanramirez/NOVA/NOVA_LAB/data/trades.db";
let _db = null;

function getDb() {
  if (_db) return _db;
  try {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    _db = new DatabaseSync(DB_PATH);
    return _db;
  } catch {
    return null;
  }
}

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function windowMs(w) {
  if (w === "7d") return 7 * 86400000;
  if (w === "30d") return 30 * 86400000;
  if (w === "90d") return 90 * 86400000;
  return null;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const win = searchParams.get("window") || "all";

  const db = getDb();

  // Days live — always calculated, no DB needed
  const launch = new Date("2026-02-08");
  const days = Math.floor((Date.now() - launch.getTime()) / 86400000);

  if (!db) {
    return NextResponse.json({ ...STATIC_BRIEFING, days });
  }

  try {
    // ── overall platform stats (no window filter — all-time) ──
    // Deduplicate: 1 pick per ticker per day (keep earliest trade_id per group)
    const outcomeRows = db.prepare(`
      SELECT t.trade_id, t.ticker, t.entry_price, t.created_utc, t.confidence,
             o.outcome, o.return_pct, o.evaluated_utc
      FROM trades t
      JOIN trade_outcomes o ON o.trade_id = t.trade_id
      WHERE t.action IN ('BUY','SELL')
        AND t.trade_id IN (
          SELECT MIN(trade_id) FROM trades
          WHERE action IN ('BUY','SELL')
          GROUP BY ticker, DATE(created_utc)
        )
      ORDER BY t.created_utc DESC
    `).all();

    const total = outcomeRows.length;

    const totalEval = outcomeRows.length;
    const wins = outcomeRows.filter((r) => String(r.outcome).toUpperCase() === "WIN").length;
    const winRate = totalEval > 0 ? (wins / totalEval) * 100 : null;
    const returns = outcomeRows.map((r) => toNum(r.return_pct, null)).filter((v) => v != null);
    const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : null;
    const cumulativeReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) : null;

    // ── monthly win rates ──
    const monthlyMap = {};
    for (const r of outcomeRows) {
      const mo = String(r.created_utc || "").slice(0, 7); // "YYYY-MM"
      if (!mo) continue;
      if (!monthlyMap[mo]) monthlyMap[mo] = { wins: 0, total: 0 };
      monthlyMap[mo].total += 1;
      if (String(r.outcome).toUpperCase() === "WIN") monthlyMap[mo].wins += 1;
    }
    const monthlyWinRates = Object.entries(monthlyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mo, d]) => ({
        month: mo.slice(5), // "MM"
        rate: d.total > 0 ? Math.round((d.wins / d.total) * 100) : 0,
      }));

    // ── windowed picks table ──
    const cutoff = windowMs(win);
    const cutoffIso = cutoff ? new Date(Date.now() - cutoff).toISOString() : null;

    const filtered = cutoffIso
      ? outcomeRows.filter((r) => String(r.created_utc || "") >= cutoffIso)
      : outcomeRows;

    const filteredWins = filtered.filter((r) => String(r.outcome).toUpperCase() === "WIN").length;
    const filteredWinRate = filtered.length > 0 ? Math.round((filteredWins / filtered.length) * 100) : null;
    const filteredReturns = filtered.map((r) => toNum(r.return_pct, null)).filter((v) => v != null);
    const filteredAvgReturn = filteredReturns.length > 0
      ? parseFloat((filteredReturns.reduce((a, b) => a + b, 0) / filteredReturns.length).toFixed(2))
      : null;

    const picks = filtered.slice(0, 30).map((r) => ({
      ticker: String(r.ticker || "").toUpperCase(),
      entryPrice: toNum(r.entry_price, 0),
      date: String(r.created_utc || "").slice(0, 10),
      confidence: toNum(r.confidence, 0),
      outcome: String(r.outcome || "").toUpperCase() === "WIN" ? "win" : "loss",
      returnPct: toNum(r.return_pct, 0),
    }));

    // If no windowed picks from DB, fall back to static dataset
    const finalPicks   = picks.length > 0 ? picks : STATIC_PICKS;
    const finalCount   = picks.length > 0 ? filtered.length : STATIC_PICKS.length;
    const finalWinRate = picks.length > 0 ? filteredWinRate : STATIC_BRIEFING.winRate;
    const finalAvg     = picks.length > 0 ? filteredAvgReturn : STATIC_BRIEFING.avgReturn;

    return NextResponse.json({
      ok: true,
      days,
      totalPicks: total,
      winRatePct: winRate != null ? parseFloat(winRate.toFixed(1)) : STATIC_BRIEFING.winRatePct,
      avgReturnPct: avgReturn != null ? parseFloat(avgReturn.toFixed(2)) : STATIC_BRIEFING.avgReturnPct,
      cumulativeReturnPct: cumulativeReturn != null ? parseFloat(cumulativeReturn.toFixed(2)) : null,
      waitlistCount: null,
      picks: finalPicks,
      monthlyWinRates,
      winRate: finalWinRate,
      count: finalCount,
      avgReturn: finalAvg,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e), days },
      { status: 500 }
    );
  }
}
