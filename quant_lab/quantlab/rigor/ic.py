from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence

import numpy as np


def _rankdata(x: np.ndarray) -> np.ndarray:
    """
    Dense ranking with average ranks for ties (deterministic).
    """
    n = int(x.size)
    order = np.argsort(x, kind="mergesort")
    ranks = np.empty(n, dtype=float)
    i = 0
    while i < n:
        j = i
        while j + 1 < n and x[order[j + 1]] == x[order[i]]:
            j += 1
        r = 0.5 * (i + j) + 1.0
        ranks[order[i : j + 1]] = r
        i = j + 1
    return ranks


def _spearman_corr(x: np.ndarray, y: np.ndarray) -> float:
    if x.size != y.size:
        raise ValueError("Spearman corr: size mismatch")
    n = int(x.size)
    if n < 3:
        return float("nan")
    rx = _rankdata(x)
    ry = _rankdata(y)
    # Pearson on ranks
    rx = rx - rx.mean()
    ry = ry - ry.mean()
    denom = float(np.sqrt(np.dot(rx, rx) * np.dot(ry, ry)))
    if denom <= 0 or not math.isfinite(denom):
        return float("nan")
    return float(np.dot(rx, ry) / denom)


@dataclass(frozen=True)
class ICResult:
    ic: Dict[Any, float]
    mean: float
    n: int


def rank_ic(
    scores: Any,
    fwd_returns: Any,
    *,
    min_obs: int = 5,
) -> ICResult:
    """
    Compute daily cross-sectional Rank IC (Spearman) between `scores[t]` and `fwd_returns[t]`.

    Inputs:
      - scores: DataFrame-like (index time, columns assets)
      - fwd_returns: DataFrame-like aligned to scores (same index/columns)
    """
    import pandas as pd  # type: ignore

    s = pd.DataFrame(scores).copy()
    r = pd.DataFrame(fwd_returns).copy()
    s, r = s.align(r, join="inner", axis=0)
    s, r = s.align(r, join="inner", axis=1)

    out: Dict[Any, float] = {}
    vals = []
    for t in s.index:
        xs = pd.to_numeric(s.loc[t], errors="coerce").astype(float)
        ys = pd.to_numeric(r.loc[t], errors="coerce").astype(float)
        m = xs.notna() & ys.notna()
        if int(m.sum()) < int(min_obs):
            continue
        ic = _spearman_corr(xs[m].to_numpy(), ys[m].to_numpy())
        if math.isfinite(ic):
            out[t] = float(ic)
            vals.append(float(ic))
    mean = float(np.mean(vals)) if vals else float("nan")
    return ICResult(ic=out, mean=mean, n=int(len(vals)))


def rolling_ic_decay(
    scores: Any,
    returns: Any,
    *,
    horizons: Sequence[int] = (1, 5, 20),
    window: int = 252,
    min_obs: int = 5,
) -> Any:
    """
    Rolling IC decay: for each horizon h, compute rolling mean Rank IC of score[t] vs return[t+h].

    Returns: pandas DataFrame indexed by date with columns "ic_h{h}".
    """
    import pandas as pd  # type: ignore

    s = pd.DataFrame(scores).copy()
    r = pd.DataFrame(returns).copy()
    s, r = s.align(r, join="inner", axis=0)
    s, r = s.align(r, join="inner", axis=1)

    cols = {}
    for h in horizons:
        h = int(h)
        if h <= 0:
            continue
        fwd = r.shift(-h)
        ic_res = rank_ic(s, fwd, min_obs=min_obs)
        ic_series = pd.Series(ic_res.ic).sort_index()
        cols[f"ic_h{h}"] = ic_series.rolling(int(window), min_periods=max(10, int(window) // 4)).mean()

    if not cols:
        return pd.DataFrame(index=s.index)
    out = pd.DataFrame(cols)
    # Keep full input index for consistent alignment (missing forward returns become NaN).
    out = out.reindex(s.index).sort_index()
    return out
