# assets/equities_model.py — US Equities & ETF asset model
#
# Supports Alpaca and IBKR as venues.
# Handles:
#   - Market hours enforcement (NYSE/NASDAQ 09:30–16:00 ET)
#   - PDT (Pattern Day Trader) rule awareness
#   - Commission structure (per-share or percentage)
#   - Mean reversion and momentum signals on daily/hourly bars

from __future__ import annotations
import time
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from assets.base_asset import BaseAssetModel
from core.candidate import TradeCandidateRecord, AssetClass, OrderSide
from core.ev_model import EVModel
from core.features import FeatureCalculator
from core.signals import SignalEngine, SIGNAL_MEAN_REVERSION, SIGNAL_MOMENTUM
from utils.logger import get_logger

log = get_logger("assets.equities")

ET = ZoneInfo("America/New_York")

# Venue fees (round-trip)
_VENUE_FEES = {
    "alpaca": 0.0,        # Alpaca commission-free for US equities
    "ibkr":   0.0010,     # IBKR Lite: ~$0 + ECN; Conservative 0.1% round-trip
}
_DEFAULT_FEE = 0.0010

# Default EV assumptions
_DEFAULT_P_WIN    = 0.54
_DEFAULT_AVG_WIN  = 0.008   # 0.8%
_DEFAULT_AVG_LOSS = 0.004   # 0.4%

# Scalp parameters (equities need slightly wider TP due to lower leverage)
_TP_PCT = 0.010   # 1.0%
_SL_PCT = 0.005   # 0.5%
_MAX_HOLD_SEC = 3600  # 1 hour for intraday


class EquitiesAssetModel(BaseAssetModel):

    @property
    def asset_class(self) -> str:
        return AssetClass.EQUITIES.value

    @property
    def supported_strategies(self) -> list[str]:
        return [SIGNAL_MEAN_REVERSION, SIGNAL_MOMENTUM]

    # ── scan ─────────────────────────────────────────────────────────────────

    def scan(
        self,
        market_data: dict,
        regime:      dict,
        candles:     Optional[dict] = None,
    ) -> list[TradeCandidateRecord]:
        """
        Produce equity trade candidates from bar data.
        market_data: {symbol: {bid, ask, last, ...}}
        candles:     {symbol: [{"close": ..., "high": ..., "low": ..., ...}]}
        """
        if not self.is_market_open():
            log.debug("Equities market closed — skipping scan")
            return []

        candidates: list[TradeCandidateRecord] = []
        ev_model   = EVModel()
        regime_str = regime.get("regime", "UNKNOWN")

        if not candles:
            return []

        for symbol, candle_list in candles.items():
            if len(candle_list) < 15:
                continue

            row = market_data.get(symbol, {})
            bid = row.get("bid") or row.get("last") or 0
            ask = row.get("ask") or row.get("last") or 0
            if not bid or not ask:
                continue

            venue    = row.get("venue", "alpaca")
            features = FeatureCalculator.compute(candle_list, bid, ask)
            signal   = SignalEngine.best(
                features, regime_str, [SIGNAL_MEAN_REVERSION, SIGNAL_MOMENTUM]
            )

            if signal:
                fee  = self.estimate_fees(venue)
                slip = self.estimate_slippage(symbol, row.get("order_book", {}),
                                              1000.0, signal["side"].value)
                c = TradeCandidateRecord(
                    symbol        = symbol,
                    asset_class   = AssetClass.EQUITIES,
                    venue         = venue,
                    strategy      = signal["type"],
                    side          = signal["side"],
                    bid           = bid,
                    ask           = ask,
                    last          = (bid + ask) / 2,
                    spread_pct    = FeatureCalculator.spread_pct(bid, ask),
                    regime        = regime_str,
                    p_win         = _DEFAULT_P_WIN,
                    avg_win       = _DEFAULT_AVG_WIN,
                    avg_loss      = _DEFAULT_AVG_LOSS,
                    fees_pct      = fee,
                    slippage_pct  = slip,
                    expected_hold_sec = 1800.0,
                    confidence    = signal["confidence"],
                    features      = features,
                )
                ev_model.enrich(c)
                candidates.append(c)

        return [c for c in candidates if c.is_viable]

    # ── Fee / slippage ────────────────────────────────────────────────────────

    def estimate_fees(self, venue: str, order_type: str = "limit") -> float:
        return _VENUE_FEES.get(venue, _DEFAULT_FEE)

    def estimate_slippage(
        self, symbol: str, order_book: dict, size_usd: float, side: str
    ) -> float:
        if order_book:
            return self._book_slippage(order_book, size_usd, side)
        # Fallback: 2 bps for liquid large-caps, more for small-caps
        return 0.0002

    # ── Validation ────────────────────────────────────────────────────────────

    def validate_order(
        self, candidate: TradeCandidateRecord, balance: float
    ) -> tuple[bool, str]:
        if not self.is_market_open():
            return False, "market_closed"
        if candidate.allocated_capital <= 0:
            return False, "zero_capital"
        if candidate.spread_pct > 0.003:
            return False, f"spread_too_wide ({candidate.spread_pct:.3%})"
        # PDT: warn if account < $25k — don't block, but log
        if balance < 25_000:
            log.warning("PDT WARNING: Account < $25k. Day trading equities may violate PDT rule.")
        return True, "ok"

    # ── Exit rules ────────────────────────────────────────────────────────────

    def exit_rules(
        self,
        position:    dict,
        market_data: dict,
        regime:      dict,
    ) -> Optional[str]:
        symbol   = position["symbol"]
        entry    = position.get("avg_entry", 0)
        entry_ts = position.get("entry_ts", 0)
        if not entry:
            return None

        row = market_data.get(symbol, {})
        bid = row.get("bid") or row.get("last") or 0
        if not bid:
            return None

        pnl_pct  = (bid - entry) / entry
        tp_mult  = regime.get("tp_mult", 1.0)
        sl_mult  = regime.get("sl_mult", 1.0)

        if pnl_pct >= _TP_PCT * tp_mult:
            return "take_profit"
        if pnl_pct <= -(_SL_PCT * sl_mult):
            return "stop_loss"
        if entry_ts and (time.time() - entry_ts) > _MAX_HOLD_SEC:
            return "time_exit"

        # Force close before market close (15:55 ET)
        if self._minutes_to_close() < 10:
            return "market_close_exit"

        return None

    # ── Market hours ──────────────────────────────────────────────────────────

    @staticmethod
    def is_market_open() -> bool:
        """Returns True if NYSE/NASDAQ regular session is open."""
        now = datetime.now(ET)
        if now.weekday() >= 5:  # Saturday=5, Sunday=6
            return False
        market_open  = now.replace(hour=9,  minute=30, second=0, microsecond=0)
        market_close = now.replace(hour=16, minute=0,  second=0, microsecond=0)
        return market_open <= now < market_close

    @staticmethod
    def _minutes_to_close() -> float:
        now   = datetime.now(ET)
        close = now.replace(hour=16, minute=0, second=0, microsecond=0)
        delta = (close - now).total_seconds() / 60
        return delta
