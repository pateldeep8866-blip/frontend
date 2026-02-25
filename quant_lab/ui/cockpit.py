from __future__ import annotations

import sys
from pathlib import Path

# Allow `python ui/cockpit.py` to import top-level packages like `quantlab.*`.
_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

import os

# Prefer running the cockpit under the project venv for consistent dependencies.
def _maybe_reexec_into_venv() -> None:
    if os.environ.get("QUANTLAB_COCKPIT_REEXEC", "") == "1":
        return
    in_venv = getattr(sys, "base_prefix", sys.prefix) != sys.prefix
    if in_venv:
        return
    venv_py = _ROOT / ".venv" / "bin" / "python"
    if not venv_py.exists():
        return
    os.environ["QUANTLAB_COCKPIT_REEXEC"] = "1"
    os.execv(str(venv_py), [str(venv_py), str(Path(__file__).resolve()), *sys.argv[1:]])


_maybe_reexec_into_venv()

# Avoid matplotlib config warnings on environments where ~/.matplotlib isn't writable.
_mpl_cfg = _ROOT / ".cache" / "matplotlib"
_mpl_cfg.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_mpl_cfg))

import csv
import json
import math
import queue
import threading
import time
from dataclasses import asdict
from datetime import date, datetime
from typing import Any, Dict, List, Optional

try:
    import customtkinter as ctk  # type: ignore
except ModuleNotFoundError as e:  # pragma: no cover
    raise SystemExit(
        "Missing dependency: customtkinter.\n"
        "Install UI requirements (e.g., `pip install -r requirements.txt`) and re-run `python ui/cockpit.py`."
    ) from e

from quantlab.live.alpaca_provider import AlpacaProvider
from quantlab.live.providers import apply_slippage, best_price_for_side, compute_target_shares_from_weights
from quantlab.live.replay_provider import ReplayProvider
from quantlab.sim.autopilot import (
    AutopilotDecision,
    MarketContext,
    decide_daily_actions,
    next_decision_time_text,
)
from quantlab.sim.account import PaperAccount
from ui.components.chart_panel import ChartPanel
from ui.components.logs_panel import LogsPanel
from ui.components.portfolio_panel import PortfolioPanel
from ui.components.signals_panel import SignalsPanel
from ui.components.simulator_panel import SimulatorPanel
from ui.components.topbar import TopBar
from ui.components.universe_panel import UniversePanel
from ui.state import RunPack, load_latest_run_pack, run_morning_plan
from ui.theme import UISettings, apply_appearance_mode, get_palette, load_settings


