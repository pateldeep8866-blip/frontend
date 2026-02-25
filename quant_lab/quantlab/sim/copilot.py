from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence


@dataclass(frozen=True)
class Recommendation:
    action: str  # BUY/SELL/HOLD
    suggested_shares: int
    reason: str
    risk_notes: List[str]
    confidence: float


class Copilot:
    """
    Simple math-based copilot.

    Signal:
      - ma_short > ma_long -> prefer long
      - else -> prefer flat

    Risk constraints:
      - max_position_pct: cap notional exposure as a fraction of equity
      - max_daily_loss_pct: if breached, recommend HOLD (halt trading for the day)
    """

    def __init__(
        self,
        *,
        short_window: int = 20,
        long_window: int = 50,
        max_position_pct: float = 0.25,
        max_daily_loss_pct: float = 0.02,
    ):
        if short_window <= 0 or long_window <= 0 or short_window >= long_window:
            raise ValueError("require 0 < short_window < long_window")
        if max_position_pct <= 0 or max_position_pct > 1:
            raise ValueError("max_position_pct must be in (0, 1]")
        if max_daily_loss_pct <= 0 or max_daily_loss_pct >= 1:
            raise ValueError("max_daily_loss_pct must be in (0, 1)")

        self.short_window = int(short_window)
        self.long_window = int(long_window)
        self.max_position_pct = float(max_position_pct)
        self.max_daily_loss_pct = float(max_daily_loss_pct)

    @staticmethod
    def _sma(xs: Sequence[float]) -> float:
        return float(sum(float(x) for x in xs) / float(len(xs)))

    def recommend(
        self,
        *,
        close: float,
        history_closes: Sequence[float],
        cash: float,
        current_shares: float,
        equity: float,
        daily_pnl_pct: float,
        halted: bool,
    ) -> Recommendation:
        px = float(close)
        if px <= 0 or not math.isfinite(px):
            return Recommendation(
                action="HOLD",
                suggested_shares=0,
                reason="Invalid price input.",
                risk_notes=["price_invalid"],
                confidence=0.0,
            )

        risk_notes: List[str] = []
        if halted or float(daily_pnl_pct) <= -float(self.max_daily_loss_pct):
            risk_notes.append("daily_loss_limit_reached")
            return Recommendation(
                action="HOLD",
                suggested_shares=0,
                reason="Daily loss limit reached: halt trading for the day.",
                risk_notes=risk_notes,
                confidence=0.2,
            )

        if len(history_closes) < self.long_window:
            risk_notes.append("insufficient_history")
            return Recommendation(
                action="HOLD",
                suggested_shares=0,
                reason=f"Need {self.long_window} closes to compute long MA.",
                risk_notes=risk_notes,
                confidence=0.1,
            )

        ma_s = self._sma(history_closes[-self.short_window :])
        ma_l = self._sma(history_closes[-self.long_window :])

        # Position sizing constraint.
        eq = float(equity)
        max_value = float(self.max_position_pct) * eq
        max_shares = int(max_value // px) if max_value > 0 else 0

        cur = float(current_shares)
        action = "HOLD"
        suggested = 0

        if ma_s > ma_l:
            # Prefer long up to max_shares.
            target = max_shares
            if cur < float(target) - 1e-9:
                need = int(max(0, target - int(round(cur))))
                affordable = int(max(0, float(cash) // px))
                suggested = int(min(need, affordable))
                if suggested > 0:
                    action = "BUY"
                else:
                    action = "HOLD"
                    risk_notes.append("insufficient_cash_for_target")
            else:
                action = "HOLD"
        else:
            # Prefer flat.
            if cur > 0:
                action = "SELL"
                suggested = int(round(cur))
            else:
                action = "HOLD"

        # Confidence heuristic: MA separation scaled by price.
        sep = abs(ma_s - ma_l) / px
        conf = 0.5 + min(0.4, sep * 10.0)
        if action == "HOLD":
            conf = max(0.3, conf - 0.1)
        conf = float(min(max(conf, 0.0), 1.0))

        reason = f"MA short={ma_s:.2f} vs long={ma_l:.2f}. Prefer {'LONG' if ma_s > ma_l else 'FLAT'}."
        risk_notes.append(f"max_position_pct={self.max_position_pct}")
        risk_notes.append(f"max_daily_loss_pct={self.max_daily_loss_pct}")

        return Recommendation(
            action=action,
            suggested_shares=int(suggested),
            reason=reason,
            risk_notes=risk_notes,
            confidence=conf,
        )

