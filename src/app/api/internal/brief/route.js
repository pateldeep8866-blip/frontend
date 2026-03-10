/**
 * /api/internal/brief
 * YUNI's single-call briefing endpoint.
 * Returns a complete snapshot of Arthastra system state.
 * Called by the YUNI ambient loop or on-demand briefing.
 */

import { checkYuniAuth } from "../../_lib/yuni-auth";
import { getSystemLog, getPerformanceStats, getLatestWeight, ensureDb } from "../../_lib/trade-db";
import { ok, UNAUTHORIZED } from "../../_lib/response";
import { getSupabaseServer } from "../../_lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request) {
  if (!checkYuniAuth(request)) return UNAUTHORIZED();

  const now = new Date().toISOString();

  // ── db snapshot ─────────────────────────────────────────────────────────────
  let tradeCount = 0, dbStatus = "ok";
  let stats = {};
  let latestWeight = null;
  try {
    const db = ensureDb();
    tradeCount = Number(db.prepare("SELECT COUNT(*) AS c FROM trades").get()?.c || 0);
    stats = getPerformanceStats();
    latestWeight = getLatestWeight();
  } catch {
    dbStatus = "error";
  }

  // ── system log (last 50) ────────────────────────────────────────────────────
  let logRows = [];
  try { logRows = getSystemLog(50); } catch {}

  const loginFailures = logRows.filter(r => r.event_type === "LOGIN_FAILURE");
  const picksRejected = logRows.filter(r => r.event_type === "PICK_REJECTED");
  const recentActions = logRows.filter(r =>
    ["ADMIN_EVALUATE","ADMIN_RESET","LOGIN_SUCCESS","LOGOUT"].includes(r.event_type)
  ).slice(0, 5);

  // ── quant engine ─────────────────────────────────────────────────────────────
  const quantUrl = process.env.QUANT_ENGINE_URL || "http://localhost:3001";
  let quant = { status: "offline" };
  try {
    const res = await fetch(`${quantUrl}/health`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    quant = res.ok ? data : { status: "offline" };
  } catch {}

  // ── alerts ───────────────────────────────────────────────────────────────────
  const alerts = [];
  if (loginFailures.length >= 3) alerts.push({ level: "warning", message: `${loginFailures.length} failed login attempts in last 50 events` });
  if (!process.env.ADMIN_SECRET) alerts.push({ level: "critical", message: "ADMIN_SECRET is not set — admin login is non-functional" });
  if (!process.env.YUNI_INTERNAL_TOKEN) alerts.push({ level: "warning", message: "YUNI_INTERNAL_TOKEN is not set" });
  if (quant.status === "offline") alerts.push({ level: "info", message: "QUANT engine is offline" });
  if (dbStatus === "error") alerts.push({ level: "critical", message: "Database connection failed" });
  if (toNum(stats.win_rate) !== null && toNum(stats.win_rate) < 0.45)
    alerts.push({ level: "warning", message: `Win rate is ${(toNum(stats.win_rate) * 100).toFixed(1)}% — below 45% threshold` });

  // ── build briefing ───────────────────────────────────────────────────────────
  const briefing = {
    generated_utc: now,
    alerts,

    site: {
      status: "online",
      db_status: dbStatus,
      admin_secret_set: Boolean(process.env.ADMIN_SECRET),
      yuni_token_set: Boolean(process.env.YUNI_INTERNAL_TOKEN),
    },

    trades: {
      total_logged: tradeCount,
      evaluated: stats.evaluated_trades ?? 0,
      win_rate: toNum(stats.win_rate),
      average_5d_return: toNum(stats.average_5d_return),
      sharpe_ratio: toNum(stats.sharpe_ratio),
      progress_to_200: `${Math.min(tradeCount, 200)}/200`,
      data_since: stats.data_collection_started || null,
    },

    security: {
      login_failures_recent: loginFailures.length,
      picks_rejected_recent: picksRejected.length,
      last_login_failure: loginFailures[0]?.created_utc || null,
      recent_admin_actions: recentActions.map(r => ({
        event: r.event_type,
        time: r.created_utc,
        reason: r.reason,
      })),
    },

    quant: {
      status: quant.status,
      pick: quant.pick || null,
      regime: quant.regime || null,
      composite_score: quant.composite_score ?? null,
      weight_version: latestWeight?.version_id || "v1",
      weight_updated: latestWeight?.created_utc || null,
    },

    performance: {
      by_regime: stats.by_regime || [],
      best_conditions: stats.best_performing_conditions || null,
      worst_conditions: stats.worst_performing_conditions || null,
      win_rate_risk_on: toNum(stats.win_rate_risk_on),
      win_rate_risk_off: toNum(stats.win_rate_risk_off),
    },
  };

  // ── persist to Supabase (fire-and-forget, never blocks response) ─────────────
  const sb = getSupabaseServer();
  if (sb) {
    sb.from("site_snapshots").insert({
      captured_utc: now,
      snapshot: briefing,
      alert_count: alerts.length,
      db_status: dbStatus,
      quant_status: quant.status,
      win_rate: toNum(stats.win_rate),
    }).then(({ error }) => {
      if (error) console.error("[brief] supabase insert error:", error.message);
    });
  }

  return ok(briefing);
}
