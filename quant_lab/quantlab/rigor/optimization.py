from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Optional

import numpy as np


def _as_1d(x: Any) -> np.ndarray:
    a = np.asarray(x, dtype=float).reshape(-1)
    if a.size == 0:
        raise ValueError("Empty vector")
    if not np.isfinite(a).all():
        raise ValueError("Vector contains NaN/inf")
    return a


def _as_cov(cov: Any) -> np.ndarray:
    A = np.asarray(cov, dtype=float)
    if A.ndim != 2 or A.shape[0] != A.shape[1]:
        raise ValueError("cov must be square")
    if not np.isfinite(A).all():
        raise ValueError("cov contains NaN/inf")
    return 0.5 * (A + A.T)


def _cap_and_renormalize(w: np.ndarray, *, max_weight: float) -> np.ndarray:
    """
    Deterministic projection onto the capped simplex:
      w_i in [0, max_weight], sum w_i = 1
    """
    if max_weight <= 0:
        raise ValueError("max_weight must be > 0")

    n = int(w.size)
    w = np.maximum(w, 0.0)
    if w.sum() <= 0:
        w = np.full(n, 1.0 / n)
    else:
        w = w / w.sum()

    cap = float(max_weight)
    # Iteratively cap overweight names and redistribute.
    active = np.ones(n, dtype=bool)
    w_out = w.copy()
    for _ in range(n + 1):
        over = w_out > cap + 1e-12
        if not np.any(over):
            break
        w_out[over] = cap
        active = ~over
        rem = 1.0 - float(w_out[~active].sum())
        if rem <= 0:
            # All capped; renormalize (edge case if cap*n < 1).
            w_out = w_out / float(w_out.sum())
            break
        if not np.any(active):
            break
        w_act = w_out[active]
        if w_act.sum() <= 0:
            w_out[active] = rem / float(active.sum())
        else:
            w_out[active] = w_act / float(w_act.sum()) * rem
    # Final normalization.
    s = float(w_out.sum())
    if s <= 0:
        w_out = np.full(n, 1.0 / n)
    else:
        w_out = w_out / s
    return w_out


@dataclass(frozen=True)
class MVWeights:
    weights: np.ndarray
    method: str


def mean_variance_weights(
    mu: Any,
    cov: Any,
    *,
    risk_aversion: float = 1.0,
    max_weight: float = 0.25,
    ridge: float = 1e-6,
) -> MVWeights:
    """
    Mean-variance long-only weights with max-weight cap.

    Closed-form unconstrained solution w ~ inv(cov) mu, then project to capped simplex.
    """
    m = _as_1d(mu)
    C = _as_cov(cov)
    n = int(m.size)
    if C.shape != (n, n):
        raise ValueError("mu and cov dimension mismatch")

    lam = float(risk_aversion)
    if lam <= 0:
        raise ValueError("risk_aversion must be > 0")

    A = C + float(ridge) * np.eye(n, dtype=float)
    try:
        w = np.linalg.solve(A, m)
        method = "solve"
    except np.linalg.LinAlgError:
        w = np.linalg.pinv(A) @ m
        method = "pinv"

    # Scale by risk_aversion (equivalent to changing leverage; projection re-normalizes).
    w = w / lam
    w = _cap_and_renormalize(w, max_weight=float(max_weight))
    return MVWeights(weights=w, method=method)


@dataclass(frozen=True)
class RiskParity:
    weights: np.ndarray
    converged: bool
    iters: int


def risk_parity_weights(
    cov: Any,
    *,
    max_weight: float = 0.25,
    tol: float = 1e-8,
    max_iter: int = 2000,
) -> RiskParity:
    """
    Risk parity weights (long-only) via deterministic fixed-point iteration.

    Objective: equalize risk contributions approximately.
    """
    C = _as_cov(cov)
    n = int(C.shape[0])
    # Start from inverse-vol (good initialization).
    vol = np.sqrt(np.maximum(np.diag(C), 1e-18))
    w = 1.0 / vol
    w = _cap_and_renormalize(w, max_weight=float(max_weight))

    converged = False
    for it in range(int(max_iter)):
        # Marginal contribution: (C w)
        mc = C @ w
        port_var = float(w @ mc)
        if port_var <= 0 or not math.isfinite(port_var):
            break
        rc = w * mc
        target = port_var / float(n)
        # Multiplicative update; clip to avoid instability.
        adj = np.clip(target / np.maximum(rc, 1e-18), 0.2, 5.0)
        w_new = w * adj
        w_new = _cap_and_renormalize(w_new, max_weight=float(max_weight))
        diff = float(np.max(np.abs(w_new - w)))
        w = w_new
        if diff < float(tol):
            converged = True
            return RiskParity(weights=w, converged=True, iters=it + 1)
    return RiskParity(weights=w, converged=converged, iters=int(max_iter))


def risk_contributions(weights: Any, cov: Any) -> Dict[str, float]:
    w = _as_1d(weights)
    C = _as_cov(cov)
    if C.shape != (w.size, w.size):
        raise ValueError("weights/cov dimension mismatch")
    mc = C @ w
    port_var = float(w @ mc)
    if port_var <= 0 or not math.isfinite(port_var):
        return {"portfolio_var": float("nan")}
    rc = w * mc / port_var
    out = {"portfolio_var": float(port_var)}
    for i, v in enumerate(rc):
        out[f"rc_{i}"] = float(v)
    return out