class QuantCockpit(ctk.CTk):
    def __init__(self):
        super().__init__()

        self.project_root = Path(__file__).resolve().parents[1]
        self.run_root = self.project_root / "reports" / "runs"

        settings = load_settings()
        apply_appearance_mode(settings.appearance)
        pal = get_palette()
        self.configure(fg_color=pal.bg)

        self.title("QUANT_LAB Quant Cockpit (Paper/Research Only)")
        self.geometry("1440x880")
        self.minsize(1180, 760)

        self._engine_status = "IDLE"
        self._plan: Optional[RunPack] = None

        self._provider = None
        self._tick_q: "queue.Queue[dict]" = queue.Queue()
        self._stop_stream = threading.Event()

        # Live session state
        self._account: Optional[PaperAccount] = None
        self._symbols: List[str] = []
        self._first_prices: Dict[str, float] = {}
        self._first_ticks: Dict[str, Dict[str, Any]] = {}
        self._last_prices: Dict[str, float] = {}
        self._live_prices_rows: List[Dict[str, Any]] = []
        self._live_equity_rows: List[Dict[str, Any]] = []
        self._live_trades_rows: List[Dict[str, Any]] = []
        self._rebalance_done = False
        self._start_equity = 0.0
        self._equity_peak = 0.0
        self._manual_baseline_start = 0.0
        self._manual_baseline_peak = 0.0
        self._manual_baseline_rows: List[Dict[str, Any]] = []
        self._benchmark_start = 0.0
        self._benchmark_rows: List[Dict[str, Any]] = []

        # Auto-pilot state (paper-only).
        self._autopilot_enabled = False
        self._autopilot_last_action_ts: Optional[datetime] = None
        self._autopilot_last_decision_day: Optional[str] = None
        self._autopilot_decisions_rows: List[Dict[str, Any]] = []
        self._autopilot_latest_decision: Optional[AutopilotDecision] = None
        self._autopilot_watchlist: List[str] = []
        self._autopilot_outlook = "Waiting for market context."
        self._autopilot_risk_score = "Moderate"

        self._last_chart_draw = 0.0

        # Layout
        self.grid_columnconfigure(0, weight=0)
        self.grid_columnconfigure(1, weight=1)
        self.grid_columnconfigure(2, weight=0)
        self.grid_rowconfigure(1, weight=1)
        self.grid_rowconfigure(2, weight=0)

        self.topbar = TopBar(
            self,
            on_run_plan=self._on_run_plan,
            on_start=self._on_start,
            on_stop=self._on_stop,
            initial_settings=settings,
        )
        self.topbar.grid(row=0, column=0, columnspan=3, sticky="ew", padx=12, pady=(12, 6))

        self.universe_panel = UniversePanel(self, on_change=self._on_universe_change)
        self.universe_panel.grid(row=1, column=0, sticky="nsew", padx=(12, 6), pady=(6, 12))

        center = ctk.CTkFrame(self, fg_color="transparent")
        center.grid(row=1, column=1, sticky="nsew", padx=6, pady=(6, 12))
        center.grid_columnconfigure(0, weight=1)
        center.grid_rowconfigure(1, weight=1)

        self.signals_panel = SignalsPanel(center, on_select=self._on_select_ticker)
        self.signals_panel.grid(row=0, column=0, sticky="nsew")

        self.chart_panel = ChartPanel(center)
        self.chart_panel.grid(row=1, column=0, sticky="nsew", pady=(10, 0))

        self.portfolio_panel = PortfolioPanel(self)
        self.portfolio_panel.grid(row=1, column=2, sticky="nsew", padx=(6, 12), pady=(6, 12))

        bottom = ctk.CTkFrame(self, fg_color="transparent")
        bottom.grid(row=2, column=0, columnspan=3, sticky="ew", padx=12, pady=(0, 12))
        bottom.grid_columnconfigure(0, weight=0)
        bottom.grid_columnconfigure(1, weight=1)

        self.sim_panel = SimulatorPanel(
            bottom,
            on_mode_change=self._on_mode_change,
            on_autopilot_toggle=self._on_autopilot_toggle,
        )
        self.sim_panel.grid(row=0, column=0, sticky="ew", padx=(0, 8))

        self.logs_panel = LogsPanel(bottom)
        self.logs_panel.grid(row=0, column=1, sticky="nsew")

        # Defaults for plan inputs.
        self.universe_panel.set_end_date(date.today().isoformat())

        # Try load latest run pack at startup.
        latest = load_latest_run_pack(self.run_root)
        if latest is not None and str(latest.metrics.get("mode", "")) == "morning_signal_engine":
            self._apply_plan(latest)

        self._refresh_autopilot_panels()
        self.after(100, self._pump_ticks)

    def _log(self, msg: str) -> None:
        ts = datetime.utcnow().strftime("%H:%M:%S")
        self.logs_panel.append(f"[{ts}Z] {msg}")

    def _set_status(self, status: str) -> None:
        self._engine_status = str(status)
        self.topbar.set_status(self._engine_status)

    def _on_universe_change(self, universe: List[str]) -> None:
        self._log(f"Universe updated: {len(universe)} tickers")

    def _on_mode_change(self, mode: str) -> None:
        self.topbar.set_mode(mode)

    def _on_autopilot_toggle(self, enabled: bool) -> None:
        if bool(enabled) == bool(self._autopilot_enabled):
            return
        if enabled:
            if self._plan is None:
                self._log("Auto-Pilot requires a loaded Morning Plan.")
                self.sim_panel.set_autopilot_enabled(False)
                return
            ok = self._show_confirm_modal(
                title="Enable quant Auto-Pilot",
                body=(
                    "QUANT will now manage your portfolio. You can watch every decision and the reasoning behind it. "
                    "Switch back to manual at any time."
                ),
            )
            if not ok:
                self.sim_panel.set_autopilot_enabled(False)
                return
            self._autopilot_enabled = True
            self._autopilot_last_decision_day = None
            self._log("Auto-Pilot enabled. QUANT is now managing paper trades.")
        else:
            self._autopilot_enabled = False
            self._log("Auto-Pilot disabled. Manual control restored; holdings unchanged.")

        self.sim_panel.set_autopilot_enabled(self._autopilot_enabled)
        self._refresh_autopilot_panels()

    def _show_confirm_modal(self, *, title: str, body: str) -> bool:
        result = {"ok": False}
        dialog = ctk.CTkToplevel(self)
        dialog.title(str(title))
        dialog.geometry("560x220")
        dialog.transient(self)
        dialog.grab_set()
        dialog.grid_columnconfigure(0, weight=1)
        p = get_palette()
        frame = ctk.CTkFrame(dialog, fg_color=p.card, corner_radius=14)
        frame.grid(row=0, column=0, sticky="nsew", padx=14, pady=14)
        frame.grid_columnconfigure(0, weight=1)
        ctk.CTkLabel(
            frame,
            text=str(title),
            font=ctk.CTkFont(family="Avenir Next", size=18, weight="bold"),
        ).grid(row=0, column=0, sticky="w", padx=14, pady=(14, 8))
        ctk.CTkLabel(
            frame,
            text=str(body),
            justify="left",
            wraplength=500,
            text_color=p.muted,
        ).grid(row=1, column=0, sticky="w", padx=14, pady=(0, 14))
        btns = ctk.CTkFrame(frame, fg_color="transparent")
        btns.grid(row=2, column=0, sticky="e", padx=14, pady=(0, 14))

        def _yes() -> None:
            result["ok"] = True
            dialog.destroy()

        def _no() -> None:
            result["ok"] = False
            dialog.destroy()

        ctk.CTkButton(btns, text="Cancel", command=_no, width=100).grid(row=0, column=0, padx=(0, 8))
        ctk.CTkButton(btns, text="Enable", command=_yes, width=100).grid(row=0, column=1)
        dialog.wait_window()
        return bool(result["ok"])

    def _on_select_ticker(self, ticker: str) -> None:
        if self._plan is None:
            return
        params = (self._plan.manifest.get("strategy") or {}).get("parameters") or {}
        start = str(params.get("start", ""))
        end = str(params.get("end", ""))
        interval = str(params.get("interval", "1d"))

        try:
            from quantlab.data_cache import get_prices_cached

            df, _path, _sha, _hit = get_prices_cached(str(ticker), start=start, end=end, interval=interval)
            # Plot close series.
            if "Adj Close" in df.columns and df["Adj Close"].notna().any():
                s = df["Adj Close"].astype(float).dropna()
            else:
                s = df["Close"].astype(float).dropna()
            self.chart_panel.plot(s.index, list(s.values), title=f"{ticker} Price", ylabel="Price")
        except Exception as e:
            self._log(f"Chart error for {ticker}: {e}")

    def _on_run_plan(self) -> None:
        if self._engine_status in {"RESEARCHING", "LIVE"}:
            return

        start = self.universe_panel.start_date()
        end = self.universe_panel.end_date()
        asof = self.universe_panel.asof_date() or None
        k = self.universe_panel.k_value()
        universe = self.universe_panel.get_universe()

        self._set_status("RESEARCHING")
        self.topbar.set_start_enabled(False)
        self.topbar.set_stop_enabled(False)
        self.sim_panel.set_status("Running Morning Plan...")
        self._log(f"Running Morning Plan: start={start} end={end} asof={asof or end} k={k} universe={len(universe)}")

        def _worker() -> None:
            try:
                plan = run_morning_plan(start=start, end=end, asof=asof, k=k, universe=universe)
                self._tick_q.put({"type": "plan_ready", "plan_dir": str(plan.run_dir)})
            except BaseException as e:  # includes SystemExit from argparse
                self._tick_q.put({"type": "plan_error", "error": str(e)})

        threading.Thread(target=_worker, daemon=True).start()

    def _apply_plan(self, plan: RunPack) -> None:
        self._plan = plan
        self._set_status("PLAN_READY")

        asof = str(plan.metrics.get("asof", "-"))
        self.topbar.set_asof(asof)
        self.topbar.set_regime(plan.regime.label, float(plan.regime.confidence))

        mode = self.sim_panel.mode()
        self.topbar.set_mode(mode)
        self.topbar.set_provider("ReplayProvider" if mode == "Replay" else "AlpacaProvider")

        self.signals_panel.set_rows(plan.picks)
        pv = None
        hhi = None
        try:
            pv = float(((plan.metrics.get("portfolio") or {}).get("portfolio_vol")))
        except Exception:
            pv = None
        try:
            hhi = float(((plan.metrics.get("portfolio") or {}).get("concentration_hhi")))
        except Exception:
            hhi = None
        self.portfolio_panel.set_plan(plan.allocation, portfolio_vol=pv, concentration_hhi=hhi)

        self.topbar.set_start_enabled(True)
        self.sim_panel.set_status(f"Plan ready: {plan.run_dir.name}")
        self._log(f"Plan ready: {plan.run_dir}")
        self._autopilot_watchlist = [p.ticker for p in plan.picks[5:8] if p.ticker]
        self._autopilot_outlook = "Neutral. Waiting for live context."
        self._autopilot_risk_score = "Moderate"
        self._refresh_autopilot_panels()

    def _on_start(self) -> None:
        if self._plan is None or self._engine_status != "PLAN_READY":
            return

        mode = self.sim_panel.mode()
        self.topbar.set_mode(mode)
        self.topbar.set_provider("ReplayProvider" if mode == "Replay" else "AlpacaProvider")

        # Symbols: non-cash from allocation.
        symbols = [r.ticker for r in self._plan.allocation if r.ticker and r.ticker != "CASH" and r.target_weight > 0]
        symbols = sorted(list(dict.fromkeys(symbols)))
        if not symbols:
            self._log("No non-cash symbols to simulate.")
            return

        # Provider
        params = (self._plan.manifest.get("strategy") or {}).get("parameters") or {}
        start = str(params.get("start", ""))
        end = str(params.get("end", ""))
        asof = str(params.get("asof", params.get("end", "")))

        if mode == "Replay":
            provider = ReplayProvider(start=start, end=end, asof=asof, speed=self.sim_panel.speed(), offline=True, async_mode=True)
        else:
            provider = AlpacaProvider()
            if not provider.configured():
                self._log("Live provider not configured. Set env vars or use Replay mode.")
                return

        self._provider = provider
        self._symbols = symbols

        # Reset session state.
        self._account = PaperAccount(self.sim_panel.cash())
        self._account.set_time(None)
        self._first_prices = {}
        self._first_ticks = {}
        self._last_prices = {}
        self._live_prices_rows = []
        self._live_equity_rows = []
        self._live_trades_rows = []
        self._rebalance_done = False
        self._start_equity = float(self._account.cash)
        self._equity_peak = self._start_equity
        self._manual_baseline_start = self._start_equity
        self._manual_baseline_peak = self._start_equity
        self._manual_baseline_rows = []
        self._benchmark_start = 0.0
        self._benchmark_rows = []
        self._autopilot_decisions_rows = []
        self._autopilot_last_action_ts = None
        self._autopilot_last_decision_day = None
        self._autopilot_latest_decision = None

        self._stop_stream.clear()
        self._set_status("LIVE")
        self.topbar.set_start_enabled(False)
        self.topbar.set_stop_enabled(True)
        self.sim_panel.set_status(f"Streaming ({mode})... waiting for first prices")
        self._log(f"START ({mode}) symbols={symbols}")
        self._refresh_autopilot_panels()

        def _on_tick(tick: dict) -> None:
            self._tick_q.put({"type": "tick", "tick": tick})

        try:
            provider.connect()
            provider.subscribe(symbols)
            provider.start_stream(_on_tick)
            if isinstance(provider, ReplayProvider):
                info = provider.stream_info()
                if info:
                    self._log(
                        f"Replay stream: ticks={info.get('tick_count')} "
                        f"symbols={info.get('unique_symbols')} "
                        f"from={info.get('start_ts')} to={info.get('end_ts')}"
                    )
        except Exception as e:
            self._log(f"START failed: {e}")
            try:
                provider.stop()
            except Exception:
                pass
            self._provider = None
            self._set_status("PLAN_READY")
            self.topbar.set_start_enabled(True)
            self.topbar.set_stop_enabled(False)
            self.sim_panel.set_status("Start failed. Check logs.")
            return

    def _on_stop(self) -> None:
        if self._engine_status != "LIVE":
            return
        self._set_status("STOPPED")
        self.topbar.set_stop_enabled(False)

        try:
            if self._provider is not None:
                self._provider.stop()
        except Exception as e:
            self._log(f"Stop error: {e}")
        self._provider = None

        self._finalize_live_session()
        self.topbar.set_start_enabled(True if self._plan is not None else False)
        self.sim_panel.set_status("Stopped. Artifacts written.")
        self._log("STOPPED")

    def _pump_ticks(self) -> None:
        """
        UI-thread tick pump. Processes queued ticks/events and updates UI at a capped rate.
        """
        processed = 0
        max_per_pump = 250
        while processed < max_per_pump:
            try:
                msg = self._tick_q.get_nowait()
            except queue.Empty:
                break

            typ = msg.get("type")
            if typ == "plan_ready":
                plan_dir = Path(str(msg.get("plan_dir", "")))
                try:
                    from ui.state import load_run_pack

                    plan = load_run_pack(plan_dir)
                    self._apply_plan(plan)
                except Exception as e:
                    self._set_status("IDLE")
                    self._log(f"Failed to load plan: {e}")
                    self.sim_panel.set_status("Plan load failed.")

            elif typ == "plan_error":
                self._set_status("IDLE")
                self.topbar.set_start_enabled(False)
                self._log(f"Morning Plan error: {msg.get('error')}")
                self.sim_panel.set_status("Morning Plan failed.")

            elif typ == "tick":
                tick = msg.get("tick", {})
                self._handle_tick(tick)

            processed += 1

        self.after(100, self._pump_ticks)

    def _handle_tick(self, tick: Dict[str, Any]) -> None:
        if self._account is None or self._plan is None:
            return
        try:
            sym = str(tick.get("symbol", "")).upper()
            ts = tick.get("ts")
            last = float(tick.get("last", 0.0))
            bid = tick.get("bid", None)
            ask = tick.get("ask", None)
            if not sym or ts is None or last <= 0:
                return
        except Exception:
            return

        # Record tick.
        self._last_prices[sym] = last
        self._live_prices_rows.append(
            {
                "ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                "symbol": sym,
                "last": f"{last:.6f}",
                "bid": "" if bid is None else f"{float(bid):.6f}",
                "ask": "" if ask is None else f"{float(ask):.6f}",
            }
        )

        # Rebalance on first prices for all symbols.
        if not self._rebalance_done:
            if sym not in self._first_prices:
                self._first_prices[sym] = float(last)
                # Keep the full first tick for bid/ask-aware fills.
                self._first_ticks[sym] = dict(tick)
            if all(s in self._first_prices for s in self._symbols):
                self._do_rebalance(ts)
                self._rebalance_done = True
                self.sim_panel.set_status("Rebalanced to plan. Streaming...")

        # Mark-to-market equity.
        self._account.set_time(ts if isinstance(ts, datetime) else None)
        eq = float(self._account.equity(self._last_prices))
        self._equity_peak = max(self._equity_peak, eq)
        dd = (eq / self._equity_peak) - 1.0 if self._equity_peak > 0 else 0.0
        pnl = eq - self._start_equity
        self._live_equity_rows.append(
            {
                "ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                "equity": f"{eq:.2f}",
                "pnl": f"{pnl:.2f}",
                "drawdown": f"{dd:.6f}",
            }
        )
        if isinstance(ts, datetime):
            self._update_baseline_curves(ts)
            self._maybe_run_autopilot(ts)
        self.sim_panel.set_status(f"Equity {eq:,.2f} | PnL {pnl:,.2f} | DD {dd:.2%}")

        now = time.time()
        if now - self._last_chart_draw > 0.2:  # ~5 fps
            self._last_chart_draw = now
            self._draw_live_chart()
        self._refresh_autopilot_panels()

    def _update_baseline_curves(self, ts: datetime) -> None:
        ts_s = ts.isoformat()
        if self._live_equity_rows:
            eq = float(self._live_equity_rows[-1]["equity"])
            self._manual_baseline_rows.append({"ts": ts_s, "equity": f"{eq:.2f}"})

        if "SPY" in self._last_prices:
            spy = float(self._last_prices.get("SPY", 0.0))
            if spy > 0.0:
                if self._benchmark_start <= 0.0:
                    self._benchmark_start = spy
                bench_eq = 100000.0 * (spy / self._benchmark_start)
                self._benchmark_rows.append({"ts": ts_s, "equity": f"{bench_eq:.2f}"})

    def _draw_live_chart(self) -> None:
        xs = [r["ts"] for r in self._live_equity_rows][-500:]
        auto = [float(r["equity"]) for r in self._live_equity_rows][-500:]
        manual = [float(r["equity"]) for r in self._manual_baseline_rows][-500:]
        bench = [float(r["equity"]) for r in self._benchmark_rows][-500:]
        if xs and len(manual) == len(xs) and len(bench) == len(xs):
            self.chart_panel.plot_multi(
                xs,
                [
                    ("quant Auto-Pilot", auto, ("#2563EB", "#60A5FA")),
                    ("Manual Portfolio", manual, ("#16A34A", "#22C55E")),
                    ("S&P 500", bench, ("#6B7280", "#9CA3AF")),
                ],
                title="Performance Comparison",
                ylabel="Equity",
            )
            return
        self.chart_panel.plot(xs, auto, title="Portfolio Equity (Paper)", ylabel="Equity")

    def _collect_market_context(self, ts: datetime) -> MarketContext:
        assert self._account is not None
        assert self._plan is not None

        holdings = {str(k).upper(): int(v) for k, v in self._account.positions.items() if int(v) > 0}
        prices = {str(k).upper(): float(v) for k, v in self._last_prices.items() if float(v) > 0.0}
        cash = float(self._account.cash)
        equity = float(self._account.equity(prices))
        picks = [p.ticker for p in self._plan.picks[:5] if p.ticker]

        trend = "FLAT"
        if str(self._plan.regime.label).lower() == "risk_on":
            trend = "UP"
        elif str(self._plan.regime.label).lower() == "risk_off":
            trend = "DOWN"
        vix = float(self._last_prices.get("VIX", 19.0))
        dxy = float(self._last_prices.get("DXY", 103.0))
        us10y = float(self._last_prices.get("US10Y", 4.2))

        movers = [f"{p.ticker} score={p.score:.2f}" for p in self._plan.picks[:5] if p.ticker]
        news = [f"{p.ticker}: {p.reasons}" for p in self._plan.picks[:3] if p.ticker and p.reasons]
        sectors = [t for t in ("XLK", "XLF", "XLE", "XLV") if t in prices]
        sector_snapshot = [f"{t}:{prices[t]:.2f}" for t in sectors]

        risk_score = "Moderate"
        if trend == "DOWN" or vix >= 24.0:
            risk_score = "Conservative"
        elif trend == "UP" and vix <= 16.0:
            risk_score = "Aggressive"
        outlook = (
            "Risk-off backdrop; preserve capital and hold optional cash."
            if risk_score == "Conservative"
            else ("Constructive trend; selective risk-on with strict sizing." if risk_score == "Aggressive" else "Mixed regime; keep balanced exposure and discipline.")
        )
        watch = self._autopilot_watchlist or [p.ticker for p in self._plan.picks[5:8] if p.ticker]
        self._autopilot_watchlist = watch
        self._autopilot_risk_score = risk_score
        self._autopilot_outlook = outlook

        return MarketContext(
            ts=ts,
            cash=cash,
            equity=equity,
            holdings=holdings,
            prices=prices,
            movers=movers,
            news=news,
            vix=vix,
            dxy=dxy,
            us10y=us10y,
            sector_snapshot=sector_snapshot,
            today_picks=picks,
            market_trend=trend,
            risk_score=risk_score,
            watchlist=watch,
            outlook=outlook,
        )

    def _maybe_run_autopilot(self, ts: datetime) -> None:
        if not self._autopilot_enabled or self._account is None or self._plan is None:
            return
        day_key = ts.date().isoformat()
        if self._autopilot_last_decision_day == day_key:
            return
        self._autopilot_last_decision_day = day_key
        ctx = self._collect_market_context(ts)
        decisions = decide_daily_actions(ctx=ctx, max_weight_per_asset=0.20, min_cash_reserve=0.10)
        for d in decisions:
            self._execute_autopilot_decision(ts, d)

    def _execute_autopilot_decision(self, ts: datetime, d: AutopilotDecision) -> None:
        assert self._account is not None
        sym = str(d.ticker).upper()
        action = str(d.action).upper()
        qty = int(d.shares)
        if action == "HOLD" or sym == "PORTFOLIO" or qty <= 0:
            self._append_autopilot_decision(ts, d, price=float("nan"))
            return
        px = float(self._last_prices.get(sym, 0.0))
        if px <= 0.0:
            self._append_autopilot_decision(ts, d, price=float("nan"))
            return

        commission = float(self.sim_panel.commission())
        slip_bps = float(self.sim_panel.slippage_bps())
        fill_base = best_price_for_side({"symbol": sym, "ts": ts, "last": px, "bid": None, "ask": None}, action)
        fill_px = apply_slippage(fill_base, action, slip_bps)

        if action == "BUY":
            eq = float(self._account.equity(self._last_prices))
            min_cash = 0.10 * eq
            max_cash_spend = max(0.0, float(self._account.cash) - min_cash)
            max_cash_qty = int(max_cash_spend // (fill_px * (1.0 + commission))) if fill_px > 0 else 0
            cur = int(self._account.positions.get(sym, 0))
            cap_qty = int(max(0.0, (0.20 * eq - cur * fill_px)) // fill_px) if fill_px > 0 else 0
            qty = int(max(0, min(qty, max_cash_qty, cap_qty)))
            if qty > 0:
                self._account.buy(sym, qty, fill_px, commission=commission)
                self._live_trades_rows.append(
                    {"ts": ts.isoformat(), "symbol": sym, "side": "BUY", "qty": str(qty), "price": f"{fill_px:.6f}", "reason": "quant_autopilot"}
                )
        elif action == "SELL":
            held = int(self._account.positions.get(sym, 0))
            qty = int(max(0, min(qty, held)))
            if qty > 0:
                self._account.sell(sym, qty, fill_px, commission=commission)
                self._live_trades_rows.append(
                    {"ts": ts.isoformat(), "symbol": sym, "side": "SELL", "qty": str(qty), "price": f"{fill_px:.6f}", "reason": "quant_autopilot"}
                )

        self._append_autopilot_decision(ts, d, price=fill_px)

    def _append_autopilot_decision(self, ts: datetime, d: AutopilotDecision, *, price: float) -> None:
        self._autopilot_decisions_rows.append(
            {
                "ts": ts.isoformat(),
                "action": str(d.action),
                "ticker": str(d.ticker),
                "shares": str(int(d.shares)),
                "price": "" if not math.isfinite(float(price)) else f"{float(price):.6f}",
                "reasoning": str(d.reasoning),
                "confidence": f"{float(d.confidence):.2f}",
                "risk": str(d.risk),
                "lesson": str(d.lesson),
                "extended": str(d.extended),
            }
        )
        self._autopilot_last_action_ts = ts
        self._autopilot_latest_decision = d
        self.logs_panel.append_decision(
            ts=ts.strftime("%H:%M:%S") + "Z",
            action=d.action,
            ticker=d.ticker,
            shares=int(d.shares),
            price=0.0 if not math.isfinite(float(price)) else float(price),
            reasoning=d.reasoning,
            confidence=float(d.confidence),
            risk=d.risk,
            lesson=d.lesson,
            extended=d.extended,
        )
        self._log(f"Market School lesson: {d.lesson}")

    def _refresh_autopilot_panels(self) -> None:
        last = "none"
        if isinstance(self._autopilot_last_action_ts, datetime):
            delta = datetime.utcnow() - self._autopilot_last_action_ts
            mins = int(max(0, delta.total_seconds() // 60))
            last = f"{mins}m ago"
        if self._autopilot_enabled:
            self.sim_panel.set_autopilot_banner(
                f"QUANT is managing your portfolio • Last action: {last} • View Latest Decision"
            )
        else:
            self.sim_panel.set_autopilot_banner("Auto-Pilot inactive. Manual Trading mode.")
        self.sim_panel.set_thinking_panel(
            watchlist=list(self._autopilot_watchlist[:3]),
            risk_score=str(self._autopilot_risk_score),
            outlook=str(self._autopilot_outlook),
            next_decision=next_decision_time_text(datetime.utcnow()),
        )

    def _do_rebalance(self, ts: Any) -> None:
        assert self._account is not None
        assert self._plan is not None

        # Build weights from allocation.csv.
        weights = {r.ticker: float(r.target_weight) for r in self._plan.allocation if r.ticker}
        commission = float(self.sim_panel.commission())
        slip_bps = float(self.sim_panel.slippage_bps())

        # Convert first prices to conservative BUY fill prices (ask if present else last), plus slippage.
        prices = {}
        for sym in self._symbols:
            tk = self._first_ticks.get(sym, None)
            if tk is None:
                continue
            base = best_price_for_side(tk, "BUY")
            px = apply_slippage(base, "BUY", slip_bps)
            prices[sym] = float(px)

        targets, _residual = compute_target_shares_from_weights(
            equity=float(self._account.cash),
            weights=weights,
            prices=prices,
            max_weight_per_asset=float((self._plan.metrics.get("portfolio") or {}).get("risk_budget", {}).get("max_weight_per_asset", 0.25))
            if isinstance((self._plan.metrics.get("portfolio") or {}), dict)
            else 0.25,
            commission=commission,
        )

        # Execute buys (deterministic order).
        for sym in sorted(targets.keys()):
            sh = int(targets[sym])
            if sh <= 0:
                continue
            px = float(prices.get(sym, 0.0))
            if px <= 0:
                continue
            try:
                self._account.set_time(ts if isinstance(ts, datetime) else None)
                self._account.buy(sym, sh, px, commission=commission)
                self._live_trades_rows.append(
                    {
                        "ts": ts.isoformat() if hasattr(ts, "isoformat") else str(ts),
                        "symbol": sym,
                        "side": "BUY",
                        "qty": str(int(sh)),
                        "price": f"{px:.6f}",
                        "reason": "paper_rebalance_to_plan",
                    }
                )
                self._log(f"REB: BUY {sym} {sh} @ {px:.2f}")
            except Exception as e:
                self._log(f"Rebalance BUY failed for {sym}: {e}")

    def _finalize_live_session(self) -> None:
        if self._plan is None:
            return

        out_dir = Path(self._plan.run_dir) / "live_session"
        out_dir.mkdir(parents=True, exist_ok=True)

        # Write CSVs.
        def _write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
            with path.open("w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=fieldnames)
                w.writeheader()
                for r in rows:
                    w.writerow({k: r.get(k, "") for k in fieldnames})

        _write_csv(
            out_dir / "live_prices.csv",
            self._live_prices_rows,
            fieldnames=["ts", "symbol", "last", "bid", "ask"],
        )
        _write_csv(
            out_dir / "live_equity.csv",
            self._live_equity_rows,
            fieldnames=["ts", "equity", "pnl", "drawdown"],
        )
        _write_csv(
            out_dir / "live_trades.csv",
            self._live_trades_rows,
            fieldnames=["ts", "symbol", "side", "qty", "price", "reason"],
        )
        _write_csv(
            out_dir / "autopilot_decisions.csv",
            self._autopilot_decisions_rows,
            fieldnames=["ts", "action", "ticker", "shares", "price", "reasoning", "confidence", "risk", "lesson", "extended"],
        )

        # Summary stats (simple proxies).
        start_eq = float(self._start_equity)
        end_eq = float(start_eq)
        if self._live_equity_rows:
            try:
                end_eq = float(self._live_equity_rows[-1]["equity"])
            except Exception:
                end_eq = start_eq
        total_return = (end_eq / start_eq) - 1.0 if start_eq > 0 else 0.0
        max_dd = 0.0
        for r in self._live_equity_rows:
            try:
                dd = float(r["drawdown"])
                max_dd = min(max_dd, dd)
            except Exception:
                pass

        summary = {
            "start_equity": start_eq,
            "end_equity": end_eq,
            "total_return": total_return,
            "max_drawdown": max_dd,
            "num_ticks": int(len(self._live_prices_rows)),
            "num_trades": int(len(self._live_trades_rows)),
            "autopilot_active": bool(self._autopilot_enabled),
            "autopilot_decisions": int(len(self._autopilot_decisions_rows)),
            "notes": "Paper-only valuation using last/bid/ask rules + slippage/commission.",
        }
        (out_dir / "live_summary.json").write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        # Report (no profit promises).
        lines = []
        lines.append(f"# Live Session (Paper Only): {self._plan.run_dir.name}")
        lines.append("")
        lines.append("This is a paper-only simulation for research. It does not guarantee profits and is not trading advice.")
        lines.append("")
        lines.append(f"- Plan run: `{self._plan.run_dir}`")
        lines.append(f"- Start equity: `{start_eq:.2f}`")
        lines.append(f"- End equity: `{end_eq:.2f}`")
        lines.append(f"- Total return: `{total_return:.2%}`")
        lines.append(f"- Max drawdown: `{max_dd:.2%}`")
        lines.append(f"- Auto-Pilot decisions: `{int(len(self._autopilot_decisions_rows))}`")
        lines.append("")
        lines.append("Artifacts:")
        lines.append("- `live_equity.csv`, `live_prices.csv`, `live_trades.csv`, `autopilot_decisions.csv`, `live_summary.json`, `live_report.md`")
        lines.append("")
        (out_dir / "live_report.md").write_text("\n".join(lines), encoding="utf-8")

        self._log(f"Live session artifacts written: {out_dir}")


def main() -> int:
    app = QuantCockpit()
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
