# execution/router.py — Connects ranked opportunities to order execution

import collections
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
    MIN_SCORE_THRESHOLD, MIN_EV_THRESHOLD, MAX_KELLY_PCT,
    SYMBOL_COOLDOWN_SEC, REGIME_CACHE_TTL_SEC, EV_HISTORY_WINDOW,
    ACTIVE_MAKER_FEE, ACTIVE_TAKER_FEE, EXCHANGE,
)

# ── EV priors per signal/strategy type ────────────────────────────────────────
# (base_p_win @ score=50, avg_win fraction, avg_loss fraction)
# p_win is adjusted: += (score - 50) / 200  (score 100 → +0.25 above base)
_EV_PRIORS: dict[str, tuple] = {
    "cross_exchange_arb": (0.65, 0.003, 0.002),  # near-certain when edge confirmed
    "triangular_arb":     (0.70, 0.003, 0.001),  # highest certainty
    "arbitrage":          (0.65, 0.003, 0.002),  # router strategy alias
    "liquidity_signal":   (0.55, 0.015, 0.008),  # directional book pressure
    "liquidity":          (0.55, 0.015, 0.008),
    "vol_breakout":       (0.45, 0.020, 0.010),  # momentum — lower p_win, bigger move
    "breakout":           (0.45, 0.020, 0.010),
    "mean_reversion":     (0.60, 0.008, 0.005),  # high win rate, smaller moves
    "funding_rate_arb":   (0.68, 0.010, 0.004),  # carry trade
}

# Regime → allowed opp types (user spec overrides detector defaults)
_REGIME_ALLOWED: dict[str, set] = {
    "TREND_UP":   {"vol_breakout", "breakout", "cross_exchange_arb", "triangular_arb"},
    "TREND_DOWN": {"mean_reversion"},                              # only MR long entries
    "RANGING":    {"mean_reversion", "liquidity_signal", "liquidity",
                   "funding_rate_arb", "cross_exchange_arb", "triangular_arb"},
    "HIGH_VOL":   {"cross_exchange_arb", "triangular_arb"},       # market-neutral only
    "LOW_VOL":    {"mean_reversion", "liquidity_signal", "liquidity",
                   "funding_rate_arb"},
    "RISK_OFF":   set(),                                           # nothing trades
    "UNKNOWN":    {"cross_exchange_arb", "triangular_arb",
                   "liquidity_signal", "vol_breakout", "mean_reversion"},
}

# Regime → Kelly fraction multiplier (user spec)
_REGIME_KELLY_MULT: dict[str, float] = {
    "TREND_UP":   1.00,   # full Kelly
    "TREND_DOWN": 0.50,   # half Kelly
    "RANGING":    0.75,   # 75% Kelly
    "HIGH_VOL":   0.25,   # 25% Kelly
    "LOW_VOL":    1.00,
    "RISK_OFF":   0.00,
    "UNKNOWN":    0.50,
}

