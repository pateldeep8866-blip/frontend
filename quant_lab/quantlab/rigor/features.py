from __future__ import annotations

import math
from typing import Any, Iterable, Tuple

import numpy as np


def _clean_array(x: Iterable[Any]) -> np.ndarray:
    out = []
    for v in x:
        try:
            f = float(v)
        except Exception:
            continue
        if math.isfinite(f):
            out.append(f)
    return np.asarray(out, dtype=float)


def log_returns(prices: Iterable[float]) -> np.ndarray:
    p = _clean_array(prices)
    if p.size < 2:
        return np.asarray([], dtype=float)
    if np.any(p <= 0):
        raise ValueError("prices must be > 0 for log returns")
    lp = np.log(p)
    return np.diff(lp)


def momentum_acceleration(prices: Iterable[float]) -> np.ndarray:
    """
    Momentum acceleration proxy: 2nd derivative of log-price.

      a_t = Δ^2 log(P_t) = log(P_t) - 2 log(P_{t-1}) + log(P_{t-2})
    """
    p = _clean_array(prices)
    if p.size < 3:
        return np.asarray([], dtype=float)
    if np.any(p <= 0):
        raise ValueError("prices must be > 0 for log acceleration")
    lp = np.log(p)
    # second difference
    return np.diff(lp, n=2)

