from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional


@dataclass(frozen=True)
class FillModel:
    """
    Simple paper fill model.

    - fill_at_close: fill price uses bar close (default)
    - slippage_bps: applied against the user (BUY pays more, SELL receives less)
    """

    slippage_bps: float = 0.0
    fill_at_close: bool = True

    def _slip_mult(self, action: str) -> float:
        bps = float(self.slippage_bps)
        slip = bps / 10_000.0
        a = str(action).upper()
        if a == "BUY":
            return 1.0 + slip
        if a == "SELL":
            return 1.0 - slip
        return 1.0

    def fill_price(
        self,
        action: str,
        bar: Mapping[str, float],
        *,
        use_open: bool = False,
    ) -> float:
        """
        Return fill price for action on a given bar, with slippage applied.

        `bar` is expected to have 'Open' and/or 'Close' keys (case-sensitive).
        """
        a = str(action).upper()
        if use_open and "Open" in bar and bar["Open"] is not None:
            px = float(bar["Open"])
        else:
            px = float(bar.get("Close", bar.get("Adj Close", 0.0)))
        if px <= 0:
            raise ValueError("invalid bar price for fill")
        return float(px * self._slip_mult(a))


@dataclass(frozen=True)
class PendingOrder:
    action: str  # BUY/SELL
    shares: int
    reason: str = ""

