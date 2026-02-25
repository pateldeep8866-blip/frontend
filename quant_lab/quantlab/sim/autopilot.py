from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Mapping, Optional, Sequence


@dataclass(frozen=True)
class AutopilotDecision:
    action: str  # BUY/SELL/HOLD
    ticker: str
    shares: int
    reasoning: str
    confidence: float  # 0..100
    risk: str  # LOW/MEDIUM/HIGH
    lesson: str
    extended: str


@dataclass(frozen=True)
class MarketContext:
    ts: datetime
    cash: float
    equity: float
    holdings: Dict[str, int]
    prices: Dict[str, float]
    movers: List[str]
    news: List[str]
    vix: float
    dxy: float
    us10y: float
    sector_snapshot: List[str]
    today_picks: List[str]
    market_trend: str
    risk_score: str
    watchlist: List[str]
    outlook: str


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _to_float(x: object, default: float = float("nan")) -> float:
    try:
        v = float(x)
    except Exception:
        return default
    return v if math.isfinite(v) else default


def _position_weight(shares: int, price: float, equity: float) -> float:
    if equity <= 0 or shares <= 0 or price <= 0:
        return 0.0
    return float((float(shares) * float(price)) / float(equity))


def _risk_label(confidence: float, vix: float) -> str:
    if vix >= 24.0:
        return "HIGH"
    if confidence >= 70.0:
        return "LOW"
    return "MEDIUM"


def _confidence(base: float, *, trend: str, vix: float) -> float:
    out = float(base)
    if trend == "UP":
        out += 8.0
    elif trend == "DOWN":
        out -= 10.0
    if vix >= 24.0:
        out -= 12.0
    elif vix <= 16.0:
        out += 4.0
    return _clamp(out, 25.0, 95.0)


def decide_daily_actions(
    *,
    ctx: MarketContext,
    max_weight_per_asset: float = 0.20,
    min_cash_reserve: float = 0.10,
) -> List[AutopilotDecision]:
    """
    Deterministic paper-only auto-pilot decisions.

    Policy:
    - Capital preservation first.
    - Respect max single-name concentration.
    - Keep minimum cash reserve.
    - Prefer picks/watchlist when risk is acceptable.
    """
    if ctx.equity <= 0:
        return []

    decisions: List[AutopilotDecision] = []
    cash = float(ctx.cash)
    equity = float(ctx.equity)
    target_cash = float(min_cash_reserve) * equity
    cash_shortfall = max(0.0, target_cash - cash)

    holdings = {str(k).upper(): int(v) for k, v in ctx.holdings.items() if int(v) > 0}
    prices = {str(k).upper(): float(v) for k, v in ctx.prices.items() if _to_float(v, 0.0) > 0.0}
    picks = [str(t).upper() for t in ctx.today_picks if str(t).strip()]

    # 1) Risk-off deleveraging when needed: sell weakest non-pick first.
    if cash_shortfall > 0.0 or ctx.market_trend == "DOWN":
        ranked = sorted(
            holdings.items(),
            key=lambda kv: (
                0 if kv[0] in picks else 1,
                -_position_weight(int(kv[1]), prices.get(kv[0], 0.0), equity),
                kv[0],
            ),
        )
        for t, sh in ranked:
            px = prices.get(t, 0.0)
            if px <= 0.0 or sh <= 0:
                continue
            needed_value = cash_shortfall if cash_shortfall > 0 else (0.03 * equity)
            qty = int(max(1, min(int(sh), int(math.ceil(needed_value / px)))))
            conf = _confidence(62.0, trend=ctx.market_trend, vix=ctx.vix)
            risk = _risk_label(conf, ctx.vix)
            decisions.append(
                AutopilotDecision(
                    action="SELL",
                    ticker=t,
                    shares=int(qty),
                    reasoning=(
                        f"Portfolio cash buffer fell below {min_cash_reserve:.0%} or market trend is risk-off. "
                        f"Selling part of {t} raises reserve and lowers downside convexity."
                    ),
                    confidence=conf,
                    risk=risk,
                    lesson="Capital preservation means de-risking when market stress rises.",
                    extended=(
                        f"Weight control: this sale addresses reserve shortfall={cash_shortfall:.2f}. "
                        f"Trend={ctx.market_trend}, VIX={ctx.vix:.2f}. Priority is maintaining optionality."
                    ),
                )
            )
            break

    # 2) Buy top pick if cash is ample and concentration allows.
    if picks and cash > target_cash:
        t = picks[0]
        px = prices.get(t, 0.0)
        if px > 0.0:
            current_w = _position_weight(holdings.get(t, 0), px, equity)
            cap_w = float(max_weight_per_asset)
            if current_w < cap_w - 1e-6:
                max_target_value = cap_w * equity
                current_value = float(holdings.get(t, 0)) * px
                buy_budget = min(
                    max(0.0, cash - target_cash),
                    max(0.0, max_target_value - current_value),
                )
                qty = int(max(0, math.floor(buy_budget / px)))
                if qty > 0:
                    conf = _confidence(68.0, trend=ctx.market_trend, vix=ctx.vix)
                    risk = _risk_label(conf, ctx.vix)
                    decisions.append(
                        AutopilotDecision(
                            action="BUY",
                            ticker=t,
                            shares=int(qty),
                            reasoning=(
                                f"{t} is the highest-ranked pick with supportive trend context. "
                                "Position size is capped to keep single-name risk within portfolio limits."
                            ),
                            confidence=conf,
                            risk=risk,
                            lesson="Position sizing is as important as stock selection.",
                            extended=(
                                f"Buy budget={buy_budget:.2f}, target cap={cap_w:.0%}, "
                                f"current_weight={current_w:.2%}, cash_reserve_target={target_cash:.2f}."
                            ),
                        )
                    )

    # 3) If no action was generated, HOLD with explicit rationale.
    if not decisions:
        conf = _confidence(56.0, trend=ctx.market_trend, vix=ctx.vix)
        risk = _risk_label(conf, ctx.vix)
        decisions.append(
            AutopilotDecision(
                action="HOLD",
                ticker="PORTFOLIO",
                shares=0,
                reasoning=(
                    "No trade improves risk-adjusted expectancy under current constraints. "
                    "Maintaining positions avoids over-trading and preserves cash optionality."
                ),
                confidence=conf,
                risk=risk,
                lesson="Sometimes the best trade is no trade when edge is weak.",
                extended=(
                    f"Trend={ctx.market_trend}, VIX={ctx.vix:.2f}, "
                    f"cash={cash:.2f}/{equity:.2f} ({(cash/equity if equity>0 else 0):.1%})."
                ),
            )
        )

    return decisions


def next_decision_time_text(now_ts: datetime) -> str:
    """
    Display helper for UI scheduling label.
    """
    return f"{now_ts.strftime('%Y-%m-%d')} 09:30 local (next session)"
