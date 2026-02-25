from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional


class DataIntegrityError(RuntimeError):
    """Raised when downloaded/cached market data fails integrity checks."""


class DataProvider:
    def get_prices(self, symbol: str, start: str, end: str, interval: str):
        raise NotImplementedError

    def provider_name(self) -> str:
        raise NotImplementedError

    def provider_version(self) -> str:
        raise NotImplementedError


def iso_utc(ts: Optional[datetime] = None) -> str:
    dt = ts or datetime.now(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def standardize_ohlcv_columns(df: Any) -> Any:
    """
    Best-effort standardization to canonical yfinance-like OHLCV names:
      Open, High, Low, Close, Adj Close, Volume

    Returns a copy. Raises DataIntegrityError if pandas isn't available.
    """
    try:
        import pandas as pd  # type: ignore
    except ModuleNotFoundError as e:  # pragma: no cover
        raise DataIntegrityError("pandas is required for OHLCV standardization") from e

    if df is None:
        raise DataIntegrityError("OHLCV dataframe is None")

    # Preserve any existing attrs (used for provenance).
    attrs = {}
    try:
        attrs = dict(getattr(df, "attrs", {}) or {})
    except Exception:
        attrs = {}

    out = df.copy()
    # Normalize column names case/spacing.
    rename = {}
    for c in list(out.columns):
        s = str(c).strip()
        k = " ".join(s.replace("_", " ").split()).lower()
        if k == "open":
            rename[c] = "Open"
        elif k == "high":
            rename[c] = "High"
        elif k == "low":
            rename[c] = "Low"
        elif k == "close":
            rename[c] = "Close"
        elif k in {"adj close", "adjclose", "adjusted close", "adjustedclose"}:
            rename[c] = "Adj Close"
        elif k in {"volume", "vol"}:
            rename[c] = "Volume"

    if rename:
        out = out.rename(columns=rename)

    # Ensure datetime index.
    if not isinstance(out.index, pd.DatetimeIndex):
        try:
            out.index = pd.to_datetime(out.index)
        except Exception as e:
            raise DataIntegrityError("Index could not be converted to datetime") from e

    out = out.sort_index()
    try:
        out.attrs = attrs
    except Exception:
        pass
    return out


def validate_ohlcv_df(
    df: Any,
    *,
    symbol: str,
    interval: str,
    strict_calendar: bool = False,
) -> None:
    """
    Fail-fast integrity checks for standardized OHLCV frames.

    Required:
    - non-empty
    - DatetimeIndex, sorted, monotonic
    - no duplicate timestamps
    - required columns present: Open, High, Low, Close, Volume
    - no NaNs in required columns
    - prices > 0
    - High >= Low
    - Close within [Low, High]
    - Volume >= 0
    - daily data: no "unexpected" gaps (> 7 calendar days) between consecutive bars
    - strict calendar (optional): validate against a NYSE-like trading-day calendar
      (no missing or extra trading days between first/last bar).
    """
    try:
        import pandas as pd  # type: ignore
        import numpy as np  # type: ignore
    except ModuleNotFoundError as e:  # pragma: no cover
        raise DataIntegrityError("pandas/numpy required for OHLCV validation") from e

    if df is None:
        raise DataIntegrityError(f"{symbol}: dataset is None")
    if getattr(df, "empty", True):
        raise DataIntegrityError(f"{symbol}: dataset is empty")

    if not isinstance(df.index, pd.DatetimeIndex):
        raise DataIntegrityError(f"{symbol}: index is not a DatetimeIndex")

    if df.index.has_duplicates:
        # show a few duplicates for debugging
        dup = df.index[df.index.duplicated(keep=False)]
        sample = ", ".join([str(x) for x in list(dup[:5])])
        raise DataIntegrityError(f"{symbol}: duplicate timestamps detected (sample: {sample})")

    if not df.index.is_monotonic_increasing:
        raise DataIntegrityError(f"{symbol}: timestamps are not monotonic increasing")

    required = ["Open", "High", "Low", "Close", "Volume"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise DataIntegrityError(f"{symbol}: missing required columns: {missing}")

    # Coerce numeric and validate finiteness (do not mutate caller frame).
    o = pd.to_numeric(df["Open"], errors="coerce")
    h = pd.to_numeric(df["High"], errors="coerce")
    l = pd.to_numeric(df["Low"], errors="coerce")
    c = pd.to_numeric(df["Close"], errors="coerce")
    v = pd.to_numeric(df["Volume"], errors="coerce")

    for name, s in [("Open", o), ("High", h), ("Low", l), ("Close", c), ("Volume", v)]:
        if s.isna().any():
            bad = s.index[s.isna()]
            sample = ", ".join([str(x) for x in list(bad[:5])])
            raise DataIntegrityError(f"{symbol}: NaNs in {name} (sample: {sample})")
        if not np.isfinite(s.to_numpy(dtype=float)).all():
            raise DataIntegrityError(f"{symbol}: non-finite values in {name}")

    if (o <= 0).any() or (h <= 0).any() or (l <= 0).any() or (c <= 0).any():
        raise DataIntegrityError(f"{symbol}: non-positive prices detected")

    if (v < 0).any():
        raise DataIntegrityError(f"{symbol}: negative volume detected")

    if (h < l).any():
        raise DataIntegrityError(f"{symbol}: High < Low detected")

    if (c < l).any() or (c > h).any():
        raise DataIntegrityError(f"{symbol}: Close outside [Low, High] detected")

    # Gap checks for daily-ish data only (avoid intraday market-hours complexity).
    interval_s = str(interval or "").strip().lower()
    if interval_s.endswith("d"):
        diffs = df.index.to_series().diff().dropna()
        if not diffs.empty:
            max_gap = diffs.max()
            # Allow weekends/holidays; flag only very large gaps (e.g., missing chunks).
            if max_gap > pd.Timedelta(days=7):
                # Provide first offending gap for debugging.
                idx = diffs[diffs > pd.Timedelta(days=7)].index[0]
                gap = diffs.loc[idx]
                prev = df.index[df.index.get_loc(idx) - 1] if df.index.get_loc(idx) > 0 else None
                raise DataIntegrityError(
                    f"{symbol}: unexpected gap {gap} between {prev} and {idx} (interval={interval})"
                )

        if bool(strict_calendar):
            # Exchange calendar validation: fail loudly on missing/extra trading days.
            from quantlab.data.calendar import nyse_trading_days

            # Compare on normalized dates (ignore time-of-day).
            idx = pd.DatetimeIndex(df.index)
            if getattr(idx, "tz", None) is not None:
                idx = idx.tz_convert(None)
            actual = idx.normalize().unique().sort_values()
            first = actual.min()
            last = actual.max()
            expected = nyse_trading_days(first, last)

            missing = expected.difference(actual)
            extra = actual.difference(expected)
            if len(missing) > 0:
                sample = ", ".join([str(x.date()) for x in list(missing[:5])])
                raise DataIntegrityError(f"{symbol}: strict calendar missing trading days (sample: {sample})")
            if len(extra) > 0:
                sample = ", ".join([str(x.date()) for x in list(extra[:5])])
                raise DataIntegrityError(f"{symbol}: strict calendar found unexpected non-trading days (sample: {sample})")
