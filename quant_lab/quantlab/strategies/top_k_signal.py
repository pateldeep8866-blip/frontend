from __future__ import annotations

"""
Top-K Signal Strategy (Research/Paper-Only)
==========================================

This module computes a probabilistic stock pick list using a small set of common
quant signals (multi-horizon momentum, volatility, liquidity) combined with a
simple linear predictive model (OLS) trained on historical panel data.

Notes / Constraints:
- Data access MUST go through `quantlab.data_cache.get_prices_cached` which uses
  the provider abstraction and caching layer (no direct `yfinance` import here).
- Deterministic: OLS via `numpy.linalg.lstsq` (no stochastic components).
- Offline-first: Optional value proxy is loaded from local files if present.

Example:
  >>> from quantlab.strategies.top_k_signal import compute_top_k_signals
  >>> df = compute_top_k_signals(["SPY", "QQQ", "IWM"], start="2018-01-01", end="2024-12-31", k=2)
  >>> df[["ticker", "score", "prob_up"]]
"""

import math
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
import pandas as pd

from quantlab.data_cache import get_prices_cached


def _select_close(df: pd.DataFrame) -> pd.Series:
    if "Adj Close" in df.columns and df["Adj Close"].notna().any():
        s = df["Adj Close"]
    else:
        s = df["Close"]
    s = pd.to_numeric(s, errors="coerce").astype(float)
    # Standardize timezone handling to keep indexes comparable.
    if getattr(s.index, "tz", None) is not None:
        s.index = s.index.tz_convert(None)
    return s


def _select_volume(df: pd.DataFrame) -> pd.Series:
    if "Volume" not in df.columns:
        return pd.Series(index=df.index, dtype=float)
    s = pd.to_numeric(df["Volume"], errors="coerce").astype(float)
    if getattr(s.index, "tz", None) is not None:
        s.index = s.index.tz_convert(None)
    return s


def _phi(x: float) -> float:
    """Standard normal CDF via erf (no scipy)."""
    if not math.isfinite(x):
        return float("nan")
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _cs_z(s: pd.Series) -> pd.Series:
    """
    Cross-sectional z-score per date group.

    If std==0 (or not finite), returns zeros to avoid NaN propagation.
    """
    s = pd.to_numeric(s, errors="coerce").astype(float)
    m = float(s.mean(skipna=True)) if len(s) else float("nan")
    sd = float(s.std(ddof=0, skipna=True)) if len(s) else float("nan")
    if not math.isfinite(sd) or sd <= 0.0:
        return s * 0.0
    return (s - m) / sd


