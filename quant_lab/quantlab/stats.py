from __future__ import annotations

import math
from typing import Iterable, Tuple

try:
    import pandas as pd  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    pd = None  # type: ignore


def equity_returns(equity: pd.Series) -> pd.Series:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for equity/price metrics.")
    equity = equity.astype(float)
    return equity.pct_change().dropna()


def max_drawdown(equity: pd.Series) -> float:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for equity/price metrics.")
    equity = equity.dropna().astype(float)
    if equity.empty:
        return float("nan")
    running_max = equity.cummax()
    dd = (equity / running_max) - 1.0
    return float(dd.min())


def cagr(equity: pd.Series) -> float:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for equity/price metrics.")
    equity = equity.dropna().astype(float)
    if equity.empty:
        return float("nan")
    if not isinstance(equity.index, pd.DatetimeIndex):
        return float("nan")
    start = float(equity.iloc[0])
    end = float(equity.iloc[-1])
    if start <= 0 or end <= 0:
        return float("nan")
    days = (equity.index[-1] - equity.index[0]).days
    years = days / 365.25
    if years <= 0:
        return float("nan")
    return float((end / start) ** (1.0 / years) - 1.0)


def annualized_vol(returns: pd.Series, annualization: int = 252) -> float:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for equity/price metrics.")
    r = returns.dropna().astype(float)
    if r.empty:
        return float("nan")
    return float(r.std(ddof=0) * math.sqrt(float(annualization)))


def sharpe_ratio(
    returns: pd.Series,
    annualization: int = 252,
    risk_free_rate: float = 0.0,
) -> float:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for equity/price metrics.")
    r = returns.dropna().astype(float)
    if r.empty:
        return float("nan")
    rf_daily = float(risk_free_rate) / float(annualization)
    excess = r - rf_daily
    vol = float(excess.std(ddof=0))
    if vol == 0.0:
        return float("nan")
    return float(math.sqrt(float(annualization)) * excess.mean() / vol)


def sortino_ratio(
    returns: pd.Series,
    annualization: int = 252,
    risk_free_rate: float = 0.0,
) -> float:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for equity/price metrics.")
    r = returns.dropna().astype(float)
    if r.empty:
        return float("nan")
    rf_daily = float(risk_free_rate) / float(annualization)
    excess = r - rf_daily
    downside = excess.clip(upper=0.0)
    downside_dev = float((downside**2).mean() ** 0.5)
    if downside_dev == 0.0:
        return float("nan")
    return float(math.sqrt(float(annualization)) * float(excess.mean()) / downside_dev)


def calmar_ratio(cagr_value: float, max_drawdown_value: float) -> float:
    if not math.isfinite(float(cagr_value)) or not math.isfinite(float(max_drawdown_value)):
        return float("nan")
    if max_drawdown_value >= 0:
        return float("nan")
    denom = abs(float(max_drawdown_value))
    if denom == 0.0:
        return float("nan")
    return float(float(cagr_value) / denom)


def hit_rate(returns: pd.Series) -> float:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for equity/price metrics.")
    r = returns.dropna().astype(float)
    if r.empty:
        return float("nan")
    return float((r > 0.0).mean())


def compute_metrics(
    equity: pd.Series,
    *,
    annualization: int = 252,
    risk_free_rate: float = 0.0,
) -> dict[str, float]:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for equity/price metrics.")
    equity = equity.dropna().astype(float)
    if equity.empty:
        raise ValueError("Equity curve is empty.")

    total_return = float((equity.iloc[-1] / equity.iloc[0]) - 1.0)
    rets = equity_returns(equity)
    cagr_v = cagr(equity)
    vol_v = annualized_vol(rets, annualization=annualization)
    sharpe_v = sharpe_ratio(rets, annualization=annualization, risk_free_rate=risk_free_rate)
    sortino_v = sortino_ratio(rets, annualization=annualization, risk_free_rate=risk_free_rate)
    max_dd = max_drawdown(equity)
    calmar_v = calmar_ratio(cagr_v, max_dd)
    hit_v = hit_rate(rets)

    return {
        "total_return": total_return,
        "cagr": float(cagr_v),
        "annualized_vol": float(vol_v),
        "sharpe": float(sharpe_v),
        "sortino": float(sortino_v),
        "max_drawdown": float(max_dd),
        "calmar": float(calmar_v),
        "hit_rate": float(hit_v),
    }


def mean_return_t_stat(returns: Iterable[float]) -> Tuple[float, float]:
    """
    t-stat + (approx) p-value for mean daily returns vs 0.

    Uses a normal approximation for the p-value to avoid extra dependencies.
    """
    xs = []
    for x in returns:
        try:
            xf = float(x)
        except Exception:
            continue
        if math.isfinite(xf):
            xs.append(xf)

    n = int(len(xs))
    if n < 2:
        return 0.0, 1.0

    mu = float(sum(xs) / float(n))
    var = float(sum((x - mu) ** 2 for x in xs) / float(n - 1))
    sd = float(math.sqrt(var))
    if sd == 0.0:
        return 0.0, 1.0

    t = mu / (sd / math.sqrt(float(n)))

    # Two-sided normal approximation.
    z = abs(float(t))
    p = math.erfc(z / math.sqrt(2.0))  # 2*(1 - Phi(z))
    p = float(min(max(p, 0.0), 1.0))
    return float(t), p


def bh_fdr(p_values: Iterable[float], q: float = 0.10) -> list[bool]:
    """
    Benjamini–Hochberg FDR control.

    Returns a boolean array of rejections in the original p-value order.
    """
    p = []
    for x in p_values:
        try:
            xf = float(x)
        except Exception:
            xf = 1.0
        if not math.isfinite(xf):
            xf = 1.0
        xf = min(max(xf, 0.0), 1.0)
        p.append(xf)

    m = int(len(p))
    if m == 0:
        return []

    order = sorted(range(m), key=lambda i: p[i])
    p_sorted = [p[i] for i in order]
    thresh = [(float(i + 1) / float(m)) * float(q) for i in range(m)]

    k = -1
    for i, (pv, tv) in enumerate(zip(p_sorted, thresh)):
        if pv <= tv:
            k = i

    reject_sorted = [i <= k for i in range(m)]
    reject = [False] * m
    for rank, orig_i in enumerate(order):
        reject[orig_i] = bool(reject_sorted[rank])
    return reject
