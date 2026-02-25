from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Optional, Tuple

if TYPE_CHECKING:  # pragma: no cover
    from quantlab.data.providers.base import DataProvider


def _safe_token(s: Optional[str]) -> str:
    if s is None or str(s).strip() == "":
        return "none"
    out = []
    for ch in str(s).strip():
        if ch.isalnum() or ch in ("-", "_", "."):
            out.append(ch)
        else:
            out.append("-")
    return "".join(out)


def get_cache_path(
    ticker: str,
    start: Optional[str],
    end: Optional[str],
    interval: str = "1d",
    *,
    provider_name: Optional[str] = None,
    project_root: Optional[Path] = None,
) -> Path:
    """
    Deterministic cache path for a ticker/date range/interval.

    Cache root defaults to `<project_root>/data/cache/`.

    Provider namespacing:
    - For `provider_name` other than "yfinance", cache files are stored under:
        `data/cache/<provider_name>/...`
      to avoid collisions across providers and preserve reproducibility of past runs.
    - For yfinance (or unknown), we keep the legacy location `data/cache/` for
      backward compatibility with existing cached artifacts.
    """
    if project_root is None:
        project_root = Path(__file__).resolve().parents[1]

    base_cache_dir = Path(project_root) / "data" / "cache"
    pn = _safe_token(provider_name).lower() if provider_name else ""
    if not pn or pn in {"none", "unknown"}:
        # Operational safety: cache paths must be namespaced by provider.
        raise ValueError(
            "provider_name is required for cache path computation. "
            "Ensure QUANTLAB_DATA_PROVIDER is set and a valid provider is used."
        )
    cache_dir = base_cache_dir / pn
    cache_dir.mkdir(parents=True, exist_ok=True)

    t = _safe_token(ticker).upper()
    s = _safe_token(start)
    e = _safe_token(end)
    i = _safe_token(interval)

    filename = f"{t}__{i}__{s}__{e}.csv"
    return cache_dir / filename


