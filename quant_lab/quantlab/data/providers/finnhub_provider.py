from __future__ import annotations

import os
from importlib import metadata

from quantlab.data.providers.base import (
    DataIntegrityError,
    DataProvider,
    standardize_ohlcv_columns,
    validate_ohlcv_df,
)


class FinnhubProvider(DataProvider):
    """
    Finnhub daily OHLCV provider.

    Env:
      - FINNHUB_API_KEY (required)

    Notes:
    - Only supports `interval="1d"` at the moment.
    - Uses the candle endpoint with resolution=D.
    """

    def provider_name(self) -> str:
        return "finnhub"

    def provider_version(self) -> str:
        try:
            return f"api|requests={metadata.version('requests')}"
        except Exception:
            return "api"

    def get_prices(self, symbol: str, start: str, end: str, interval: str):
        interval_s = str(interval or "").strip().lower()
        if interval_s not in {"1d", "d", "day", "daily"}:
            raise DataIntegrityError(f"FinnhubProvider only supports daily data (interval=1d), got {interval!r}")

        key = (os.environ.get("FINNHUB_API_KEY") or "").strip()
        if not key:
            raise DataIntegrityError("FINNHUB_API_KEY is not set")

        try:
            import pandas as pd  # type: ignore
            import requests  # type: ignore
        except ModuleNotFoundError as e:  # pragma: no cover
            raise DataIntegrityError("pandas/requests are required for FinnhubProvider") from e

        s_ts = pd.Timestamp(start)
        e_ts = pd.Timestamp(end)
        frm = int(s_ts.timestamp())
        to = int(e_ts.timestamp())

        url = "https://finnhub.io/api/v1/stock/candle"
        params = {
            "symbol": str(symbol).upper(),
            "resolution": "D",
            "from": frm,
            "to": to,
            "token": key,
        }

        try:
            resp = requests.get(url, params=params, timeout=30)
        except Exception as e:
            # Treat network errors as retryable by the cache layer.
            raise RuntimeError(f"Finnhub request failed: {e}") from e

        if resp.status_code == 429:
            raise DataIntegrityError("Finnhub rate limited (HTTP 429)")
        if resp.status_code in {500, 502, 503, 504}:
            raise RuntimeError(f"Finnhub server error {resp.status_code}")
        if resp.status_code >= 400:
            raise DataIntegrityError(f"Finnhub HTTP error {resp.status_code}")

        try:
            obj = resp.json()
        except Exception as e:
            raise DataIntegrityError(f"Finnhub JSON parse failed: {e}") from e

        if not isinstance(obj, dict):
            raise DataIntegrityError("Finnhub response is not an object")

        status = str(obj.get("s") or "").strip().lower()
        if status and status != "ok":
            raise DataIntegrityError(f"Finnhub returned status={status!r}")

        t = obj.get("t") or []
        o = obj.get("o") or []
        h = obj.get("h") or []
        l = obj.get("l") or []
        c = obj.get("c") or []
        v = obj.get("v") or []
        if not (len(t) and len(o) and len(h) and len(l) and len(c) and len(v)):
            raise DataIntegrityError(f"Finnhub: empty candle arrays for {symbol!r}")

        if not (len(t) == len(o) == len(h) == len(l) == len(c) == len(v)):
            raise DataIntegrityError(f"Finnhub: mismatched candle array lengths for {symbol!r}")

        idx = pd.to_datetime(t, unit="s", utc=True).tz_convert(None)
        df = pd.DataFrame(
            {
                "Open": o,
                "High": h,
                "Low": l,
                "Close": c,
                "Adj Close": c,
                "Volume": v,
            },
            index=idx,
        ).sort_index()

        df = df.loc[(df.index >= s_ts) & (df.index <= e_ts)]
        df = standardize_ohlcv_columns(df)
        validate_ohlcv_df(df, symbol=str(symbol).upper(), interval="1d")
        return df
