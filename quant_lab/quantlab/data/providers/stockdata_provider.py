from __future__ import annotations

import os
from importlib import metadata
from typing import Any, Dict, List, Optional

from quantlab.data.providers.base import (
    DataIntegrityError,
    DataProvider,
    standardize_ohlcv_columns,
    validate_ohlcv_df,
)


class StockDataProvider(DataProvider):
    """
    StockData.org daily OHLCV provider (EOD).

    Env:
      - STOCKDATA_API_KEY (required)

    Endpoint (as implemented):
      GET https://api.stockdata.org/v1/data/eod
        params:
          - symbols=<SYMBOL>
          - date_from=YYYY-MM-DD
          - date_to=YYYY-MM-DD
          - api_token=<KEY>

    Notes:
    - Only supports `interval=\"1d\"` at the moment.
    - Fails loudly on rate limits or malformed responses.
    - Does not log or store the API key anywhere.
    """

    def provider_name(self) -> str:
        return "stockdata"

    def provider_version(self) -> str:
        try:
            return f"api|requests={metadata.version('requests')}"
        except Exception:
            return "api"

    def get_prices(self, symbol: str, start: str, end: str, interval: str):
        interval_s = str(interval or "").strip().lower()
        if interval_s not in {"1d", "d", "day", "daily"}:
            raise DataIntegrityError(f"StockDataProvider only supports daily data (interval=1d), got {interval!r}")

        key = (os.environ.get("STOCKDATA_API_KEY") or "").strip()
        if not key:
            raise DataIntegrityError("STOCKDATA_API_KEY is not set")

        try:
            import pandas as pd  # type: ignore
            import requests  # type: ignore
        except ModuleNotFoundError as e:  # pragma: no cover
            raise DataIntegrityError("pandas/requests are required for StockDataProvider") from e

        url = "https://api.stockdata.org/v1/data/eod"
        params: Dict[str, Any] = {
            "symbols": str(symbol).upper(),
            "date_from": str(start),
            "date_to": str(end),
            "api_token": key,
        }

        try:
            resp = requests.get(url, params=params, timeout=30)
        except Exception as e:
            # Treat network errors as retryable by the cache layer.
            raise RuntimeError(f"StockData request failed: {e}") from e

        if resp.status_code == 429:
            raise DataIntegrityError("StockData rate limited (HTTP 429)")
        if resp.status_code in {500, 502, 503, 504}:
            raise RuntimeError(f"StockData server error {resp.status_code}")
        if resp.status_code >= 400:
            raise DataIntegrityError(f"StockData HTTP error {resp.status_code}")

        try:
            obj = resp.json()
        except Exception as e:
            raise DataIntegrityError(f"StockData JSON parse failed: {e}") from e

        if not isinstance(obj, dict):
            raise DataIntegrityError("StockData response is not an object")

        # Some APIs return errors as {\"error\": {...}} or {\"message\": ...}
        if "error" in obj and obj.get("error"):
            raise DataIntegrityError(f"StockData error: {obj.get('error')}")
        if "message" in obj and obj.get("message") and not obj.get("data"):
            raise DataIntegrityError(f"StockData message: {obj.get('message')}")

        data = obj.get("data")
        if not isinstance(data, list) or not data:
            raise DataIntegrityError(f"StockData: missing/empty data for {symbol!r}")

        rows: List[Dict[str, Any]] = []
        for rec in data:
            if not isinstance(rec, dict):
                continue
            dt = rec.get("date") or rec.get("datetime") or rec.get("timestamp")
            if dt is None:
                continue
            rows.append(
                {
                    "Date": dt,
                    "Open": rec.get("open"),
                    "High": rec.get("high"),
                    "Low": rec.get("low"),
                    "Close": rec.get("close"),
                    # Best-effort: if adj_close exists use it, else close.
                    "Adj Close": rec.get("adj_close", rec.get("close")),
                    "Volume": rec.get("volume", rec.get("vol")),
                }
            )

        df = pd.DataFrame(rows)
        if df.empty:
            raise DataIntegrityError(f"StockData: no rows parsed for {symbol!r}")

        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        df = df.dropna(subset=["Date"]).set_index("Date").sort_index()
        for c in ["Open", "High", "Low", "Close", "Adj Close", "Volume"]:
            if c in df.columns:
                df[c] = pd.to_numeric(df[c], errors="coerce")

        s_ts = pd.Timestamp(start)
        e_ts = pd.Timestamp(end)
        df = df.loc[(df.index >= s_ts) & (df.index <= e_ts)]

        df = standardize_ohlcv_columns(df)
        validate_ohlcv_df(df, symbol=str(symbol).upper(), interval="1d")
        return df

