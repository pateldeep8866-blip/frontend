from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass(frozen=True)
class RiskResult:
    weights: Dict[str, float]  # includes CASH if any residual
    portfolio_vol: float  # annualized estimate
    concentration_hhi: float
    risk_actions: List[str]
    risk_budget: Dict[str, float]
    kill_switch_rules: List[str]


def _normalize(weights: Dict[str, float]) -> Dict[str, float]:
    s = sum(max(0.0, float(w)) for w in weights.values())
    if s <= 0:
        return {}
    return {k: max(0.0, float(v)) / s for k, v in weights.items()}


def portfolio_vol_from_cov(weights: Dict[str, float], cov_annualized: Dict[str, Dict[str, float]]) -> float:
    tickers = [t for t in weights.keys() if t != "CASH"]
    vol2 = 0.0
    for i in tickers:
        wi = float(weights.get(i, 0.0))
        for j in tickers:
            wj = float(weights.get(j, 0.0))
            cij = float(cov_annualized.get(i, {}).get(j, 0.0))
            vol2 += wi * wj * cij
    return float(math.sqrt(max(0.0, vol2)))


def apply_risk_constraints(
    weights: Dict[str, float],
    *,
    max_weight_per_asset: float = 0.25,
    max_portfolio_vol: float = 0.18,
    max_drawdown_limit: float = -0.10,
    cov_annualized: Optional[Dict[str, Dict[str, float]]] = None,
) -> RiskResult:
    actions: List[str] = []

    w = {str(k): float(v) for k, v in weights.items() if float(v) > 0.0 and str(k) != "CASH"}
    w = _normalize(w)

    # Max weight cap: clip and leave residual as CASH (conservative).
    capped = {}
    for t, wt in w.items():
        if float(wt) > float(max_weight_per_asset):
            capped[t] = float(max_weight_per_asset)
            actions.append(f"cap_weight: {t} clipped to {max_weight_per_asset:.2f}")
        else:
            capped[t] = float(wt)

    used = sum(capped.values())
    cash_w = max(0.0, 1.0 - used)
    if cash_w > 1e-12:
        capped["CASH"] = float(cash_w)

    # Portfolio vol constraint: scale risky weights down, increase CASH.
    if cov_annualized is not None and used > 0:
        vol = portfolio_vol_from_cov({k: v for k, v in capped.items() if k != "CASH"}, cov_annualized)
        if math.isfinite(vol) and vol > float(max_portfolio_vol) and vol > 0:
            scale = float(max_portfolio_vol) / float(vol)
            scaled = {}
            for t, wt in capped.items():
                if t == "CASH":
                    continue
                scaled[t] = float(wt * scale)
            used2 = sum(scaled.values())
            cash2 = max(0.0, 1.0 - used2)
            if cash2 > 1e-12:
                scaled["CASH"] = float(cash2)
            capped = scaled
            actions.append(f"scale_vol: scaled risky weights by {scale:.3f} to meet max_portfolio_vol={max_portfolio_vol:.2f}")

    # Final portfolio vol estimate.
    port_vol = float("nan")
    if cov_annualized is not None and any(k != "CASH" for k in capped):
        port_vol = portfolio_vol_from_cov({k: v for k, v in capped.items() if k != "CASH"}, cov_annualized)

    # Concentration (HHI on risky weights only).
    hhi = sum((float(v) ** 2) for k, v in capped.items() if k != "CASH")

    budget = {
        "max_weight_per_asset": float(max_weight_per_asset),
        "max_portfolio_vol": float(max_portfolio_vol),
        "max_drawdown_limit": float(max_drawdown_limit),
    }
    kill = [
        f"ADVISORY: if paper drawdown <= {max_drawdown_limit:.0%}, halt adding risk and reassess.",
        f"ADVISORY: if est. portfolio vol > {max_portfolio_vol:.0%}, reduce exposure (increase CASH).",
    ]

    return RiskResult(
        weights=capped,
        portfolio_vol=float(port_vol),
        concentration_hhi=float(hhi),
        risk_actions=actions,
        risk_budget=budget,
        kill_switch_rules=kill,
    )

