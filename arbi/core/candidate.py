# core/candidate.py — Universal trade candidate record
#
# TradeCandidateRecord is the single data structure that flows through the
# entire pipeline: asset model → EV model → sizer → allocator → execution.
# Every asset class produces these; the portfolio allocator ranks them together.

from __future__ import annotations
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class AssetClass(str, Enum):
    CRYPTO   = "crypto"
    EQUITIES = "equities"
    FUTURES  = "futures"
    FX       = "fx"
    OPTIONS  = "options"


class OrderSide(str, Enum):
    BUY  = "buy"
    SELL = "sell"


@dataclass
class TradeCandidateRecord:
    """
    Universal trade proposal produced by any asset-class scanner.

    Immutable after construction — the allocator stamps `allocated_capital`
    on the selected candidates before handing them to execution.
    """

    # ── Identity ──────────────────────────────────────────────────────────────
    symbol:      str          # Internal canonical form: "BTC/USD", "AAPL", "ES=F", "EURUSD"
    asset_class: AssetClass
    venue:       str          # "binance_us", "alpaca", "ibkr", "kraken", …
    strategy:    str          # "mean_reversion", "momentum", "funding_rate_arb", …
    side:        OrderSide    # BUY or SELL

    # ── Market snapshot (at signal generation time) ───────────────────────────
    bid:        float
    ask:        float
    last:       float
    spread_pct: float         # (ask - bid) / bid

    # ── Regime ────────────────────────────────────────────────────────────────
    regime: str = "UNKNOWN"   # RANGING | TREND_UP | TREND_DOWN | HIGH_VOL

    # ── EV model inputs ───────────────────────────────────────────────────────
    p_win:             float = 0.0   # Estimated win probability  [0, 1]
    avg_win:           float = 0.0   # Expected gain as fraction  (e.g. 0.006 = 0.6%)
    avg_loss:          float = 0.0   # Expected loss as fraction  (positive, e.g. 0.003)
    fees_pct:          float = 0.0   # Round-trip fee fraction
    slippage_pct:      float = 0.0   # Estimated slippage fraction
    expected_hold_sec: float = 0.0

    # ── EV model outputs (populated by EVModel.enrich) ────────────────────────
    ev:         float = 0.0   # Expected value per dollar risked
    confidence: float = 0.0   # Composite signal confidence [0, 1]

    # ── Sizing (populated by TradeSizer / PortfolioAllocator) ─────────────────
    suggested_capital: float = 0.0   # Dollar amount suggested by TradeSizer
    allocated_capital: float = 0.0   # Confirmed by PortfolioAllocator

    # ── Raw signal features (for research / ML) ───────────────────────────────
    features: dict = field(default_factory=dict)

    # ── Metadata ──────────────────────────────────────────────────────────────
    signal_ts:  float = field(default_factory=time.time)
    source_opp: Optional[dict] = field(default=None, repr=False)  # original scanner dict

    # ── Computed helpers ──────────────────────────────────────────────────────
    @property
    def net_ev(self) -> float:
        """EV after fees and slippage."""
        return self.ev - self.fees_pct - self.slippage_pct

    @property
    def risk_reward(self) -> float:
        """avg_win / avg_loss ratio (0 if avg_loss == 0)."""
        return self.avg_win / self.avg_loss if self.avg_loss > 0 else 0.0

    @property
    def is_viable(self) -> bool:
        """Quick gate: positive EV and confidence above noise floor."""
        return self.ev > 0 and self.confidence >= 0.3

    def to_dict(self) -> dict:
        return {
            "symbol":      self.symbol,
            "asset_class": self.asset_class.value,
            "venue":       self.venue,
            "strategy":    self.strategy,
            "side":        self.side.value,
            "bid":         self.bid,
            "ask":         self.ask,
            "last":        self.last,
            "spread_pct":  self.spread_pct,
            "regime":      self.regime,
            "p_win":       self.p_win,
            "avg_win":     self.avg_win,
            "avg_loss":    self.avg_loss,
            "fees_pct":    self.fees_pct,
            "slippage_pct": self.slippage_pct,
            "ev":          self.ev,
            "confidence":  self.confidence,
            "suggested_capital": self.suggested_capital,
            "allocated_capital": self.allocated_capital,
            "expected_hold_sec": self.expected_hold_sec,
            "signal_ts":   self.signal_ts,
        }
