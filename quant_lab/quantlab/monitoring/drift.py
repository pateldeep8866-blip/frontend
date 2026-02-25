from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Optional, Sequence, Tuple

try:
    import pandas as pd  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    pd = None  # type: ignore


def ks_statistic(x: Sequence[float], y: Sequence[float]) -> float:
    """
    Two-sample Kolmogorov–Smirnov D statistic (no p-value; deterministic).

    Returns D in [0, 1]. Raises ValueError on empty inputs.
    """
    xs = sorted([float(v) for v in x])
    ys = sorted([float(v) for v in y])
    nx = len(xs)
    ny = len(ys)
    if nx == 0 or ny == 0:
        raise ValueError("ks_statistic requires non-empty samples")

    i = 0
    j = 0
    d = 0.0
    while i < nx and j < ny:
        if xs[i] <= ys[j]:
            i += 1
        else:
            j += 1
        fx = i / nx
        fy = j / ny
        d = max(d, abs(fx - fy))

    # Exhaust the tail.
    while i < nx:
        i += 1
        d = max(d, abs((i / nx) - (j / ny)))
    while j < ny:
        j += 1
        d = max(d, abs((i / nx) - (j / ny)))

    return float(max(0.0, min(1.0, d)))


@dataclass(frozen=True)
class DriftReport:
    drift_flag: bool
    # Sub-tests:
    ks_shift: Dict[str, Any]
    ic_decay: Dict[str, Any]
    sharpe_breakdown: Dict[str, Any]
    vol_regime: Dict[str, Any]


def _slice_windows(
    s: "pd.Series",
    *,
    baseline_window: int,
    recent_window: int,
    asof: Optional["pd.Timestamp"] = None,
) -> Tuple["pd.Series", "pd.Series"]:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for drift monitoring")

    r = s.dropna().astype(float)
    if asof is not None:
        r = r.loc[r.index <= asof]
    need = int(baseline_window) + int(recent_window)
    if r.shape[0] < need:
        raise ValueError(f"not enough data: need {need}, have {r.shape[0]}")
    base = r.iloc[-need : -int(recent_window)]
    recent = r.iloc[-int(recent_window) :]
    return base, recent


def ks_shift_test(
    s: "pd.Series",
    *,
    baseline_window: int = 252,
    recent_window: int = 63,
    asof: Optional["pd.Timestamp"] = None,
    ks_threshold: float = 0.20,
) -> Dict[str, Any]:
    """
    Feature distribution shift via two-sample KS D statistic: recent vs baseline window.
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for drift monitoring")

    try:
        base, recent = _slice_windows(s, baseline_window=baseline_window, recent_window=recent_window, asof=asof)
    except Exception as e:
        return {
            "status": "insufficient_data",
            "error": str(e),
            "drift": False,
        }

    d = ks_statistic(base.to_numpy(), recent.to_numpy())
    drift = bool(d >= float(ks_threshold))
    return {
        "status": "ok",
        "ks_d": float(d),
        "ks_threshold": float(ks_threshold),
        "n_baseline": int(base.shape[0]),
        "n_recent": int(recent.shape[0]),
        "drift": drift,
    }


def vol_regime_change_detection(
    returns: "pd.Series",
    *,
    baseline_window: int = 252,
    recent_window: int = 63,
    asof: Optional["pd.Timestamp"] = None,
    annualization: int = 252,
    vol_ratio_threshold: float = 1.50,
) -> Dict[str, Any]:
    """
    Volatility regime change: compare recent annualized vol vs baseline annualized vol.
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for drift monitoring")

    try:
        base, recent = _slice_windows(returns, baseline_window=baseline_window, recent_window=recent_window, asof=asof)
    except Exception as e:
        return {"status": "insufficient_data", "error": str(e), "drift": False}

    sqrt_a = float(math.sqrt(float(annualization)))
    vb = float(base.std(ddof=0) * sqrt_a) if base.shape[0] >= 2 else float("nan")
    vr = float(recent.std(ddof=0) * sqrt_a) if recent.shape[0] >= 2 else float("nan")
    ratio = float(vr / vb) if vb > 0 and math.isfinite(vb) and math.isfinite(vr) else float("nan")
    drift = bool(math.isfinite(ratio) and ratio >= float(vol_ratio_threshold))
    return {
        "status": "ok",
        "vol_baseline": vb,
        "vol_recent": vr,
        "vol_ratio": ratio,
        "vol_ratio_threshold": float(vol_ratio_threshold),
        "drift": drift,
    }


