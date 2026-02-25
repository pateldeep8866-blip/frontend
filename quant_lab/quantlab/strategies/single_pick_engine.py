from __future__ import annotations

"""Structured single-pick engine (research/paper-only).

This module produces a deterministic "top 1" pick based on a composite of:
- medium-term momentum (20d + 60d, vol-adjusted)
- very short-term mean reversion (5d, vol-adjusted)

Data access:
- Uses the provider abstraction via `ProviderFactory.new()` and the existing
  cache layer (`quantlab.data_cache.get_prices_cached`).

Example:
  python -m quantlab.strategies.single_pick_engine --universe SPY,QQQ,IWM,TLT,GLD --asof 2026-02-17 --k 3
"""

import csv
import math
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import numpy as np
import pandas as pd

from quantlab.data.providers import ProviderFactory
from quantlab.data.providers.base import DataIntegrityError
import quantlab.data_cache as data_cache


def _iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _is_rate_limit_error(e: BaseException) -> bool:
    msg = str(e).lower()
    needles = [
        "rate limit",
        "too many requests",
        "429",
        "throttle",
        "temporarily unavailable",
    ]
    return any(n in msg for n in needles)


def _normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """Return clean daily OHLCV with lowercase columns.

    Expected output columns: open, high, low, close, volume.
    Close uses Adj Close when available.
    """
    if df is None or df.empty:
        raise DataIntegrityError("dataset is empty")

    out = df.copy()
    # Prefer adjusted close for return computations.
    if "Adj Close" in out.columns and out["Adj Close"].notna().any():
        out["Close"] = out["Adj Close"]

    rename = {
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume": "volume",
    }
    missing = [c for c in rename.keys() if c not in out.columns]
    if missing:
        raise DataIntegrityError(f"missing required columns: {missing}")

    out = out.rename(columns=rename)
    out = out[["open", "high", "low", "close", "volume"]]
    out.index = pd.to_datetime(out.index)
    if getattr(out.index, "tz", None) is not None:
        out.index = out.index.tz_convert(None)
    out = out.sort_index()

    # Coerce numerics.
    for c in ["open", "high", "low", "close", "volume"]:
        out[c] = pd.to_numeric(out[c], errors="coerce")

    if out[["open", "high", "low", "close"]].isna().any().any():
        raise DataIntegrityError("NaNs found in price columns")
    if out["volume"].isna().any():
        raise DataIntegrityError("NaNs found in volume")

    return out


def _find_superset_cache_range(
    *,
    ticker: str,
    start: str,
    end: str,
    interval: str = "1d",
    provider_name: Optional[str] = None,
) -> Optional[tuple[str, str]]:
    """If an exact cache file isn't present, reuse a cached superset range.

    This keeps the engine offline-first and avoids duplicate downloads when a
    larger cache window already exists for the same ticker/interval.
    """
    wanted_start = pd.Timestamp(start)
    wanted_end = pd.Timestamp(end)

    exact = data_cache.get_cache_path(ticker, start, end, interval, provider_name=provider_name)
    cache_dir = exact.parent
    if not cache_dir.exists():
        return None

    candidates: List[tuple[int, str, str]] = []
    prefix = f"{str(ticker).upper()}__{str(interval)}__"
    for p in sorted(cache_dir.glob(f"{str(ticker).upper()}__{str(interval)}__*.csv")):
        name = p.name
        if not name.startswith(prefix) or not name.endswith(".csv"):
            continue
        core = name[:-4]
        parts = core.split("__")
        if len(parts) != 4:
            continue
        _, _interval, s0, e0 = parts
        try:
            s_ts = pd.Timestamp(s0)
            e_ts = pd.Timestamp(e0)
        except Exception:
            continue
        if s_ts <= wanted_start and e_ts >= wanted_end:
            # Choose the smallest superset (min span). Deterministic tie-break.
            span = int((e_ts - s_ts).days)
            candidates.append((span, s0, e0))

    if not candidates:
        return None

    candidates.sort(key=lambda x: (x[0], x[1], x[2]))
    _, s_best, e_best = candidates[0]
    return str(s_best), str(e_best)


