#!/usr/bin/env python3
"""
ARBI — Arthastra Arbitrage Bot
One-push-go. The bot decides everything. The user just sets capital.

Usage:
    python main.py              # paper trading (safe default)
    python main.py --live       # live trading (requires validated API keys)
    python main.py --scan-only  # scanner only, no execution
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sqlite3
import sys
import tempfile
import time
from typing import Any, Optional

# ─── Bootstrap ───────────────────────────────────────────────────────────────
from utils.logger import get_logger
from config import (
    START_BALANCE, MAX_DAILY_LOSS_PCT, MAIN_LOOP_INTERVAL_SEC,
    RECONCILE_INTERVAL_SEC, OPTIMIZER_RUN_INTERVAL_SEC,
    MIN_POSITION_USD, SMALL_ACCOUNT_THRESHOLD,
    SCALP_MODE_ENABLED, SCALP_SCAN_INTERVAL_SEC,
    SCALP_TAKE_PROFIT_PCT, SCALP_STOP_LOSS_PCT, SCALP_MAX_HOLD_SEC,
    MICRO_ROUND_TRIP_FEE,
    FAST_SCALP_TP_PCT, FAST_SCALP_SL_PCT, FAST_SCALP_MAX_HOLD_SEC,
    FAST_SCALP_SCAN_INTERVAL_SEC, FAST_SCALP_PAIRS,
    EXCHANGE, ACTIVE_MAKER_FEE, ACTIVE_TAKER_FEE, PAPER_TRADING,
)

log = get_logger("main")

# ─── Constants ────────────────────────────────────────────────────────────────
WS_RECONNECT_DELAY    = 5      # seconds before WS reconnect attempt
MAX_WS_FAILURES       = 10     # switch to REST fallback after this many failures
SELF_HEAL_INTERVAL    = 30     # seconds between self-heal checks
MAX_LOOP_ERRORS       = 5      # errors before entering safe mode
PREFLIGHT_TIMEOUT     = 15     # seconds to validate exchange connection


# ─── Pre-flight validator ─────────────────────────────────────────────────────

def preflight_check(adapter, capital: float, dry_run: bool) -> tuple[bool, str]:
    """
    Validates everything before allowing the bot to start.
    Returns (ok, human_readable_message).
    Never shows stack traces to the user.
    """
    try:
        # 1. Exchange connectivity
        ticker = adapter.fetch_ticker("BTC/USDT")
        if not ticker or not ticker.get("last"):
            return False, "Cannot reach exchange — check your internet connection and try again."
    except Exception:
        return False, "Cannot connect to the exchange. Check your API key and internet connection."

    if not dry_run:
        try:
            # 2. API key permissions
            balance = adapter.fetch_balance()
        except Exception as e:
            msg = str(e).lower()
            if "permission" in msg or "auth" in msg or "invalid" in msg:
                return False, (
                    "Your API key doesn't have trading permissions enabled. "
                    "Go to your exchange settings → API → enable 'Trade' permission."
                )
            return False, f"Could not read your balance. Make sure your API key is correct."

        # 3. Minimum capital check — must have at least 80% of declared capital on exchange.
        # For small accounts, also ensure at least one trade's worth is available.
        # kraken_adapter returns {currency: {free, used, total}} structure.
        quote = (
            (balance.get("USD",  {}).get("total", 0) or 0) +
            (balance.get("USDT", {}).get("total", 0) or 0)
        )
        min_required = max(capital * 0.80, MIN_POSITION_USD)
        if quote < min_required:
            return False, (
                f"Not enough USD/USDT on the exchange. "
                f"You need at least ${min_required:.0f} but found ${quote:.0f}. "
                f"Deposit funds or lower your capital setting."
            )

    return True, "All checks passed."


# ─── WebSocket manager with auto-reconnect ────────────────────────────────────

class WSManager:
    """
    Wraps the WebSocket feed with automatic reconnection and REST fallback.
    The main loop never needs to worry about WS state.
    """
    def __init__(self, symbols: list[str], on_price):
        self.symbols    = symbols
        self.on_price   = on_price
        self.feed       = None
        self.failures   = 0
        self.using_ws   = True
        self._start()

    def _start(self):
        try:
            from data.ws_feed import get_ws_feed
            self.feed = get_ws_feed(self.symbols, self.on_price)
            self.feed.start()
            self.failures = 0
            self.using_ws = True
            log.info("WebSocket feed active (%s)", EXCHANGE)
        except Exception as exc:
            self.failures += 1
            log.warning("WS start failed (%d): %s", self.failures, exc)
            if self.failures >= MAX_WS_FAILURES:
                self.using_ws = False
                log.warning("Switching to REST-only mode after %d WS failures", self.failures)

    def ensure_alive(self):
        """Call each loop. Reconnects silently if feed dropped."""
        if not self.using_ws:
            return
        try:
            alive = self.feed and getattr(self.feed, "is_alive", lambda: True)()
            if not alive:
                log.warning("WS feed dropped — reconnecting...")
                time.sleep(WS_RECONNECT_DELAY)
                self._start()
        except Exception as exc:
            log.warning("WS health check failed: %s", exc)
            self._start()

    def stop(self):
        try:
            if self.feed:
                self.feed.stop()
        except Exception:
            pass


# ─── Self-healing loop ────────────────────────────────────────────────────────

class SelfHealingLoop:
    """
    Wraps the main bot loop with:
    - automatic error recovery
    - safe mode entry on repeated failures
    - silent self-healing (user never sees transient errors)
    - clean shutdown on SIGINT/SIGTERM
    """
    def __init__(self, bot):
        self.bot            = bot
        self.running        = True
        self.error_count    = 0
        self.last_heal_ts   = 0.0
        self.last_good_ts   = time.time()

        signal.signal(signal.SIGINT,  self._shutdown)
        signal.signal(signal.SIGTERM, self._shutdown)

    def _shutdown(self, sig, frame):
        log.info("Shutdown signal received — stopping cleanly")
        self.running = False

    def _try_heal(self):
        """
        Attempts to recover from errors silently.
        Only enters safe mode if truly unrecoverable.
        """
        now = time.time()
        if now - self.last_heal_ts < SELF_HEAL_INTERVAL:
            return

        self.last_heal_ts = now
        log.info("Self-heal check: error_count=%d", self.error_count)

        try:
            # Re-init market cache
            self.bot.market_cache.refresh_tickers()
            self.error_count = 0
            self.last_good_ts = time.time()
            log.info("Self-heal succeeded")
        except Exception as exc:
            log.warning("Self-heal failed: %s", exc)
            if self.error_count >= MAX_LOOP_ERRORS:
                log.critical("Too many errors — entering safe mode")
                self.bot.kill_switch.trigger("repeated_errors")

    def run(self):
        log.info("Bot started. Mode: %s", "PAPER" if self.bot.dry_run else "LIVE")

        while self.running:
            loop_start = time.time()

            try:
                # Keep WS alive
                self.bot.ws_manager.ensure_alive()

                # Run one loop iteration
                self.bot.loop_once()

                # Reset error count on success
                self.error_count = 0
                self.last_good_ts = time.time()

            except Exception as exc:
                self.error_count += 1
                log.error("Loop error #%d: %s", self.error_count, exc)
                self._try_heal()

            # Sleep remaining interval (30s in scalp mode, 5s otherwise)
            elapsed       = time.time() - loop_start
            loop_interval = getattr(self.bot, "loop_interval_sec", MAIN_LOOP_INTERVAL_SEC)
            sleep_for     = max(0, loop_interval - elapsed)
            time.sleep(sleep_for)

        self.bot.shutdown()


# ─── Auto-configured launcher ─────────────────────────────────────────────────

def auto_configure(capital: float, dry_run: bool, fast_scalp: bool = False) -> dict:
    """
    Automatically picks strategy, position sizing, and risk params
    based on capital and current market conditions.
    User never makes these decisions.
    """
    if fast_scalp:
        pairs_str = ", ".join(FAST_SCALP_PAIRS)
        log.warning(
            "FAST SCALP MODE | TP=%.1f%% | SL=%.2f%% | max_hold=%ds | scan=%ds | pairs=%s",
            FAST_SCALP_TP_PCT * 100, FAST_SCALP_SL_PCT * 100,
            FAST_SCALP_MAX_HOLD_SEC, FAST_SCALP_SCAN_INTERVAL_SEC, pairs_str,
        )
        return {
            "tier":               "FastScalp",
            "capital":            capital,
            "allocated":          capital * 0.80,
            "max_per_trade":      capital * 0.25,
            "daily_stop":         max(capital * 0.02, MIN_POSITION_USD * 0.10),
            "max_drawdown":       capital * 0.05,
            "strategies":         ["vol_breakout", "liquidity_signal", "mean_reversion"],
            "max_trades":         1,
            "dry_run":            dry_run,
            "scalp_mode":         False,
            "fast_scalp_mode":    True,
            "loop_interval_sec":  FAST_SCALP_SCAN_INTERVAL_SEC,
        }

    # Strategy selection by capital tier
    if capital >= 50_000:
        strategies  = ["funding_arb", "mean_reversion", "cross_arb", "tri_arb", "vol_breakout"]
        tier        = "Pro"
        max_trades  = 3
    elif capital >= 10_000:
        strategies  = ["funding_arb", "mean_reversion", "cross_arb", "tri_arb"]
        tier        = "Advanced"
        max_trades  = 3
    elif capital >= 2_000:
        strategies  = ["funding_arb", "mean_reversion", "cross_arb"]
        tier        = "Standard"
        max_trades  = 3
    elif capital >= SMALL_ACCOUNT_THRESHOLD:
        strategies  = ["mean_reversion", "funding_arb"]
        tier        = "Starter"
        max_trades  = 2
    else:
        # Micro tier: fixed $5 floor per trade, single position at a time.
        # All tracked pairs (BTC, ETH, XRP, ADA, SOL, DOT, DOGE) have ~$1 notional
        # minimums on Kraken, so all pass quality checks with a $5 trade size.
        strategies  = ["mean_reversion", "liquidity_signal", "vol_breakout"]
        tier        = "Micro"
        max_trades  = 1

    is_micro  = capital < SMALL_ACCOUNT_THRESHOLD
    use_scalp = is_micro and SCALP_MODE_ENABLED

    allocated     = capital * 0.80                                    # keep 20% in reserve
    # For micro accounts, min viable trade is MIN_POSITION_USD; percentage math gives cents.
    max_per_trade = max(allocated * 0.01, MIN_POSITION_USD) if is_micro else allocated * 0.01
    daily_stop    = max(capital * 0.02, MIN_POSITION_USD * 0.10)      # 2% or at least $0.50
    max_drawdown  = capital * 0.05                                    # 5% max drawdown before pause

    if use_scalp:
        log.warning(
            "SCALP MODE: TP=%.1f%% SL=%.1f%% max_hold=%ds scan=%ds | "
            "Limit-order round-trip fee=%.2f%% — need >%.2f%% gross per trade to profit",
            SCALP_TAKE_PROFIT_PCT * 100, SCALP_STOP_LOSS_PCT * 100,
            SCALP_MAX_HOLD_SEC, SCALP_SCAN_INTERVAL_SEC,
            MICRO_ROUND_TRIP_FEE * 100, MICRO_ROUND_TRIP_FEE * 100,
        )

    config = {
        "tier":               tier,
        "capital":            capital,
        "allocated":          allocated,
        "max_per_trade":      max_per_trade,
        "daily_stop":         daily_stop,
        "max_drawdown":       max_drawdown,
        "strategies":         strategies,
        "max_trades":         max_trades,
        "dry_run":            dry_run,
        "scalp_mode":         use_scalp,
        "loop_interval_sec":  SCALP_SCAN_INTERVAL_SEC if use_scalp else MAIN_LOOP_INTERVAL_SEC,
    }

    log.info("Auto-config: tier=%s strategies=%s allocated=$%.0f max_trades=%d scalp=%s",
             tier, strategies, allocated, max_trades, use_scalp)
    return config


# ─── Main Bot ─────────────────────────────────────────────────────────────────

class ARBIBot:
    def __init__(self, config: dict, adapters: dict, args):
        self.config      = config
        self.adapters    = adapters
        self.dry_run     = config["dry_run"]
        self.args        = args

        # DB
        from storage.db import init_db
        init_db()

        # Risk + kill switch
        from risk.risk_manager import RiskManager
        from risk.kill_switch  import KillSwitch
        self.risk        = RiskManager(config["capital"], max_open_trades=config.get("max_trades", 3))
        self.kill_switch = KillSwitch()

        # Portfolio
        from portfolio.positions import PositionManager
        self.positions = PositionManager()

        # Scanner
        from scanner.universe import build_universe
        from scanner.cache    import build_exchange_clients, MarketCache
        self.universe     = build_universe()
        raw_clients       = build_exchange_clients(self.universe["exchanges"])
        self.market_cache = MarketCache(raw_clients, self.universe["symbols"])

        # Execution
        from execution.router import ExecutionRouter
        self.router = ExecutionRouter(
            adapters, self.risk, self.positions, self.kill_switch,
            scalp_mode=config.get("scalp_mode", False),
            fast_scalp_mode=config.get("fast_scalp_mode", False),
        )
        self.loop_interval_sec = config.get("loop_interval_sec", MAIN_LOOP_INTERVAL_SEC)

        # Health
        from monitoring.health import HealthMonitor
        self.health = HealthMonitor(adapters, self.market_cache)

        # WebSocket with auto-reconnect
        ws_prices = {}
        def on_price(symbol, price):
            ws_prices[symbol] = price

        self.ws_prices  = ws_prices
        self.ws_manager = WSManager(self.universe["symbols"], on_price)

        # Optimizer / summary timers
        self._last_optimize_ts   = 0.0
        self._last_reconcile_ts  = 0.0
        self._last_summary_ts    = 0.0   # scalp daily summary (hourly)

        # Reconcile exchange state against local DB on startup
        self._reconcile_startup()

    def loop_once(self):
        # 1. Refresh market data (WS prices override REST where available)
        self.market_cache.refresh_tickers()
        if not self.args.scan_only:
            self.market_cache.refresh_orderbooks()
        snap = self.market_cache.snapshot()

        # Inject WS prices into snapshot where we have them
        for symbol, price in self.ws_prices.items():
            if symbol in snap:
                snap[symbol]["ws_price"] = price

        # 2. Scanners
        from scanner.spread_scanner     import scan_spreads
        from scanner.volatility_scanner import scan_volatility
        from scanner.liquidity_scanner  import scan_liquidity
        from scanner.triangular_scanner import scan_all_triangular
        from scanner.orderflow_scanner  import scan_orderflow
        from scanner.ranker             import rank_opportunities

        findings = []
        findings.extend(scan_spreads(snap))
        findings.extend(scan_volatility(snap))
        findings.extend(scan_liquidity(snap))
        findings.extend(scan_all_triangular(snap))
        orderflow_data = scan_orderflow(snap)
        ranked = rank_opportunities(findings, orderflow_data=orderflow_data)

        if ranked:
            log.info("=== TOP OPPORTUNITIES ===")
            for i, opp in enumerate(ranked[:5], 1):
                log.info("[%d] %s", i, opp)

        # 3. Kill switch checks
        kill_checks = {
            "DATA_STALE":     not self.health.check_data_freshness(),
            "DB_UNAVAILABLE": not self.health.check_db_writable(),
        }
        if self.kill_switch.check(kill_checks):
            log.critical("Kill switch active — closing all orders")
            self.router.close_all("kill_switch")
            return

        # 4. Execute
        if not self.args.scan_only and not self.kill_switch.triggered:
            self.router.process(ranked, snap)

        # 5. Periodic reconciliation — verify local state against exchange
        now = time.time()
        if now - self._last_reconcile_ts > RECONCILE_INTERVAL_SEC:
            discrepancies = self.health.reconcile_orders(self.router.order_mgr)
            if discrepancies > 0:
                log.warning("%d order discrepancies — reconciling", discrepancies)
            self._last_reconcile_ts = now

        # 6. Periodic optimization
        if now - self._last_optimize_ts > OPTIMIZER_RUN_INTERVAL_SEC:
            self._run_optimizer()
            self._last_optimize_ts = now

        # 7. Status line
        rs = self.risk.status()
        log.info(
            "Balance: $%.2f | DailyPnL: $%.2f | Drawdown: %.2f%% | OpenTrades: %d | Halted: %s",
            rs["balance"], rs["daily_pnl"], rs["drawdown_pct"],
            rs["open_trades"], rs["halted"],
        )

        # 8. Scalp daily summary — logged once per hour
        if self.config.get("scalp_mode") and now - self._last_summary_ts > 3_600:
            from storage.db import scalp_daily_summary
            s = scalp_daily_summary()
            log.info(
                "=== SCALP DAILY SUMMARY (24h) === "
                "Trades: %d | Wins: %d | Losses: %d | WinRate: %.1f%% | "
                "Gross: $%.4f | Fees: $%.4f | Net: $%.4f | AvgHold: %.0fs",
                s["trades"], s["wins"], s["losses"], s["win_rate_pct"],
                s["gross_pnl"], s["total_fees"], s["net_pnl"], s["avg_hold_sec"],
            )
            self._last_summary_ts = now

        # 9. Write live status for dashboard
        self._write_live_status(now)

    def _write_live_status(self, now: float) -> None:
        """Write bot state to /tmp/arbi_live_state.json for the dashboard."""
        try:
            rs = self.risk.status()
            recent_trades = []
            try:
                import datetime as _dt
                conn = sqlite3.connect("quant_bot.db")
                conn.row_factory = sqlite3.Row
                rows = conn.execute(
                    "SELECT ts, symbol, exchange, entry_price, exit_price,"
                    " quantity, net_pnl, exit_reason"
                    " FROM scalp_trades ORDER BY ts DESC LIMIT 20"
                ).fetchall()
                conn.close()
                for r in rows:
                    recent_trades.append({
                        "pair":     r["symbol"],
                        "exchange": r["exchange"],
                        "entry":    round(float(r["entry_price"]), 6),
                        "exit":     round(float(r["exit_price"]), 6),
                        "qty":      round(float(r["quantity"]), 6),
                        "pnl":      round(float(r["net_pnl"]), 4),
                        "reason":   r["exit_reason"],
                        "time":     _dt.datetime.fromtimestamp(r["ts"]).strftime("%H:%M:%S"),
                    })
            except Exception:
                pass

            rejections = []
            try:
                import datetime as _dt2
                conn2 = sqlite3.connect("quant_bot.db")
                conn2.row_factory = sqlite3.Row
                rej_rows = conn2.execute(
                    "SELECT ts, details FROM events"
                    " WHERE event_type LIKE '%REJECT%' OR details LIKE '%REJECTED%'"
                    " ORDER BY ts DESC LIMIT 10"
                ).fetchall()
                conn2.close()
                for r in rej_rows:
                    try:
                        d = json.loads(r["details"] or "{}")
                    except Exception:
                        d = {}
                    rejections.append({
                        "time":   _dt2.datetime.fromtimestamp(r["ts"]).strftime("%H:%M:%S"),
                        "reason": d.get("error") or d.get("reason") or str(r["details"])[:80],
                    })
            except Exception:
                pass

            state = {
                "mode":         "LIVE" if not self.dry_run else "PAPER",
                "balance":      rs["balance"],
                "daily_pnl":    rs["daily_pnl"],
                "drawdown_pct": rs["drawdown_pct"],
                "open_trades":  rs["open_trades"],
                "halted":       rs["halted"],
                "halt_reason":  rs["halt_reason"],
                "scalp_mode":   self.config.get("scalp_mode", False),
                "tier":         self.config.get("tier", ""),
                "recent_trades": recent_trades,
                "rejections":    rejections,
                "updated_at":   now,
            }
            tmp_fd, tmp_name = tempfile.mkstemp(dir="/tmp", suffix=".json")
            with os.fdopen(tmp_fd, "w") as fp:
                json.dump(state, fp)
            os.replace(tmp_name, "/tmp/arbi_live_state.json")
        except Exception as exc:
            log.debug("Failed to write live status: %s", exc)

    def _reconcile_startup(self) -> None:
        """
        On startup, compare exchange account balances against locally-tracked positions.
        If the exchange holds an asset with no matching open position, record it.
        This recovers from missed fills (e.g., order filled while bot was restarting,
        or fill incorrectly marked as CANCELED during a stale-order cleanup).
        """
        try:
            adapter = self.adapters.get(EXCHANGE)
            if not adapter or self.config.get("dry_run"):
                return

            balance = adapter.fetch_balance()
            if not balance:
                return

            QUOTE_CURRENCIES = {"USD", "USDT", "EUR", "GBP", "CAD", "CHF"}

            # Build a map of what the exchange actually holds right now
            exchange_qty: dict = {}
            for currency, bal in balance.items():
                if currency in QUOTE_CURRENCIES:
                    continue
                exchange_qty[currency] = (bal.get("free") or 0) + (bal.get("used") or 0)

            # ── Pass 1: close ghost positions (DB says open, exchange shows zero) ──
            ghost_closed = 0
            for pos in self.positions.open_positions():
                if pos.get("exchange") != EXCHANGE:
                    continue
                symbol       = pos["symbol"]
                currency     = symbol.split("/")[0] if "/" in symbol else symbol
                exchange_qty_val = exchange_qty.get(currency, 0)
                if exchange_qty_val < 0.0001 and pos["quantity"] > 0:
                    log.warning(
                        "RECONCILE_CLOSED: %s position removed — zero balance on exchange "
                        "(DB had qty=%.6f, exchange shows %.6f)",
                        symbol, pos["quantity"], exchange_qty_val,
                    )
                    pos["quantity"]       = 0.0
                    pos["unrealized_pnl"] = 0.0
                    from storage.db import upsert_position
                    upsert_position(
                        pos["symbol"], pos["exchange"], 0.0,
                        pos.get("avg_entry"), pos.get("realized_pnl", 0.0), 0.0,
                    )
                    if self.risk.open_trades > 0:
                        self.risk.open_trades -= 1
                    ghost_closed += 1

            if ghost_closed:
                log.warning("Startup reconciliation closed %d ghost position(s)", ghost_closed)

            # ── Pass 2: restore untracked positions (exchange holds asset, DB is empty) ──
            recovered = 0
            for currency, qty in exchange_qty.items():
                if qty < 0.0001:
                    continue

                symbol   = f"{currency}/USD"
                existing = self.positions.get(symbol, EXCHANGE)
                if existing and existing.get("quantity", 0) >= qty * 0.9:
                    # Already tracked — but entry_ts is never persisted to DB,
                    # so it's always None after a restart. Set it now so the
                    # scalp time-exit timer starts from this boot.
                    if existing.get("entry_ts") is None:
                        existing["entry_ts"] = time.time()
                        log.info("STARTUP RECONCILE: Set entry_ts for existing %s/%s position",
                                 symbol, EXCHANGE)
                    continue

                # Fetch current price for approximate entry
                try:
                    ticker = adapter.fetch_ticker(symbol)
                    price  = ticker.get("last") or ticker.get("bid") or 0
                except Exception:
                    price = 0

                if price > 0:
                    self.positions.record_buy(symbol, EXCHANGE, qty, price)
                    # record_buy sets entry_ts only when prev_qty==0.
                    # Force it explicitly to cover any edge cases.
                    pos_obj = self.positions.get(symbol, "kraken")
                    if pos_obj:
                        pos_obj["entry_ts"] = time.time()
                    self.risk.record_trade_open()
                    recovered += 1
                    log.warning(
                        "STARTUP RECONCILE: Untracked %s balance %.6f — "
                        "recorded as open position @ %.4f",
                        currency, qty, price,
                    )

            if recovered:
                log.warning("Startup reconciliation restored %d position(s)", recovered)
            elif not ghost_closed:
                log.info("Startup reconciliation: exchange state matches local records")

        except Exception as exc:
            log.warning("Startup reconciliation failed (non-fatal): %s", exc)

    def _run_optimizer(self):
        try:
            from optimizer.strategy_optimizer import optimize, apply_config
            conn = sqlite3.connect("quant_bot.db")
            rows = conn.execute(
                "SELECT signal_type, score, details FROM strategy_signals ORDER BY ts DESC LIMIT 1000"
            ).fetchall()
            conn.close()
            signal_log = [{"signal_type": r[0], "score": r[1],
                           "details": json.loads(r[2] or "{}")} for r in rows]
            best = optimize(signal_log)
            if best:
                apply_config(best)
        except Exception as exc:
            log.warning("Optimizer error (non-fatal): %s", exc)

    def shutdown(self):
        self.ws_manager.stop()
        rs = self.risk.status()
        log.info("Bot stopped. Final: balance=$%.2f pnl=$%.2f", rs["balance"], rs["daily_pnl"])
        report = self.health.full_report(self.risk, self.positions)
        log.info("Final report: %s", report)


# ─── Entry point ──────────────────────────────────────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="ARBI — Arthastra Arbitrage Bot")
    p.add_argument("--live",        action="store_true", help="Enable live trading")
    p.add_argument("--scan-only",   action="store_true", help="Scanner only, no execution")
    p.add_argument("--scalp-fast",  action="store_true",
                   help="Fast scalp mode: TP=0.6%% SL=0.25%% hold=180s scan=15s (SOL/USD, XRP/USD)")
    p.add_argument("--reset-state", action="store_true",
                   help="Clear ghost DB positions, verify exchange balance, then exit")
    p.add_argument("--capital",     type=float, default=float(os.getenv("BOT_CAPITAL", "5000")),
                   help="Capital to trade with in USD")
    return p.parse_args()


def reset_state() -> None:
    """
    Clear ghost positions from DB, remove incomplete scalp_trade records,
    verify exchange balance matches local state, then exit.
    Run with: python main.py --reset-state
    """
    from storage.db import init_db, get_connection

    print(f"\n=== ARBI State Reset ({EXCHANGE}) ===\n")
    init_db()
    conn = get_connection()

    # 1. Show and clear all open positions
    rows = conn.execute(
        "SELECT symbol, exchange, quantity, avg_entry FROM positions WHERE quantity != 0"
    ).fetchall()
    if rows:
        print(f"Found {len(rows)} open position(s) in DB:")
        for r in rows:
            print(f"  {r['symbol']} / {r['exchange']}: qty={r['quantity']:.6f} @ ${r['avg_entry'] or 0:.4f}")
        conn.execute(
            "UPDATE positions SET quantity = 0, unrealized_pnl = 0, updated_ts = ?",
            (time.time(),)
        )
        conn.commit()
        print(f"  -> Cleared all {len(rows)} position(s).")
    else:
        print("No open positions in DB — already clean.")

    # 2. Remove incomplete scalp_trade records (entry or exit price is 0)
    cur = conn.execute(
        "DELETE FROM scalp_trades WHERE exit_price = 0 OR entry_price = 0"
    )
    conn.commit()
    if cur.rowcount:
        print(f"\nRemoved {cur.rowcount} incomplete scalp_trade record(s).")
    else:
        print("\nNo incomplete scalp_trade records found.")

    conn.close()

    # 3. Verify exchange balance
    print(f"\nFetching {EXCHANGE} balance to verify state...")
    try:
        adapter = _build_adapter()
        balance = adapter.fetch_balance()
        QUOTE_CURRENCIES = {"USD", "USDT", "BUSD", "EUR", "GBP", "CAD", "CHF"}

        usd  = (balance.get("USD",  {}).get("total") or 0)
        usdt = (balance.get("USDT", {}).get("total") or 0)
        print(f"  USD : ${usd:.4f}")
        if usdt > 0:
            print(f"  USDT: ${usdt:.4f}")

        holdings = {
            k: (v.get("free") or 0) + (v.get("used") or 0)
            for k, v in balance.items()
            if k not in QUOTE_CURRENCIES
            and ((v.get("free") or 0) + (v.get("used") or 0)) >= 0.0001
        }
        if holdings:
            print("\n  Non-USD holdings on exchange"
                  " (startup reconciliation will re-import these on next run):")
            for currency, qty in holdings.items():
                print(f"    {currency}: {qty:.6f}")
        else:
            print("  No open non-USD holdings — clean slate confirmed.")
    except Exception as exc:
        print(f"  Could not fetch {EXCHANGE} balance: {exc}")

    print(f"\nDone. Restart the bot with:  python main.py --live --capital <amount>\n")
    sys.exit(0)


def _build_adapter():
    """Return the correct execution adapter for the configured EXCHANGE."""
    if EXCHANGE == "binance_us":
        from adapters.binance_us_adapter import BinanceUSAdapter
        return BinanceUSAdapter()
    from adapters.kraken_adapter import KrakenAdapter
    return KrakenAdapter()


def main():
    args    = parse_args()

    if args.reset_state:
        reset_state()   # exits inside

    dry_run = not args.live

    if not dry_run:
        log.warning("=" * 60)
        log.warning("  LIVE TRADING MODE — real capital at risk")
        log.warning("=" * 60)
        confirm = input("Type YES to confirm live trading: ")
        if confirm.strip() != "YES":
            log.info("Aborted.")
            sys.exit(0)

    # ── Startup banner ────────────────────────────────────────────────────────
    exchange_display = "Binance.US" if EXCHANGE == "binance_us" else EXCHANGE.capitalize()
    log.info(
        "ACTIVE EXCHANGE | %s | maker=%.4f taker=%.6f | paper_mode=%s",
        exchange_display, ACTIVE_MAKER_FEE, ACTIVE_TAKER_FEE, PAPER_TRADING,
    )

    # ── Auto-configure ────────────────────────────────────────────────────────
    config = auto_configure(args.capital, dry_run, fast_scalp=args.scalp_fast)

    # ── Build adapters ────────────────────────────────────────────────────────
    primary_adapter = _build_adapter()
    adapters = {EXCHANGE: primary_adapter}

    _cb_key = os.getenv("COINBASE_API_KEY", "")
    if _cb_key and EXCHANGE != "coinbase":
        from adapters.coinbase_adapter import CoinbaseAdapter
        adapters["coinbase"] = CoinbaseAdapter()

    # ── Pre-flight validation ─────────────────────────────────────────────────
    log.info("Running pre-flight checks...")
    ok, message = preflight_check(primary_adapter, args.capital, dry_run)
    if not ok:
        print(f"\n⚠️  {message}\n")
        sys.exit(1)
    log.info("Pre-flight: %s", message)

    # ── Start bot with self-healing loop ──────────────────────────────────────
    bot    = ARBIBot(config, adapters, args)
    healer = SelfHealingLoop(bot)
    healer.run()


if __name__ == "__main__":
    main()