def sharpe_breakdown_detection(
    returns: "pd.Series",
    *,
    baseline_window: int = 252,
    recent_window: int = 63,
    asof: Optional["pd.Timestamp"] = None,
    annualization: int = 252,
    min_recent_sharpe: float = 0.0,
    max_drop: float = 0.75,
) -> Dict[str, Any]:
    """
    Sharpe breakdown: detect large deterioration from baseline.

    Drift if:
    - recent Sharpe < min_recent_sharpe, OR
    - recent Sharpe < baseline Sharpe - max_drop
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for drift monitoring")

    try:
        base, recent = _slice_windows(returns, baseline_window=baseline_window, recent_window=recent_window, asof=asof)
    except Exception as e:
        return {"status": "insufficient_data", "error": str(e), "drift": False}

    def _sh(s: "pd.Series") -> float:
        mu = float(s.mean())
        sd = float(s.std(ddof=0))
        if sd <= 0:
            return 0.0
        return float((mu / sd) * math.sqrt(float(annualization)))

    sb = _sh(base)
    sr = _sh(recent)
    drift = bool((sr < float(min_recent_sharpe)) or (sr < (sb - float(max_drop))))
    return {
        "status": "ok",
        "sharpe_baseline": float(sb),
        "sharpe_recent": float(sr),
        "min_recent_sharpe": float(min_recent_sharpe),
        "max_drop": float(max_drop),
        "drift": drift,
    }


def ic_decay_detection(
    ic_series: "pd.Series",
    *,
    baseline_window: int = 252,
    recent_window: int = 63,
    asof: Optional["pd.Timestamp"] = None,
    min_recent_ic: float = 0.0,
    min_ratio: float = 0.50,
) -> Dict[str, Any]:
    """
    IC decay detection on a single IC time series (e.g., daily rank IC for a score).

    Drift if:
    - recent mean IC < min_recent_ic, OR
    - recent mean IC < min_ratio * baseline mean IC (when baseline > 0)
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for drift monitoring")

    try:
        base, recent = _slice_windows(ic_series, baseline_window=baseline_window, recent_window=recent_window, asof=asof)
    except Exception as e:
        return {"status": "insufficient_data", "error": str(e), "drift": False}

    mb = float(base.mean())
    mr = float(recent.mean())
    drift = False
    if math.isfinite(mr) and mr < float(min_recent_ic):
        drift = True
    if math.isfinite(mb) and mb > 0 and math.isfinite(mr) and mr < float(min_ratio) * mb:
        drift = True
    return {
        "status": "ok",
        "ic_mean_baseline": float(mb),
        "ic_mean_recent": float(mr),
        "min_recent_ic": float(min_recent_ic),
        "min_ratio": float(min_ratio),
        "drift": bool(drift),
    }


def compute_drift_report(
    *,
    spy_returns: "pd.Series",
    score_ic: Optional["pd.Series"] = None,
    strategy_returns: Optional["pd.Series"] = None,
    asof: Optional["pd.Timestamp"] = None,
) -> DriftReport:
    """
    Compute a drift report combining:
    - feature/return distribution shift (KS on SPY returns)
    - IC decay (if provided)
    - Sharpe breakdown (if provided)
    - Vol regime change (SPY returns)
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for drift monitoring")

    ks = ks_shift_test(spy_returns, asof=asof)
    vol = vol_regime_change_detection(spy_returns, asof=asof)
    ic = ic_decay_detection(score_ic, asof=asof) if score_ic is not None else {"status": "skipped", "drift": False}
    sh = (
        sharpe_breakdown_detection(strategy_returns, asof=asof)
        if strategy_returns is not None
        else {"status": "skipped", "drift": False}
    )

    drift_flag = bool(ks.get("drift")) or bool(vol.get("drift")) or bool(ic.get("drift")) or bool(sh.get("drift"))
    return DriftReport(
        drift_flag=bool(drift_flag),
        ks_shift=dict(ks),
        ic_decay=dict(ic),
        sharpe_breakdown=dict(sh),
        vol_regime=dict(vol),
    )

