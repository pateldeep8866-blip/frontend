from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, Mapping, Optional, Sequence, TypedDict


class Tick(TypedDict):
    symbol: str
    ts: datetime
    last: float
    bid: Optional[float]
    ask: Optional[float]


def validate_tick(t: Mapping[str, Any]) -> Tick:
    """
    Validate/normalize a tick dict to the required schema.
    """
    sym = str(t.get("symbol", "")).upper().strip()
    if not sym:
        raise ValueError("tick missing symbol")

    ts = t.get("ts")
    if not isinstance(ts, datetime):
        raise ValueError("tick missing ts datetime")

    last = float(t.get("last", 0.0))
    if last <= 0:
        raise ValueError("tick missing/invalid last")

    bid = t.get("bid", None)
    ask = t.get("ask", None)
    bid_f = None if bid is None else float(bid)
    ask_f = None if ask is None else float(ask)

    out: Tick = {"symbol": sym, "ts": ts, "last": float(last), "bid": bid_f, "ask": ask_f}
    return out


class MarketDataProvider(ABC):
    """
    Abstract live market data provider (paper-only; data-only).
    """

    @property
    def name(self) -> str:
        return self.__class__.__name__

    @abstractmethod
    def connect(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def subscribe(self, symbols: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def start_stream(self, on_tick_callback: Callable[[Tick], None]) -> None:
        raise NotImplementedError

    @abstractmethod
    def stop(self) -> None:
        raise NotImplementedError


def best_price_for_side(tick: Mapping[str, Any], side: str) -> float:
    """
    Conservative fill reference price from a tick.

    BUY: ask if available else last
    SELL: bid if available else last
    """
    t = validate_tick(tick)
    s = str(side).upper()
    if s == "BUY" and t["ask"] is not None:
        return float(t["ask"])
    if s == "SELL" and t["bid"] is not None:
        return float(t["bid"])
    return float(t["last"])


def apply_slippage(price: float, side: str, slippage_bps: float) -> float:
    px = float(price)
    if px <= 0:
        raise ValueError("price must be > 0")
    slip = float(slippage_bps) / 10_000.0
    s = str(side).upper()
    if s == "BUY":
        return float(px * (1.0 + slip))
    if s == "SELL":
        return float(px * (1.0 - slip))
    return float(px)


def compute_target_shares_from_weights(
    *,
    equity: float,
    weights: Mapping[str, float],
    prices: Mapping[str, float],
    max_weight_per_asset: float = 0.25,
    commission: float = 0.0,
) -> tuple[Dict[str, int], float]:
    """
    Convert target weights into integer share targets.

    - Floors shares (never rounds up) so targets do not exceed the dollar budget.
    - Applies per-trade commission as a fraction of notional in the budget check.
    - Returns (target_shares, residual_cash).
    """
    eq = float(equity)
    if eq <= 0:
        return {}, float(eq)
    c = float(commission)
    if c < 0 or c >= 1:
        raise ValueError("commission must be in [0, 1)")

    # Clamp weights and ignore CASH leg.
    w = {}
    for k, v in weights.items():
        t = str(k).upper()
        if t == "CASH":
            continue
        try:
            wf = float(v)
        except Exception:
            continue
        if wf <= 0:
            continue
        wf = min(wf, float(max_weight_per_asset))
        w[t] = wf

    # Deterministic ordering.
    tickers = sorted(w.keys())
    targets: Dict[str, int] = {}

    total_cost = 0.0
    for t in tickers:
        px = float(prices.get(t, 0.0))
        if px <= 0:
            targets[t] = 0
            continue
        budget = eq * float(w[t])
        sh = int(budget // (px * (1.0 + c)))
        sh = max(0, sh)
        targets[t] = sh
        total_cost += float(sh) * px * (1.0 + c)

    # Final safety: if rounding/inputs still exceed equity, reduce deterministically.
    if total_cost > eq + 1e-9:
        # Reduce 1 share at a time from the largest-cost legs first.
        while total_cost > eq + 1e-9:
            # Pick ticker with max marginal cost per share.
            cand = None
            cand_cost = 0.0
            for t in tickers:
                sh = int(targets.get(t, 0))
                if sh <= 0:
                    continue
                px = float(prices.get(t, 0.0))
                m = px * (1.0 + c)
                if m > cand_cost:
                    cand = t
                    cand_cost = m
            if cand is None:
                break
            targets[cand] = int(targets[cand]) - 1
            total_cost -= cand_cost

    residual = float(max(0.0, eq - total_cost))
    return targets, residual

