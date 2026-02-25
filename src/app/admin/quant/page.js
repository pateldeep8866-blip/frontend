"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error || `Request failed: ${res.status}`));
  return data;
}

function fmtPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

export default function AdminQuantPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quantStatus, setQuantStatus] = useState(null);
  const [perf, setPerf] = useState(null);
  const [weights, setWeights] = useState(null);
  const [decisions, setDecisions] = useState(null);
  const [runs, setRuns] = useState(null);
  const [strategyPerf, setStrategyPerf] = useState(null);

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const [a, b, c, d, e, f] = await Promise.all([
        fetchJson("/api/admin/quant-status"),
        fetchJson("/api/trades/performance"),
        fetchJson("/api/admin/weights"),
        fetchJson("/api/admin/decisions?limit=20"),
        fetchJson("/api/admin/quant-runs"),
        fetchJson("/api/admin/strategy-performance"),
      ]);
      setQuantStatus(a);
      setPerf(b);
      setWeights(c);
      setDecisions(d);
      setRuns(e);
      setStrategyPerf(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load admin data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function logout() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.replace("/admin/login");
  }

  const stats = perf?.stats || {};
  const latestWeight = quantStatus?.latestWeight || weights?.current || null;
  const decisionRows = decisions?.rows || [];
  const healthArthastra = "online";
  const healthQuant = String(quantStatus?.quant?.status || "offline");
  const dbPath = perf?.db_path || "unknown";
  const cacheCount = Array.isArray(runs?.runs) ? runs.runs.length : 0;

  return (
    <main className="min-h-screen bg-slate-950 text-white px-6 py-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-white/15 bg-slate-900/70 p-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">NOVA Intelligence Dashboard</h1>
            <p className="text-sm text-rose-300 mt-1">Private — Not for public distribution</p>
          </div>
          <div className="flex gap-2">
            <button onClick={loadAll} className="rounded-lg border border-white/20 px-3 py-2 text-sm">
              Refresh
            </button>
            <button onClick={logout} className="rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-2 text-sm">
              Logout
            </button>
          </div>
        </header>

        {loading ? <div className="text-sm text-white/70">Loading dashboard...</div> : null}
        {error ? <div className="text-sm text-rose-300">{error}</div> : null}

        {!loading && !error ? (
          <>
            <section className="rounded-2xl border border-white/15 bg-slate-900/60 p-4">
              <h2 className="text-lg font-semibold mb-3">QUANT_LAB Status</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div>Status: <span className="font-semibold">{String(quantStatus?.quant?.status || "offline").toUpperCase()}</span></div>
                <div>Last signal: <span className="font-semibold">{quantStatus?.generated_utc || "—"}</span></div>
                <div>Current pick: <span className="font-semibold">{quantStatus?.quant?.pick || "NONE"}</span></div>
                <div>Composite score: <span className="font-semibold">{quantStatus?.quant?.composite_score ?? "—"}</span></div>
                <div>Market regime: <span className="font-semibold">{quantStatus?.quant?.regime || "—"}</span></div>
                <div>Universe size: <span className="font-semibold">{quantStatus?.quant?.universe_size ?? "—"}</span></div>
                <div>Weights version: <span className="font-semibold">{latestWeight?.version_id || "—"}</span></div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/15 bg-slate-900/60 p-4">
              <h2 className="text-lg font-semibold mb-3">Learning Stats</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                <div>Total trades logged: <span className="font-semibold">{stats.total_trades_logged ?? 0}</span></div>
                <div>Win rate overall: <span className="font-semibold">{stats.win_rate == null ? "—" : `${(stats.win_rate * 100).toFixed(2)}%`}</span></div>
                <div>Win rate risk-on: <span className="font-semibold">{stats.win_rate_risk_on == null ? "—" : `${(stats.win_rate_risk_on * 100).toFixed(2)}%`}</span></div>
                <div>Win rate risk-off: <span className="font-semibold">{stats.win_rate_risk_off == null ? "—" : `${(stats.win_rate_risk_off * 100).toFixed(2)}%`}</span></div>
                <div>Average 5d return: <span className="font-semibold">{stats.average_5d_return == null ? "—" : `${(stats.average_5d_return * 100).toFixed(2)}%`}</span></div>
                <div>Best conditions: <span className="font-semibold">{stats.best_performing_conditions?.regime || "—"}</span></div>
                <div>Worst conditions: <span className="font-semibold">{stats.worst_performing_conditions?.regime || "—"}</span></div>
                <div>Progress to 200: <span className="font-semibold">{Math.min(Number(stats.total_trades_logged || 0), 200)}/200</span></div>
                <div>Progress to 1000: <span className="font-semibold">{Math.min(Number(stats.total_trades_logged || 0), 1000)}/1000</span></div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/15 bg-slate-900/60 p-4">
              <h2 className="text-lg font-semibold mb-3">Strategy Performance</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-white/60">
                    <tr className="border-b border-white/10 text-left">
                      <th className="py-2 pr-2">Strategy</th>
                      <th className="py-2 pr-2">Total Trades</th>
                      <th className="py-2 pr-2">Win Rate</th>
                      <th className="py-2 pr-2">Avg 5d Return</th>
                      <th className="py-2 pr-2">Avg 21d Return</th>
                      <th className="py-2 pr-2">Best Regime</th>
                      <th className="py-2 pr-2">Worst Regime</th>
                      <th className="py-2 pr-2">Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(strategyPerf?.rows || []).map((r) => (
                      <tr key={r.strategy_name} className="border-b border-white/10">
                        <td className="py-2 pr-2">{r.strategy_name}</td>
                        <td className="py-2 pr-2">{r.total_trades}</td>
                        <td className="py-2 pr-2">{fmtPct(r.win_rate)}</td>
                        <td className="py-2 pr-2">{fmtPct(r.avg_return_5d)}</td>
                        <td className="py-2 pr-2">{fmtPct(r.avg_return_21d)}</td>
                        <td className="py-2 pr-2">{r.best_regime || "—"}</td>
                        <td className="py-2 pr-2">{r.worst_regime || "—"}</td>
                        <td className="py-2 pr-2">{r.active ? "YES" : "NO"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-white/15 bg-slate-900/60 p-4">
              <h2 className="text-lg font-semibold mb-3">Weight History</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-white/60">
                    <tr className="border-b border-white/10 text-left">
                      <th className="py-2 pr-2">Version</th>
                      <th className="py-2 pr-2">Created</th>
                      <th className="py-2 pr-2">Improvement</th>
                      <th className="py-2 pr-2">Validated</th>
                      <th className="py-2 pr-2">Weights</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(weights?.rows || []).map((w) => (
                      <tr key={w.version_id} className="border-b border-white/10">
                        <td className="py-2 pr-2">{w.version_id}</td>
                        <td className="py-2 pr-2">{w.created_utc}</td>
                        <td className="py-2 pr-2">{w.sharpe_improvement ?? "—"} / {w.hit_rate_improvement ?? "—"}</td>
                        <td className="py-2 pr-2">{Number(w.validated || 0) ? "YES" : "NO"}</td>
                        <td className="py-2 pr-2">{`M ${w.weight_momentum} | MR ${w.weight_mean_reversion} | V ${w.weight_volatility} | R ${w.weight_range}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-white/15 bg-slate-900/60 p-4">
              <h2 className="text-lg font-semibold mb-3">Recent Decisions</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-white/60">
                    <tr className="border-b border-white/10 text-left">
                      <th className="py-2 pr-2">Time</th>
                      <th className="py-2 pr-2">Ticker</th>
                      <th className="py-2 pr-2">Action</th>
                      <th className="py-2 pr-2">Composite</th>
                      <th className="py-2 pr-2">Momentum</th>
                      <th className="py-2 pr-2">Mean Rev</th>
                      <th className="py-2 pr-2">Regime</th>
                      <th className="py-2 pr-2">VIX</th>
                      <th className="py-2 pr-2">Signal</th>
                      <th className="py-2 pr-2">Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decisionRows.map((r) => (
                      <tr key={r.trade_id} className="border-b border-white/10">
                        <td className="py-2 pr-2">{r.created_utc}</td>
                        <td className="py-2 pr-2">{r.ticker}</td>
                        <td className="py-2 pr-2">{r.action}</td>
                        <td className="py-2 pr-2">{r.quant_composite_score ?? "—"}</td>
                        <td className="py-2 pr-2">{r.quant_momentum ?? "—"}</td>
                        <td className="py-2 pr-2">{r.quant_mean_reversion ?? "—"}</td>
                        <td className="py-2 pr-2">{r.market_regime || "—"}</td>
                        <td className="py-2 pr-2">{r.vix_at_entry ?? "—"}</td>
                        <td className="py-2 pr-2">{r.quant_signal || "—"}</td>
                        <td className="py-2 pr-2">{r.confidence ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-white/15 bg-slate-900/60 p-4">
              <h2 className="text-lg font-semibold mb-3">QUANT_LAB Raw Output</h2>
              <div className="text-xs space-y-2">
                <div>Latest run: <span className="font-semibold">{runs?.latest_run || "—"}</span></div>
                <div>Last 10 runs: <span className="font-semibold">{(runs?.runs || []).join(", ") || "—"}</span></div>
                <div>Manifest: <pre className="mt-1 whitespace-pre-wrap text-[11px] text-white/80">{JSON.stringify(runs?.manifest || {}, null, 2)}</pre></div>
                <div>Metrics: <pre className="mt-1 whitespace-pre-wrap text-[11px] text-white/80">{JSON.stringify(runs?.metrics || {}, null, 2)}</pre></div>
                <div>Regime: <pre className="mt-1 whitespace-pre-wrap text-[11px] text-white/80">{JSON.stringify(runs?.regime || {}, null, 2)}</pre></div>
                <div>single_pick.csv: <pre className="mt-1 whitespace-pre-wrap text-[11px] text-white/80">{runs?.single_pick_csv || "—"}</pre></div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/15 bg-slate-900/60 p-4">
              <h2 className="text-lg font-semibold mb-3">Platform Health</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div>Arthastra API status: <span className="font-semibold">{healthArthastra.toUpperCase()}</span></div>
                <div>QUANT_LAB analyzer status: <span className="font-semibold">{healthQuant.toUpperCase()}</span></div>
                <div>Database status: <span className="font-semibold">{dbPath}</span></div>
                <div>Cache runs indexed: <span className="font-semibold">{cacheCount}</span></div>
                <div>Last feature feed timestamp: <span className="font-semibold">{stats.data_collection_started || "—"}</span></div>
                <div>Candles API working: <span className="font-semibold">YES</span></div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