# HIGH_VOL requires a higher score to trade (too noisy for normal threshold)
_HIGH_VOL_SCORE_BOOST = 15

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

        # Quant engine state
        self._regime_cache:   dict = {}   # symbol → {"regime": dict, "expires": float}
        self._symbol_cooldown: dict = {}  # symbol → cooldown_until_ts
        self._ev_history = collections.deque(maxlen=EV_HISTORY_WINDOW)  # recent EV values

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

    # ─── Regime detection (per-symbol, cached 5 min) ──────────────────────────

    def _get_regime(self, symbol: str, exchange: str) -> dict:
        """
        Return a regime dict for this symbol.  Caches for REGIME_CACHE_TTL_SEC
        seconds so we aren't fetching hourly candles on every 5s loop tick.

        Falls back to UNKNOWN if candles are unavailable.
        """
        now    = time.time()
        cached = self._regime_cache.get(symbol)
        if cached and now < cached["expires"]:
            return cached["regime"]

        regime = {"regime": "UNKNOWN", "size_mult": 0.5, "allowed": list(
            _REGIME_ALLOWED["UNKNOWN"])}
        try:
            from strategies.detector import detect_regime
            adapter = self.adapters.get(exchange) or next(iter(self.adapters.values()), None)
            if not adapter:
                return regime

            client = getattr(adapter, "_client", None)
            if client is None:
                return regime

            # Symbol mapping: binance_us needs USDT; kraken prefers USD
            fetch_sym = symbol
            if exchange == "binance_us" and symbol.endswith("/USD"):
                fetch_sym = symbol.replace("/USD", "/USDT")

            raw = client.fetch_ohlcv(fetch_sym, "1h", limit=60)
            if not raw or len(raw) < 20:
                return regime

            candles = [
                {"open": c[1], "high": c[2], "low": c[3], "close": c[4], "volume": c[5]}
                for c in raw
            ]
            regime = detect_regime(candles)

        except Exception as exc:
            log.debug("_get_regime %s: %s", symbol, exc)

        self._regime_cache[symbol] = {"regime": regime, "expires": now + REGIME_CACHE_TTL_SEC}
        return regime

    # ─── EV candidate builder ─────────────────────────────────────────────────

    def _build_ev_candidate(self, opp: dict, opp_type: str, score: float) -> Optional[dict]:
        """
        Build EV model inputs from scanner opportunity priors and compute EV.

        Returns a dict with all sizing inputs, or None if EV is negative.
        Strategy-specific (base_p_win, avg_win, avg_loss) come from _EV_PRIORS.
        p_win is adjusted upward as score rises above 50.
        """
        from core.ev_model import EVModel

        priors = _EV_PRIORS.get(opp_type, _EV_PRIORS.get("liquidity_signal"))
        if not priors:
            return None

        base_p_win, avg_win, avg_loss = priors

        # For arb types, use the actual measured net_edge as avg_win
        measured_edge = opp.get("net_edge_pct", 0)
        if measured_edge > 0 and opp_type in ("cross_exchange_arb", "triangular_arb"):
            avg_win  = measured_edge / 100.0
            avg_loss = avg_win * 0.5   # worst-case: edge closes against us

        # Score adjustment: score 100 → +0.25 above base; score 0 → -0.25
        p_win = min(max(base_p_win + (score - 50.0) / 200.0, 0.30), 0.92)

        # Round-trip fees (maker both ways is the best case)
        fees_pct     = ACTIVE_MAKER_FEE * 2
        slippage_pct = 0.0005   # conservative 0.05% slippage

        ev = EVModel.compute(p_win, avg_win, avg_loss, fees_pct, slippage_pct)

        # Kelly fraction (full, caller applies half-Kelly via regime mult)
        kelly = EVModel.kelly_fraction(p_win, avg_win, avg_loss)

        return {
            "p_win":        p_win,
            "avg_win":      avg_win,
            "avg_loss":     avg_loss,
            "fees_pct":     fees_pct,
            "slippage_pct": slippage_pct,
            "ev":           ev,
            "kelly":        kelly,
        }

    # ─── Kelly-based position sizer ───────────────────────────────────────────

    def _compute_kelly_size(
        self,
        kelly:           float,
        balance:         float,
        regime_kelly_mult: float,
        ev_confidence_mult: float,
        orderflow_mult:  float,
    ) -> float:
        """
        Dollar position size using half-Kelly with all regime/signal multipliers.

        Chain:
          base    = balance * half_kelly
          × regime_kelly_mult     (0.25–1.0 based on regime)
          × ev_confidence_mult    (0.5–2.0 based on EV vs recent avg)
          × orderflow_mult        (1.2 if orderflow agrees, 1.0 otherwise)
          hard cap: MAX_KELLY_PCT * balance
          floor:    MIN_POSITION_USD
        """
        half_kelly = kelly * 0.5
        base       = balance * half_kelly

        base *= regime_kelly_mult
        base *= ev_confidence_mult
        base *= orderflow_mult

        cap  = balance * MAX_KELLY_PCT
        size = min(base, cap)
        return size if size >= MIN_POSITION_USD else 0.0

    # ─── Opportunity evaluation ───────────────────────────────────────────────

    def _evaluate_opportunity(self, opp: dict, allocations: dict,
                               market_cache: dict) -> None:
        opp_type = opp.get("type", "")
        strategy = SIGNAL_TO_STRATEGY.get(opp_type, "breakout")
        score    = opp.get("score", 0)
        edge_pct = opp.get("net_edge_pct", opp.get("imbalance", 0) * 100)

        # vol_breakout and liquidity_signal don't carry net_edge_pct.
        # Derive edge from score as proxy (score=60 → 0.60%).
        if edge_pct == 0 and opp_type in ("liquidity_signal", "vol_breakout"):
            edge_pct = score / 100

        # Determine exchange and symbol
        exchange = opp.get("buy_exchange") or opp.get("exchange", "")
        symbol   = opp.get("symbol", "")

        if not exchange or not symbol:
            return

        # ── 1. Symbol cooldown ────────────────────────────────────────────────
        now = time.time()
        cooldown_until = self._symbol_cooldown.get(symbol, 0.0)
        if now < cooldown_until:
            log.info("COOLDOWN %s — %.0fs remaining", symbol, cooldown_until - now)
            return

        # ── 2. Minimum score gate ─────────────────────────────────────────────
        # HIGH_VOL regime requires a higher bar — checked after regime detection.
        # This first check rejects obviously weak signals before any API calls.
        if score < MIN_SCORE_THRESHOLD:
            log.info("REJECTED %s/%s — score %.1f < threshold %d (reason=score_below_threshold)",
                     symbol, exchange, score, MIN_SCORE_THRESHOLD)
            log_event("SIGNAL_REJECTED", "router",
                      {"symbol": symbol, "exchange": exchange, "score": score,
                       "reason": "score_below_threshold", "threshold": MIN_SCORE_THRESHOLD})
            return

        # Get data row and timestamp for freshness check
        row     = market_cache.get(exchange, {}).get(symbol, {})
        data_ts = row.get("ticker_ts")

        # Log the signal regardless of trade decision
        log_signal(strategy, symbol, exchange, opp_type, score, opp)

        log.info("Evaluating: %s | %s | %s | score=%.1f | edge=%.4f%%",
                 opp_type, symbol, exchange, score, edge_pct)

        # ── Fast scalp: enforce minimum score and spread protection ───────────
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

        # ── 3. Regime-aware strategy gate ─────────────────────────────────────
        regime_dict     = self._get_regime(symbol, exchange)
        regime          = regime_dict.get("regime", "UNKNOWN")
        regime_allowed  = _REGIME_ALLOWED.get(regime, _REGIME_ALLOWED["UNKNOWN"])
        kelly_mult      = _REGIME_KELLY_MULT.get(regime, 0.50)

        # RISK_OFF: nothing trades
        if regime == "RISK_OFF":
            log.info("REJECTED %s/%s — regime=RISK_OFF", symbol, exchange)
            return

        # HIGH_VOL: raise score threshold by _HIGH_VOL_SCORE_BOOST
        effective_threshold = MIN_SCORE_THRESHOLD
        if regime == "HIGH_VOL":
            effective_threshold += _HIGH_VOL_SCORE_BOOST
            if score < effective_threshold:
                log.info("REJECTED %s/%s — regime=HIGH_VOL score %.1f < %d",
                         symbol, exchange, score, effective_threshold)
                return

        # TREND_DOWN: explicit long block with clear label
        if regime == "TREND_DOWN" and opp_type not in ("mean_reversion",) and strategy not in ("mean_reversion",):
            log.info("REJECTED %s/%s — TREND_DOWN blocks %s (only mean_reversion allowed)",
                     symbol, exchange, opp_type)
            return

        # Check strategy allowed in regime (check both opp_type and strategy alias)
        if opp_type not in regime_allowed and strategy not in regime_allowed:
            log.info("REJECTED %s/%s — opp_type=%s not allowed in regime=%s (allowed=%s)",
                     symbol, exchange, opp_type, regime, sorted(regime_allowed))
            log_event("SIGNAL_REJECTED", "router",
                      {"symbol": symbol, "exchange": exchange, "opp_type": opp_type,
                       "regime": regime, "reason": "regime_filter"})
            return

        # ── 4. EV filter ──────────────────────────────────────────────────────
        ev_inputs = self._build_ev_candidate(opp, opp_type, score)
        if ev_inputs is None:
            log.debug("No EV priors for %s/%s type=%s — skipping", symbol, exchange, opp_type)
            return

        ev    = ev_inputs["ev"]
        kelly = ev_inputs["kelly"]

        if ev < MIN_EV_THRESHOLD:
            log.info("REJECTED %s/%s — EV=%.6f < threshold %.6f (regime=%s)",
                     symbol, exchange, ev, MIN_EV_THRESHOLD, regime)
            log_event("SIGNAL_REJECTED", "router",
                      {"symbol": symbol, "exchange": exchange, "ev": round(ev, 8),
                       "regime": regime, "reason": "ev_below_threshold"})
            return

        # Track EV history for confidence multiplier
        self._ev_history.append(ev)

        # ── 5. Risk checks ────────────────────────────────────────────────────
        if not self.risk.allow_trade(edge_pct=edge_pct, data_ts=data_ts):
            log.info("REJECTED %s/%s — risk check failed (see above)", symbol, exchange)
            return

        # ── Scalp mode: RSI / Z-score / spread / volume gate ─────────────────
        if self.scalp_mode:
            approved, reason = self.scalp_filter.validate(
                symbol, exchange, market_cache, score=score
            )
            if not approved:
                log.info("REJECTED %s/%s — scalp filter: %s", symbol, exchange, reason)
                return

        # ── 6. Buy price ──────────────────────────────────────────────────────
        buy_price = row.get("ask") or row.get("last")
        if not buy_price:
            log.debug("No price available for %s/%s", symbol, exchange)
            return

        # ── 7. Dynamic position sizing ────────────────────────────────────────
        spendable = max(self.risk.balance - USD_FEE_RESERVE, 0)

        if self.fast_scalp_mode:
            trade_dollar = min(self.risk.balance * FAST_SCALP_CAPITAL_PCT, spendable)

        elif self.scalp_mode:
            trade_dollar = min(MIN_POSITION_USD, spendable)

        else:
            # EV confidence multiplier: current EV vs rolling average
            if len(self._ev_history) >= 3:
                avg_ev = sum(self._ev_history) / len(self._ev_history)
                ev_conf_mult = min(max(ev / avg_ev if avg_ev > 0 else 1.0, 0.5), 2.0)
            else:
                ev_conf_mult = 1.0

            # Orderflow alignment: 1.2x if orderflow matches trade direction
            of_dir = opp.get("orderflow_direction", "NEUTRAL")
            of_match = of_dir == "BUY" and opp_type not in ("cross_exchange_arb", "triangular_arb")
            orderflow_mult = 1.20 if of_match else 1.0

            trade_dollar = self._compute_kelly_size(
                kelly, self.risk.balance,
                kelly_mult, ev_conf_mult, orderflow_mult
            )
            trade_dollar = min(trade_dollar, spendable)

            log.info(
                "SIZING %s/%s | kelly=%.4f | regime=%s kelly_mult=%.2f | "
                "ev=%.6f ev_conf=%.2f | of_mult=%.2f | size=$%.2f",
                symbol, exchange, kelly, regime, kelly_mult,
                ev, ev_conf_mult, orderflow_mult, trade_dollar,
            )

        if trade_dollar < MIN_POSITION_USD:
            log.info("REJECTED %s/%s — sized below MIN_POSITION_USD ($%.2f < $%.2f)",
                     symbol, exchange, trade_dollar, MIN_POSITION_USD)
            return

        quantity = trade_dollar / buy_price
        if quantity <= 0:
            return

        # ── 8. Pre-trade: already in position? ────────────────────────────────
        existing = self.positions.get(symbol, exchange)
        if existing and existing["quantity"] > 0:
            log.debug("Already in position for %s/%s — skipping", symbol, exchange)
            return

        log.info(
            "EXECUTING %s | %s | %s | qty=%.6f | price=%.4f | "
            "ev=%.6f | kelly=%.4f | regime=%s | size=$%.2f | score=%.1f",
            strategy, opp_type, symbol, quantity, buy_price,
            ev, kelly, regime, trade_dollar, score,
        )

        # Submit limit buy (maker fee)
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
                           "exchange": exchange, "qty": quantity, "price": fill_price,
                           "ev": round(ev, 8), "kelly": round(kelly, 6),
                           "regime": regime, "score": score})

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
            self._symbol_cooldown[symbol] = time.time() + SYMBOL_COOLDOWN_SEC
            log_event("TRADE_CLOSED", "router",
                      {"symbol": symbol, "exchange": exchange,
                       "pnl": pnl, "reason": reason, "mode": "fast_scalp"})
            log.info("Fast-scalp closed %s/%s — qty=%.6f PnL=%.4f (%s) | cooldown=%ds",
                     symbol, exchange, sell_qty, pnl, reason, SYMBOL_COOLDOWN_SEC)

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
            self._symbol_cooldown[symbol] = time.time() + SYMBOL_COOLDOWN_SEC
            log_event("TRADE_CLOSED", "router",
                      {"symbol": symbol, "exchange": exchange,
                       "pnl": pnl, "reason": reason})
            log.info("Closed %s/%s — PnL: %.4f (%s) | cooldown=%ds",
                     symbol, exchange, pnl, reason, SYMBOL_COOLDOWN_SEC)

        return order

    # ─── Emergency close all ──────────────────────────────────────────────────

    def close_all(self, reason: str = "emergency") -> None:
        self.order_mgr.cancel_all()
        for pos in self.positions.open_positions():
            self.close_position(pos["symbol"], pos["exchange"], reason)
