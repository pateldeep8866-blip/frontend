export const dynamic = "force-static";

// src/app/api/arbi/bot-status/route.js
// Priority:
//   1. /tmp/arbi_live_state.json (< 60s old) → LIVE mode
//   2. arbi/simulation_knowledge.db          → SIMULATION mode
//   3. Neither                               → OFFLINE

import { readFileSync, statSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

const STATUS_FILE = "/tmp/arbi_live_state.json";
const SIM_DB      = join(process.cwd(), "arbi", "simulation_knowledge.db");

function sqlJSON(db, query) {
  try {
    const out = execSync(`sqlite3 -json "${db}" "${query}"`, { timeout: 4000 })
      .toString().trim();
    return out ? JSON.parse(out) : [];
  } catch {
    return [];
  }
}

export async function GET() {
  // ── 1. Live bot ────────────────────────────────────────────────────────────
  try {
    const stat   = statSync(STATUS_FILE);
    const ageSec = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSec < 60) {
      const state = JSON.parse(readFileSync(STATUS_FILE, "utf8"));
      return Response.json({ ok: true, mode: "LIVE", ...state });
    }
  } catch { /* file absent or stale */ }

  // ── 2. Simulation DB ───────────────────────────────────────────────────────
  try {
    statSync(SIM_DB); // throws if absent

    const totalsRow = sqlJSON(SIM_DB,
      "SELECT COUNT(*) AS total, " +
      "SUM(CASE WHEN net_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, " +
      "SUM(net_pnl_usd) AS net_pnl " +
      "FROM sim_scalp_trades WHERE status='CLOSED'"
    )[0] || {};

    const openCount = (sqlJSON(SIM_DB,
      "SELECT COUNT(*) AS n FROM sim_scalp_trades WHERE status='OPEN'"
    )[0] || {}).n || 0;

    const sweep = sqlJSON(SIM_DB,
      "SELECT bot_name, tp_pct, sl_pct, " +
      "COUNT(*) AS trades, " +
      "SUM(CASE WHEN net_pnl_usd > 0 THEN 1 ELSE 0 END) AS wins, " +
      "ROUND(SUM(net_pnl_usd), 4) AS net_pnl " +
      "FROM sim_scalp_trades WHERE status='CLOSED' " +
      "GROUP BY bot_name ORDER BY net_pnl DESC"
    );

    const recent = sqlJSON(SIM_DB,
      "SELECT bot_name, symbol, net_pnl_usd, exit_reason, ts " +
      "FROM sim_scalp_trades WHERE status='CLOSED' " +
      "ORDER BY ts DESC LIMIT 20"
    );

    const total     = totalsRow.total   || 0;
    const totalWins = totalsRow.wins    || 0;
    const netPnl    = totalsRow.net_pnl || 0;
    const winRate   = total > 0 ? ((totalWins / total) * 100).toFixed(1) : "0.0";

    const recentTrades = recent.map(t => ({
      pair:   t.symbol,
      pnl:    t.net_pnl_usd,
      reason: t.exit_reason,
      time:   new Date(t.ts * 1000).toISOString().slice(11, 19),
      bot:    t.bot_name,
    }));

    return Response.json({
      ok:               true,
      mode:             "SIMULATION",
      balance:          null,
      daily_pnl:        netPnl,
      open_trades:      openCount,
      recent_trades:    recentTrades,
      rejections:       [],
      sweep_leaderboard: sweep,
      community_trades:  total,
      community_win_rate: parseFloat(winRate),
    });
  } catch { /* DB absent or unreadable */ }

  // ── 3. Offline ─────────────────────────────────────────────────────────────
  return Response.json({
    ok:            false,
    mode:          "OFFLINE",
    message:       "Bot is not running. Start with: cd arbi && python main.py --live",
    balance:       null,
    daily_pnl:     null,
    open_trades:   0,
    recent_trades: [],
    rejections:    [],
  });
}
