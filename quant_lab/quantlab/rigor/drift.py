from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Tuple

import numpy as np


def _clean(x: Iterable[Any]) -> np.ndarray:
    vals = []
    for v in x:
        try:
            f = float(v)
        except Exception:
            continue
        if math.isfinite(f):
            vals.append(f)
    return np.asarray(vals, dtype=float)


def wasserstein_1d(a: Iterable[float], b: Iterable[float]) -> float:
    """
    1D Wasserstein distance via quantile coupling (deterministic).
    """
    x = _clean(a)
    y = _clean(b)
    if x.size == 0 or y.size == 0:
        return float("nan")
    x = np.sort(x)
    y = np.sort(y)
    n = int(max(x.size, y.size))
    q = np.linspace(0.0, 1.0, n, endpoint=True)
    xq = np.quantile(x, q)
    yq = np.quantile(y, q)
    return float(np.mean(np.abs(xq - yq)))


def psi(a: Iterable[float], b: Iterable[float], *, bins: int = 10, eps: float = 1e-6) -> float:
    """
    Population Stability Index (PSI).
    """
    x = _clean(a)
    y = _clean(b)
    if x.size == 0 or y.size == 0:
        return float("nan")
    bins_i = int(max(2, bins))
    # Bin edges from baseline quantiles for robustness.
    edges = np.quantile(x, np.linspace(0.0, 1.0, bins_i + 1))
    edges = np.unique(edges)
    if edges.size < 3:
        # Fallback to min/max range bins.
        lo = float(min(float(x.min()), float(y.min())))
        hi = float(max(float(x.max()), float(y.max())))
        if lo == hi:
            return 0.0
        edges = np.linspace(lo, hi, bins_i + 1)

    x_hist, _ = np.histogram(x, bins=edges)
    y_hist, _ = np.histogram(y, bins=edges)
    x_p = x_hist / float(x_hist.sum())
    y_p = y_hist / float(y_hist.sum())
    x_p = np.clip(x_p, eps, 1.0)
    y_p = np.clip(y_p, eps, 1.0)
    return float(np.sum((y_p - x_p) * np.log(y_p / x_p)))


def mean_shift_z(a: Iterable[float], b: Iterable[float]) -> float:
    x = _clean(a)
    y = _clean(b)
    if x.size < 2 or y.size < 2:
        return float("nan")
    mx = float(x.mean())
    my = float(y.mean())
    sx = float(x.std(ddof=0))
    sy = float(y.std(ddof=0))
    sp = float(math.sqrt(0.5 * (sx * sx + sy * sy)))
    if sp <= 0.0 or not math.isfinite(sp):
        return float("nan")
    return float((my - mx) / sp)


def drift_metrics(
    baseline: Iterable[float],
    recent: Iterable[float],
    *,
    bins: int = 10,
) -> Dict[str, float]:
    """
    Lightweight drift metrics for research monitoring (no SciPy).
    """
    x = _clean(baseline)
    y = _clean(recent)
    return {
        "n_baseline": float(x.size),
        "n_recent": float(y.size),
        "psi": float(psi(x, y, bins=bins)),
        "wasserstein": float(wasserstein_1d(x, y)),
        "mean_shift_z": float(mean_shift_z(x, y)),
        "baseline_mean": float(x.mean()) if x.size else float("nan"),
        "recent_mean": float(y.mean()) if y.size else float("nan"),
        "baseline_vol": float(x.std(ddof=0)) if x.size else float("nan"),
        "recent_vol": float(y.std(ddof=0)) if y.size else float("nan"),
    }

