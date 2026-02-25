from __future__ import annotations

import os
from importlib import metadata
from typing import Any, Dict, Tuple

from quantlab.data.providers.base import (
    DataIntegrityError,
    DataProvider,
    standardize_ohlcv_columns,
    validate_ohlcv_df,
)


class AlphaVantageProvider(DataProvider):
    """
    Alpha Vantage daily OHLCV provider.

    Env:
      - ALPHAVANTAGE_API_KEY (required)

    Notes:
    - Only supports `interval="1d"` at the moment.
    - Does not log or store the API key anywhere.
    """

    def provider_name(self) -> str:
        return "alphavantage"

    def provider_version(self) -> str:
        # API doesn't have a reliable semantic version; record local client libs.
        try:
            return f"api|requests={metadata.version('requests')}"
        except Exception:
            return "api"

    def get_prices(self, symbol: str, start: str, end: str, interval: str):
        interval_s = str(interval or "").strip().lower()
        if interval_s not in {"1d", "d", "day", "daily"}:
            raise DataIntegrityError(f"AlphaVantageProvider only supports daily data (interval=1d), got {interval!r}")

        key = (os.environ.get("ALPHAVANTAGE_API_KEY") or "").strip()
        if not key:
            raise DataIntegrityError("ALPHAVANTAGE_API_KEY is not set")

        try:
            import pandas as pd  # type: ignore
            import requests  # type: ignore
        except ModuleNotFoundError as e:  # pragma: no cover
            raise DataIntegrityError("pandas/requests are required for AlphaVantageProvider") from e

        url = "https://www.alphavantage.co/query"
        symbol_u = str(symbol).upper()

        def _request(function_name: str) -> Dict[str, Any]:
            params = {
                "function": str(function_name),
                "symbol": symbol_u,
                "outputsize": "full",
                "apikey": key,
            }

            try:
                resp = requests.get(url, params=params, timeout=30)
            except Exception as e:
                # Treat network errors as retryable by the cache layer.
                raise RuntimeError(f"AlphaVantage request failed ({function_name}): {e}") from e

            if resp.status_code == 429:
                raise DataIntegrityError("AlphaVantage rate limited (HTTP 429)")
            if resp.status_code in {500, 502, 503, 504}:
                raise RuntimeError(f"AlphaVantage server error {resp.status_code}")
            if resp.status_code >= 400:
                raise DataIntegrityError(f"AlphaVantage HTTP error {resp.status_code}")

            try:
                obj = resp.json()
            except Exception as e:
                raise DataIntegrityError(f"AlphaVantage JSON parse failed: {e}") from e
            if not isinstance(obj, dict):
                raise DataIntegrityError("AlphaVantage response is not an object")
            return obj

        def _extract_timeseries(obj: Dict[str, Any], function_name: str) -> Tuple[Dict[str, Any], bool]:
            # AlphaVantage frequently uses "Information" and "Note" for quota/rate-limit responses.
            note = str(obj.get("Note") or "").strip()
            info = str(obj.get("Information") or "").strip()
            err = str(obj.get("Error Message") or "").strip()
            if note:
                raise DataIntegrityError(f"AlphaVantage rate limit note: {note}")
            if info:
                raise DataIntegrityError(f"AlphaVantage information: {info}")
            if err:
                raise DataIntegrityError(f"AlphaVantage error: {err}")

            ts = obj.get("Time Series (Daily)")
            if not isinstance(ts, dict) or not ts:
                keys = sorted([str(k) for k in obj.keys()])[:8]
                raise DataIntegrityError(
                    f"AlphaVantage: missing Time Series (Daily) for {symbol_u!r} "
                    f"(function={function_name}, response_keys={keys})"
                )
            adjusted = function_name == "TIME_SERIES_DAILY_ADJUSTED"
            return ts, adjusted

        # Try adjusted first; always attempt a deterministic fallback to non-adjusted daily.
        # This handles provider-tier constraints where adjusted series can be unavailable
        # while daily OHLCV remains accessible for the same key/account.
        try:
            ts, adjusted = _extract_timeseries(_request("TIME_SERIES_DAILY_ADJUSTED"), "TIME_SERIES_DAILY_ADJUSTED")
        except DataIntegrityError as e_adjusted:
            try:
                ts, adjusted = _extract_timeseries(_request("TIME_SERIES_DAILY"), "TIME_SERIES_DAILY")
            except DataIntegrityError as e_daily:
                raise DataIntegrityError(
                    "AlphaVantage daily retrieval failed for both endpoints.\n"
                    f"- adjusted_error: {e_adjusted}\n"
                    f"- daily_error: {e_daily}"
                ) from e_daily

        rows = []
        for dt_s, rec in ts.items():
            if not isinstance(rec, dict):
                continue
            adj_close = rec.get("5. adjusted close") if adjusted else rec.get("4. close")
            vol = rec.get("6. volume") if adjusted else rec.get("5. volume")
            rows.append(
                {
                    "Date": dt_s,
                    "Open": rec.get("1. open"),
                    "High": rec.get("2. high"),
                    "Low": rec.get("3. low"),
                    "Close": rec.get("4. close"),
                    "Adj Close": adj_close,
                    "Volume": vol,
                }
            )

        df = pd.DataFrame(rows)
        if df.empty:
            raise DataIntegrityError(f"AlphaVantage: no rows parsed for {symbol!r}")

        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        df = df.dropna(subset=["Date"]).set_index("Date").sort_index()
        for c in ["Open", "High", "Low", "Close", "Adj Close", "Volume"]:
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce")

        s_ts = pd.Timestamp(start)
        e_ts = pd.Timestamp(end)
        df = df.loc[(df.index >= s_ts) & (df.index <= e_ts)]

        df = standardize_ohlcv_columns(df)
        validate_ohlcv_df(df, symbol=symbol_u, interval="1d")
        return df
