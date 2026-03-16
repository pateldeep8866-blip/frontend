# data/ws_feed.py — Real-time WebSocket price feed (Kraken)

import json
import threading
import time
from typing import Callable, Optional

from utils.logger import get_logger

log = get_logger("data.ws_feed")

try:
    import websocket
    WS_AVAILABLE = True
except ImportError:
    WS_AVAILABLE = False
    log.warning("websocket-client not installed. Run: pip install websocket-client")

# Internal symbol → Kraken WS pair name (supports both /USDT and /USD internal symbols)
_KRAKEN_WS_MAP = {
    # USDT variants
    "BTC/USDT":   "XBT/USD",
    "ETH/USDT":   "ETH/USD",
    "SOL/USDT":   "SOL/USD",
    "XRP/USDT":   "XRP/USD",
    "ADA/USDT":   "ADA/USD",
    "DOGE/USDT":  "DOGE/USD",
    "AVAX/USDT":  "AVAX/USD",
    "DOT/USDT":   "DOT/USD",
    "LINK/USDT":  "LINK/USD",
    "ATOM/USDT":  "ATOM/USD",
    "LTC/USDT":   "LTC/USD",
    "UNI/USDT":   "UNI/USD",
    "MATIC/USDT": "POL/USD",   # Kraken renamed MATIC → POL
    # USD variants
    "BTC/USD":    "XBT/USD",
    "ETH/USD":    "ETH/USD",
    "SOL/USD":    "SOL/USD",
    "XRP/USD":    "XRP/USD",
    "ADA/USD":    "ADA/USD",
    "DOGE/USD":   "DOGE/USD",
    "AVAX/USD":   "AVAX/USD",
    "DOT/USD":    "DOT/USD",
    "LINK/USD":   "LINK/USD",
    "ATOM/USD":   "ATOM/USD",
    "LTC/USD":    "LTC/USD",
    "UNI/USD":    "UNI/USD",
    "MATIC/USD":  "POL/USD",   # Kraken renamed MATIC → POL
    # BNB not on Kraken — omitted intentionally
}
# Build reverse map; USD entries come last in _KRAKEN_WS_MAP so they win for the reverse lookup
_KRAKEN_WS_REVERSE = {v: k for k, v in _KRAKEN_WS_MAP.items()}

STALE_SEC = 30


class KrakenWSFeed:
    """
    Real-time Kraken WebSocket ticker feed.
    Caches latest prices; exposes get_price(internal_sym) and is_alive()
    to match the interface previously provided by BybitWSFeed.
    """

    WS_URL = "wss://ws.kraken.com"

    def __init__(self, symbols: list, price_callback: Optional[Callable] = None):
        self._internal_syms = [s for s in symbols if s in _KRAKEN_WS_MAP]
        self._kraken_pairs  = [_KRAKEN_WS_MAP[s] for s in self._internal_syms]
        self._callback      = price_callback
        self._cache: dict   = {}   # internal_sym → {"price": float, "ts": float}
        self._ws: Optional[object] = None
        self._running       = False
        self._last_msg      = 0.0
        self._lock          = threading.Lock()

    # ── Public API (matches BybitWSFeed interface) ─────────────────────────────

    def start(self) -> Optional[threading.Thread]:
        if not WS_AVAILABLE:
            log.error("Cannot start Kraken WS feed — websocket-client missing")
            return None
        self._running = True
        t = threading.Thread(target=self._run, daemon=True, name="KrakenWSFeed")
        t.start()
        log.info("KrakenWSFeed thread started for %d symbols", len(self._kraken_pairs))
        return t

    def stop(self) -> None:
        self._running = False
        if self._ws:
            self._ws.close()

    def get_price(self, internal_sym: str) -> Optional[float]:
        """Return cached price for an internal symbol (e.g. 'BTC/USDT'), or None if stale."""
        with self._lock:
            entry = self._cache.get(internal_sym)
        if entry and (time.time() - entry["ts"]) < STALE_SEC:
            return entry["price"]
        return None

    def is_alive(self) -> bool:
        return (time.time() - self._last_msg) < STALE_SEC

    # ── Internal ──────────────────────────────────────────────────────────────

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
            except Exception as exc:
                log.error("KrakenWS error: %s — reconnecting in 5s", exc)
            if self._running:
                time.sleep(5)

    def _on_open(self, ws) -> None:
        sub = {
            "event":        "subscribe",
            "pair":         self._kraken_pairs,
            "subscription": {"name": "ticker"},
        }
        ws.send(json.dumps(sub))
        log.info("KrakenWS subscribed: %s", self._kraken_pairs)

    def _on_message(self, ws, message: str) -> None:
        self._last_msg = time.time()
        try:
            data = json.loads(message)
            if isinstance(data, list) and len(data) >= 4:
                payload = data[1]
                kraken_pair = data[3]   # e.g. "XBT/USD"
                if isinstance(payload, dict) and "c" in payload:
                    price = float(payload["c"][0])
                    internal = _KRAKEN_WS_REVERSE.get(kraken_pair)
                    if internal:
                        with self._lock:
                            self._cache[internal] = {"price": price, "ts": self._last_msg}
                        if self._callback:
                            self._callback(internal, price)
        except Exception as exc:
            log.debug("KrakenWS parse error: %s", exc)

    def _on_error(self, ws, error) -> None:
        log.warning("KrakenWS error: %s", error)

    def _on_close(self, ws, code, msg) -> None:
        log.info("KrakenWS closed (code=%s)", code)


