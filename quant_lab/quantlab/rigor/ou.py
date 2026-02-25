from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Tuple

import numpy as np


def _clean_array(xs: Iterable[Any]) -> np.ndarray:
    out = []
    for x in xs:
        try:
            xf = float(x)
        except Exception:
            continue
        if math.isfinite(xf):
            out.append(xf)
    return np.asarray(out, dtype=float)


@dataclass(frozen=True)
class OUHalfLife:
    half_life: float
    beta: float
    intercept: float
    r2: float
    n: int


def ou_half_life(series: Iterable[float]) -> OUHalfLife:
    """
    Estimate OU mean-reversion half-life from a time series using an AR(1) regression:

      Δx_t = a + b * x_{t-1} + ε_t

    For a mean-reverting process, b < 0 and half-life = ln(2) / -b.
    """
    x = _clean_array(series)
    n = int(x.size)
    if n < 20:
        return OUHalfLife(half_life=float("nan"), beta=float("nan"), intercept=float("nan"), r2=float("nan"), n=n)

    x_lag = x[:-1]
    dx = x[1:] - x[:-1]
    m = int(dx.size)
    if m < 10:
        return OUHalfLife(half_life=float("nan"), beta=float("nan"), intercept=float("nan"), r2=float("nan"), n=n)

    X = np.column_stack([np.ones_like(x_lag), x_lag])
    # OLS: beta_hat = (X'X)^{-1} X'y
    XtX = X.T @ X
    try:
        inv = np.linalg.inv(XtX)
    except np.linalg.LinAlgError:
        inv = np.linalg.pinv(XtX)
    bhat = inv @ (X.T @ dx)
    a = float(bhat[0])
    b = float(bhat[1])

    yhat = X @ bhat
    ss_res = float(np.sum((dx - yhat) ** 2))
    ss_tot = float(np.sum((dx - float(dx.mean())) ** 2))
    r2 = float(1.0 - ss_res / ss_tot) if ss_tot > 0 else float("nan")

    if not math.isfinite(b) or b >= 0.0:
        # Not mean reverting (or not identifiable).
        hl = float("inf") if math.isfinite(b) else float("nan")
    else:
        hl = float(math.log(2.0) / (-b))

    return OUHalfLife(half_life=hl, beta=b, intercept=a, r2=r2, n=n)