def get_prices_cached(
    ticker: str,
    start: Optional[str],
    end: Optional[str],
    interval: str = "1d",
    *,
    provider: Optional["DataProvider"] = None,
    strict: bool = False,
    no_network: Optional[bool] = None,
) -> Tuple["object", Path, str, bool]:
    """
    Fetch historical data for `ticker` with caching and return:
      (df, data_path, data_sha256, cache_hit)

    Cache storage: `data/cache[/<provider_name>]/<deterministic-name>.csv`
    """
    import pandas as pd

    from quantlab.data.providers.base import DataIntegrityError, iso_utc, standardize_ohlcv_columns, validate_ohlcv_df
    from quantlab.data.providers import ProviderFactory
    from quantlab.utils.hashing import sha256_bytes

    prov = provider or ProviderFactory.new()
    prov_name = getattr(prov, "provider_name", lambda: "unknown")()
    prov_ver = getattr(prov, "provider_version", lambda: "unknown")()

    data_path = get_cache_path(ticker, start, end, interval, provider_name=str(prov_name))
    meta_path = Path(str(data_path) + ".meta.json")

    if data_path.exists():
        raw = data_path.read_bytes()
        data_sha256 = sha256_bytes(raw)
        df = pd.read_csv(data_path, index_col=0, parse_dates=True)
        df = standardize_ohlcv_columns(df)
        validate_ohlcv_df(df, symbol=str(ticker).upper(), interval=str(interval), strict_calendar=bool(strict))

        meta: dict = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}

        # If metadata is missing, create a deterministic best-effort sidecar for provenance hardening.
        if not meta:
            try:
                retrieval_ts = datetime.fromtimestamp(data_path.stat().st_mtime, timezone.utc)
                retrieval_iso = retrieval_ts.isoformat().replace("+00:00", "Z")
            except Exception:
                retrieval_iso = iso_utc()

            meta = {
                "provider_name": str(prov_name),
                # Do not infer the version from the environment on cache-hit. If unknown, record as unknown.
                "provider_version": "unknown",
                "retrieval_timestamp": str(retrieval_iso),
                "request_params": {
                    "symbol": str(ticker),
                    "start": start,
                    "end": end,
                    "interval": str(interval),
                },
                "row_count": int(getattr(df, "shape", [0])[0]),
                "first_timestamp": df.index.min().isoformat() if not df.empty else "",
                "last_timestamp": df.index.max().isoformat() if not df.empty else "",
                "sha256": str(data_sha256),
                "file_sha256": str(data_sha256),
                "cache_hit": True,
                "meta_migrated_on_hit": True,
            }
            meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        # Integrity: ensure the sidecar hash matches the raw cache file bytes.
        meta_sha = str(meta.get("sha256") or meta.get("file_sha256") or "").strip()
        if meta_sha and meta_sha != str(data_sha256):
            raise DataIntegrityError(
                f"{str(ticker).upper()}: cache file sha256 mismatch: "
                f"meta={meta_sha} actual={data_sha256} path={data_path}"
            )
        meta_provider = str(meta.get("provider_name") or "").strip()
        if meta_provider and str(meta_provider) != str(prov_name) and str(prov_name) not in {"unknown", ""}:
            raise DataIntegrityError(
                f"{str(ticker).upper()}: cache provider mismatch: meta={meta_provider!r} prov={prov_name!r} path={data_path}"
            )

        # Normalize meta fields expected by downstream code.
        meta.setdefault("provider_name", str(prov_name))
        meta.setdefault("provider_version", "unknown")
        meta.setdefault("retrieval_timestamp", "")
        meta.setdefault("row_count", int(getattr(df, "shape", [0])[0]))
        meta.setdefault("first_timestamp", df.index.min().isoformat() if not df.empty else "")
        meta.setdefault("last_timestamp", df.index.max().isoformat() if not df.empty else "")
        meta.setdefault("file_sha256", str(data_sha256))
        meta.setdefault("sha256", str(data_sha256))
        meta["cache_hit"] = True

        try:
            df.attrs["quantlab_data"] = meta
        except Exception:
            pass
        return df, data_path, data_sha256, True

    # No-network mode: fail loudly on cache miss.
    if no_network is None:
        no_network = os.environ.get("QUANTLAB_NO_NETWORK", "").strip().lower() in {"1", "true", "yes"}
    if bool(no_network):
        raise DataIntegrityError(
            f"{str(ticker).upper()}: cache miss in no-network mode.\n"
            f"- provider={prov_name}\n"
            f"- interval={interval}\n"
            f"- start={start} end={end}\n"
            f"- expected_cache_path={data_path}\n"
            "- Disable QUANTLAB_NO_NETWORK or pre-populate the cache."
        )

    # Cache miss: fetch via provider abstraction (yfinance logic lives in provider module).
    import time

    retrieval_iso = iso_utc()
    attempts = 3
    backoff = [1.0, 2.0]  # fixed, deterministic
    last_err: Optional[BaseException] = None
    for i in range(attempts):
        try:
            df = prov.get_prices(str(ticker), start=start, end=end, interval=interval)
            break
        except DataIntegrityError:
            # Fail fast on rate limits/malformed data (no fallback providers).
            raise
        except Exception as e:
            last_err = e
            if i < attempts - 1:
                time.sleep(float(backoff[min(i, len(backoff) - 1)]))
                continue
            raise DataIntegrityError(f"{str(ticker).upper()}: provider fetch failed after {attempts} attempts: {e}") from e
    else:  # pragma: no cover
        raise DataIntegrityError(f"{str(ticker).upper()}: provider fetch failed: {last_err}")

    df = standardize_ohlcv_columns(df)
    validate_ohlcv_df(df, symbol=str(ticker).upper(), interval=str(interval), strict_calendar=bool(strict))

    # Deterministic-ish CSV output for hashing and caching.
    df.to_csv(
        data_path,
        index=True,
        date_format="%Y-%m-%dT%H:%M:%S",
        float_format="%.10f",
    )
    raw = data_path.read_bytes()
    data_sha256 = sha256_bytes(raw)

    meta = {
        "provider_name": str(prov_name),
        "provider_version": str(prov_ver),
        "retrieval_timestamp": str(retrieval_iso),
        "request_params": {
            "symbol": str(ticker),
            "start": start,
            "end": end,
            "interval": str(interval),
        },
        "row_count": int(getattr(df, "shape", [0])[0]),
        "first_timestamp": df.index.min().isoformat() if not df.empty else "",
        "last_timestamp": df.index.max().isoformat() if not df.empty else "",
        "sha256": str(data_sha256),
        "file_sha256": str(data_sha256),
        "cache_hit": False,
    }
    meta_path.write_text(json.dumps(meta, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        df.attrs["quantlab_data"] = meta
    except Exception:
        pass
    return df, data_path, data_sha256, False