class BybitWSFeed:
    """
    Real-time Bybit linear perpetuals ticker feed.

    Connects to wss://stream.bybit.com/v5/public/linear, subscribes to
    tickers for every symbol, and keeps a price cache that the simulation
    engine reads directly.

    Usage:
        feed = BybitWSFeed(SYMBOLS)
        feed.start()
        price = feed.get_price("BTC/USDT")   # None if not yet received
        feed.is_alive()                        # True if last msg < 10 s ago
    """

    WS_URL      = "wss://stream.bybit.com/v5/public/linear"
    STALE_SEC   = 10      # price considered stale after this many seconds
    MAX_BACKOFF = 60      # max reconnect wait in seconds

    def __init__(self, symbols: list):
        # Normalise "BTC/USDT" → "BTCUSDT" for Bybit topic names
        self._sym_map = {s.replace("/", ""): s for s in symbols}  # "BTCUSDT" → "BTC/USDT"
        self._cache: dict = {}        # "BTC/USDT" → {"price": float, "ts": float}
        self._ws: Optional[object] = None
        self._running   = False
        self._last_msg  = 0.0
        self._backoff   = 1          # current reconnect delay
        self._lock      = threading.Lock()

    # ── Public API ────────────────────────────────────────────────────────────

    def start(self) -> threading.Thread:
        if not WS_AVAILABLE:
            log.error("Cannot start Bybit WS feed — websocket-client missing")
            return None
        self._running = True
        t = threading.Thread(target=self._run, daemon=True, name="BybitWSFeed")
        t.start()
        log.info("BybitWSFeed thread started for %d symbols", len(self._sym_map))
        return t

    def stop(self) -> None:
        self._running = False
        if self._ws:
            self._ws.close()

    def get_price(self, symbol: str) -> Optional[float]:
        """Return cached price for symbol (e.g. 'BTC/USDT'), or None if stale/missing."""
        with self._lock:
            entry = self._cache.get(symbol)
        if entry and (time.time() - entry["ts"]) < self.STALE_SEC:
            return entry["price"]
        return None

    def get_cache(self) -> dict:
        """Return full cache snapshot: {symbol: {"price": float, "ts": float}}."""
        with self._lock:
            return dict(self._cache)

    def is_alive(self) -> bool:
        """True if a message was received within the last STALE_SEC seconds."""
        return (time.time() - self._last_msg) < self.STALE_SEC

    # ── Internal ──────────────────────────────────────────────────────────────

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
                self._backoff = 1   # reset on clean exit
            except Exception as exc:
                log.error("BybitWS error: %s", exc)
            if self._running:
                log.info("BybitWS reconnecting in %ds …", self._backoff)
                time.sleep(self._backoff)
                self._backoff = min(self._backoff * 2, self.MAX_BACKOFF)

    def _on_open(self, ws) -> None:
        args = [f"tickers.{sym}" for sym in self._sym_map]
        ws.send(json.dumps({"op": "subscribe", "args": args}))
        log.info("BybitWS subscribed: %s", args)

    def _on_message(self, ws, message: str) -> None:
        self._last_msg = time.time()
        try:
            msg = json.loads(message)
            topic = msg.get("topic", "")
            if not topic.startswith("tickers."):
                return
            bybit_sym = topic.split(".", 1)[1]          # "BTCUSDT"
            canonical = self._sym_map.get(bybit_sym)    # "BTC/USDT"
            if not canonical:
                return
            data = msg.get("data", {})
            price_str = data.get("lastPrice") or data.get("last_price")
            if price_str:
                with self._lock:
                    self._cache[canonical] = {
                        "price": float(price_str),
                        "ts":    self._last_msg,
                    }
        except Exception as exc:
            log.debug("BybitWS parse error: %s", exc)

    def _on_error(self, ws, error) -> None:
        log.warning("BybitWS error: %s", error)

    def _on_close(self, ws, code, msg) -> None:
        log.info("BybitWS closed (code=%s)", code)