def fetch_historical(ticker, start, end):
    """Fetch daily OHLCV for `ticker` using provider abstraction + cache.

    Uses `ProviderFactory.new()` (selection via env var `QUANTLAB_DATA_PROVIDER`).
    Handles rate-limit style failures with deterministic exponential backoff.

    Returns a clean DataFrame with date index and columns:
      ['open','high','low','close','volume']
    """
    provider = ProviderFactory.new()
    prov_name = getattr(provider, "provider_name", lambda: "unknown")()
    interval = "1d"

    # Prefer an existing cached superset if present to avoid extra downloads.
    superset = None
    exact_path = data_cache.get_cache_path(ticker, start, end, interval, provider_name=str(prov_name))
    if not exact_path.exists():
        superset = _find_superset_cache_range(
            ticker=str(ticker),
            start=str(start),
            end=str(end),
            interval=interval,
            provider_name=str(prov_name),
        )

    # If we don't have a true superset, still prefer any cached file that covers the requested end.
    # This makes tests/offline workflows robust while still allowing provider downloads when needed.
    fallback_ranges: List[tuple[str, str]] = []
    if superset is None and not exact_path.exists():
        cache_dir = exact_path.parent
        prefix = f"{str(ticker).upper()}__{str(interval)}__"
        for p in sorted(cache_dir.glob(f"{str(ticker).upper()}__{str(interval)}__*.csv")):
            name = p.name
            if not name.startswith(prefix) or not name.endswith(".csv"):
                continue
            core = name[:-4]
            parts = core.split("__")
            if len(parts) != 4:
                continue
            _, _interval, s0, e0 = parts
            try:
                e_ts = pd.Timestamp(e0)
            except Exception:
                continue
            if e_ts >= pd.Timestamp(end):
                fallback_ranges.append((str(s0), str(e0)))

    attempts = int(os.environ.get("QUANTLAB_FETCH_RETRIES", "3") or 3)
    base_sleep = float(os.environ.get("QUANTLAB_FETCH_BACKOFF_SEC", "1.0") or 1.0)

    last_err: Optional[BaseException] = None
    for i in range(max(1, attempts)):
        try:
            if superset is not None:
                s0, e0 = superset
                df, _, _, _ = data_cache.get_prices_cached(
                    str(ticker), s0, e0, interval=interval, provider=provider
                )
                df = df.loc[(df.index >= pd.Timestamp(start)) & (df.index <= pd.Timestamp(end))]
            else:
                # Try any cached range that covers `end` before downloading.
                if fallback_ranges:
                    for s0, e0 in fallback_ranges:
                        try:
                            df0, _, _, _ = data_cache.get_prices_cached(
                                str(ticker), s0, e0, interval=interval, provider=provider
                            )
                            df0 = df0.loc[(df0.index >= pd.Timestamp(start)) & (df0.index <= pd.Timestamp(end))]
                            if df0 is not None and not getattr(df0, "empty", True) and len(df0) >= 65:
                                df = df0
                                break
                        except Exception:
                            continue
                    else:
                        df, _, _, _ = data_cache.get_prices_cached(
                            str(ticker), str(start), str(end), interval=interval, provider=provider
                        )
                else:
                    df, _, _, _ = data_cache.get_prices_cached(
                        str(ticker), str(start), str(end), interval=interval, provider=provider
                    )
            return _normalize_ohlcv(df)
        except DataIntegrityError:
            raise
        except Exception as e:
            last_err = e
            if _is_rate_limit_error(e) and i < attempts - 1:
                time.sleep(base_sleep * (2.0 ** float(i)))
                continue
            raise

    raise RuntimeError(f"fetch_historical failed for {ticker!r}: {last_err}")


def compute_features(df):
    """Compute per-ticker scalar features from daily OHLCV.

    Features (latest available row):
    - ret_5d, ret_20d, ret_60d: close pct-change over horizon
    - vol_5d, vol_20d: rolling std of daily log returns over horizon
    - avg_volume_20d: rolling mean volume

    Raises DataIntegrityError if required history is missing or values are invalid.
    """
    if df is None or getattr(df, "empty", True):
        raise DataIntegrityError("empty dataset")
    required = {"open", "high", "low", "close", "volume"}
    missing = [c for c in sorted(required) if c not in df.columns]
    if missing:
        raise DataIntegrityError(f"missing OHLCV columns: {missing}")

    close = pd.to_numeric(df["close"], errors="coerce").astype(float)
    vol = pd.to_numeric(df["volume"], errors="coerce").astype(float)
    if close.isna().any() or vol.isna().any():
        raise DataIntegrityError("NaNs in close/volume")
    if len(close) < 65:
        raise DataIntegrityError("insufficient history (need >= 65 rows)")

    # pct_change features
    r5 = float(close.pct_change(5).iloc[-1])
    r20 = float(close.pct_change(20).iloc[-1])
    r60 = float(close.pct_change(60).iloc[-1])

    # log-return volatility
    lr = np.log(close).diff()
    v5 = float(lr.rolling(5).std(ddof=0).iloc[-1])
    v20 = float(lr.rolling(20).std(ddof=0).iloc[-1])

    avgv = float(vol.rolling(20).mean().iloc[-1])

    feats = {
        "ret_5d": r5,
        "ret_20d": r20,
        "ret_60d": r60,
        "vol_5d": v5,
        "vol_20d": v20,
        "avg_volume_20d": avgv,
    }

    for k, v in feats.items():
        if not math.isfinite(float(v)):
            raise DataIntegrityError(f"non-finite feature: {k}={v}")

    # Basic sanity: volatility should be non-negative and not absurdly large.
    # Note: perfectly smooth synthetic series can yield ~0 vol; treat that as valid.
    max_daily_vol = float(os.environ.get("QUANTLAB_SINGLEPICK_MAX_DAILY_VOL", "0.50") or 0.50)
    if feats["vol_5d"] < 0 or feats["vol_20d"] < 0:
        raise DataIntegrityError("abnormal volatility (< 0) detected")
    if feats["vol_5d"] > max_daily_vol or feats["vol_20d"] > max_daily_vol:
        raise DataIntegrityError("abnormal volatility (too large) detected")

    return feats