def _load_value_proxy(
    *,
    project_root: Path,
    asof: pd.Timestamp,
    tickers: Iterable[str],
) -> Dict[str, float]:
    """
    Optional local value proxy loader.

    Looks for:
      - data/value_proxy.csv
      - data/value_proxy.parquet

    Expected formats (best-effort):
      1) Columns include `ticker` and one numeric column (e.g., `bm`, `fcf_yield`, `value`).
      2) Optional `date` column; if present, uses the last row per ticker with date <= asof.

    Returns {ticker: value_proxy}. Missing tickers are omitted.
    """
    path_csv = project_root / "data" / "value_proxy.csv"
    path_pq = project_root / "data" / "value_proxy.parquet"
    src: Optional[Path] = None
    if path_pq.exists():
        src = path_pq
    elif path_csv.exists():
        src = path_csv
    else:
        return {}

    try:
        if src.suffix.lower() == ".parquet":
            df = pd.read_parquet(src)
        else:
            df = pd.read_csv(src)
    except Exception:
        return {}

    if df is None or df.empty:
        return {}

    cols_l = {str(c).strip().lower(): c for c in df.columns}
    if "ticker" not in cols_l:
        return {}
    tcol = cols_l["ticker"]

    dcol = cols_l.get("date")
    if dcol is not None:
        try:
            df[dcol] = pd.to_datetime(df[dcol])
        except Exception:
            dcol = None

    # Find first usable numeric column besides ticker/date.
    candidate_cols: List[str] = []
    for c in df.columns:
        if c == tcol or (dcol is not None and c == dcol):
            continue
        candidate_cols.append(c)

    vcol: Optional[str] = None
    for c in candidate_cols:
        s = pd.to_numeric(df[c], errors="coerce")
        if s.notna().any():
            vcol = c
            break
    if vcol is None:
        return {}

    work = df[[tcol] + ([dcol] if dcol is not None else []) + [vcol]].copy()
    work[tcol] = work[tcol].astype(str).str.upper().str.strip()
    work[vcol] = pd.to_numeric(work[vcol], errors="coerce")
    work = work.dropna(subset=[tcol, vcol])

    if dcol is not None:
        work = work.dropna(subset=[dcol])
        work = work.loc[work[dcol] <= asof]
        if work.empty:
            return {}
        work = work.sort_values([tcol, dcol])
        work = work.groupby(tcol, as_index=False).tail(1)

    out: Dict[str, float] = {}
    tick_set = {str(t).upper().strip() for t in tickers}
    for _, row in work.iterrows():
        t = str(row[tcol]).upper().strip()
        if t not in tick_set:
            continue
        v = row[vcol]
        try:
            vf = float(v)
        except Exception:
            continue
        if math.isfinite(vf):
            out[t] = vf
    return out


def _stack_panel(wide: pd.DataFrame, *, name: str) -> pd.Series:
    # Pandas 2.1+ introduced a new stack implementation behind `future_stack=True`.
    # Use it when available to keep behavior stable across versions and silence warnings.
    try:
        # NOTE: with `future_stack=True`, `dropna`/`sort` must be unspecified.
        s = wide.stack(future_stack=True)
    except TypeError:  # pragma: no cover
        s = wide.stack(dropna=False)
    s.name = name
    s.index = s.index.set_names(["date", "ticker"])
    return s


def _fit_ols(
    X: np.ndarray,
    y: np.ndarray,
    *,
    cond_max: float = 1e10,
) -> Optional[Tuple[np.ndarray, float, float, float]]:
    """
    Fit OLS via lstsq with intercept already included in X.

    Returns (beta, sigma, r2, cond) or None if ill-conditioned / insufficient.
    """
    if X.ndim != 2 or y.ndim != 1:
        return None
    n, p = X.shape
    if n < max(50, (p + 1) * 10):
        return None
    try:
        cond = float(np.linalg.cond(X))
    except Exception:
        cond = float("inf")
    if not np.isfinite(cond) or cond > float(cond_max):
        return None

    try:
        beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    except Exception:
        return None

    yhat = X @ beta
    resid = y - yhat
    sigma = float(np.sqrt(np.mean(resid**2))) if len(resid) else float("nan")

    denom = float(np.sum((y - float(np.mean(y))) ** 2))
    num = float(np.sum(resid**2))
    r2 = float("nan") if denom <= 0 else float(1.0 - (num / denom))
    return beta.astype(float), sigma, r2, cond


