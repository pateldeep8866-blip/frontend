# core/sizer.py — Universal TradeSizer
#
# Converts EV + confidence into a dollar position size.
# Applies Kelly fraction, capital constraints, and risk caps.
# Stateless — receives all inputs, returns a float.

from __future__ import annotations
from core.candidate import TradeCandidateRecord
from core.ev_model import EVModel


class TradeSizer:
    """
    Determine how many dollars to risk on a trade candidate.

    Sizing chain:
      1. Base size  = balance * risk_pct
      2. Kelly bump = clamp(half_kelly * 4, 0.5, 2.0)   [conservative Kelly scale]
      3. Confidence scale * confidence
      4. Regime multiplier  (from regime.size_mult)
      5. Hard caps: min_usd ≤ size ≤ max_single_usd
    """

    def __init__(
        self,
        risk_pct:      float = 0.02,    # fraction of balance per trade (2%)
        max_risk_pct:  float = 0.05,    # hard cap (5% of balance)
        min_usd:       float = 4.0,
        use_kelly:     bool  = True,
    ):
        self.risk_pct     = risk_pct
        self.max_risk_pct = max_risk_pct
        self.min_usd      = min_usd
        self.use_kelly    = use_kelly

    def size(
        self,
        candidate: TradeCandidateRecord,
        balance:   float,
        regime_size_mult: float = 1.0,
    ) -> float:
        """
        Return suggested dollar position size for this candidate.
        Returns 0.0 if the trade should not be taken.
        """
        if balance <= 0 or not candidate.is_viable:
            return 0.0

        base = balance * self.risk_pct

        # Kelly adjustment
        if self.use_kelly and candidate.avg_loss > 0:
            kelly = EVModel.kelly_fraction(
                candidate.p_win, candidate.avg_win, candidate.avg_loss
            )
            half_kelly = kelly * 0.5
            # Scale base: half-Kelly of 5% → multiplier of 1.0; 10% → 2.0
            kelly_mult = min(max(half_kelly / self.risk_pct, 0.3), 2.0)
            base *= kelly_mult

        # Confidence and regime
        base *= min(candidate.confidence, 1.5)
        base *= regime_size_mult

        # Hard caps
        max_usd = balance * self.max_risk_pct
        size    = max(min(base, max_usd), 0.0)

        return size if size >= self.min_usd else 0.0

    def size_and_stamp(
        self,
        candidate: TradeCandidateRecord,
        balance:   float,
        regime_size_mult: float = 1.0,
    ) -> TradeCandidateRecord:
        """Compute size and stamp it on candidate.suggested_capital. Returns candidate."""
        candidate.suggested_capital = self.size(candidate, balance, regime_size_mult)
        return candidate

    def size_batch(
        self,
        candidates: list[TradeCandidateRecord],
        balance:    float,
    ) -> list[TradeCandidateRecord]:
        """Stamp suggested_capital on all candidates in the list."""
        for c in candidates:
            self.size_and_stamp(c, balance)
        return candidates
