# data/bybit_ws_feed.py — Bybit linear perpetuals WebSocket feed
#
# Connects to wss://stream.bybit.com/v5/public/linear
# Subscribes to:
#   tickers.{SYM}     — mid/last price, bid, ask, volume
#   publicTrade.{SYM} — individual trades for microstructure analysis
#
# REST fallback: GET https://api.bybit.com/v5/market/tickers?category=linear
#
# Output per symbol (via get_snapshot()):
#   {symbol, bid, ask, last, volume, timestamp}
#
# Interface matches BinanceUSWSFeed: start(), stop(), get_price(), is_alive()

from __future__ import annotations

import json
import threading
import time
from typing import Callable, Optional

from utils.logger import get_logger

log = get_logger("data.bybit_ws_feed")

try:
    import websocket
    WS_AVAILABLE = True
except ImportError:
    WS_AVAILABLE = False
    log.warning("websocket-client not installed — pip install websocket-client")

# Symbols this feed can handle (internal "BTC/USDT" → Bybit "BTCUSDT")
_BYBIT_SYM_MAP = {
    "BTC/USDT":  "BTCUSDT",
    "ETH/USDT":  "ETHUSDT",
    "SOL/USDT":  "SOLUSDT",
    "XRP/USDT":  "XRPUSDT",
    "DOGE/USDT": "DOGEUSDT",
    "ADA/USDT":  "ADAUSDT",
    "AVAX/USDT": "AVAXUSDT",
    "DOT/USDT":  "DOTUSDT",
    "BNB/USDT":  "BNBUSDT",
}
# Reverse: "BTCUSDT" → "BTC/USDT"
_BYBIT_SYM_REVERSE = {v: k for k, v in _BYBIT_SYM_MAP.items()}

STALE_SEC   = 30
MAX_BACKOFF = 60


