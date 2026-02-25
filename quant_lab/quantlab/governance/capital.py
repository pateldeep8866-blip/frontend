from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


def _clean_weights(weights: Dict[str, float]) -> Dict[str, float]:
    out: Dict[str, float] = {}
    for k, v in (weights or {}).items():
        kk = str(k).upper().strip()
        if not kk:
            continue
        try:
            vf = float(v)
        except Exception:
            continue
        if not math.isfinite(vf):
            continue
        out[kk] = float(vf)
    return out


def _normalize_with_cash(weights: Dict[str, float]) -> Dict[str, float]:
    risky = {k: max(0.0, float(v)) for k, v in weights.items() if k != "CASH"}
    s = sum(risky.values())
    if s <= 0.0:
        return {"CASH": 1.0}
    risky = {k: float(v) / s for k, v in risky.items()}
    cash = max(0.0, 1.0 - sum(risky.values()))
    if cash > 1e-12:
        risky["CASH"] = float(cash)
    return risky


def _cap_weights(weights: Dict[str, float], *, max_weight_per_asset: float) -> Tuple[Dict[str, float], List[str]]:
    actions: List[str] = []
    risky = {k: float(v) for k, v in weights.items() if k != "CASH"}
    capped: Dict[str, float] = {}
    for k, v in risky.items():
        if v > float(max_weight_per_asset):
            capped[k] = float(max_weight_per_asset)
            actions.append(f"cap_weight: {k} clipped to {max_weight_per_asset:.2f}")
        else:
            capped[k] = float(v)
    cash = max(0.0, 1.0 - sum(capped.values()))
    if cash > 1e-12:
        capped["CASH"] = float(cash)
    return capped, actions


def turnover(prev: Dict[str, float], new: Dict[str, float]) -> float:
    keys = set(prev.keys()) | set(new.keys())
    tot = 0.0
    for k in keys:
        tot += abs(float(new.get(k, 0.0)) - float(prev.get(k, 0.0)))
    return float(0.5 * tot)


def _blend_turnover(prev: Dict[str, float], new: Dict[str, float], *, max_turnover: float) -> Tuple[Dict[str, float], float, float]:
    """
    Blend `new` towards `prev` to meet a max turnover cap.

    Returns: (blended_weights, turnover_before, alpha)
    """
    prev = _normalize_with_cash(prev)
    new = _normalize_with_cash(new)
    t = turnover(prev, new)
    if t <= float(max_turnover) or t <= 0.0:
        return new, float(t), 1.0
    alpha = float(max_turnover) / float(t)
    keys = set(prev.keys()) | set(new.keys())
    blended = {k: float(prev.get(k, 0.0) + alpha * (new.get(k, 0.0) - prev.get(k, 0.0))) for k in keys}
    blended = _normalize_with_cash(blended)
    return blended, float(t), float(alpha)


@dataclass(frozen=True)
class GovernanceResult:
    weights: Dict[str, float]
    actions: List[str]
    # Optional diagnostics:
    regime_scale: float
    turnover_before: Optional[float]
    turnover_alpha: Optional[float]


def apply_capital_governance(
    weights: Dict[str, float],
    *,
    regime_label: str,
    regime_confidence: float,
    max_weight_per_asset: float = 0.25,
    risk_off_scale: float = 1.0,
    vol_target: Optional[float] = None,
    cov_annualized: Optional[Dict[str, Dict[str, float]]] = None,
    max_turnover: Optional[float] = None,
    prev_weights: Optional[Dict[str, float]] = None,
) -> GovernanceResult:
    """
    Paper-only capital governance layer.

    This function is deterministic and conservative:
    - It can scale down exposure under risk_off regimes (adds CASH).
    - It optionally targets a max portfolio volatility by scaling down risky weights (adds CASH).
    - It optionally caps day-over-day turnover by blending with previous weights.
    - Always enforces max_weight_per_asset caps.
    """
    actions: List[str] = []
    w = _normalize_with_cash(_clean_weights(weights))

    # 1) Regime-conditioned capital scaling (scale risky weights down, add CASH).
    scale = 1.0
    if str(regime_label).strip().lower() == "risk_off":
        # Confidence-weight the scale so low confidence regimes don't overreact.
        conf = float(regime_confidence) if math.isfinite(float(regime_confidence)) else 0.0
        conf = min(max(conf, 0.0), 1.0)
        base = float(min(max(float(risk_off_scale), 0.0), 1.0))
        scale = 1.0 - (1.0 - base) * conf
        if scale < 1.0 - 1e-12:
            actions.append(f"regime_scale: risk_off scale={scale:.3f} (base={base:.3f}, conf={conf:.3f})")

        scaled = {k: float(v) * float(scale) for k, v in w.items() if k != "CASH"}
        cash = max(0.0, 1.0 - sum(scaled.values()))
        scaled["CASH"] = float(cash)
        w = _normalize_with_cash(scaled)

    # 2) Optional volatility targeting (no leverage; only scales down).
    if vol_target is not None and cov_annualized is not None:
        try:
            from quantlab.morning.risk import portfolio_vol_from_cov

            risky = {k: v for k, v in w.items() if k != "CASH"}
            vol = float(portfolio_vol_from_cov(risky, cov_annualized))
            if math.isfinite(vol) and vol > 0 and vol > float(vol_target):
                s = float(vol_target) / float(vol)
                risky2 = {k: float(v) * s for k, v in risky.items()}
                cash = max(0.0, 1.0 - sum(risky2.values()))
                risky2["CASH"] = float(cash)
                w = _normalize_with_cash(risky2)
                actions.append(f"vol_target: scaled risky weights by {s:.3f} to meet vol_target={float(vol_target):.2f}")
        except Exception as e:
            actions.append(f"vol_target: skipped due to error: {e}")

    # 3) Optional max turnover cap (requires prev weights).
    t_before: Optional[float] = None
    alpha: Optional[float] = None
    if max_turnover is not None and prev_weights:
        blended, t, a = _blend_turnover(prev_weights, w, max_turnover=float(max_turnover))
        t_before = float(t)
        alpha = float(a)
        if t_before > float(max_turnover) + 1e-12:
            # Shouldn't happen, but keep fail-loud semantics for strict callers.
            actions.append(f"turnover_cap: WARNING turnover still high (t={t_before:.3f} cap={float(max_turnover):.3f})")
        if alpha < 1.0 - 1e-12:
            actions.append(f"turnover_cap: blended towards prev (alpha={alpha:.3f}, t_before={t_before:.3f}, cap={float(max_turnover):.3f})")
        w = blended

    # 4) Enforce max weight caps (conservative: residual goes to CASH).
    w, cap_actions = _cap_weights(w, max_weight_per_asset=float(max_weight_per_asset))
    actions.extend(cap_actions)
    w = _normalize_with_cash(w)

    return GovernanceResult(
        weights=w,
        actions=actions,
        regime_scale=float(scale),
        turnover_before=t_before,
        turnover_alpha=alpha,
    )

