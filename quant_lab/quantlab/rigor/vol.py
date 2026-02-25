from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable

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
class EWMAVol:
    lambda_: float
    annualization: int
    vol: np.ndarray


def ewma_vol(
    returns: Iterable[float],
    *,
    lambda_: float = 0.94,
    annualization: int = 252,
    init_var: float | None = None,
) -> EWMAVol:
    """
    RiskMetrics-style EWMA volatility model:
      var_t = λ var_{t-1} + (1-λ) r_{t-1}^2
    """
    if not (0.0 < float(lambda_) < 1.0):
        raise ValueError("lambda_ must be in (0,1)")
    r = _clean_array(returns)
    n = int(r.size)
    if n == 0:
        raise ValueError("ewma_vol: empty returns")

    lam = float(lambda_)
    v = np.empty(n, dtype=float)
    if init_var is None:
        base = float(np.var(r, ddof=0))
        if not math.isfinite(base) or base <= 0.0:
            base = float(np.mean(r**2)) if float(np.mean(r**2)) > 0 else 1e-12
        v0 = base
    else:
        v0 = float(init_var)
    v[0] = v0

    for t in range(1, n):
        v[t] = lam * v[t - 1] + (1.0 - lam) * float(r[t - 1] ** 2)

    vol = np.sqrt(np.maximum(v, 0.0) * float(annualization))
    return EWMAVol(lambda_=lam, annualization=int(annualization), vol=vol)


def garch11_placeholder(*_args: Any, **_kwargs: Any) -> None:
    """
    Placeholder for a future GARCH(1,1) implementation.
    We use EWMA in this repo to keep dependencies light and deterministic.
    """
    raise NotImplementedError("GARCH(1,1) is not implemented (use EWMA via ewma_vol).")

