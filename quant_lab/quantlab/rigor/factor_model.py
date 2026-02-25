from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from quantlab.rigor.validation import newey_west_t_stat_mean


def _align_panels(
    returns: Any,
    exposures: Dict[str, Any],
) -> tuple[Any, Dict[str, Any]]:
    import pandas as pd  # type: ignore

    r = pd.DataFrame(returns).copy()
    exps = {k: pd.DataFrame(v).copy() for k, v in exposures.items()}

    # Align all on index/columns.
    for k in list(exps.keys()):
        exps[k], r = exps[k].align(r, join="inner", axis=0)
        exps[k], r = exps[k].align(r, join="inner", axis=1)

    return r, exps


def _ols_beta(y: np.ndarray, X: np.ndarray) -> np.ndarray:
    # Deterministic OLS using pinv for numerical safety.
    return np.linalg.pinv(X) @ y


@dataclass(frozen=True)
class FamaMacBethResult:
    betas_ts: Any  # pandas DataFrame (time x factors+intercept)
    mean_betas: Dict[str, float]
    t_stats_nw: Dict[str, float]
    p_values: Dict[str, float]
    n_periods: int


def fama_macbeth(
    returns: Any,
    exposures: Dict[str, Any],
    *,
    horizon: int = 1,
    nw_lags: Optional[int] = 5,
    min_assets: int = 5,
) -> FamaMacBethResult:
    """
    Fama-MacBeth cross-sectional regression:
      r_{i,t+h} = a_t + sum_k beta_{k,t} x_{k,i,t} + e_{i,t+h}

    Inputs:
      - returns: DataFrame-like (index time, columns assets), daily returns.
      - exposures: dict factor -> DataFrame-like (index time, columns assets).
    """
    import pandas as pd  # type: ignore

    if int(horizon) <= 0:
        raise ValueError("horizon must be > 0")
    r, exps = _align_panels(returns, exposures)
    h = int(horizon)

    y_panel = r.shift(-h)
    factors = list(sorted(exps.keys()))
    if not factors:
        raise ValueError("No exposures provided")

    rows = []
    idx = []
    for t in r.index:
        y = pd.to_numeric(y_panel.loc[t], errors="coerce").astype(float)
        Xcols = []
        for f in factors:
            x = pd.to_numeric(exps[f].loc[t], errors="coerce").astype(float)
            Xcols.append(x)
        X = pd.concat(Xcols, axis=1)
        X.columns = factors

        m = y.notna()
        for f in factors:
            m = m & X[f].notna()

        if int(m.sum()) < int(max(min_assets, len(factors) + 2)):
            continue

        yv = y[m].to_numpy(dtype=float)
        Xv = X.loc[m, :].to_numpy(dtype=float)
        # Add intercept.
        Xv = np.column_stack([np.ones(Xv.shape[0], dtype=float), Xv])
        b = _ols_beta(yv, Xv)
        rows.append([float(x) for x in b.tolist()])
        idx.append(t)

    if not rows:
        raise ValueError("Fama-MacBeth: no valid cross-sectional regressions (insufficient data).")

    cols = ["intercept"] + factors
    betas_ts = pd.DataFrame(rows, index=pd.Index(idx, name="date"), columns=cols).sort_index()

    mean_betas = {c: float(betas_ts[c].mean()) for c in cols}
    t_stats_nw = {}
    p_values = {}
    for c in cols:
        t_stat, p_val, _se = newey_west_t_stat_mean(betas_ts[c].to_numpy(), lags=nw_lags)
        t_stats_nw[c] = float(t_stat)
        p_values[c] = float(p_val)

    return FamaMacBethResult(
        betas_ts=betas_ts,
        mean_betas=mean_betas,
        t_stats_nw=t_stats_nw,
        p_values=p_values,
        n_periods=int(betas_ts.shape[0]),
    )


@dataclass(frozen=True)
class ResidualAlpha:
    alpha: Any  # pandas Series indexed by asset
    t_stat: Any  # pandas Series indexed by asset
    p_value: Any  # pandas Series indexed by asset


def residual_alpha(
    returns: Any,
    exposures: Dict[str, Any],
    betas_ts: Any,
    *,
    horizon: int = 1,
    nw_lags: Optional[int] = 5,
) -> ResidualAlpha:
    """
    Compute residual returns and per-asset residual alpha (mean residual), with NW t-stats.
    """
    import pandas as pd  # type: ignore

    r, exps = _align_panels(returns, exposures)
    b = pd.DataFrame(betas_ts).copy().sort_index()
    h = int(horizon)

    y_panel = r.shift(-h)
    factors = [c for c in b.columns if c != "intercept"]

    # Align betas to exposures index.
    b, y_panel = b.align(y_panel, join="inner", axis=0)
    for f in factors:
        exps[f], y_panel = pd.DataFrame(exps[f]).align(y_panel, join="inner", axis=0)

    residuals = pd.DataFrame(index=y_panel.index, columns=y_panel.columns, dtype=float)

    for t in y_panel.index:
        y = pd.to_numeric(y_panel.loc[t], errors="coerce").astype(float)
        pred = pd.Series(float(b.loc[t, "intercept"]), index=y.index, dtype=float)
        for f in factors:
            x = pd.to_numeric(exps[f].loc[t], errors="coerce").astype(float)
            pred = pred + float(b.loc[t, f]) * x
        residuals.loc[t, :] = (y - pred).to_numpy(dtype=float)

    # Per-asset alpha (mean residual).
    alpha = residuals.mean(axis=0).astype(float)
    t_stat = {}
    p_val = {}
    for a in residuals.columns:
        ts, pv, _ = newey_west_t_stat_mean(residuals[a].to_numpy(), lags=nw_lags)
        t_stat[a] = float(ts)
        p_val[a] = float(pv)

    return ResidualAlpha(alpha=alpha, t_stat=pd.Series(t_stat), p_value=pd.Series(p_val))

