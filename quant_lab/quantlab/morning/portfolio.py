from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

from quantlab.morning.regime import RegimeResult
from quantlab.morning.signals import SignalRow


DEFENSIVE_SET = {"TLT", "GLD", "XLP", "XLV"}


def inverse_vol_weights(vols: Dict[str, float]) -> Dict[str, float]:
    inv = {}
    for t, v in vols.items():
        try:
            vf = float(v)
        except Exception:
            continue
        if not math.isfinite(vf) or vf <= 0:
            continue
        inv[str(t)] = 1.0 / vf
    s = sum(inv.values())
    if s <= 0:
        return {}
    return {t: float(x / s) for t, x in inv.items()}


@dataclass(frozen=True)
class PortfolioPlan:
    picks: List[str]
    base_weights: Dict[str, float]
    notes: List[str]


def select_picks(
    signals: Sequence[SignalRow],
    *,
    regime: RegimeResult,
    k: int = 5,
    corr_cap_to_spy: float = 0.95,
) -> Tuple[List[SignalRow], List[str]]:
    notes: List[str] = []
    if k <= 0:
        return [], ["k<=0: no picks"]

    # Regime filter: in risk_off, prefer defensive set and/or lower correlation assets.
    def _regime_ok(s: SignalRow) -> bool:
        if regime.label == "risk_off":
            if s.ticker in DEFENSIVE_SET:
                return True
            # If not defensive, require lower correlation.
            return bool(math.isfinite(s.corr_spy) and s.corr_spy < 0.5)
        return True

    candidates = [s for s in signals if _regime_ok(s)]
    if regime.label == "risk_off":
        notes.append("regime=risk_off: filtered candidates to defensive/low-corr subset")

    # Correlation cap: drop overly redundant assets if enough alternatives exist.
    filtered = []
    dropped = []
    for s in candidates:
        if math.isfinite(s.corr_spy) and s.corr_spy > float(corr_cap_to_spy):
            dropped.append(s.ticker)
            continue
        filtered.append(s)
    if len(filtered) >= k and dropped:
        notes.append(f"corr_cap: dropped {len(dropped)} tickers with corr_to_spy>{corr_cap_to_spy}")
        candidates = filtered
    else:
        candidates = candidates  # keep as-is if dropping would starve picks

    picks = list(candidates[: int(k)])
    if not picks:
        notes.append("no picks after filtering")
    return picks, notes


def build_portfolio(
    pick_rows: Sequence[SignalRow],
) -> PortfolioPlan:
    vols = {r.ticker: float(r.volatility) for r in pick_rows}
    w = inverse_vol_weights(vols)
    return PortfolioPlan(picks=[r.ticker for r in pick_rows], base_weights=w, notes=[])

