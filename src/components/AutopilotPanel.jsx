"use client";

/**
 * AutopilotPanel.jsx
 * Drop this into your simulator page wherever you want
 * the autopilot control center to appear.
 * 
 * Props:
 *   portfolio    — current portfolio state
 *   onUpdate     — callback when portfolio changes
 *   riskProfile  — 'conservative'|'moderate'|'aggressive'
 */

import { useState, useEffect, useRef, useCallback } from "react";

const AUTOPILOT_CSS = `
.ap-root { font-family: 'IBM Plex Mono', monospace; }

/* HEADER CARD */
.ap-header {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-top: 2px solid var(--gold);
  margin-bottom: 10px;
}
.ap-header-top {
  padding: 14px 16px 10px;
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.ap-title {
  font-family: 'Instrument Serif', serif;
  font-size: 20px; font-style: italic; color: var(--text);
  flex: 1;
}
.ap-status-badge {
  font-size: 8px; font-weight: 700; letter-spacing: 0.2em;
  text-transform: uppercase; padding: 4px 10px; border-radius: 1px;
}
.ap-status-badge.running {
  background: rgba(34,197,94,0.12); color: var(--green);
  border: 1px solid rgba(34,197,94,0.25);
  animation: ap-pulse 2s ease-in-out infinite;
}
.ap-status-badge.stopped {
  background: var(--surface); color: var(--text3);
  border: 1px solid var(--border);
}
.ap-status-badge.starting {
  background: rgba(240,165,0,0.12); color: var(--gold);
  border: 1px solid rgba(240,165,0,0.25);
  animation: ap-pulse 0.8s ease-in-out infinite;
}
@keyframes ap-pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }

.ap-stats-row {
  padding: 8px 16px 12px;
  display: flex; gap: 20px; flex-wrap: wrap;
  border-top: 1px solid var(--border2);
}
.ap-stat { display: flex; flex-direction: column; gap: 2px; }
.ap-stat-l { font-size: 7px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--text3); }
.ap-stat-v { font-size: 12px; font-weight: 500; color: var(--text); }
.ap-stat-v.pos { color: var(--green); }
.ap-stat-v.neg { color: var(--red); }
.ap-stat-v.gold { color: var(--gold); }

/* CONTROLS */
.ap-controls {
  padding: 10px 16px 14px;
  display: flex; flex-direction: column; gap: 10px;
  border-top: 1px solid var(--border2);
}
.ap-risk-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.ap-risk-label { font-size: 9px; color: var(--text3); letter-spacing: 0.12em; text-transform: uppercase; }
.ap-risk-btns { display: flex; gap: 2px; }
.ap-risk-btn {
  font-size: 8px; font-weight: 600; letter-spacing: 0.1em;
  text-transform: uppercase; padding: 4px 10px;
  background: var(--surface); border: 1px solid var(--border);
  color: var(--text3); cursor: pointer; font-family: 'IBM Plex Mono', monospace;
  transition: all 0.15s;
}
.ap-risk-btn:hover { color: var(--text); }
.ap-risk-btn.active { background: var(--gold-dim); color: var(--gold); border-color: rgba(240,165,0,0.3); }

.ap-interval-row {
  display: flex; align-items: center; gap: 8px;
}
.ap-interval-label { font-size: 9px; color: var(--text3); letter-spacing: 0.12em; text-transform: uppercase; }
.ap-interval-btns { display: flex; gap: 2px; }
.ap-interval-btn {
  font-size: 8px; font-weight: 600; padding: 4px 10px;
  background: var(--surface); border: 1px solid var(--border);
  color: var(--text3); cursor: pointer; font-family: 'IBM Plex Mono', monospace;
  transition: all 0.15s; letter-spacing: 0.08em;
}
.ap-interval-btn:hover { color: var(--text); }
.ap-interval-btn.active { background: rgba(59,130,246,0.12); color: var(--blue); border-color: rgba(59,130,246,0.25); }

.ap-action-btns { display: flex; gap: 8px; }
.ap-start-btn {
  flex: 1; padding: 12px 20px;
  font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase;
  background: var(--green); color: var(--bg); border: none;
  cursor: pointer; transition: all 0.2s;
}
.ap-start-btn:hover { background: #16a34a; transform: translateY(-1px); }
.ap-start-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
.ap-stop-btn {
  flex: 1; padding: 12px 20px;
  font-family: 'IBM Plex Mono', monospace; font-size: 11px;
  font-weight: 600; letter-spacing: 0.15em; text-transform: uppercase;
  background: transparent; color: var(--red); border: 1px solid var(--red);
  cursor: pointer; transition: all 0.2s;
}
.ap-stop-btn:hover { background: var(--red-dim); }
.ap-stop-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* PROGRESS BAR */
.ap-progress-wrap {
  padding: 0 16px 12px;
  border-top: 1px solid var(--border2);
}
.ap-progress-label {
  display: flex; justify-content: space-between;
  font-size: 8px; color: var(--text3); margin-bottom: 6px; margin-top: 10px;
}
.ap-progress { height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
.ap-progress-fill {
  height: 100%; background: var(--green); border-radius: 2px;
  transition: width 0.4s ease;
}
.ap-progress-fill.paused { background: var(--gold); }

/* LIVE CYCLE STATUS */
.ap-cycle-status {
  padding: 8px 16px;
  border-top: 1px solid var(--border2);
  font-size: 9px; color: var(--text2); line-height: 1.6;
  background: rgba(34,197,94,0.03);
}
.ap-cycle-num { color: var(--green); font-weight: 600; }

/* EVENT FEED */
.ap-events {
  border: 1px solid var(--border);
  border-top: none;
  max-height: 420px; overflow-y: auto;
}
.ap-events::-webkit-scrollbar { width: 3px; }
.ap-events::-webkit-scrollbar-thumb { background: var(--border); }

.ap-event {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border2);
  transition: background 0.1s;
}
.ap-event:hover { background: rgba(255,255,255,0.02); }
.ap-event:last-child { border-bottom: none; }
.ap-event.buy { border-left: 2px solid var(--green); }
.ap-event.sell { border-left: 2px solid var(--red); }
.ap-event.hold { border-left: 2px solid var(--amber); }
.ap-event.cycle_complete { border-left: 2px solid var(--blue); }
.ap-event.started { border-left: 2px solid var(--green); background: rgba(34,197,94,0.04); }
.ap-event.stopped { border-left: 2px solid var(--gold); background: rgba(240,165,0,0.04); }
.ap-event.error { border-left: 2px solid var(--red); background: rgba(239,68,68,0.04); }
.ap-event.kill_switch { border-left: 2px solid var(--red); background: rgba(239,68,68,0.08); }

.ap-event-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 5px;
}
.ap-event-badge {
  font-size: 7px; font-weight: 700; letter-spacing: 0.15em;
  padding: 2px 6px; border-radius: 1px;
}
.aeb-buy { background: rgba(34,197,94,0.12); color: var(--green); }
.aeb-sell { background: rgba(239,68,68,0.12); color: var(--red); }
.aeb-hold { background: rgba(240,165,0,0.12); color: var(--gold); }
.aeb-cycle { background: rgba(59,130,246,0.12); color: var(--blue); }
.aeb-info { background: var(--surface2); color: var(--text3); }
.aeb-alert { background: rgba(239,68,68,0.12); color: var(--red); }

.ap-event-ticker {
  font-family: 'Instrument Serif', serif;
  font-size: 16px; font-style: italic; color: var(--text);
}
.ap-event-time { font-size: 8px; color: var(--text3); margin-left: auto; }

.ap-event-pnl { font-size: 13px; font-weight: 600; }
.ap-event-pnl.pos { color: var(--green); }
.ap-event-pnl.neg { color: var(--red); }

.ap-event-main { font-size: 10px; color: var(--text); margin-bottom: 4px; }
.ap-event-reasoning { font-size: 9px; color: var(--text2); line-height: 1.65; margin-bottom: 5px; }
.ap-event-lesson {
  font-size: 9px; color: var(--text2); line-height: 1.6;
  background: rgba(240,165,0,0.04); border: 1px solid rgba(240,165,0,0.1);
  padding: 5px 8px; margin-top: 5px;
}

.ap-event-breakdown {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 3px; margin-top: 6px;
}
.ap-breakdown-item {
  font-size: 8px; color: var(--text3);
  display: flex; justify-content: space-between; gap: 4px;
}
.ap-breakdown-item span { color: var(--text2); }

.ap-conf-row {
  display: flex; align-items: center; gap: 8px; margin-top: 6px;
}
.ap-conf-bar { flex: 1; height: 2px; background: var(--border); border-radius: 1px; overflow: hidden; }
.ap-conf-fill { height: 100%; background: var(--gold); border-radius: 1px; }
.ap-conf-label { font-size: 8px; color: var(--text3); }
.ap-risk-badge {
  font-size: 7px; font-weight: 600; letter-spacing: 0.1em; padding: 1px 6px; border-radius: 1px;
}
.apb-low { background: rgba(34,197,94,0.12); color: var(--green); }
.apb-medium { background: rgba(240,165,0,0.12); color: var(--gold); }
.apb-high { background: rgba(239,68,68,0.12); color: var(--red); }

.ap-expand-btn {
  font-size: 8px; color: var(--text3); background: none; border: none;
  cursor: pointer; padding: 0; margin-left: auto;
}
.ap-expand-btn:hover { color: var(--text); }

/* SCORE BAR */
.ap-score-row { display: flex; align-items: center; gap: 8px; margin-top: 5px; }
.ap-score-bar { flex: 1; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
.ap-score-fill { height: 100%; border-radius: 2px; }
.ap-score-label { font-size: 8px; color: var(--text3); white-space: nowrap; }

/* SESSION REPORT */
.ap-report {
  background: rgba(240,165,0,0.05);
  border: 1px solid rgba(240,165,0,0.2);
  padding: 16px;
  margin-top: 10px;
}
.ap-report-title {
  font-family: 'Instrument Serif', serif;
  font-size: 18px; font-style: italic; color: var(--text);
  margin-bottom: 14px;
}
.ap-report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
.ap-report-item { }
.ap-report-label { font-size: 8px; letter-spacing: 0.15em; text-transform: uppercase; color: var(--text3); margin-bottom: 3px; }
.ap-report-value { font-size: 14px; font-weight: 500; color: var(--text); }
.ap-report-value.pos { color: var(--green); }
.ap-report-value.neg { color: var(--red); }
.ap-report-msg { font-size: 10px; color: var(--text2); line-height: 1.7; padding-top: 12px; border-top: 1px solid var(--border2); }

/* EMPTY STATE */
.ap-empty {
  padding: 40px 20px; text-align: center;
  color: var(--text3); border: 1px solid var(--border);
}
.ap-empty-ico { font-size: 32px; margin-bottom: 14px; }
.ap-empty-ttl { font-family: 'Instrument Serif', serif; font-size: 18px; font-style: italic; color: var(--text); margin-bottom: 8px; }
.ap-empty-txt { font-size: 10px; line-height: 1.75; max-width: 340px; margin: 0 auto 20px; }
.ap-empty-disc { font-size: 9px; color: rgba(232,237,242,0.2); border-top: 1px solid var(--border2); padding-top: 12px; max-width: 340px; margin: 0 auto; }

/* STRATEGY BADGE */
.ap-strat {
  font-size: 7px; font-weight: 600; letter-spacing: 0.1em;
  padding: 2px 6px; border-radius: 1px;
}
.aps-momentum { background: rgba(59,130,246,0.12); color: #3b82f6; }
.aps-mean_reversion { background: rgba(168,85,247,0.12); color: #a855f7; }
.aps-regime_rotation { background: rgba(240,165,0,0.12); color: #f0a500; }
.aps-pairs_trading { background: rgba(20,184,166,0.12); color: #14b8a6; }
.aps-earnings_momentum { background: rgba(249,115,22,0.12); color: #f97316; }
.aps-defensive { background: rgba(100,116,139,0.15); color: #94a3b8; }
`;

