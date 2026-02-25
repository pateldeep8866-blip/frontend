from __future__ import annotations

import asyncio
import json
import os
import threading
from datetime import datetime, timezone
from typing import Callable, Dict, Optional

from quantlab.live.providers import MarketDataProvider, Tick, validate_tick


def _iso_to_dt(s: str) -> datetime:
    # Alpaca timestamps are ISO8601; normalize to aware UTC where possible.
    try:
        if s.endswith("Z"):
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        return datetime.fromisoformat(s)
    except Exception:
        return datetime.now(timezone.utc)


class AlpacaProvider(MarketDataProvider):
    """
    Optional Alpaca market data websocket provider (paper-only, data-only).

    Requirements:
    - Env vars: ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_PAPER_BASE_URL, ALPACA_DATA_FEED
    - Dependency: `websockets` (optional; not required for tests)

    IMPORTANT:
    - This provider never submits orders. It only streams quotes/trades for valuation.
    """

    def __init__(self) -> None:
        self.api_key = os.getenv("ALPACA_API_KEY", "").strip()
        self.secret_key = os.getenv("ALPACA_SECRET_KEY", "").strip()
        self.paper_base_url = os.getenv("ALPACA_PAPER_BASE_URL", "").strip()
        self.data_feed = os.getenv("ALPACA_DATA_FEED", "").strip()  # iex/sip

        self._symbols: list[str] = []
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._callback: Optional[Callable[[Tick], None]] = None

        self._latest: Dict[str, Dict[str, Optional[float]]] = {}

    def configured(self) -> bool:
        return bool(self.api_key and self.secret_key and self.paper_base_url and self.data_feed)

    def connect(self) -> None:
        if not self.configured():
            raise RuntimeError(
                "AlpacaProvider not configured. Set env vars: "
                "ALPACA_API_KEY, ALPACA_SECRET_KEY, ALPACA_PAPER_BASE_URL, ALPACA_DATA_FEED."
            )
        # Fail fast on missing optional dependency instead of dying silently in a thread.
        try:
            import websockets  # type: ignore  # noqa: F401
        except ModuleNotFoundError as e:
            raise RuntimeError("Missing optional dependency: websockets") from e

    def subscribe(self, symbols: list[str]) -> None:
        self._symbols = [str(s).upper().strip() for s in symbols if str(s).strip()]
        self._symbols = sorted(list(dict.fromkeys(self._symbols)))

    def start_stream(self, on_tick_callback: Callable[[Tick], None]) -> None:
        self._callback = on_tick_callback
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="AlpacaProvider", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self._thread = None

    def _run(self) -> None:
        asyncio.run(self._run_async())

    async def _run_async(self) -> None:
        try:
            import websockets  # type: ignore
        except ModuleNotFoundError as e:
            raise ModuleNotFoundError("Missing optional dependency: websockets") from e

        # Alpaca data websocket endpoint:
        # https://alpaca.markets/docs/api-references/market-data-api/stock-pricing-data/realtime/
        # Example: wss://stream.data.alpaca.markets/v2/iex
        feed = self.data_feed.lower()
        ws_url = f"wss://stream.data.alpaca.markets/v2/{feed}"

        async with websockets.connect(ws_url, ping_interval=20, ping_timeout=20) as ws:
            # Auth
            await ws.send(json.dumps({"action": "auth", "key": self.api_key, "secret": self.secret_key}))
            # Subscribe
            await ws.send(json.dumps({"action": "subscribe", "trades": self._symbols, "quotes": self._symbols}))

            while not self._stop.is_set():
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                try:
                    msgs = json.loads(raw)
                except Exception:
                    continue

                if not isinstance(msgs, list):
                    continue

                for m in msgs:
                    if not isinstance(m, dict):
                        continue
                    typ = m.get("T")
                    sym = str(m.get("S", "")).upper().strip()
                    if not sym:
                        continue
                    ts = _iso_to_dt(str(m.get("t", "")))

                    state = self._latest.setdefault(sym, {"last": None, "bid": None, "ask": None})

                    if typ == "t":  # trade
                        px = m.get("p")
                        if px is not None:
                            state["last"] = float(px)
                    elif typ == "q":  # quote
                        bp = m.get("bp")
                        ap = m.get("ap")
                        if bp is not None:
                            state["bid"] = float(bp)
                        if ap is not None:
                            state["ask"] = float(ap)
                    else:
                        continue

                    last = state.get("last")
                    if last is None or float(last) <= 0:
                        continue

                    tick = validate_tick(
                        {
                            "symbol": sym,
                            "ts": ts,
                            "last": float(last),
                            "bid": state.get("bid"),
                            "ask": state.get("ask"),
                        }
                    )
                    if self._callback is not None:
                        self._callback(tick)
