"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function api(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error || `${res.status}`));
  return data;
}

function fmt(v, digits = 2) {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "—";
}

function Badge({ color, children }) {
  const colors = {
    green: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
    red:   "bg-rose-500/20 text-rose-300 border-rose-500/30",
    amber: "bg-amber-500/20 text-amber-300 border-amber-500/30",
    blue:  "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    gray:  "bg-white/10 text-white/60 border-white/15",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${colors[color] || colors.gray}`}>
      {children}
    </span>
  );
}

function StatCard({ label, value, sub, color = "default" }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
      <div className="text-xs text-white/50 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color === "green" ? "text-emerald-400" : color === "red" ? "text-rose-400" : color === "amber" ? "text-amber-400" : "text-white"}`}>
        {value ?? "—"}
      </div>
      {sub && <div className="text-xs text-white/40 mt-1">{sub}</div>}
    </div>
  );
}

const TABS = ["Overview", "Security", "Trades", "Engine", "Actions"];

// ─── main ─────────────────────────────────────────────────────────────────────

export default function YuniPage() {
  const router = useRouter();
  const [tab, setTab] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState({});
  const [actionMsg, setActionMsg] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [status, perf, weights, decisions, runs, strat, syslog] = await Promise.all([
        api("/api/admin/quant-status"),
        api("/api/trades/performance"),
        api("/api/admin/weights"),
        api("/api/admin/decisions?limit=50"),
        api("/api/admin/quant-runs"),
        api("/api/admin/strategy-performance"),
        api("/api/admin/system-log?limit=200"),
      ]);
      setData({ status, perf, weights, decisions, runs, strat, syslog });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Load failed — you may need to log in again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  async function logout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.replace("/admin/login");
  }

  async function runAction(path, method = "POST", label = "action") {
    setActionLoading(true);
    setActionMsg("");
    try {
      const res = await fetch(path, { method, cache: "no-store" });
      const d = await res.json().catch(() => ({}));
      setActionMsg(res.ok ? `✓ ${label}: ${JSON.stringify(d)}` : `✗ ${d?.error || res.status}`);
      if (res.ok) loadAll();
    } catch (e) {
      setActionMsg(`✗ ${e.message}`);
    } finally {
      setActionLoading(false);
    }
  }

  // ── derived ────────────────────────────────────────────────────────────────

  const stats      = data.perf?.stats || {};
  const qStatus    = data.status?.quant || {};
  const logRows    = data.syslog?.rows || [];
  const decisions  = data.decisions?.rows || [];
  const weightRows = data.weights?.rows || [];
  const stratRows  = data.strat?.rows || [];
  const runsList   = data.runs?.runs || [];

  const winRate    = Number.isFinite(Number(stats.win_rate)) ? `${(Number(stats.win_rate) * 100).toFixed(1)}%` : "—";
  const totalTrades = stats.total_trades_logged ?? 0;
  const sharpe     = Number.isFinite(Number(stats.sharpe_ratio)) ? Number(stats.sharpe_ratio).toFixed(3) : "—";
  const evaluated  = stats.evaluated_trades ?? 0;

  const rejected   = logRows.filter(r => r.event_type === "PICK_REJECTED").length;
  const accepted   = logRows.filter(r => r.event_type === "PICK_ACCEPTED").length;

  const protectedRoutes = [
    { route: "POST /api/trades/log",         protected: true  },
    { route: "POST /api/trades/reset",        protected: true  },
    { route: "GET  /api/trades/performance",  protected: true  },
    { route: "GET  /api/trades/history",      protected: true  },
    { route: "POST /api/trades/evaluate",     protected: true  },
    { route: "GET  /api/admin/*",             protected: true  },
    { route: "GET  /api/status",              protected: false },
    { route: "GET  /api/metrics",             protected: false },
    { route: "GET  /api/quote",               protected: false },
    { route: "GET  /api/candles",             protected: false },
    { route: "GET  /api/news",                protected: false },
  ];

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-slate-950 text-white">

      {/* ── top bar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 backdrop-blur px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-500 flex items-center justify-center text-xs font-black text-white">Y</div>
          <div>
            <div className="text-sm font-bold tracking-wide">YUNI</div>
            <div className="text-[10px] text-white/40 leading-none">Arthastra Operations Center</div>
          </div>
        </div>
        <nav className="hidden md:flex gap-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                tab === t ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30" : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button onClick={loadAll} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:text-white hover:border-white/30 transition-colors">
            Refresh
          </button>
          <button onClick={logout} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20 transition-colors">
            Logout
          </button>
        </div>
      </header>

      {/* mobile tabs */}
      <div className="md:hidden flex gap-1 overflow-x-auto px-4 py-2 border-b border-white/10">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium ${tab === t ? "bg-cyan-500/20 text-cyan-300" : "text-white/50"}`}>
            {t}
          </button>
        ))}
      </div>

      <div className="px-4 md:px-6 py-6 mx-auto max-w-7xl space-y-6">

        {loading && <div className="text-sm text-white/50 animate-pulse">Loading YUNI...</div>}
        {error   && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300">
            {error}{" "}
            <button onClick={() => router.replace("/admin/login")} className="underline ml-2">Re-login</button>
          </div>
        )}

        {!loading && !error && (

          <>
            {/* ══════════════════ OVERVIEW ══════════════════ */}
            {tab === "Overview" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Total Trades" value={totalTrades} sub="all time" />
                  <StatCard label="Win Rate" value={winRate} color={Number(stats.win_rate) >= 0.55 ? "green" : Number(stats.win_rate) >= 0.45 ? "amber" : "red"} sub={`${evaluated} evaluated`} />
                  <StatCard label="Sharpe Ratio" value={sharpe} color={Number(sharpe) > 0 ? "green" : "red"} />
                  <StatCard label="Avg 5d Return" value={fmt(stats.average_5d_return)} color={Number(stats.average_5d_return) >= 0 ? "green" : "red"} />
                </div>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">System Health</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-white/60">Arthastra API</span>
                      <Badge color="green">ONLINE</Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-white/60">QUANT_LAB</span>
                      <Badge color={qStatus.status === "online" ? "green" : "amber"}>{String(qStatus.status || "offline").toUpperCase()}</Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-white/60">Database</span>
                      <Badge color="green">CONNECTED</Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-white/60">Quant Runs Indexed</span>
                      <Badge color="blue">{runsList.length}</Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-white/60">Current Pick</span>
                      <span className="text-white font-semibold text-xs">{qStatus.pick || "NONE"}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-white/60">Market Regime</span>
                      <span className="text-white font-semibold text-xs">{qStatus.regime || "—"}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-white/60">Weight Version</span>
                      <Badge color="blue">{data.weights?.current?.version_id || "v1"}</Badge>
                    </div>
                    <div className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                      <span className="text-white/60">Data Since</span>
                      <span className="text-white/60 text-xs">{stats.data_collection_started ? new Date(stats.data_collection_started).toLocaleDateString() : "—"}</span>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">Portals</h2>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Home",              href: "/home" },
                      { label: "War Room",          href: "/warroom.html" },
                      { label: "Investor Briefing", href: "/investor-briefing.html" },
                      { label: "Arbi Dashboard",    href: "/arbi-dashboard.html" },
                      { label: "Arbi Simulation",   href: "/arbi-simulation.html" },
                      { label: "Arbi Funding",      href: "/arbi-funding.html" },
                      { label: "Quant Admin",       href: "/admin/quant" },
                      { label: "Simulator",         href: "/simulator" },
                    ].map(p => (
                      <a key={p.href} href={p.href} target="_blank" rel="noreferrer"
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70 hover:text-white hover:border-cyan-500/40 hover:bg-cyan-500/10 transition-colors text-center">
                        {p.label}
                      </a>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">Performance by Regime</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-white/40">
                        <tr className="border-b border-white/10">
                          <th className="py-2 pr-3 text-left">Regime</th>
                          <th className="py-2 pr-3 text-left">Trades</th>
                          <th className="py-2 pr-3 text-left">Win Rate</th>
                          <th className="py-2 pr-3 text-left">Avg Return</th>
                          <th className="py-2 pr-3 text-left">Avg 5d</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(stats.by_regime || []).map(r => (
                          <tr key={r.regime} className="border-b border-white/5">
                            <td className="py-2 pr-3 font-medium">{r.regime}</td>
                            <td className="py-2 pr-3 text-white/60">{r.trades}</td>
                            <td className="py-2 pr-3">{fmt(r.win_rate)}</td>
                            <td className={`py-2 pr-3 ${Number(r.avg_return) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(r.avg_return)}</td>
                            <td className={`py-2 pr-3 ${Number(r.avg_return_5d) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(r.avg_return_5d)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {/* ══════════════════ SECURITY ══════════════════ */}
            {tab === "Security" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Events (last 200)" value={logRows.length} />
                  <StatCard label="Picks Accepted" value={accepted} color="green" />
                  <StatCard label="Picks Rejected" value={rejected} color={rejected > 0 ? "amber" : "green"} />
                  <StatCard label="Rejection Rate" value={logRows.length > 0 ? `${((rejected / logRows.length) * 100).toFixed(0)}%` : "0%"} color="amber" />
                </div>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">Route Security Audit</h2>
                  <div className="space-y-2">
                    {protectedRoutes.map(r => (
                      <div key={r.route} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-xs">
                        <span className="font-mono text-white/70">{r.route}</span>
                        <Badge color={r.protected ? "green" : "amber"}>{r.protected ? "PROTECTED" : "PUBLIC"}</Badge>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">System Event Log</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-white/40">
                        <tr className="border-b border-white/10">
                          <th className="py-2 pr-3 text-left">Time (UTC)</th>
                          <th className="py-2 pr-3 text-left">Event</th>
                          <th className="py-2 pr-3 text-left">Ticker</th>
                          <th className="py-2 pr-3 text-left">Action</th>
                          <th className="py-2 pr-3 text-left">Conf</th>
                          <th className="py-2 pr-3 text-left">Reason</th>
                          <th className="py-2 text-left">Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logRows.map(r => (
                          <tr key={r.log_id} className="border-b border-white/5">
                            <td className="py-1.5 pr-3 text-white/40 font-mono">{String(r.created_utc || "").slice(0, 19).replace("T", " ")}</td>
                            <td className="py-1.5 pr-3">
                              <Badge color={r.event_type === "PICK_ACCEPTED" ? "green" : r.event_type === "PICK_REJECTED" ? "red" : "gray"}>
                                {r.event_type}
                              </Badge>
                            </td>
                            <td className="py-1.5 pr-3 font-semibold">{r.ticker || "—"}</td>
                            <td className="py-1.5 pr-3 text-white/70">{r.action || "—"}</td>
                            <td className="py-1.5 pr-3 text-white/70">{r.confidence ?? "—"}</td>
                            <td className="py-1.5 pr-3 text-white/50">{r.reason || "—"}</td>
                            <td className="py-1.5 text-white/40 max-w-xs truncate">{r.detail || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {logRows.length === 0 && <div className="text-center text-white/30 py-8 text-sm">No events logged yet.</div>}
                  </div>
                </section>
              </div>
            )}

            {/* ══════════════════ TRADES ══════════════════ */}
            {tab === "Trades" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Total Logged" value={totalTrades} />
                  <StatCard label="Evaluated" value={evaluated} />
                  <StatCard label="Win Rate" value={winRate} color={Number(stats.win_rate) >= 0.55 ? "green" : "amber"} />
                  <StatCard label="Progress to 200" value={`${Math.min(totalTrades, 200)}/200`} color={totalTrades >= 200 ? "green" : "amber"} />
                </div>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">Recent Decisions (last 50)</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-white/40">
                        <tr className="border-b border-white/10">
                          <th className="py-2 pr-3 text-left">Time</th>
                          <th className="py-2 pr-3 text-left">Ticker</th>
                          <th className="py-2 pr-3 text-left">Action</th>
                          <th className="py-2 pr-3 text-left">Conf</th>
                          <th className="py-2 pr-3 text-left">Composite</th>
                          <th className="py-2 pr-3 text-left">Regime</th>
                          <th className="py-2 pr-3 text-left">VIX</th>
                          <th className="py-2 pr-3 text-left">Return</th>
                          <th className="py-2 text-left">Outcome</th>
                        </tr>
                      </thead>
                      <tbody>
                        {decisions.map(r => (
                          <tr key={r.trade_id} className="border-b border-white/5">
                            <td className="py-1.5 pr-3 text-white/40 font-mono">{String(r.created_utc || "").slice(0, 10)}</td>
                            <td className="py-1.5 pr-3 font-semibold">{r.ticker}</td>
                            <td className="py-1.5 pr-3">
                              <Badge color={r.action === "BUY" ? "green" : r.action === "SELL" ? "red" : "gray"}>{r.action}</Badge>
                            </td>
                            <td className="py-1.5 pr-3 text-white/70">{r.confidence ?? "—"}</td>
                            <td className="py-1.5 pr-3 text-white/60">{r.quant_composite_score != null ? Number(r.quant_composite_score).toFixed(3) : "—"}</td>
                            <td className="py-1.5 pr-3 text-white/60">{r.market_regime || "—"}</td>
                            <td className="py-1.5 pr-3 text-white/60">{r.vix_at_entry != null ? Number(r.vix_at_entry).toFixed(1) : "—"}</td>
                            <td className={`py-1.5 pr-3 ${Number(r.return_pct) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                              {r.return_pct != null ? `${Number(r.return_pct) >= 0 ? "+" : ""}${(Number(r.return_pct) * 100).toFixed(2)}%` : "—"}
                            </td>
                            <td className="py-1.5">
                              {r.outcome ? <Badge color={r.outcome === "WIN" ? "green" : r.outcome === "LOSS" ? "red" : "gray"}>{r.outcome}</Badge> : <span className="text-white/30">pending</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            )}

            {/* ══════════════════ ENGINE ══════════════════ */}
            {tab === "Engine" && (
              <div className="space-y-6">
                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">QUANT_LAB Status</h2>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                    {[
                      ["Status",          String(qStatus.status || "offline").toUpperCase()],
                      ["Current Pick",    qStatus.pick || "NONE"],
                      ["Composite Score", qStatus.composite_score ?? "—"],
                      ["Regime",          qStatus.regime || "—"],
                      ["Universe Size",   qStatus.universe_size ?? "—"],
                      ["Last Signal",     data.status?.generated_utc ? new Date(data.status.generated_utc).toLocaleString() : "—"],
                    ].map(([k, v]) => (
                      <div key={k} className="rounded-lg bg-white/5 px-3 py-2">
                        <div className="text-[10px] text-white/40 mb-0.5">{k}</div>
                        <div className="font-semibold text-sm">{v}</div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">Strategy Performance</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-white/40">
                        <tr className="border-b border-white/10">
                          <th className="py-2 pr-3 text-left">Strategy</th>
                          <th className="py-2 pr-3 text-left">Trades</th>
                          <th className="py-2 pr-3 text-left">Win Rate</th>
                          <th className="py-2 pr-3 text-left">Avg 5d</th>
                          <th className="py-2 pr-3 text-left">Avg 21d</th>
                          <th className="py-2 pr-3 text-left">Best Regime</th>
                          <th className="py-2 text-left">Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stratRows.map(r => (
                          <tr key={r.strategy_name} className="border-b border-white/5">
                            <td className="py-2 pr-3 font-semibold">{r.strategy_name}</td>
                            <td className="py-2 pr-3 text-white/60">{r.total_trades}</td>
                            <td className="py-2 pr-3">{fmt(r.win_rate)}</td>
                            <td className={`py-2 pr-3 ${Number(r.avg_return_5d) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(r.avg_return_5d)}</td>
                            <td className={`py-2 pr-3 ${Number(r.avg_return_21d) >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{fmt(r.avg_return_21d)}</td>
                            <td className="py-2 pr-3 text-white/60">{r.best_regime || "—"}</td>
                            <td className="py-2"><Badge color={r.active ? "green" : "gray"}>{r.active ? "YES" : "NO"}</Badge></td>
                          </tr>
                        ))}
                        {stratRows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-white/30">No strategy data yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">Weight History</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-white/40">
                        <tr className="border-b border-white/10">
                          <th className="py-2 pr-3 text-left">Version</th>
                          <th className="py-2 pr-3 text-left">Created</th>
                          <th className="py-2 pr-3 text-left">Momentum</th>
                          <th className="py-2 pr-3 text-left">Mean Rev</th>
                          <th className="py-2 pr-3 text-left">Volatility</th>
                          <th className="py-2 pr-3 text-left">Range</th>
                          <th className="py-2 pr-3 text-left">Sharpe Δ</th>
                          <th className="py-2 text-left">Valid</th>
                        </tr>
                      </thead>
                      <tbody>
                        {weightRows.map(w => (
                          <tr key={w.version_id} className="border-b border-white/5">
                            <td className="py-2 pr-3 font-semibold">{w.version_id}</td>
                            <td className="py-2 pr-3 text-white/40 font-mono">{String(w.created_utc || "").slice(0, 10)}</td>
                            <td className="py-2 pr-3">{w.weight_momentum}</td>
                            <td className="py-2 pr-3">{w.weight_mean_reversion}</td>
                            <td className="py-2 pr-3">{w.weight_volatility}</td>
                            <td className="py-2 pr-3">{w.weight_range}</td>
                            <td className="py-2 pr-3 text-white/60">{w.sharpe_improvement ?? "—"}</td>
                            <td className="py-2"><Badge color={Number(w.validated) ? "green" : "gray"}>{Number(w.validated) ? "YES" : "NO"}</Badge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">QUANT_LAB Raw Output</h2>
                  <div className="space-y-3 text-xs">
                    <div><span className="text-white/40">Latest run:</span> <span className="font-mono text-white/70">{data.runs?.latest_run || "—"}</span></div>
                    <div><span className="text-white/40">Runs ({runsList.length}):</span> <span className="text-white/50">{runsList.slice(0, 5).join(", ") || "—"}</span></div>
                    {data.runs?.single_pick_csv && (
                      <div>
                        <div className="text-white/40 mb-1">single_pick.csv:</div>
                        <pre className="rounded-lg bg-black/30 p-3 text-[11px] text-white/70 whitespace-pre-wrap overflow-x-auto">{data.runs.single_pick_csv}</pre>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* ══════════════════ ACTIONS ══════════════════ */}
            {tab === "Actions" && (
              <div className="space-y-6">
                {actionMsg && (
                  <div className={`rounded-xl border p-4 text-sm font-mono ${actionMsg.startsWith("✓") ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-rose-500/30 bg-rose-500/10 text-rose-300"}`}>
                    {actionMsg}
                  </div>
                )}

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5 space-y-4">
                  <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wider">Trade Operations</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                      <div className="text-sm font-semibold mb-1">Evaluate Pending Outcomes</div>
                      <div className="text-xs text-white/50 mb-3">Fetch current prices for all BUY/SELL trades older than 24h with no outcome logged.</div>
                      <button
                        onClick={() => runAction("/api/trades/evaluate", "POST", "evaluate")}
                        disabled={actionLoading}
                        className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50 transition-colors"
                      >
                        {actionLoading ? "Running..." : "Run Evaluation"}
                      </button>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                      <div className="text-sm font-semibold mb-1">Clean Bad Crypto Trades</div>
                      <div className="text-xs text-white/50 mb-3">Remove BTC/ETH trades where entry price &lt; $100 (wrongly mapped tickers).</div>
                      <button
                        onClick={() => runAction("/api/trades/reset", "POST", "cleanup")}
                        disabled={actionLoading}
                        className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
                      >
                        {actionLoading ? "Running..." : "Clean Bad Trades"}
                      </button>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5">
                  <h2 className="text-sm font-semibold text-white/70 mb-4 uppercase tracking-wider">Environment</h2>
                  <div className="space-y-2">
                    {[
                      ["ADMIN_SECRET",             "Used for founder login / admin cookie"],
                      ["ARTHASTRA_INTERNAL_TOKEN",  "Investor portal HMAC secret"],
                      ["INVESTOR_PORTAL_SECRET",    "Alt investor portal secret"],
                      ["INVESTOR_ACCESS_CODE",      "Investor access code (default: ARTHASTRA2025)"],
                      ["NEXT_PUBLIC_BASE_URL",      "Public base URL for the app"],
                    ].map(([k, desc]) => (
                      <div key={k} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-xs">
                        <div>
                          <div className="font-mono text-white/80">{k}</div>
                          <div className="text-white/40 text-[10px]">{desc}</div>
                        </div>
                        <Badge color="gray">env var</Badge>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-white/30">Set these in <span className="font-mono">.env.local</span> — never commit to git.</div>
                </section>

                <section className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5">
                  <h2 className="text-sm font-semibold text-rose-400 mb-3 uppercase tracking-wider">Session</h2>
                  <button
                    onClick={logout}
                    className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/25 transition-colors"
                  >
                    Logout
                  </button>
                </section>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