if (typeof document !== "undefined") {
  const s = document.createElement("style");
  s.textContent = AUTOPILOT_CSS;
  document.head.appendChild(s);
}

const STRAT_META = {
  momentum: { label: "Momentum", emoji: "📈", cls: "aps-momentum" },
  mean_reversion: { label: "Mean Rev", emoji: "📊", cls: "aps-mean_reversion" },
  regime_rotation: { label: "Regime", emoji: "🔄", cls: "aps-regime_rotation" },
  pairs_trading: { label: "Pairs", emoji: "⚖️", cls: "aps-pairs_trading" },
  earnings_momentum: { label: "Earnings", emoji: "📣", cls: "aps-earnings_momentum" },
  defensive: { label: "Defensive", emoji: "🛡️", cls: "aps-defensive" },
};

function StratBadge({ strategy }) {
  const m = STRAT_META[strategy] || STRAT_META.momentum;
  return <span className={`ap-strat ${m.cls}`}>{m.emoji} {m.label}</span>;
}

function ScoreBar({ score }) {
  const color = score >= 80 ? "var(--gold)" : score >= 60 ? "var(--green)" : score >= 40 ? "var(--amber)" : "var(--text3)";
  return (
    <div className="ap-score-row">
      <span className="ap-score-label">Score {score}/100</span>
      <div className="ap-score-bar"><div className="ap-score-fill" style={{ width: `${score}%`, background: color }} /></div>
    </div>
  );
}

