"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

const YUNI_URL = process.env.NEXT_PUBLIC_YUNI_URL || "http://localhost:9000";

function Badge({ label, value, color = "slate" }) {
  const colors = {
    green:  "bg-green-500/15 text-green-300 border-green-500/30",
    yellow: "bg-yellow-500/15 text-yellow-300 border-yellow-500/30",
    red:    "bg-red-500/15 text-red-300 border-red-500/30",
    cyan:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    slate:  "bg-white/8 text-white/60 border-white/10",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center justify-between ${colors[color] || colors.slate}`}>
      <span className="text-xs text-white/50">{label}</span>
      <span className="text-sm font-semibold">{value ?? "—"}</span>
    </div>
  );
}

function AlertRow({ alert }) {
  const cls = alert.level === "critical" ? "border-red-500/40 bg-red-500/10 text-red-300"
    : alert.level === "warning"  ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
    : "border-cyan-500/20 bg-cyan-500/5 text-cyan-200/80";
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${cls}`}>
      <span className="uppercase tracking-wider mr-2 opacity-60">{alert.level}</span>
      {alert.message}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 backdrop-blur-md p-5 space-y-3">
      <h3 className="text-xs uppercase tracking-[0.2em] text-white/40 font-semibold">{title}</h3>
      {children}
    </div>
  );
}