def score_universe(universe, asof):
    """Score a universe and return a ranked pick table.

    For each ticker:
    - Fetch ~3y of data up to `asof`.
    - Compute features.
    - Compute scores:
        momentum_score = (ret_20d + ret_60d) / (1 + vol_20d)
        mean_reversion_score = -(ret_5d) / (1 + vol_5d)
        composite = 0.6*momentum_score + 0.4*mean_reversion_score

    Returns a DataFrame sorted by composite desc.
    Required columns:
      ['ticker','composite','momentum_score','mean_reversion_score']
    """
    if universe is None:
        from quantlab.morning.universe import DEFAULT_UNIVERSE

        universe_list = list(DEFAULT_UNIVERSE)
    else:
        universe_list = [str(x).strip().upper() for x in list(universe)]
        universe_list = [x for x in universe_list if x]

    if not universe_list:
        raise ValueError("universe is empty")

    asof_ts = pd.Timestamp(asof).normalize()
    start_ts = (asof_ts - pd.DateOffset(years=3)).normalize()
    start = start_ts.strftime("%Y-%m-%d")
    end = asof_ts.strftime("%Y-%m-%d")

    rows: List[Dict[str, float]] = []
    for t in universe_list:
        df = fetch_historical(t, start, end)
        feats = compute_features(df)

        mom = (float(feats["ret_20d"]) + float(feats["ret_60d"])) / (1.0 + float(feats["vol_20d"]))
        mr = (-(float(feats["ret_5d"])) / (1.0 + float(feats["vol_5d"])))
        comp = 0.6 * mom + 0.4 * mr

        rows.append(
            {
                "ticker": str(t),
                "composite": float(comp),
                "momentum_score": float(mom),
                "mean_reversion_score": float(mr),
            }
        )

    out = pd.DataFrame(rows)
    if out.empty:
        raise DataIntegrityError("no tickers produced scores")

    out = out.replace([np.inf, -np.inf], np.nan)
    if out[["composite", "momentum_score", "mean_reversion_score"]].isna().any().any():
        raise DataIntegrityError("NaNs in computed scores")

    out = out.sort_values(["composite", "ticker"], ascending=[False, True]).reset_index(drop=True)
    out.attrs["asof"] = str(asof_ts.date())
    out.attrs["generated_utc"] = _iso_utc_now()
    return out[["ticker", "composite", "momentum_score", "mean_reversion_score"]]


def write_pick_artifact(run_id, picks_df):
    """Write `single_pick.csv` into `reports/runs/<run_id>/`.

    Includes timestamp + asof for auditability.
    """
    project_root = Path(__file__).resolve().parents[2]
    run_dir = project_root / "reports" / "runs" / str(run_id)
    run_dir.mkdir(parents=True, exist_ok=True)

    asof = str(getattr(picks_df, "attrs", {}).get("asof") or "")
    generated_utc = str(getattr(picks_df, "attrs", {}).get("generated_utc") or _iso_utc_now())

    if picks_df is None or getattr(picks_df, "empty", True):
        raise DataIntegrityError("picks_df empty")

    top = picks_df.iloc[0]
    payload = {
        "generated_utc": generated_utc,
        "asof": asof,
        "ticker": str(top.get("ticker")),
        "composite": float(top.get("composite")),
        "momentum_score": float(top.get("momentum_score")),
        "mean_reversion_score": float(top.get("mean_reversion_score")),
    }

    out_path = run_dir / "single_pick.csv"
    with out_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(payload.keys()))
        w.writeheader()
        w.writerow(payload)
    return out_path


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--universe", type=str, default="")
    parser.add_argument("--asof", type=str, default=None)
    parser.add_argument("--k", type=int, default=1)
    args = parser.parse_args()

    asof = args.asof or datetime.utcnow().strftime("%Y-%m-%d")
    universe = args.universe.split(",") if args.universe else None
    results = score_universe(universe, asof)
    print("Single pick results:")
    print(results.head(args.k))