function EventCard({ event }) {
  const [expanded, setExpanded] = useState(false);
  const d = event.data;
  const type = event.type;
  const action = d?.action?.toLowerCase();
  const time = new Date(event.ts).toLocaleTimeString();

  // Cycle complete summary
  if (type === "cycle_complete") {
    return (
      <div className="ap-event cycle_complete">
        <div className="ap-event-header">
          <span className="ap-event-badge aeb-cycle">CYCLE {d.cycle}</span>
          <span style={{ fontSize: 9, color: "var(--text2)" }}>
            {d.regime?.replace("_", " ")} · VIX {d.vix?.toFixed(1)}
          </span>
          <span className="ap-event-time">{time}</span>
        </div>
        <div className="ap-event-reasoning">{d.message}</div>
        {d.portfolio && (
          <div style={{ fontSize: 9, color: "var(--text3)", display: "flex", gap: 12, marginTop: 4 }}>
            <span>Value: <span style={{ color: "var(--text)" }}>${d.portfolio.totalValue?.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span></span>
            <span className={d.portfolio.totalReturn >= 0 ? "pos" : "neg"} style={{ color: d.portfolio.totalReturn >= 0 ? "var(--green)" : "var(--red)" }}>
              {d.portfolio.totalReturn >= 0 ? "+" : ""}{d.portfolio.totalReturn?.toFixed(2)}%
            </span>
            <span>Cash: ${d.portfolio.cash?.toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
          </div>
        )}
      </div>
    );
  }

  // Started / stopped
  if (type === "started" || type === "stopped") {
    return (
      <div className={`ap-event ${type}`}>
        <div className="ap-event-header">
          <span className={`ap-event-badge ${type === "started" ? "aeb-buy" : "aeb-info"}`}>
            {type === "started" ? "▶ STARTED" : "■ STOPPED"}
          </span>
          <span className="ap-event-time">{time}</span>
        </div>
        <div className="ap-event-reasoning">{d.message || d.session?.stopReason}</div>
        {d.lesson && <div className="ap-event-lesson">{d.lesson}</div>}
      </div>
    );
  }

  // Error / warning
  if (type === "error" || type === "warning") {
    return (
      <div className="ap-event error">
        <div className="ap-event-header">
          <span className="ap-event-badge aeb-alert">⚠ {type.toUpperCase()}</span>
          <span className="ap-event-time">{time}</span>
        </div>
        <div className="ap-event-reasoning">{d.message}</div>
      </div>
    );
  }

  // Decision events (BUY / SELL / HOLD)
  if (!action) return null;

  const isSell = action === "sell";
  const isBuy = action === "buy";
  const isKill = d.reason === "kill_switch";

  return (
    <div className={`ap-event ${action} ${isKill ? "kill_switch" : ""}`}>
      <div className="ap-event-header">
        <span className={`ap-event-badge aeb-${action}`}>{d.action}</span>
        {d.reason === "stop_loss" && <span className="ap-event-badge" style={{ background: "rgba(239,68,68,0.12)", color: "var(--red)" }}>STOP</span>}
        {d.reason === "take_profit" && <span className="ap-event-badge" style={{ background: "rgba(34,197,94,0.12)", color: "var(--green)" }}>TARGET</span>}
        <span className="ap-event-ticker">{d.ticker}</span>
        {d.strategy && <StratBadge strategy={d.strategy} />}
        <span className="ap-event-time">{time}</span>
        {d.breakdown && (
          <button className="ap-expand-btn" onClick={() => setExpanded(!expanded)}>
            {expanded ? "▲" : "▼"}
          </button>
        )}
      </div>

      {/* P&L for sells */}
      {isSell && (d.executedPnl !== undefined || d.pnl !== undefined) && (
        <div className={`ap-event-pnl ${(d.executedPnl ?? d.pnl) >= 0 ? "pos" : "neg"}`}>
          {(d.executedPnl ?? d.pnl) >= 0 ? "+" : ""}${Math.abs(d.executedPnl ?? d.pnl).toFixed(2)}
          {d.pnlPct !== undefined && (
            <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400, marginLeft: 8 }}>
              ({d.pnlPct >= 0 ? "+" : ""}{d.pnlPct?.toFixed(2)}%)
            </span>
          )}
        </div>
      )}

      {/* Buy price line */}
      {isBuy && d.shares && d.price && (
        <div className="ap-event-main">
          {Number(d.shares) < 1
            ? d.shares.toFixed(4)
            : d.shares.toFixed(2)
          } shares at ${d.price?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          {d.stop_loss && <span style={{ color: "var(--red)", marginLeft: 12 }}>🛑 ${d.stop_loss?.toFixed(2)}</span>}
          {d.take_profit && <span style={{ color: "var(--green)", marginLeft: 8 }}>🎯 ${d.take_profit?.toFixed(2)}</span>}
        </div>
      )}

      {/* Score bar */}
      {d.score !== undefined && <ScoreBar score={d.score} />}

      {/* Reasoning */}
      {d.reasoning && (
        <div className="ap-event-reasoning" style={{ marginTop: 6 }}>{d.reasoning}</div>
      )}

      {/* Expanded breakdown */}
      {expanded && d.breakdown && (
        <div className="ap-event-breakdown">
          {Object.entries(d.breakdown).map(([k, v]) => (
            <div key={k} className="ap-breakdown-item">{k} <span>{v}</span></div>
          ))}
        </div>
      )}

      {/* Confidence + risk */}
      {d.confidence !== undefined && (
        <div className="ap-conf-row">
          <span className="ap-conf-label">Confidence: {d.confidence}%</span>
          <div className="ap-conf-bar"><div className="ap-conf-fill" style={{ width: `${d.confidence}%` }} /></div>
          <span className={`ap-risk-badge apb-${(d.risk || "medium").toLowerCase()}`}>
            {d.risk || "MEDIUM"}
          </span>
        </div>
      )}

      {/* Lesson */}
      {d.lesson && <div className="ap-event-lesson">💡 {d.lesson}</div>}
    </div>
  );
}

function SessionReportCard({ report }) {
  if (!report) return null;
  const p = report.performance;
  const pnlNum = parseFloat(p.totalPnl?.replace(/[^0-9.-]/g, "") || 0);
  return (
    <div className="ap-report">
      <div className="ap-report-title">Session Complete</div>
      <div className="ap-report-grid">
        <div className="ap-report-item">
          <div className="ap-report-label">Start Value</div>
          <div className="ap-report-value">{p.startValue}</div>
        </div>
        <div className="ap-report-item">
          <div className="ap-report-label">End Value</div>
          <div className="ap-report-value">{p.endValue}</div>
        </div>
        <div className="ap-report-item">
          <div className="ap-report-label">Total P&L</div>
          <div className={`ap-report-value ${pnlNum >= 0 ? "pos" : "neg"}`}>{p.totalPnl}</div>
        </div>
        <div className="ap-report-item">
          <div className="ap-report-label">Return</div>
          <div className={`ap-report-value ${pnlNum >= 0 ? "pos" : "neg"}`}>{p.totalReturnPct}</div>
        </div>
        <div className="ap-report-item">
          <div className="ap-report-label">Trades</div>
          <div className="ap-report-value">{p.tradesExecuted}</div>
        </div>
        <div className="ap-report-item">
          <div className="ap-report-label">Win Rate</div>
          <div className="ap-report-value">{p.winRate}</div>
        </div>
        <div className="ap-report-item">
          <div className="ap-report-label">Cycles Run</div>
          <div className="ap-report-value">{report.session?.cyclesRun}</div>
        </div>
        <div className="ap-report-item">
          <div className="ap-report-label">Duration</div>
          <div className="ap-report-value">{report.session?.duration}</div>
        </div>
      </div>
      <div className="ap-report-msg">{report.message}</div>
    </div>
  );
}

// ── Main Panel Component ─────────────────────────────────────────

export default function AutopilotPanel({ portfolio, onUpdate, riskProfile = "moderate" }) {
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [events, setEvents] = useState([]);
  const [sessionReport, setSessionReport] = useState(null);
  const [risk, setRisk] = useState(riskProfile.toUpperCase());
  const [intervalSecs, setIntervalSecs] = useState(60);
  const [stats, setStats] = useState(null);
  const [cycleProgress, setCycleProgress] = useState(0);
  const [lastCycleMsg, setLastCycleMsg] = useState(null);

  const pollRef = useRef(null);
  const progressRef = useRef(null);
  const lastEventTsRef = useRef(0);
  const eventsEndRef = useRef(null);

  const INTERVALS = [
    { label: "30s", value: 30 },
    { label: "1m", value: 60 },
    { label: "5m", value: 300 },
    { label: "15m", value: 900 },
  ];

  // Auto-scroll events to top (newest)
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // Check status on mount
  useEffect(() => {
    fetchStatus();
    return () => {
      stopPolling();
    };
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/simulator-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const data = await res.json();
      if (data.ok) {
        setIsRunning(!!data.running);
        if (data.status?.portfolio) setStats(data.status.portfolio);
        if (data.events?.length > 0) processEvents(data.events);
        if (data.running) startPolling();
      }
    } catch (_) {}
  };

  const processEvents = useCallback((newEvents) => {
    const fresh = newEvents.filter(e => e.ts > lastEventTsRef.current);
    if (fresh.length === 0) return;

    lastEventTsRef.current = Math.max(...fresh.map(e => e.ts));

    setEvents(prev => {
      const merged = [
        ...fresh.map(e => ({ ...e, id: `${e.ts}-${Math.random()}` })),
        ...prev,
      ].slice(0, 100);
      return merged;
    });

    // React to specific events
    for (const e of fresh) {
      if (e.type === "cycle_complete") {
        setLastCycleMsg(e.data?.message);
        if (e.data?.portfolio) {
          setStats(e.data.portfolio);
          onUpdate?.(e.data.portfolio);
        }
        // Reset progress bar
        setCycleProgress(0);
      }
      if (e.type === "stopped") {
        setIsRunning(false);
        setIsStarting(false);
        setSessionReport(e.data);
        stopPolling();
      }
      if (e.type === "started") {
        setIsRunning(true);
        setIsStarting(false);
      }
    }
  }, [onUpdate]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/simulator-autopilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "events", since: lastEventTsRef.current }),
        });
        const data = await res.json();
        if (data.events?.length > 0) processEvents(data.events);
        if (data.portfolio) setStats(data.portfolio);
        if (!data.running && isRunning) {
          setIsRunning(false);
          stopPolling();
        }
      } catch (_) {}
    }, 3000); // Poll every 3 seconds

    // Progress bar animation between cycles
    progressRef.current = setInterval(() => {
      setCycleProgress(p => Math.min(99, p + (100 / (intervalSecs / 0.5))));
    }, 500);
  }, [processEvents, intervalSecs, isRunning]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (progressRef.current) { clearInterval(progressRef.current); progressRef.current = null; }
  };

  const handleStart = async () => {
    if (isRunning || isStarting) return;
    setIsStarting(true);
    setSessionReport(null);
    setEvents([]);
    lastEventTsRef.current = 0;

    try {
      const res = await fetch("/api/simulator-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          riskLevel: risk,
          cycleIntervalMs: intervalSecs * 1000,
          portfolio: portfolio || null,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setIsRunning(true);
        setIsStarting(false);
        if (data.portfolio) setStats(data.portfolio);
        if (data.events?.length > 0) processEvents(data.events);
        startPolling();
      } else {
        setIsStarting(false);
      }
    } catch (e) {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    try {
      await fetch("/api/simulator-autopilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop", reason: "user_request" }),
      });
      setIsRunning(false);
      stopPolling();
      // Final poll to get the stopped event + report
      setTimeout(fetchStatus, 500);
    } catch (_) {}
  };

  const handleRiskChange = async (newRisk) => {
    setRisk(newRisk);
    if (isRunning) {
      try {
        await fetch("/api/simulator-autopilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "update_risk", riskLevel: newRisk }),
        });
      } catch (_) {}
    }
  };

  const currentReturn = stats?.totalReturn ?? 0;
  const currentPnl = stats?.totalPnl ?? 0;
  const statusLabel = isStarting ? "starting" : isRunning ? "running" : "stopped";

  return (
    <div className="ap-root">
      {/* ── HEADER ── */}
      <div className="ap-header">
        <div className="ap-header-top">
          <div className="ap-title">ASTRA Autopilot</div>
          <span className={`ap-status-badge ${statusLabel}`}>
            {isStarting ? "⚡ Starting..." : isRunning ? "● Live" : "■ Stopped"}
          </span>
        </div>

        {stats && (
          <div className="ap-stats-row">
            <div className="ap-stat">
              <span className="ap-stat-l">Portfolio Value</span>
              <span className="ap-stat-v">${(stats.totalValue || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-l">Total Return</span>
              <span className={`ap-stat-v ${currentReturn >= 0 ? "pos" : "neg"}`}>
                {currentReturn >= 0 ? "+" : ""}{currentReturn.toFixed(2)}%
              </span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-l">P&L</span>
              <span className={`ap-stat-v ${currentPnl >= 0 ? "pos" : "neg"}`}>
                {currentPnl >= 0 ? "+" : ""}${Math.abs(currentPnl).toFixed(2)}
              </span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-l">Win Rate</span>
              <span className="ap-stat-v gold">{stats.winRate || "—"}%</span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-l">Trades</span>
              <span className="ap-stat-v">{stats.tradesExecuted || 0}</span>
            </div>
            <div className="ap-stat">
              <span className="ap-stat-l">Cycles</span>
              <span className="ap-stat-v">{stats.cycleCount || 0}</span>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="ap-controls">
          <div className="ap-risk-row">
            <span className="ap-risk-label">Risk:</span>
            <div className="ap-risk-btns">
              {["CONSERVATIVE", "MODERATE", "AGGRESSIVE"].map(r => (
                <button key={r} className={`ap-risk-btn ${risk === r ? "active" : ""}`}
                  onClick={() => handleRiskChange(r)} disabled={false}>
                  {r === "CONSERVATIVE" ? "CONS" : r === "MODERATE" ? "MOD" : "AGG"}
                </button>
              ))}
            </div>
          </div>

          {!isRunning && (
            <div className="ap-interval-row">
              <span className="ap-interval-label">Cycle:</span>
              <div className="ap-interval-btns">
                {INTERVALS.map(({ label, value }) => (
                  <button key={value}
                    className={`ap-interval-btn ${intervalSecs === value ? "active" : ""}`}
                    onClick={() => setIntervalSecs(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="ap-action-btns">
            <button className="ap-start-btn" onClick={handleStart} disabled={isRunning || isStarting}>
              {isStarting ? "⚡ Starting..." : "▶ Start Autopilot"}
            </button>
            <button className="ap-stop-btn" onClick={handleStop} disabled={!isRunning && !isStarting}>
              ■ Stop
            </button>
          </div>
        </div>

        {/* Cycle progress */}
        {isRunning && (
          <>
            <div className="ap-progress-wrap">
              <div className="ap-progress-label">
                <span>Next cycle in {Math.max(0, intervalSecs - Math.round(cycleProgress * intervalSecs / 100))}s</span>
                <span>{Math.round(cycleProgress)}%</span>
              </div>
              <div className="ap-progress">
                <div className="ap-progress-fill" style={{ width: `${cycleProgress}%` }} />
              </div>
            </div>
            {lastCycleMsg && (
              <div className="ap-cycle-status">
                <span className="ap-cycle-num">Latest: </span>{lastCycleMsg}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── SESSION REPORT ── */}
      {sessionReport && <SessionReportCard report={sessionReport} />}

      {/* ── EVENT FEED ── */}
      {events.length === 0 && !isRunning ? (
        <div className="ap-empty">
          <div className="ap-empty-ico">⚡</div>
          <div className="ap-empty-ttl">Autopilot is ready.</div>
          <div className="ap-empty-txt">
            Click "Start Autopilot" and ASTRA will take control of your portfolio.
            It will analyze 47 tickers across 5 strategies every cycle, buy the
            top-ranked setups, protect positions with stop losses, and lock in
            gains at targets — explaining every decision in plain English.
          </div>
          <div className="ap-empty-disc">
            Paper trading only · No real money · Not financial advice<br />
            All decisions are simulated and educational
          </div>
        </div>
      ) : (
        <div className="ap-events">
          <div ref={eventsEndRef} />
          {events.map(e => <EventCard key={e.id} event={e} />)}
        </div>
      )}
    </div>
  );
}
