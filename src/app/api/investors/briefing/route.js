import { NextResponse } from "next/server";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
    return NextResponse.json({
      ok: true,
      days,
      totalPicks: null,
      winRatePct: null,
      avgReturnPct: null,
      cumulativeReturnPct: null,
      waitlistCount: null,
      picks: [],
      monthlyWinRates: [],
      winRate: null,
      count: 0,
      avgReturn: null,
    });
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

    // If DB returned no picks, fall back to committed picks-data.json
    let finalPicks = picks;
    let finalCount = filtered.length;
    let finalWinRate = filteredWinRate;
    let finalAvgReturn = filteredAvgReturn;
    if (!finalPicks || finalPicks.length === 0) {
      try {
        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const jsonPath = join(process.cwd(), "public", "picks-data.json");
        const raw = JSON.parse(readFileSync(jsonPath, "utf8"));
        finalPicks = raw.map(r => ({
          ticker: String(r.ticker || "").toUpperCase(),
          entryPrice: Number(r.entry_price || 0),
          date: String(r.date || ""),
          confidence: Number(r.confidence || 0),
          outcome: String(r.outcome || "").toLowerCase() === "win" ? "win" : "loss",
          returnPct: Number(r.return_pct || 0),
        }));
        const wins = finalPicks.filter(p => p.outcome === "win").length;
        finalCount = finalPicks.length;
        finalWinRate = finalCount > 0 ? Math.round((wins / finalCount) * 100 * 10) / 10 : null;
        finalAvgReturn = finalCount > 0
          ? Math.round((finalPicks.reduce((s, p) => s + p.returnPct, 0) / finalCount) * 100) / 100
          : null;
      } catch { /* no fallback file, return empty */ }
    }

    return NextResponse.json({
      ok: true,
      days,
      totalPicks: total || finalCount,
      winRatePct: winRate != null ? parseFloat(winRate.toFixed(1)) : finalWinRate,
      avgReturnPct: avgReturn != null ? parseFloat(avgReturn.toFixed(2)) : finalAvgReturn,
      cumulativeReturnPct: cumulativeReturn != null ? parseFloat(cumulativeReturn.toFixed(2)) : null,
      waitlistCount: null,
      // windowed
      picks: finalPicks,
      monthlyWinRates,
      winRate: finalWinRate,
      count: finalCount,
      avgReturn: finalAvgReturn,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e), days },
      { status: 500 }
    );
  }
}
