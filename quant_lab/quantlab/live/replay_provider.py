from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import Any, Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from quantlab.live.providers import MarketDataProvider, Tick, validate_tick


class ReplayProvider(MarketDataProvider):
    """
    Deterministic historical replay provider.

    - Uses cached OHLCV bars (prefers 1m if cached, else falls back to 1d).
    - Emits ticks sequentially in timestamp order.
    - Paper-only: no orders; data-only.
    """

    def __init__(
        self,
        *,
        start: str,
        end: str,
        asof: Optional[str] = None,
        speed: float = 10.0,
        offline: bool = True,
        async_mode: bool = True,
        bars_by_symbol: Optional[Dict[str, Sequence[Tuple[datetime, float]]]] = None,
    ):
        self.start = str(start)
        self.end = str(end)
        self.asof = str(asof) if asof is not None else None
        self.speed = float(speed)
        self.offline = bool(offline)
        self.async_mode = bool(async_mode)
        self._symbols: list[str] = []
        self._bars_by_symbol = bars_by_symbol

        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._stream_info: Dict[str, Any] = {}

    def stream_info(self) -> Dict[str, Any]:
        """
        Best-effort diagnostics about the most recent built stream (for UI/logging).
        """
        return dict(self._stream_info)

    def connect(self) -> None:
        return

    def subscribe(self, symbols: list[str]) -> None:
        self._symbols = [str(s).upper().strip() for s in symbols if str(s).strip()]
        self._symbols = sorted(list(dict.fromkeys(self._symbols)))  # stable de-dupe
        if self._bars_by_symbol is None:
            self._bars_by_symbol = self._load_cached_bars(self._symbols)

    def start_stream(self, on_tick_callback: Callable[[Tick], None]) -> None:
        if self._bars_by_symbol is None:
            raise RuntimeError("ReplayProvider.subscribe() must be called before start_stream().")

        stream = self._build_tick_stream()
        if not stream:
            raise RuntimeError(
                "ReplayProvider has no ticks to replay.\n"
                f"- symbols={self._symbols}\n"
                f"- start={self.start} end={self.end} asof={self.asof}\n"
                "- Hint: pick an earlier as-of date (or a later end date) so there are bars to replay."
            )
        self._stream_info = {
            "tick_count": int(len(stream)),
            "start_ts": stream[0]["ts"].isoformat(),
            "end_ts": stream[-1]["ts"].isoformat(),
            "unique_symbols": int(len({t["symbol"] for t in stream})),
        }

        def _run() -> None:
            self._run_stream(on_tick_callback, stream)

        if self.async_mode:
            self._stop.clear()
            self._thread = threading.Thread(target=_run, name="ReplayProvider", daemon=True)
            self._thread.start()
            return

        # Synchronous mode (used by deterministic tests).
        self._stop.clear()
        self._run_stream(on_tick_callback, stream)

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self._thread = None

    def _load_cached_bars(self, symbols: Sequence[str]) -> Dict[str, Sequence[Tuple[datetime, float]]]:
        """
        Load cached bars for symbols. Prefers interval=1m if cached, else 1d.

        If offline=True and no cache exists, raises FileNotFoundError.
        """
        try:
            import pandas as pd  # type: ignore
        except ModuleNotFoundError as e:  # pragma: no cover
            raise ModuleNotFoundError("pandas is required to load cached replay data.") from e

        from quantlab.data.providers import ProviderFactory
        from quantlab.data_cache import get_cache_path, get_prices_cached

        # Prefer caches created by the currently-selected provider; fall back to legacy root caches.
        try:
            prov = ProviderFactory.new()
            prov_name = getattr(prov, "provider_name", lambda: "unknown")()
        except Exception:
            prov_name = "unknown"

        out: Dict[str, Sequence[Tuple[datetime, float]]] = {}
        for sym in symbols:
            # Try 1m cache file without triggering downloads.
            path_1m = get_cache_path(sym, self.start, self.end, "1m", provider_name=str(prov_name))
            if path_1m.exists():
                df = pd.read_csv(path_1m, index_col=0, parse_dates=True)
            else:
                path_1d = get_cache_path(sym, self.start, self.end, "1d", provider_name=str(prov_name))
                if path_1d.exists():
                    df = pd.read_csv(path_1d, index_col=0, parse_dates=True)
                else:
                    # Legacy fallback: caches without provider namespacing.
                    legacy_1m = get_cache_path(sym, self.start, self.end, "1m", provider_name="yfinance")
                    legacy_1d = get_cache_path(sym, self.start, self.end, "1d", provider_name="yfinance")
                    if legacy_1m.exists():
                        df = pd.read_csv(legacy_1m, index_col=0, parse_dates=True)
                    elif legacy_1d.exists():
                        df = pd.read_csv(legacy_1d, index_col=0, parse_dates=True)
                    else:
                        if self.offline:
                            raise FileNotFoundError(
                                f"No cached data for {sym} in {path_1m} or {path_1d}. "
                                "Run the Morning Plan first to populate caches, or set offline=False."
                            )
                        df, _, _, _ = get_prices_cached(sym, start=self.start, end=self.end, interval="1d")

            if not isinstance(df.index, pd.DatetimeIndex):
                df.index = pd.to_datetime(df.index)
            df = df.sort_index()
            if df.empty:
                continue

            # Use Adj Close if present and non-empty else Close.
            if "Adj Close" in df.columns and df["Adj Close"].notna().any():
                close = df["Adj Close"].astype(float)
            else:
                close = df["Close"].astype(float)

            rows: list[Tuple[datetime, float]] = []
            for ts, px in close.dropna().items():
                dt = ts.to_pydatetime() if hasattr(ts, "to_pydatetime") else ts
                rows.append((dt, float(px)))
            out[str(sym)] = rows
        return out

    def _build_tick_stream(self) -> list[Tick]:
        bars = self._bars_by_symbol or {}
        stream: list[Tick] = []

        # Determine replay start timestamp.
        #
        # - If `asof` is set, replay starts at the first bar timestamp >= asof.
        # - If no timestamp exists >= asof (e.g., end is exclusive and the last bar is before asof),
        #   fall back to the last available bar so the stream is non-empty and deterministic.
        all_ts: list[datetime] = []
        for sym in sorted(bars.keys()):
            for ts, _last in bars[sym]:
                all_ts.append(ts)
        all_ts = sorted(set(all_ts))
        if not all_ts:
            return []

        start_ts = all_ts[0]
        if self.asof:
            asof_dt: Optional[datetime]
            try:
                asof_dt = datetime.fromisoformat(self.asof)
            except Exception:
                asof_dt = None
            if asof_dt is not None:
                nxt = None
                for ts in all_ts:
                    if ts >= asof_dt:
                        nxt = ts
                        break
                start_ts = nxt if nxt is not None else all_ts[-1]

        for sym in sorted(bars.keys()):
            for ts, last in bars[sym]:
                if ts < start_ts:
                    continue
                stream.append(
                    validate_tick(
                        {
                            "symbol": sym,
                            "ts": ts,
                            "last": float(last),
                            "bid": None,
                            "ask": None,
                        }
                    )
                )

        stream.sort(key=lambda t: (t["ts"], t["symbol"]))
        return stream

    def _run_stream(self, on_tick_callback: Callable[[Tick], None], stream: list[Tick]) -> None:
        # Speed is "ticks per second"; clamp to avoid division by zero.
        tps = max(0.0, float(self.speed))
        delay = 0.0 if tps <= 0 else (1.0 / tps)

        for tick in stream:
            if self._stop.is_set():
                break
            on_tick_callback(tick)
            if delay > 0:
                time.sleep(delay)