export default function YuniPage() {
  const [brief, setBrief]         = useState(null);
  const [security, setSecurity]   = useState(null);
  const [yuniHealth, setYuniHealth] = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [tab, setTab]             = useState("overview");

  const fetchAll = useCallback(async () => {
    try {
      const [briefRes, secRes, healthRes] = await Promise.allSettled([
        fetch(`${YUNI_URL}/brief`).then(r => r.json()),
        fetch(`${YUNI_URL}/security`).then(r => r.json()),
        fetch(`${YUNI_URL}/health`).then(r => r.json()),
      ]);
      if (briefRes.status === "fulfilled")   setBrief(briefRes.value);
      if (secRes.status === "fulfilled")     setSecurity(secRes.value);
      if (healthRes.status === "fulfilled")  setYuniHealth(healthRes.value);
      setError(null);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (e) {
      setError("Cannot reach YUNI bridge server at " + YUNI_URL);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 30_000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const TABS = ["overview", "security", "quant", "raw"];

  const threatColor = security?.threat_level === "red" ? "red"
    : security?.threat_level === "yellow" ? "yellow" : "green";

  return (
    <div className="min-h-screen bg-[#07090e] text-white px-4 py-8 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-bold text-lg">Y</div>
            <div>
              <h1 className="text-2xl font-semibold text-white">YUNI Bridge</h1>
              <p className="text-xs text-white/40 mt-0.5">Intelligence layer — Arthastra integration</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && <span className="text-xs text-white/30">updated {lastRefresh}</span>}
          <button
            onClick={fetchAll}
            className="text-xs border border-white/10 rounded-lg px-3 py-1.5 text-white/60 hover:text-white hover:border-white/20 transition"
          >
            Refresh
          </button>
          <Link href="/admin" className="text-xs border border-white/10 rounded-lg px-3 py-1.5 text-white/60 hover:text-white hover:border-white/20 transition">
            ← Admin
          </Link>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          {error}
          <p className="mt-1 text-xs text-red-400/60">Start YUNI: <code>uvicorn server:app --host 127.0.0.1 --port 9000</code> in YUNI_CORE</p>
        </div>
      )}

      {/* YUNI process health bar */}
      {yuniHealth && (
        <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 flex flex-wrap gap-4 text-xs">
          <span className="text-green-400 font-semibold">● {yuniHealth.status}</span>
          <span className="text-white/50">Arthastra: <span className={yuniHealth.arthastra === "online" ? "text-green-300" : "text-red-300"}>{yuniHealth.arthastra}</span></span>
          <span className="text-white/50">QUANT: <span className={yuniHealth.quant === "online" ? "text-green-300" : "text-yellow-300"}>{yuniHealth.quant}</span></span>
          <span className="text-white/50">Ambient: <span className={yuniHealth.ambient_running ? "text-cyan-300" : "text-red-300"}>{yuniHealth.ambient_running ? "running" : "stopped"}</span></span>
          {yuniHealth.last_observe && <span className="text-white/30">last observe: {new Date(yuniHealth.last_observe).toLocaleTimeString()}</span>}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/10 pb-0">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded-t-lg transition border-b-2 -mb-px ${
              tab === t
                ? "border-cyan-400 text-cyan-300 bg-white/5"
                : "border-transparent text-white/40 hover:text-white/70"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <div className="text-white/30 text-sm text-center py-12">Connecting to YUNI…</div>}

      {/* ── OVERVIEW ── */}
      {!loading && tab === "overview" && brief && (
        <div className="space-y-4">
          {/* Alerts */}
          {brief.alerts?.length > 0 && (
            <Section title={`Alerts (${brief.alerts.length})`}>
              <div className="space-y-2">
                {brief.alerts.map((a, i) => <AlertRow key={i} alert={a} />)}
              </div>
            </Section>
          )}

          {/* Site health */}
          <Section title="Site">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Badge label="Status"     value={brief.site?.status}           color={brief.site?.status === "online" ? "green" : "red"} />
              <Badge label="Database"   value={brief.site?.db_status}        color={brief.site?.db_status === "ok" ? "green" : "red"} />
              <Badge label="Admin key"  value={brief.site?.admin_secret_set ? "set" : "MISSING"} color={brief.site?.admin_secret_set ? "green" : "red"} />
              <Badge label="YUNI token" value={brief.site?.yuni_token_set ? "set" : "MISSING"}   color={brief.site?.yuni_token_set ? "green" : "red"} />
            </div>
          </Section>

          {/* Trades */}
          <Section title="Trades">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Badge label="Total logged"    value={brief.trades?.total_logged} />
              <Badge label="Progress"        value={brief.trades?.progress_to_200} color="cyan" />
              <Badge label="Win rate"        value={brief.trades?.win_rate != null ? `${(brief.trades.win_rate * 100).toFixed(1)}%` : "—"} color={brief.trades?.win_rate >= 0.45 ? "green" : "yellow"} />
              <Badge label="Sharpe"          value={brief.trades?.sharpe_ratio?.toFixed(2) ?? "—"} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <Badge label="Evaluated"       value={brief.trades?.evaluated} />
              <Badge label="Avg 5d return"   value={brief.trades?.average_5d_return != null ? `${(brief.trades.average_5d_return * 100).toFixed(2)}%` : "—"} />
              <Badge label="Data since"      value={brief.trades?.data_since?.split("T")[0] ?? "—"} />
            </div>
          </Section>

          {/* Performance by regime */}
          {brief.performance?.by_regime?.length > 0 && (
            <Section title="Performance by regime">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {brief.performance.by_regime.map((r, i) => (
                  <div key={i} className="rounded-lg border border-white/8 bg-white/5 px-3 py-2 text-xs flex items-center justify-between">
                    <span className="text-white/60">{r.regime ?? r.market_regime ?? "—"}</span>
                    <span className="text-white font-semibold">{r.win_rate != null ? `${(r.win_rate * 100).toFixed(1)}%` : "—"} win / {r.count ?? r.trade_count ?? "—"} trades</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* ── SECURITY ── */}
      {!loading && tab === "security" && security && (
        <div className="space-y-4">
          <Section title="Threat posture">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Badge label="Threat level"    value={security.threat_level?.toUpperCase()}  color={threatColor} />
              <Badge label="Login failures"  value={security.login_failures_recent}         color={security.login_failures_recent >= 3 ? "red" : "green"} />
              <Badge label="Picks rejected"  value={security.picks_rejected_recent}         color={security.picks_rejected_recent >= 5 ? "yellow" : "green"} />
              <Badge label="Alerts total"    value={security.alert_count} />
            </div>
            {security.last_login_failure && (
              <p className="text-xs text-white/30">Last login failure: {new Date(security.last_login_failure).toLocaleString()}</p>
            )}
          </Section>

          {security.flags?.length > 0 && (
            <Section title="Active flags">
              <div className="space-y-2">
                {security.flags.map((f, i) => (
                  <div key={i} className={`rounded-lg border px-3 py-2 text-xs ${
                    f.severity === "critical" || f.severity === "high" ? "border-red-500/40 bg-red-500/10 text-red-300"
                    : f.severity === "medium" ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-300"
                    : "border-white/10 text-white/50"}`}>
                    <span className="font-mono mr-2 opacity-60">{f.type}</span>
                    {f.detail}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {security.recent_admin_actions?.length > 0 && (
            <Section title="Recent admin actions">
              <div className="space-y-1">
                {security.recent_admin_actions.map((a, i) => (
                  <div key={i} className="flex items-center justify-between text-xs border-b border-white/5 py-1.5">
                    <span className="font-mono text-cyan-300/80">{a.event}</span>
                    <span className="text-white/30">{new Date(a.time).toLocaleString()}</span>
                    {a.reason && <span className="text-white/50 text-right max-w-[40%] truncate">{a.reason}</span>}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* ── QUANT ── */}
      {!loading && tab === "quant" && brief && (
        <div className="space-y-4">
          <Section title="QUANT engine">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Badge label="Status"          value={brief.quant?.status}          color={brief.quant?.status === "offline" ? "red" : "green"} />
              <Badge label="Pick"            value={brief.quant?.pick ?? "—"}     color="cyan" />
              <Badge label="Regime"          value={brief.quant?.regime ?? "—"} />
              <Badge label="Composite score" value={brief.quant?.composite_score?.toFixed(2) ?? "—"} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Badge label="Weight version"  value={brief.quant?.weight_version ?? "—"} />
              <Badge label="Weight updated"  value={brief.quant?.weight_updated?.split("T")[0] ?? "—"} />
            </div>
          </Section>

          <Section title="Performance conditions">
            <div className="grid grid-cols-2 gap-2">
              <Badge label="Win rate risk-on"  value={brief.performance?.win_rate_risk_on  != null ? `${(brief.performance.win_rate_risk_on  * 100).toFixed(1)}%` : "—"} color="green" />
              <Badge label="Win rate risk-off" value={brief.performance?.win_rate_risk_off != null ? `${(brief.performance.win_rate_risk_off * 100).toFixed(1)}%` : "—"} color="yellow" />
            </div>
            {brief.performance?.best_conditions && (
              <div className="text-xs text-white/40 mt-1">Best: <span className="text-white/70">{JSON.stringify(brief.performance.best_conditions)}</span></div>
            )}
            {brief.performance?.worst_conditions && (
              <div className="text-xs text-white/40">Worst: <span className="text-white/70">{JSON.stringify(brief.performance.worst_conditions)}</span></div>
            )}
          </Section>
        </div>
      )}

      {/* ── RAW ── */}
      {!loading && tab === "raw" && (
        <div className="space-y-4">
          <Section title="Raw YUNI brief">
            <pre className="text-[11px] text-green-300/80 font-mono overflow-auto max-h-[60vh] whitespace-pre-wrap break-all">
              {JSON.stringify(brief, null, 2)}
            </pre>
          </Section>
          <Section title="Raw security posture">
            <pre className="text-[11px] text-yellow-300/80 font-mono overflow-auto max-h-40 whitespace-pre-wrap break-all">
              {JSON.stringify(security, null, 2)}
            </pre>
          </Section>
        </div>
      )}

    </div>
  );
}