def compute_top_k_signals(universe: list[str], start: str, end: str, k: int = 5) -> pd.DataFrame:
    """
    For each ticker in universe:
    - Fetch historical daily OHLCV via the existing provider abstraction + cache.
    - Compute features:
      * 1d / 1w / 30d / 3m / 6m / 12m momentum (log-return over horizon)
      * Volatility (rolling 60-day std of daily log returns; annualized)
      * Average volume (rolling 60-day mean volume; log1p transformed)
      * Optional value proxy (offline-first): from `data/value_proxy.(csv|parquet)` if present
    - Standardize features cross-sectionally (per date).
    - Fit an OLS model on historical panel data to predict forward 21d log returns.
      If the regression is ill-conditioned or insufficient data, falls back to equal-weight
      z-score composite.
    - Compute a predicted expected return score and a probability-of-positive-return proxy.
    - Rank by predicted score and return the top-K tickers with component breakdown.

    Returns:
      DataFrame (top K) with columns:
        ticker, rank, score, prob_up, model_type,
        raw features, z-features, per-feature contributions.

    Model metadata is attached to `df.attrs["model"]`.
    """
    if not universe:
        raise ValueError("universe must be non-empty")
    if k <= 0:
        raise ValueError("k must be >= 1")

    project_root = Path(__file__).resolve().parents[2]
    start_ts = pd.Timestamp(start)
    end_ts = pd.Timestamp(end)

    tickers = [str(t).upper().strip() for t in universe if str(t).strip()]
    tickers = sorted(dict.fromkeys(tickers))  # stable unique

    prices: Dict[str, pd.Series] = {}
    volumes: Dict[str, pd.Series] = {}
    last_ts: Dict[str, pd.Timestamp] = {}

    for t in tickers:
        df, _, _, _ = get_prices_cached(t, start, end, interval="1d")
        c = _select_close(df).dropna()
        v = _select_volume(df).reindex(c.index).dropna()
        c = c.loc[(c.index >= start_ts) & (c.index <= end_ts)]
        v = v.loc[v.index.isin(c.index)]
        if c.empty:
            continue
        prices[t] = c
        volumes[t] = v
        last_ts[t] = pd.Timestamp(c.index.max())

    if not prices:
        raise ValueError("no usable price series loaded for universe")

    # As-of: choose the last date that is available for all loaded tickers (conservative).
    asof = min(last_ts.values())

    # Align into wide frames.
    price_w = pd.concat(prices, axis=1).sort_index()
    vol_w = pd.concat(volumes, axis=1).sort_index()
    price_w = price_w.loc[price_w.index <= asof]
    vol_w = vol_w.reindex(price_w.index)

    # Compute daily log returns.
    log_p = np.log(price_w)
    r1 = log_p.diff()

    horizons = {
        "mom_1d": 1,
        "mom_5d": 5,
        "mom_30d": 30,
        "mom_63d": 63,
        "mom_126d": 126,
        "mom_252d": 252,
    }

    feats_wide: Dict[str, pd.DataFrame] = {}
    for name, h in horizons.items():
        if h == 1:
            feats_wide[name] = r1
        else:
            feats_wide[name] = r1.rolling(h).sum()

    feats_wide["vol_60d"] = r1.rolling(60).std(ddof=0) * math.sqrt(252.0)
    feats_wide["avg_volume_60d"] = np.log1p(vol_w.rolling(60).mean())

    # Optional value proxy (static per ticker; repeated for each date).
    value_map = _load_value_proxy(project_root=project_root, asof=asof, tickers=tickers)
    if value_map:
        vser = pd.Series({t: float(value_map.get(t, float("nan"))) for t in price_w.columns}, dtype=float)
        feats_wide["value_proxy"] = pd.DataFrame(np.tile(vser.to_numpy()[None, :], (len(price_w.index), 1)), index=price_w.index, columns=price_w.columns)

    # Forward return target (21 trading days ahead).
    fwd_h = 21
    y_w = (log_p.shift(-fwd_h) - log_p)

    # Build panel.
    panel_parts = []
    for name, dfw in feats_wide.items():
        panel_parts.append(_stack_panel(dfw, name=name))
    panel = pd.concat(panel_parts + [_stack_panel(y_w, name="y_fwd_21d")], axis=1)

    # Drop dates beyond `asof` is already done for features; y has NaNs at tail.
    # Determine which features are usable for modeling (exclude fully-null columns).
    feature_cols = [c for c in feats_wide.keys() if panel[c].notna().any()]
    if not feature_cols:
        raise ValueError("no features computed (unexpected)")

    # Cross-sectional z-score per date.
    for c in feature_cols:
        panel[f"z_{c}"] = panel.groupby(level=0)[c].transform(_cs_z)

    z_cols = [f"z_{c}" for c in feature_cols]

    train = panel.dropna(subset=z_cols + ["y_fwd_21d"]).copy()
    X = train[z_cols].to_numpy(dtype=float)
    y = train["y_fwd_21d"].to_numpy(dtype=float)
    X = np.column_stack([np.ones(len(X), dtype=float), X])

    fit = _fit_ols(X, y)
    model_type = "equal_weight"
    beta = None
    sigma = float("nan")
    r2 = float("nan")
    cond = float("nan")

    if fit is not None:
        beta, sigma, r2, cond = fit
        model_type = "ols"

    # Snapshot at asof.
    snap = panel.xs(asof, level=0, drop_level=False)
    snap = snap.reset_index(level=0, drop=True)  # index=ticker
    snap.index = snap.index.astype(str).str.upper()
    snap = snap.dropna(subset=z_cols)
    if snap.empty:
        raise ValueError("no tickers have enough history for feature snapshot at asof")

    if model_type == "ols" and beta is not None:
        Xs = snap[z_cols].to_numpy(dtype=float)
        Xs = np.column_stack([np.ones(len(Xs), dtype=float), Xs])
        mu = Xs @ beta
        snap["score"] = mu.astype(float)
        # Per-feature contributions (exclude intercept).
        for i, c in enumerate(z_cols, start=1):
            snap[f"contrib_{c[2:]}"] = beta[i] * snap[c]
    else:
        # Equal-weight composite of z-features.
        snap["score"] = snap[z_cols].mean(axis=1)
        for c in z_cols:
            snap[f"contrib_{c[2:]}"] = (1.0 / float(len(z_cols))) * snap[c]

    # Prob-up proxy from residual sigma (if available).
    if model_type == "ols" and math.isfinite(sigma) and sigma > 0:
        snap["prob_up"] = snap["score"].apply(lambda m: _phi(float(m) / float(sigma)))
    else:
        # No calibrated sigma; use a monotone proxy in [0,1].
        snap["prob_up"] = snap["score"].apply(lambda m: _phi(float(m) / 0.05) if math.isfinite(float(m)) else float("nan"))

    snap["ticker"] = snap.index
    # Avoid pandas ambiguity errors when an index level name equals a column label.
    try:
        snap.index.name = None
    except Exception:
        pass
    snap["model_type"] = model_type
    snap = snap.replace([np.inf, -np.inf], np.nan)

    # Final ordering (stable): score desc, then ticker asc.
    snap = snap.sort_values(["score", "ticker"], ascending=[False, True])
    snap["rank"] = np.arange(1, len(snap) + 1, dtype=int)

    # Output columns: keep readable ordering.
    raw_cols = feature_cols
    out_cols: List[str] = ["ticker", "rank", "score", "prob_up", "model_type"]
    out_cols += raw_cols
    out_cols += z_cols
    out_cols += [f"contrib_{c[2:]}" for c in z_cols]

    out = snap[out_cols].head(int(min(k, len(snap)))).reset_index(drop=True)

    # Attach model metadata.
    model_meta = {
        "asof": str(asof.date()),
        "start": str(pd.Timestamp(price_w.index.min()).date()) if not price_w.empty else str(start),
        "end": str(pd.Timestamp(asof).date()),
        "universe_size": int(len(tickers)),
        "used_tickers": int(len(prices)),
        "feature_cols": list(feature_cols),
        "z_feature_cols": list(z_cols),
        "forward_horizon_days": int(fwd_h),
        "train_obs": int(len(train)),
        "model_type": str(model_type),
        "ols": {
            "coef_intercept": float(beta[0]) if (model_type == "ols" and beta is not None and len(beta) > 0) else float("nan"),
            "coef_by_feature": {c: float(beta[i + 1]) for i, c in enumerate(feature_cols)} if (model_type == "ols" and beta is not None) else {},
            "sigma": float(sigma),
            "r2": float(r2),
            "cond": float(cond),
        },
    }
    try:
        out.attrs["model"] = model_meta
    except Exception:
        pass
    return out
