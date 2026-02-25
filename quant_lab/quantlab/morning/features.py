from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Optional, Sequence, Tuple

try:
    import pandas as pd  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    pd = None  # type: ignore


@dataclass(frozen=True)
class UniverseFeatures:
    asof: "pd.Timestamp"
    features: Dict[str, Dict[str, float]]  # per-ticker scalar snapshot at `asof`
    returns: Dict[str, "pd.Series"]  # per-ticker log returns up to `asof` (daily)
    closes: Dict[str, "pd.Series"]  # per-ticker close series up to `asof`


def _select_close(df: "pd.DataFrame") -> "pd.Series":
    if "Adj Close" in df.columns and df["Adj Close"].notna().any():
        s = df["Adj Close"]
    else:
        s = df["Close"]
    return s.astype(float)


def _pearson_corr(xs: Sequence[float], ys: Sequence[float]) -> float:
    n = min(len(xs), len(ys))
    if n < 3:
        return float("nan")
    x = [float(v) for v in xs[:n]]
    y = [float(v) for v in ys[:n]]
    mx = sum(x) / float(n)
    my = sum(y) / float(n)
    num = sum((a - mx) * (b - my) for a, b in zip(x, y))
    denx = sum((a - mx) ** 2 for a in x)
    deny = sum((b - my) ** 2 for b in y)
    den = math.sqrt(denx * deny)
    if den == 0.0:
        return float("nan")
    return float(num / den)


def _autocorr(xs: Sequence[float], lag: int) -> float:
    if lag <= 0 or len(xs) <= lag + 2:
        return float("nan")
    return _pearson_corr(xs[lag:], xs[:-lag])


def compute_feature_snapshot(
    prices_by_ticker: Dict[str, "pd.DataFrame"],
    *,
    asof: str,
    short_window: int = 20,
    long_window: int = 50,
    spy_ticker: str = "SPY",
) -> UniverseFeatures:
    """
    Compute physics/signal-processing inspired features per ticker.

    Output contains:
    - `features[ticker]`: scalar snapshot at `asof` (or last bar <= asof)
    - `returns[ticker]`: log return series up to `asof`
    - `closes[ticker]`: close series up to `asof`
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for morning features.")

    if short_window <= 0 or long_window <= 0 or short_window >= long_window:
        raise ValueError("require 0 < short_window < long_window")

    asof_ts = pd.Timestamp(asof)
    closes: Dict[str, "pd.Series"] = {}
    returns: Dict[str, "pd.Series"] = {}

    for t, df in prices_by_ticker.items():
        c = _select_close(df)
        c = c.loc[c.index <= asof_ts]
        c = c.dropna().astype(float)
        if c.empty:
            continue
        closes[t] = c
        # Log returns.
        r = (c / c.shift(1)).apply(lambda x: math.log(float(x)) if x and x > 0 else float("nan"))
        r = r.replace([math.inf, -math.inf], float("nan")).dropna()
        returns[t] = r

    if spy_ticker not in returns:
        raise ValueError(f"spy_ticker={spy_ticker!r} not found in universe data.")

    spy_r = returns[spy_ticker]

    feats: Dict[str, Dict[str, float]] = {}
    sqrt252 = math.sqrt(252.0)

    for t, c in closes.items():
        r = returns.get(t)
        if r is None or r.empty:
            continue

        # Align to `asof` (last available close <= asof).
        last_dt = c.index.max()
        close = float(c.loc[last_dt])

        vol_63 = float(r.rolling(63).std(ddof=0).iloc[-1] * sqrt252) if len(r) >= 2 else float("nan")
        mom_63 = float(r.tail(63).sum()) if len(r) >= 1 else float("nan")
        mom_252 = float(r.tail(252).sum()) if len(r) >= 1 else float("nan")

        ma_s = float(c.rolling(short_window).mean().iloc[-1]) if len(c) >= short_window else float("nan")
        ma_l = float(c.rolling(long_window).mean().iloc[-1]) if len(c) >= long_window else float("nan")

        ma_s_series = c.rolling(short_window).mean()
        ma_slope = float((ma_s_series.iloc[-1] - ma_s_series.shift(5).iloc[-1]) / 5.0) if len(ma_s_series.dropna()) >= 6 else float("nan")

        equity = c / float(c.iloc[0])
        dd = float((equity.iloc[-1] / float(equity.cummax().iloc[-1])) - 1.0) if not equity.empty else float("nan")

        # Correlation to SPY over 63d log returns.
        if t == spy_ticker:
            rho = 1.0
        else:
            joint = pd.concat([r, spy_r], axis=1, join="inner").dropna()
            if len(joint) >= 63:
                rho = float(joint.iloc[-63:, 0].corr(joint.iloc[-63:, 1]))
            else:
                rho = float("nan")

        # Cycle strength proxy: max(|autocorr|) at lags 5/10/20 on recent returns.
        r_list = [float(x) for x in r.tail(252).tolist()]
        cycle = float("nan")
        if len(r_list) >= 50:
            vals = []
            for lag in (5, 10, 20):
                ac = _autocorr(r_list, lag=lag)
                if math.isfinite(ac):
                    vals.append(abs(float(ac)))
            cycle = float(max(vals)) if vals else float("nan")

        feats[t] = {
            "date": float(last_dt.value),  # deterministic scalar encoding of timestamp
            "close": float(close),
            "volatility": float(vol_63),
            "mom_63": float(mom_63),
            "mom_252": float(mom_252),
            "ma_short": float(ma_s),
            "ma_long": float(ma_l),
            "ma_slope": float(ma_slope),
            "drawdown": float(dd),
            "corr_spy_63": float(rho),
            "cycle_score": float(cycle),
        }

    return UniverseFeatures(asof=asof_ts, features=feats, returns=returns, closes=closes)