class BybitPerpWSFeed:
    """
    Real-time Bybit linear perpetuals WebSocket feed.

    Subscribes to tickers + publicTrade for each symbol.
    Exposes get_price(), get_snapshot(), is_alive(), start(), stop().
    """

    WS_URL = "wss://stream.bybit.com/v5/public/linear"

    def __init__(self, symbols: list, price_callback: Optional[Callable] = None):
        # Only keep symbols we have a Bybit mapping for
        self._internal_syms = [s for s in symbols if s in _BYBIT_SYM_MAP]
        self._bybit_syms    = [_BYBIT_SYM_MAP[s] for s in self._internal_syms]
        self._callback      = price_callback

        # Full snapshot cache: internal_sym → {bid, ask, last, volume, ts}
        self._cache: dict[str, dict] = {}

        self._ws       = None
        self._running  = False
        self._last_msg = 0.0
        self._backoff  = 1
        self._lock     = threading.Lock()

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> Optional[threading.Thread]:
        if not WS_AVAILABLE:
            log.error("Cannot start BybitPerpWSFeed — websocket-client missing")
            return None
        self._running = True
        # Prime cache from REST so first tick has data immediately
        threading.Thread(target=self._rest_bootstrap, daemon=True,
                         name="BybitPerpWSFeed-boot").start()
        t = threading.Thread(target=self._run, daemon=True, name="BybitPerpWSFeed")
        t.start()
        log.info("BybitPerpWSFeed started for %d symbols: %s",
                 len(self._bybit_syms), self._bybit_syms)
        return t

    def stop(self) -> None:
        self._running = False
        if self._ws:
            self._ws.close()

    def get_price(self, internal_sym: str) -> Optional[float]:
        """Return cached last price, or None if stale/missing."""
        with self._lock:
            entry = self._cache.get(internal_sym)
        if entry and (time.time() - entry.get("ts", 0)) < STALE_SEC:
            return entry.get("last")
        return None

    def get_snapshot(self, internal_sym: str) -> Optional[dict]:
        """Return full {bid, ask, last, volume, ts} for a symbol."""
        with self._lock:
            entry = self._cache.get(internal_sym)
        if entry and (time.time() - entry.get("ts", 0)) < STALE_SEC:
            return dict(entry)
        return None

    def get_all_snapshots(self) -> dict:
        """Return copy of the full cache (all symbols)."""
        with self._lock:
            return {k: dict(v) for k, v in self._cache.items()}

    def is_alive(self) -> bool:
        return (time.time() - self._last_msg) < STALE_SEC

    # ── REST bootstrap ────────────────────────────────────────────────────────

    def _rest_bootstrap(self) -> None:
        """Fetch initial prices from REST so cache is warm before first WS message."""
        try:
            import urllib.request
            url = ("https://api.bybit.com/v5/market/tickers?category=linear&"
                   + "&".join(f"symbol={s}" for s in self._bybit_syms))
            with urllib.request.urlopen(url, timeout=10) as resp:
                data = json.loads(resp.read())
            items = data.get("result", {}).get("list", [])
            now = time.time()
            with self._lock:
                for item in items:
                    bybit_sym = item.get("symbol", "")
                    internal  = _BYBIT_SYM_REVERSE.get(bybit_sym)
                    if not internal:
                        continue
                    self._cache[internal] = {
                        "last":   float(item.get("lastPrice", 0) or 0),
                        "bid":    float(item.get("bid1Price", 0) or 0),
                        "ask":    float(item.get("ask1Price", 0) or 0),
                        "volume": float(item.get("volume24h", 0) or 0),
                        "ts":     now,
                    }
            log.info("BybitPerpWSFeed REST bootstrap: %d symbols primed", len(items))
        except Exception as exc:
            log.warning("BybitPerpWSFeed REST bootstrap failed: %s", exc)

    # ── WebSocket ─────────────────────────────────────────────────────────────

    def _run(self) -> None:
        while self._running:
            try:
                self._ws = websocket.WebSocketApp(
                    self.WS_URL,
                    on_open    = self._on_open,
                    on_message = self._on_message,
                    on_error   = self._on_error,
                    on_close   = self._on_close,
                )
                self._ws.run_forever(ping_interval=20, ping_timeout=10)
                self._backoff = 1
            except Exception as exc:
                log.error("BybitPerpWS error: %s", exc)
            if self._running:
                log.info("BybitPerpWS reconnecting in %ds…", self._backoff)
                time.sleep(self._backoff)
                self._backoff = min(self._backoff * 2, MAX_BACKOFF)

    def _on_open(self, ws) -> None:
        # Subscribe to tickers (bid/ask/last/volume) for each symbol
        ticker_args = [f"tickers.{s}" for s in self._bybit_syms]
        ws.send(json.dumps({"op": "subscribe", "args": ticker_args}))
        log.info("BybitPerpWS subscribed tickers: %s", ticker_args)

    def _on_message(self, ws, message: str) -> None:
        self._last_msg = time.time()
        try:
            msg   = json.loads(message)
            topic = msg.get("topic", "")

            if topic.startswith("tickers."):
                self._handle_ticker(msg)

        except Exception as exc:
            log.debug("BybitPerpWS parse error: %s", exc)

    def _handle_ticker(self, msg: dict) -> None:
        topic    = msg.get("topic", "")
        bybit_sym = topic.split(".", 1)[1] if "." in topic else ""
        internal  = _BYBIT_SYM_REVERSE.get(bybit_sym)
        if not internal:
            return
        data = msg.get("data", {})
        now  = time.time()

        last_str = data.get("lastPrice") or data.get("last_price")
        bid_str  = data.get("bid1Price") or data.get("bidPrice")
        ask_str  = data.get("ask1Price") or data.get("askPrice")
        vol_str  = data.get("volume24h") or data.get("turnover24h")

        with self._lock:
            existing = self._cache.get(internal, {})
            self._cache[internal] = {
                "last":   float(last_str) if last_str else existing.get("last", 0.0),
                "bid":    float(bid_str)  if bid_str  else existing.get("bid",  0.0),
                "ask":    float(ask_str)  if ask_str  else existing.get("ask",  0.0),
                "volume": float(vol_str)  if vol_str  else existing.get("volume", 0.0),
                "ts":     now,
            }

        if last_str and self._callback:
            self._callback(internal, float(last_str))

    def _on_error(self, ws, error) -> None:
        log.warning("BybitPerpWS error: %s", error)

    def _on_close(self, ws, code, msg) -> None:
        log.info("BybitPerpWS closed (code=%s)", code)
