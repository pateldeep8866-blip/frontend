from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional


@dataclass(frozen=True)
class TradeLogEntry:
    dt: Optional[datetime]
    action: str  # BUY/SELL
    ticker: str
    shares: float
    price: float
    commission: float
    cash_after: float
    shares_after: float


class PaperAccount:
    """
    Minimal paper account.

    - cash is in dollars (float)
    - positions are stored as shares (float; typically integer-like)
    """

    def __init__(self, cash: float):
        if cash < 0:
            raise ValueError("cash must be >= 0")
        self.cash: float = float(cash)
        self.positions: Dict[str, float] = {}
        self._trade_log: List[TradeLogEntry] = []
        self._current_dt: Optional[datetime] = None

    def set_time(self, dt: Optional[datetime]) -> None:
        """Set the timestamp used for subsequent trade log entries."""
        self._current_dt = dt

    @property
    def trade_log(self) -> List[TradeLogEntry]:
        return list(self._trade_log)

    def shares(self, ticker: str) -> float:
        return float(self.positions.get(str(ticker).upper(), 0.0))

    def buy(self, ticker: str, shares: float, price: float, commission: float = 0.0) -> None:
        t = str(ticker).upper()
        sh = float(shares)
        px = float(price)
        c = float(commission)
        if sh <= 0:
            raise ValueError("shares must be > 0")
        if px <= 0:
            raise ValueError("price must be > 0")
        if c < 0 or c >= 1:
            raise ValueError("commission must be in [0, 1)")

        notional = sh * px
        total_cost = notional * (1.0 + c)
        if total_cost > self.cash + 1e-12:
            raise ValueError("insufficient cash")

        self.cash -= total_cost
        self.positions[t] = self.shares(t) + sh

        self._trade_log.append(
            TradeLogEntry(
                dt=self._current_dt,
                action="BUY",
                ticker=t,
                shares=sh,
                price=px,
                commission=c,
                cash_after=float(self.cash),
                shares_after=float(self.positions[t]),
            )
        )

    def sell(self, ticker: str, shares: float, price: float, commission: float = 0.0) -> None:
        t = str(ticker).upper()
        sh = float(shares)
        px = float(price)
        c = float(commission)
        if sh <= 0:
            raise ValueError("shares must be > 0")
        if px <= 0:
            raise ValueError("price must be > 0")
        if c < 0 or c >= 1:
            raise ValueError("commission must be in [0, 1)")

        held = self.shares(t)
        if sh > held + 1e-12:
            raise ValueError("insufficient shares")

        notional = sh * px
        proceeds = notional * (1.0 - c)
        self.cash += proceeds
        new_shares = held - sh
        if new_shares <= 1e-12:
            self.positions.pop(t, None)
            new_shares = 0.0
        else:
            self.positions[t] = new_shares

        self._trade_log.append(
            TradeLogEntry(
                dt=self._current_dt,
                action="SELL",
                ticker=t,
                shares=sh,
                price=px,
                commission=c,
                cash_after=float(self.cash),
                shares_after=float(new_shares),
            )
        )

    def equity(self, prices: Dict[str, float]) -> float:
        eq = float(self.cash)
        for t, sh in self.positions.items():
            px = float(prices.get(t, 0.0))
            eq += float(sh) * px
        return float(eq)

