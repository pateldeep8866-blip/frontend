from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Iterable, Optional

from quantlab.data_cache import get_prices_cached

try:
    import pandas as pd  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    pd = None  # type: ignore


class UniversePrices(dict):
    """
    Dict-like container: {ticker -> DataFrame}, with `data_files` metadata.
    """

    def __init__(self, *args: Any, data_files: Optional[Dict[str, Dict[str, Any]]] = None, **kwargs: Any):
        super().__init__(*args, **kwargs)
        self.data_files: Dict[str, Dict[str, Any]] = data_files or {}


def _maybe_rel(p: Path, project_root: Optional[Path]) -> str:
    p = Path(p).resolve()
    if project_root is None:
        return str(p)
    try:
        return str(p.relative_to(Path(project_root).resolve()))
    except Exception:
        return str(p)


def _normalize_ohlcv(df: "pd.DataFrame", *, symbol: str, interval: str, strict: bool) -> "pd.DataFrame":
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for morning data loading.")

    from quantlab.data.providers.base import standardize_ohlcv_columns, validate_ohlcv_df

    out = standardize_ohlcv_columns(df)
    # Enforce strict integrity (fail fast).
    validate_ohlcv_df(out, symbol=str(symbol).upper(), interval=str(interval), strict_calendar=bool(strict))
    return out


def load_universe_prices(
    universe: Iterable[str],
    start: str,
    end: str,
    interval: str = "1d",
    *,
    project_root: Optional[Path] = None,
    strict: bool = False,
) -> UniversePrices:
    """
    Load cached OHLCV for each ticker and return a dict-like container.

    Uses `quantlab.data_cache.get_prices_cached()` per ticker and records:
    - data_path
    - data_sha256
    - cache_hit
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for morning data loading.")

    prices: Dict[str, "pd.DataFrame"] = {}
    data_files: Dict[str, Dict[str, Any]] = {}

    for raw in universe:
        t = str(raw).upper().strip()
        if not t:
            continue
        df, data_path, data_sha256, cache_hit = get_prices_cached(t, start=start, end=end, interval=interval, strict=bool(strict))
        df = _normalize_ohlcv(df, symbol=t, interval=interval, strict=bool(strict))
        prices[t] = df

        meta = {}
        try:
            meta = dict(getattr(df, "attrs", {}).get("quantlab_data") or {})
        except Exception:
            meta = {}

        row_count = int(meta.get("row_count") or getattr(df, "shape", [0])[0] or 0)
        first_ts = str(meta.get("first_timestamp") or (df.index.min().isoformat() if not df.empty else ""))
        last_ts = str(meta.get("last_timestamp") or (df.index.max().isoformat() if not df.empty else ""))

        data_files[t] = {
            "data_path": _maybe_rel(Path(data_path), project_root),
            "data_sha256": str(data_sha256),
            "cache_hit": bool(cache_hit),
            # Provenance / integrity metadata (populated by the data layer when available).
            "provider_name": str(meta.get("provider_name") or ""),
            "provider_version": str(meta.get("provider_version") or ""),
            "retrieval_timestamp": str(meta.get("retrieval_timestamp") or ""),
            "row_count": row_count,
            "first_timestamp": first_ts,
            "last_timestamp": last_ts,
            "file_sha256": str(meta.get("file_sha256") or str(data_sha256)),
            # Backward-compatible fields used by older reports.
            "rows": row_count,
            "first_date": first_ts,
            "last_date": last_ts,
        }

    return UniversePrices(prices, data_files=data_files)
