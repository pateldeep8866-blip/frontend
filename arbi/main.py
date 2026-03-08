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
import time
from typing import Any, Optional

# ─── Bootstrap ───────────────────────────────────────────────────────────────
from utils.logger import get_logger
from config import (
    START_BALANCE, MAX_DAILY_LOSS_PCT, MAIN_LOOP_INTERVAL_SEC,
    RECONCILE_INTERVAL_SEC, OPTIMIZER_RUN_INTERVAL_SEC,
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

        # 3. Minimum capital check
        quote = balance.get("total", {}).get("USDT", 0) or 0
        if quote < capital * 0.5:
            return False, (
                f"Not enough USDT on the exchange. "
                f"You need at least ${capital * 0.5:.0f} but found ${quote:.0f}. "
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
            from data.ws_feed import KrakenWSFeed
            self.feed = KrakenWSFeed(self.symbols, self.on_price)
            self.feed.start()
            self.failures = 0
            self.using_ws = True
            log.info("WebSocket feed active")
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

            # Sleep remaining interval
            elapsed  = time.time() - loop_start
            sleep_for = max(0, MAIN_LOOP_INTERVAL_SEC - elapsed)
            time.sleep(sleep_for)

        self.bot.shutdown()


# ─── Auto-configured launcher ─────────────────────────────────────────────────

def auto_configure(capital: float, dry_run: bool) -> dict:
    """
    Automatically picks strategy, position sizing, and risk params
    based on capital and current market conditions.
    User never makes these decisions.
    """
    # Strategy selection by capital tier
    if capital >= 50_000:
        strategies = ["funding_arb", "mean_reversion", "cross_arb", "tri_arb", "vol_breakout"]
        tier = "Pro"
    elif capital >= 10_000:
        strategies = ["funding_arb", "mean_reversion", "cross_arb", "tri_arb"]
        tier = "Advanced"
    elif capital >= 2_000:
        strategies = ["funding_arb", "mean_reversion", "cross_arb"]
        tier = "Standard"
    else:
        strategies = ["mean_reversion", "funding_arb"]
        tier = "Starter"

    allocated      = capital * 0.80          # keep 20% in reserve
    max_per_trade  = allocated * 0.01        # 1% risk per trade
    daily_stop     = capital  * 0.02         # 2% daily loss limit
    max_drawdown   = capital  * 0.05         # 5% max drawdown before pause

    config = {
        "tier":           tier,
        "capital":        capital,
        "allocated":      allocated,
        "max_per_trade":  max_per_trade,
        "daily_stop":     daily_stop,
        "max_drawdown":   max_drawdown,
        "strategies":     strategies,
        "dry_run":        dry_run,
    }

    log.info("Auto-config: tier=%s strategies=%s allocated=$%.0f",
             tier, strategies, allocated)
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
        self.risk        = RiskManager(config["capital"])
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
        self.router = ExecutionRouter(adapters, self.risk, self.positions, self.kill_switch)

        # Health
        from monitoring.health import HealthMonitor
        self.health = HealthMonitor(adapters, self.market_cache)

        # WebSocket with auto-reconnect
        ws_prices = {}
        def on_price(symbol, price):
            ws_prices[symbol] = price

        self.ws_prices  = ws_prices
        self.ws_manager = WSManager(self.universe["symbols"], on_price)

        # Optimizer
        self._last_optimize_ts   = 0.0
        self._last_reconcile_ts  = 0.0

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
        from scanner.ranker             import rank_opportunities

        findings = []
        findings.extend(scan_spreads(snap))
        findings.extend(scan_volatility(snap))
        findings.extend(scan_liquidity(snap))
        findings.extend(scan_all_triangular(snap))
        ranked = rank_opportunities(findings)

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
    p.add_argument("--live",      action="store_true", help="Enable live trading")
    p.add_argument("--scan-only", action="store_true", help="Scanner only, no execution")
    p.add_argument("--capital",   type=float, default=float(os.getenv("BOT_CAPITAL", "5000")),
                   help="Capital to trade with in USD")
    return p.parse_args()


def main():
    args    = parse_args()
    dry_run = not args.live

    if not dry_run:
        log.warning("=" * 60)
        log.warning("  LIVE TRADING MODE — real capital at risk")
        log.warning("=" * 60)
        confirm = input("Type YES to confirm live trading: ")
        if confirm.strip() != "YES":
            log.info("Aborted.")
            sys.exit(0)

    # ── Auto-configure ────────────────────────────────────────────────────────
    config = auto_configure(args.capital, dry_run)

    # ── Build adapters ────────────────────────────────────────────────────────
    from adapters.kraken_adapter   import KrakenAdapter
    from adapters.coinbase_adapter import CoinbaseAdapter

    adapters = {
        "kraken":   KrakenAdapter(),
        "coinbase": CoinbaseAdapter(),
    }

    # ── Pre-flight validation ─────────────────────────────────────────────────
    log.info("Running pre-flight checks...")
    ok, message = preflight_check(adapters["kraken"], args.capital, dry_run)
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
