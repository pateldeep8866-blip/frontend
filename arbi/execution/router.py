# execution/router.py — Connects ranked opportunities to order execution

import time
from typing import Optional

from execution.order_manager import OrderManager
from portfolio.positions import PositionManager
from portfolio.allocator import StrategyTracker, allocate_capital
from risk.risk_manager import RiskManager
from risk.kill_switch import KillSwitch
from storage.db import log_signal, log_event
from utils.logger import get_logger
from config import STALE_ORDER_TIMEOUT_SEC

log = get_logger("execution.router")

# Map scanner signal types → internal strategy names
SIGNAL_TO_STRATEGY = {
    "cross_exchange_arb": "arbitrage",
    "triangular_arb":     "arbitrage",
    "liquidity_signal":   "liquidity",
    "vol_breakout":       "breakout",
}


class ExecutionRouter:

    def __init__(self, adapters: dict, risk: RiskManager,
                 positions: PositionManager, kill_switch: KillSwitch):
        self.adapters     = adapters
        self.risk         = risk
        self.positions    = positions
        self.kill_switch  = kill_switch
        self.order_mgr    = OrderManager(adapters)
        self.tracker      = StrategyTracker()
        self._last_order_refresh = 0.0

    # ─── Main entry point ─────────────────────────────────────────────────────

    def process(self, ranked_opportunities: list, market_cache: dict) -> None:
        """
        Called every main loop tick.
        Evaluates top opportunities and executes if risk permits.
        """
        # Kill switch check
        if self.kill_switch.triggered:
            log.warning("Kill switch active — no trading")
            return

        # Periodically refresh stale orders
        now = time.time()
        if now - self._last_order_refresh > STALE_ORDER_TIMEOUT_SEC:
            self.order_mgr.refresh_open_orders(max_age_sec=STALE_ORDER_TIMEOUT_SEC)
            self._last_order_refresh = now

        if not ranked_opportunities:
            return

        # Dynamic allocation
        performance = self.tracker.avg_profit_per_trade()
        allocations = allocate_capital(self.risk.balance, performance)

        for opp in ranked_opportunities[:3]:   # evaluate top 3 only
            self._evaluate_opportunity(opp, allocations, market_cache)

    # ─── Opportunity evaluation ───────────────────────────────────────────────

    def _evaluate_opportunity(self, opp: dict, allocations: dict,
                               market_cache: dict) -> None:
        opp_type = opp.get("type", "")
        strategy = SIGNAL_TO_STRATEGY.get(opp_type, "breakout")
        score    = opp.get("score", 0)
        edge_pct = opp.get("net_edge_pct", opp.get("imbalance", 0) * 100)

        # Determine exchange and symbol
        exchange = opp.get("buy_exchange") or opp.get("exchange", "")
        symbol   = opp.get("symbol", "")

        if not exchange or not symbol:
            return

        # Get data timestamp for freshness check
        row = market_cache.get(exchange, {}).get(symbol, {})
        data_ts = row.get("ticker_ts")

        # Log the signal regardless of trade decision
        log_signal(strategy, symbol, exchange, opp_type, score, opp)

        if not self.risk.allow_trade(edge_pct=edge_pct, data_ts=data_ts):
            return

        # Determine buy price
        buy_price = row.get("ask") or row.get("last")
        if not buy_price:
            log.debug("No price available for %s/%s", symbol, exchange)
            return

        # Position size from risk budget and strategy allocation
        strategy_budget = allocations.get(strategy, self.risk.balance * 0.05)
        trade_dollar    = min(self.risk.position_size(), strategy_budget * 0.10)
        quantity        = trade_dollar / buy_price

        if quantity <= 0:
            return

        log.info("Executing: %s | %s | %s | qty=%.6f | price=%.4f | edge=%.4f%%",
                 strategy, opp_type, symbol, quantity, buy_price, edge_pct)

        # Pre-trade check: do we already have a position?
        existing = self.positions.get(symbol, exchange)
        if existing and existing["quantity"] > 0:
            log.debug("Already in position for %s/%s — skipping", symbol, exchange)
            return

        # Submit order
        order = self.order_mgr.submit(
            exchange   = exchange,
            symbol     = symbol,
            side       = "buy",
            quantity   = quantity,
            strategy   = strategy,
            order_type = "limit",
            price      = buy_price,
        )

        if order and order.get("status") in ("ACKED", "FILLED"):
            self.risk.record_trade_open()

            if order.get("status") == "FILLED":
                fill_price = order.get("avg_fill_price") or buy_price
                self.positions.record_buy(symbol, exchange, quantity, fill_price)
                log_event("TRADE_OPENED", "router",
                          {"strategy": strategy, "symbol": symbol,
                           "exchange": exchange, "qty": quantity, "price": fill_price})

    # ─── Close position helper ────────────────────────────────────────────────

    def close_position(self, symbol: str, exchange: str,
                       reason: str = "manual") -> Optional[dict]:
        pos = self.positions.get(symbol, exchange)
        if not pos or pos["quantity"] <= 0:
            log.info("No position to close for %s/%s", symbol, exchange)
            return None

        adapter   = self.adapters.get(exchange)
        if not adapter:
            return None

        row       = {}  # Ideally from market cache
        sell_price = None  # Will be determined by exchange

        order = self.order_mgr.submit(
            exchange   = exchange,
            symbol     = symbol,
            side       = "sell",
            quantity   = pos["quantity"],
            strategy   = "close",
            order_type = "market",
            price      = sell_price,
        )

        if order and order.get("status") == "FILLED":
            fill_price = order.get("avg_fill_price") or pos["avg_entry"]
            pnl = self.positions.record_sell(symbol, exchange, pos["quantity"], fill_price)
            self.risk.record_trade_close(pnl)
            self.tracker.update(reason, pnl)
            log_event("TRADE_CLOSED", "router",
                      {"symbol": symbol, "exchange": exchange,
                       "pnl": pnl, "reason": reason})
            log.info("Closed %s/%s — PnL: %.4f (%s)", symbol, exchange, pnl, reason)

        return order

    # ─── Emergency close all ──────────────────────────────────────────────────

    def close_all(self, reason: str = "emergency") -> None:
        self.order_mgr.cancel_all()
        for pos in self.positions.open_positions():
            self.close_position(pos["symbol"], pos["exchange"], reason)
