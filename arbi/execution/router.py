# execution/router.py — Connects ranked opportunities to order execution

import time
from typing import Optional

from execution.order_manager import OrderManager
from execution.scalp_filter import ScalpSignalFilter
from portfolio.positions import PositionManager
from portfolio.allocator import StrategyTracker, allocate_capital
from risk.risk_manager import RiskManager
from risk.kill_switch import KillSwitch
from storage.db import log_signal, log_event, log_scalp_trade
from utils.logger import get_logger
from config import (
    STALE_ORDER_TIMEOUT_SEC, MIN_POSITION_USD,
    SCALP_TAKE_PROFIT_PCT, SCALP_STOP_LOSS_PCT,
    SCALP_MAX_HOLD_SEC, SCALP_PREFERRED_PAIRS,
    SCALP_PROFITABILITY_GATE, MICRO_ROUND_TRIP_FEE,
    USD_FEE_RESERVE,
    FAST_SCALP_TP_PCT, FAST_SCALP_SL_PCT, FAST_SCALP_MAX_HOLD_SEC,
    FAST_SCALP_PAIRS, FAST_SCALP_MIN_SCORE, FAST_SCALP_MAX_SPREAD_PCT,
    FAST_SCALP_CAPITAL_PCT, FAST_SCALP_MAX_TRADES_PER_HOUR,
    FAST_SCALP_CONSEC_LOSS_LIMIT, FAST_SCALP_COOLDOWN_SEC,
)

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
                 positions: PositionManager, kill_switch: KillSwitch,
                 scalp_mode: bool = False, fast_scalp_mode: bool = False):
        self.adapters        = adapters
        self.risk            = risk
        self.positions       = positions
        self.kill_switch     = kill_switch
        self.order_mgr       = OrderManager(adapters)
        self.tracker         = StrategyTracker()
        self.scalp_mode      = scalp_mode
        self.fast_scalp_mode = fast_scalp_mode

        # Scalp mode state
        self.scalp_filter        = ScalpSignalFilter() if scalp_mode else None
        self._scalp_trade_count  = 0     # trades since last profitability check
        self._scalp_window_pnl   = 0.0   # net P&L in the current gate window
        self._scalp_paused       = False  # set True by profitability gate

        # Fast scalp mode state
        self._fast_trades_this_hour  = 0
        self._fast_hour_start        = time.time()
        self._fast_consec_losses     = 0
        self._fast_cooldown_until    = 0.0

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

            # Process fills that were discovered during cancel/refresh
            # (e.g., Kraken returned "EOrder:Unknown order" because the order filled)
            for fill in self.order_mgr.pop_discovered_fills():
                if fill.get("side") == "buy" and fill.get("status") == "FILLED":
                    sym = fill.get("symbol", "")
                    ex  = fill.get("exchange", "")
                    qty = fill.get("filled_qty") or fill.get("quantity") or 0
                    px  = fill.get("avg_fill_price") or fill.get("price") or 0
                    if sym and ex and qty > 0 and px > 0:
                        existing = self.positions.get(sym, ex)
                        if not existing or existing.get("quantity", 0) <= 0:
                            self.positions.record_buy(sym, ex, qty, px)
                            log.info(
                                "FILL RECOVERED: BUY %s/%s qty=%.6f @ %.4f "
                                "(order filled while stale-cancel was attempted)",
                                sym, ex, qty, px,
                            )

        # Scalp mode: update price/volume buffers, then check exits
        if self.scalp_mode:
            self.scalp_filter.update(market_cache)
            self._check_scalp_exits(market_cache)

        # Fast scalp mode: check exits, then enforce cooldown and hourly rate limit
        if self.fast_scalp_mode:
            self._check_fast_scalp_exits(market_cache)
            now_ts = time.time()
            if now_ts < self._fast_cooldown_until:
                log.info("FAST SCALP: cooldown active — %.0f min remaining",
                         (self._fast_cooldown_until - now_ts) / 60)
                return
            if now_ts - self._fast_hour_start > 3600:
                self._fast_hour_start       = now_ts
                self._fast_trades_this_hour = 0
            if self._fast_trades_this_hour >= FAST_SCALP_MAX_TRADES_PER_HOUR:
                log.info("FAST SCALP: max %d trades/hour reached", FAST_SCALP_MAX_TRADES_PER_HOUR)
                return

        # Scalp profitability gate — pause if losing after N trades
        if self.scalp_mode and self._scalp_paused:
            log.warning("SCALP MODE PAUSED — net P&L negative after %d trades. "
                        "Raise SCALP_TAKE_PROFIT_PCT or check market conditions.",
                        SCALP_PROFITABILITY_GATE)
            return

        if not ranked_opportunities:
            return

        # Scalp mode: only evaluate preferred pairs, best-ranked first
        if self.scalp_mode:
            ranked_opportunities = [
                o for o in ranked_opportunities
                if o.get("symbol") in SCALP_PREFERRED_PAIRS
            ]
            if not ranked_opportunities:
                return

        # Fast scalp mode: filter to fast scalp pairs only
        if self.fast_scalp_mode:
            ranked_opportunities = [
                o for o in ranked_opportunities
                if o.get("symbol") in FAST_SCALP_PAIRS
            ]
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

        # vol_breakout and liquidity_signal don't carry net_edge_pct.
        # Derive edge from score as proxy (score=46 → 0.46%, well above 0.05% min).
        if edge_pct == 0 and opp_type in ("liquidity_signal", "vol_breakout"):
            edge_pct = score / 100

        # Determine exchange and symbol
        exchange = opp.get("buy_exchange") or opp.get("exchange", "")
        symbol   = opp.get("symbol", "")

        if not exchange or not symbol:
            return

        # Get data timestamp for freshness check
        row     = market_cache.get(exchange, {}).get(symbol, {})
        data_ts = row.get("ticker_ts")

        # Log the signal regardless of trade decision
        log_signal(strategy, symbol, exchange, opp_type, score, opp)

        log.info("Evaluating: %s | %s | %s | score=%.1f | edge=%.4f%%",
                 opp_type, symbol, exchange, score, edge_pct)

        # Fast scalp: enforce minimum score and spread protection
        if self.fast_scalp_mode:
            if score < FAST_SCALP_MIN_SCORE:
                log.info("FAST SCALP REJECTED %s/%s — score %.0f < min %d",
                         symbol, exchange, score, FAST_SCALP_MIN_SCORE)
                return
            bid = row.get("bid") or 0
            ask = row.get("ask") or row.get("last") or 0
            if bid > 0 and ask > 0:
                spread_pct = (ask - bid) / ask
                if spread_pct > FAST_SCALP_MAX_SPREAD_PCT:
                    log.info("FAST SCALP REJECTED %s/%s — spread %.4f%% > max %.4f%%",
                             symbol, exchange, spread_pct * 100, FAST_SCALP_MAX_SPREAD_PCT * 100)
                    return

        if not self.risk.allow_trade(edge_pct=edge_pct, data_ts=data_ts):
            log.info("REJECTED %s/%s — risk check failed (see above)", symbol, exchange)
            return

        # Scalp mode: RSI / Z-score / spread / volume gate
        if self.scalp_mode:
            approved, reason = self.scalp_filter.validate(
                symbol, exchange, market_cache, score=score
            )
            if not approved:
                log.info("REJECTED %s/%s — scalp filter: %s", symbol, exchange, reason)
                return

        # Determine buy price (limit order at ask = maker fee)
        buy_price = row.get("ask") or row.get("last")
        if not buy_price:
            log.debug("No price available for %s/%s", symbol, exchange)
            return

        # Position sizing:
        # - Always leave USD_FEE_RESERVE in USD so sell orders can pay Kraken fees.
        # - Scalp mode: fixed MIN_POSITION_USD per trade, capped to spendable.
        # - Standard: percentage-based, floored at MIN_POSITION_USD.
        spendable = max(self.risk.balance - USD_FEE_RESERVE, 0)
        if self.fast_scalp_mode:
            trade_dollar = min(self.risk.balance * FAST_SCALP_CAPITAL_PCT, spendable)
        elif self.scalp_mode:
            trade_dollar = min(MIN_POSITION_USD, spendable)
        else:
            strategy_budget = allocations.get(strategy, self.risk.balance * 0.05)
            trade_dollar    = min(self.risk.position_size(), strategy_budget * 0.10)
            trade_dollar    = max(trade_dollar, MIN_POSITION_USD)
            trade_dollar    = min(trade_dollar, spendable)

        quantity = trade_dollar / buy_price
        if quantity <= 0:
            return

        # Pre-trade: already in position?
        existing = self.positions.get(symbol, exchange)
        if existing and existing["quantity"] > 0:
            log.debug("Already in position for %s/%s — skipping", symbol, exchange)
            return

        log.info("Executing: %s | %s | %s | qty=%.6f | price=%.4f | edge=%.4f%%",
                 strategy, opp_type, symbol, quantity, buy_price, edge_pct)

        # Submit limit buy (maker fee = 0.16%)
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
            if self.fast_scalp_mode:
                self._fast_trades_this_hour += 1

            if order.get("status") == "FILLED":
                fill_price = order.get("avg_fill_price") or buy_price
                self.positions.record_buy(symbol, exchange, quantity, fill_price)
                log_event("TRADE_OPENED", "router",
                          {"strategy": strategy, "symbol": symbol,
                           "exchange": exchange, "qty": quantity, "price": fill_price})

    # ─── Scalp exit manager ───────────────────────────────────────────────────

    def _check_scalp_exits(self, snap: dict) -> None:
        """
        Called every loop tick in scalp mode.
        Exits positions that hit TP (+0.8%), SL (-0.4%), or 10-minute time limit.

        Uses limit sell at current bid price to qualify for maker fee (0.16%).
        Skips positions that already have a pending sell order.

        Fee math (limit both ways): 0.16% × 2 = 0.32% round trip.
        Net per winning trade at 0.8% TP: +0.48%. Break-even win rate at 2:1 RR: 33%.
        """
        now = time.time()

        for pos in self.positions.open_positions():
            symbol   = pos["symbol"]
            exchange = pos["exchange"]
            entry    = pos.get("avg_entry") or 0
            entry_ts = pos.get("entry_ts")

            if entry <= 0:
                continue

            # Skip if a sell order is already pending for this position
            pending_sell = any(
                o.get("symbol") == symbol and o.get("side") == "sell"
                for o in self.order_mgr.get_open()
            )
            if pending_sell:
                continue

            # Current bid = best limit sell price (maker fee)
            row           = snap.get(exchange, {}).get(symbol, {})
            current_price = row.get("bid") or row.get("last")
            if not current_price:
                continue

            price_chg = (current_price - entry) / entry
            hold_sec  = (now - entry_ts) if entry_ts else 0

            log.info(
                "MONITORING: %s/%s | entry=%.4f | current=%.4f | pnl=%.3f%% | "
                "hold=%.0fs | entry_ts=%s",
                symbol, exchange, entry, current_price, price_chg * 100, hold_sec,
                "set" if entry_ts else "NONE (time-exit disabled!)",
            )

            reason = None
            if price_chg >= SCALP_TAKE_PROFIT_PCT:
                reason = f"take_profit({price_chg:.4%})"
            elif price_chg <= -SCALP_STOP_LOSS_PCT:
                reason = f"stop_loss({price_chg:.4%})"
            elif entry_ts and hold_sec >= SCALP_MAX_HOLD_SEC:
                reason = f"time_exit({hold_sec:.0f}s)"

            if reason:
                self._log_scalp_exit(
                    symbol, exchange, entry, current_price,
                    pos["quantity"], hold_sec, reason,
                )
                self.close_position(symbol, exchange, reason,
                                    limit_price=current_price)

    def _log_scalp_exit(self, symbol: str, exchange: str,
                        entry: float, exit_price: float,
                        quantity: float, hold_sec: float, reason: str) -> None:
        """Log scalp trade to DB and update profitability gate counters."""
        gross_pnl = (exit_price - entry) * quantity
        fee_cost  = entry * quantity * MICRO_ROUND_TRIP_FEE
        net_pnl   = gross_pnl - fee_cost

        log_scalp_trade(
            symbol      = symbol,
            exchange    = exchange,
            entry_price = entry,
            exit_price  = exit_price,
            quantity    = quantity,
            hold_sec    = hold_sec,
            fee_pct     = MICRO_ROUND_TRIP_FEE,
            exit_reason = reason,
        )

        log.info(
            "Scalp exit: %s/%s | %s | entry=%.4f exit=%.4f | "
            "gross=$%.4f fee=$%.4f net=$%.4f | hold=%.0fs",
            symbol, exchange, reason, entry, exit_price,
            gross_pnl, fee_cost, net_pnl, hold_sec,
        )

        # Update profitability gate
        self._scalp_trade_count += 1
        self._scalp_window_pnl  += net_pnl

        if self._scalp_trade_count >= SCALP_PROFITABILITY_GATE:
            if self._scalp_window_pnl < 0:
                log.warning(
                    "SCALP PROFITABILITY GATE: net=$%.4f after %d trades — pausing.",
                    self._scalp_window_pnl, self._scalp_trade_count,
                )
                self._scalp_paused = True
            else:
                log.info(
                    "Scalp gate passed: net=$%.4f after %d trades — continuing.",
                    self._scalp_window_pnl, self._scalp_trade_count,
                )
            # Reset window for next gate period
            self._scalp_trade_count = 0
            self._scalp_window_pnl  = 0.0

    def resume_scalp(self) -> None:
        """Manually clear the profitability gate pause (operator action)."""
        self._scalp_paused      = False
        self._scalp_trade_count = 0
        self._scalp_window_pnl  = 0.0
        log.info("Scalp mode resumed manually.")

    # ─── Fast scalp exit manager ──────────────────────────────────────────────

    def _check_fast_scalp_exits(self, snap: dict) -> None:
        """
        Called every loop tick in fast scalp mode.
        Exits positions that hit TP (+0.6%), SL (-0.25%), or 3-minute time limit.
        Tracks consecutive losses and triggers 30-minute cooldown after 3 in a row.
        """
        now = time.time()

        for pos in self.positions.open_positions():
            symbol   = pos["symbol"]
            exchange = pos["exchange"]
            if symbol not in FAST_SCALP_PAIRS:
                continue

            entry    = pos.get("avg_entry") or 0
            entry_ts = pos.get("entry_ts")
            if entry <= 0:
                continue

            pending_sell = any(
                o.get("symbol") == symbol and o.get("side") == "sell"
                for o in self.order_mgr.get_open()
            )
            if pending_sell:
                continue

            row           = snap.get(exchange, {}).get(symbol, {})
            current_price = row.get("bid") or row.get("last")
            if not current_price:
                continue

            price_chg = (current_price - entry) / entry
            hold_sec  = (now - entry_ts) if entry_ts else 0

            log.info(
                "MONITORING[FAST]: %s/%s | entry=%.4f | current=%.4f | pnl=%.3f%% | hold=%.0fs",
                symbol, exchange, entry, current_price, price_chg * 100, hold_sec,
            )

            reason = None
            if price_chg >= FAST_SCALP_TP_PCT:
                reason = f"take_profit({price_chg:.4%})"
            elif price_chg <= -FAST_SCALP_SL_PCT:
                reason = f"stop_loss({price_chg:.4%})"
            elif entry_ts and hold_sec >= FAST_SCALP_MAX_HOLD_SEC:
                reason = f"time_exit({hold_sec:.0f}s)"

            if reason:
                # Track consecutive losses for cooldown
                if price_chg < 0:
                    self._fast_consec_losses += 1
                    if self._fast_consec_losses >= FAST_SCALP_CONSEC_LOSS_LIMIT:
                        self._fast_cooldown_until = now + FAST_SCALP_COOLDOWN_SEC
                        log.warning(
                            "FAST SCALP: %d consecutive losses — pausing %.0f min",
                            self._fast_consec_losses, FAST_SCALP_COOLDOWN_SEC / 60,
                        )
                        self._fast_consec_losses = 0
                else:
                    self._fast_consec_losses = 0

                self._log_scalp_exit(
                    symbol, exchange, entry, current_price,
                    pos["quantity"], hold_sec, reason,
                )
                self.close_position_fast(symbol, exchange, reason)

    # ─── Fast scalp close ─────────────────────────────────────────────────────

    def close_position_fast(self, symbol: str, exchange: str,
                            reason: str = "fast_scalp") -> Optional[dict]:
        """
        Fast-scalp exit procedure:
          1. Cancel all open orders for this symbol
          2. Fetch live balance from exchange
          3. Read exact available asset quantity
          4. Market-sell 99.8% of available qty (avoids fee-rounding rejections)
        """
        adapter = self.adapters.get(exchange)
        if not adapter:
            return None

        # Step 1: cancel any open orders for this symbol
        for o in list(self.order_mgr.get_open()):
            if o.get("symbol") == symbol:
                self.order_mgr.cancel(o["order_id"])

        # Step 2 & 3: fetch live balance for exact available qty
        sell_qty = 0.0
        try:
            balance  = adapter.fetch_balance()
            currency = symbol.split("/")[0] if "/" in symbol else symbol
            bal      = balance.get(currency, {})
            sell_qty = (bal.get("free") or 0) * 0.998   # sell 99.8% to avoid rounding errors
        except Exception as exc:
            log.warning("close_position_fast: balance fetch failed (%s) — using position qty", exc)
            pos = self.positions.get(symbol, exchange)
            sell_qty = (pos["quantity"] * 0.998) if pos else 0.0

        if sell_qty <= 0:
            log.info("close_position_fast: zero sellable balance for %s — nothing to sell", symbol)
            return None

        pos   = self.positions.get(symbol, exchange)
        entry = pos.get("avg_entry", 0) if pos else 0

        # Step 4: market sell
        order = self.order_mgr.submit(
            exchange   = exchange,
            symbol     = symbol,
            side       = "sell",
            quantity   = sell_qty,
            strategy   = "close_fast",
            order_type = "market",
            price      = None,
        )

        if order and order.get("status") == "FILLED":
            fill_price = order.get("avg_fill_price") or entry
            pnl = self.positions.record_sell(symbol, exchange, sell_qty, fill_price)
            self.risk.record_trade_close(pnl)
            self.tracker.update(reason, pnl)
            log_event("TRADE_CLOSED", "router",
                      {"symbol": symbol, "exchange": exchange,
                       "pnl": pnl, "reason": reason, "mode": "fast_scalp"})
            log.info("Fast-scalp closed %s/%s — qty=%.6f PnL=%.4f (%s)",
                     symbol, exchange, sell_qty, pnl, reason)

        return order

    # ─── Close position helper ────────────────────────────────────────────────

    def close_position(self, symbol: str, exchange: str,
                       reason: str = "manual",
                       limit_price: Optional[float] = None) -> Optional[dict]:
        pos = self.positions.get(symbol, exchange)
        if not pos or pos["quantity"] <= 0:
            log.info("No position to close for %s/%s", symbol, exchange)
            return None

        adapter = self.adapters.get(exchange)
        if not adapter:
            return None

        # Always use market for sells — Kraken deducts the fee from the sale
        # proceeds, so no USD reserve is needed. Limit sells fail with
        # EOrder:Insufficient funds when the account holds no USD for fees.
        order = self.order_mgr.submit(
            exchange   = exchange,
            symbol     = symbol,
            side       = "sell",
            quantity   = pos["quantity"],
            strategy   = "close",
            order_type = "market",
            price      = None,
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
