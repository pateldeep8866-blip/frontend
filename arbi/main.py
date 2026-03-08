#!/usr/bin/env python3
# main.py — Quant Trading Bot — Main Controller
#
# Usage:
#   python main.py              # run in paper trading mode (safe default)
#   python main.py --live       # run with real capital (only after thorough testing)
#   python main.py --scan-only  # scanner only, no order execution

import argparse
import signal
import sys
import time

# ─── Bootstrap ───────────────────────────────────────────────────────────────
from storage.db import init_db
from utils.logger import get_logger
from config import (
    START_BALANCE, MAX_DAILY_LOSS_PCT, MAIN_LOOP_INTERVAL_SEC,
    RECONCILE_INTERVAL_SEC, OPTIMIZER_RUN_INTERVAL_SEC, PAPER_TRADING,
)

log = get_logger("main")


def parse_args():
    parser = argparse.ArgumentParser(description="Quant Trading Bot")
    parser.add_argument("--scan-only", action="store_true",
                        help="Run scanner only, no order execution")
    parser.add_argument("--live", action="store_true",
                        help="Enable live trading (overrides PAPER_TRADING in config)")
    return parser.parse_args()


def main():
    args  = parse_args()
    paper = not args.live  # Default to paper unless --live explicitly passed

    if not paper:
        log.warning("=" * 60)
        log.warning("  LIVE TRADING MODE — real capital at risk")
        log.warning("=" * 60)
        confirm = input("Type YES to confirm live trading: ")
        if confirm.strip() != "YES":
            log.info("Aborted.")
            sys.exit(0)
    else:
        log.info("Running in PAPER TRADING mode (safe)")

    # ─── Init DB ──────────────────────────────────────────────────────────────
    init_db()

    # ─── Build adapters ───────────────────────────────────────────────────────
    from adapters.kraken_adapter   import KrakenAdapter
    from adapters.coinbase_adapter import CoinbaseAdapter

    adapters = {
        "kraken":   KrakenAdapter(),
        "coinbase": CoinbaseAdapter(),
    }
    log.info("Adapters initialized: %s", list(adapters.keys()))

    # ─── Build scanner ────────────────────────────────────────────────────────
    from scanner.universe       import build_universe
    from scanner.cache          import build_exchange_clients, MarketCache
    from scanner.spread_scanner       import scan_spreads
    from scanner.volatility_scanner   import scan_volatility
    from scanner.liquidity_scanner    import scan_liquidity
    from scanner.triangular_scanner   import scan_all_triangular
    from scanner.ranker               import rank_opportunities

    universe      = build_universe()
    raw_clients   = build_exchange_clients(universe["exchanges"])
    market_cache  = MarketCache(raw_clients, universe["symbols"])
    log.info("Market cache ready for %d symbols", len(universe["symbols"]))

    # ─── Build risk layer ─────────────────────────────────────────────────────
    from risk.risk_manager import RiskManager
    from risk.kill_switch  import KillSwitch

    risk         = RiskManager(START_BALANCE)
    kill_switch  = KillSwitch()

    # ─── Build portfolio layer ────────────────────────────────────────────────
    from portfolio.positions import PositionManager
    positions = PositionManager()

    # ─── Build execution layer ────────────────────────────────────────────────
    from execution.router import ExecutionRouter
    router = ExecutionRouter(adapters, risk, positions, kill_switch)

    # ─── Build monitoring ─────────────────────────────────────────────────────
    from monitoring.health import HealthMonitor
    health = HealthMonitor(adapters, market_cache)

    # ─── Optional: WebSocket feed ─────────────────────────────────────────────
    try:
        from data.ws_feed import KrakenWSFeed

        def on_ws_price(symbol, price):
            log.debug("WS price update: %s = %.4f", symbol, price)

        ws_feed = KrakenWSFeed(universe["symbols"], on_ws_price)
        ws_feed.start()
        log.info("WebSocket feed started")
    except Exception as exc:
        log.warning("WS feed not started: %s", exc)

    # ─── Optimizer ────────────────────────────────────────────────────────────
    from optimizer.strategy_optimizer import optimize, apply_config
    last_optimize_ts = 0.0
    last_reconcile_ts = 0.0

    # ─── Graceful shutdown ────────────────────────────────────────────────────
    running = True

    def shutdown(sig, frame):
        nonlocal running
        log.info("Shutdown signal received — stopping cleanly")
        running = False

    signal.signal(signal.SIGINT,  shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # ─── Main loop ────────────────────────────────────────────────────────────
    log.info("Bot started. Loop interval: %ds", MAIN_LOOP_INTERVAL_SEC)

    while running:
        loop_start = time.time()

        try:
            # 1. Refresh market data
            market_cache.refresh_tickers()
            market_cache.refresh_orderbooks()
            snap = market_cache.snapshot()

            # 2. Run all scanners
            findings = []
            findings.extend(scan_spreads(snap))
            findings.extend(scan_volatility(snap))
            findings.extend(scan_liquidity(snap))
            findings.extend(scan_all_triangular(snap))

            # 3. Rank opportunities
            ranked = rank_opportunities(findings)

            # 4. Print top opportunities
            if ranked:
                log.info("=== TOP OPPORTUNITIES ===")
                for i, opp in enumerate(ranked[:5], 1):
                    log.info("[%d] %s", i, opp)

            # 5. Kill switch checks
            kill_checks = {
                "DATA_STALE":      not health.check_data_freshness(),
                "DB_UNAVAILABLE":  not health.check_db_writable(),
            }
            if kill_switch.check(kill_checks):
                log.critical("Kill switch active — canceling all orders")
                router.close_all("kill_switch")
                break

            # 6. Execute (skip in scan-only mode)
            if not args.scan_only and not kill_switch.triggered:
                router.process(ranked, snap)

            # 7. Periodic reconciliation
            now = time.time()
            if now - last_reconcile_ts > RECONCILE_INTERVAL_SEC:
                discrepancies = health.reconcile_orders(router.order_mgr)
                if discrepancies > 0:
                    log.warning("%d order discrepancies found", discrepancies)
                last_reconcile_ts = now

            # 8. Periodic optimization
            if now - last_optimize_ts > OPTIMIZER_RUN_INTERVAL_SEC:
                log.info("Running strategy optimizer...")
                import sqlite3, json
                conn = sqlite3.connect("quant_bot.db")
                rows = conn.execute(
                    "SELECT signal_type, score, details FROM strategy_signals ORDER BY ts DESC LIMIT 1000"
                ).fetchall()
                conn.close()
                signal_log = [{"signal_type": r[0], "score": r[1],
                               "details": json.loads(r[2] or "{}")} for r in rows]
                best_config = optimize(signal_log)
                if best_config:
                    apply_config(best_config)
                last_optimize_ts = now

            # 9. Status line
            rs = risk.status()
            log.info(
                "Balance: $%.2f | DailyPnL: $%.2f | Drawdown: %.2f%% | OpenTrades: %d | Halted: %s",
                rs["balance"], rs["daily_pnl"], rs["drawdown_pct"],
                rs["open_trades"], rs["halted"],
            )

        except Exception as exc:
            log.error("Main loop error: %s", exc, exc_info=True)

        # Sleep remaining interval
        elapsed = time.time() - loop_start
        sleep_time = max(0, MAIN_LOOP_INTERVAL_SEC - elapsed)
        time.sleep(sleep_time)

    # ─── Shutdown cleanup ─────────────────────────────────────────────────────
    log.info("Bot stopped. Final status: %s", risk.status())
    final_report = health.full_report(risk, positions)
    log.info("Final report: %s", final_report)


if __name__ == "__main__":
    main()
