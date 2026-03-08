# data/ws_feed.py — Real-time WebSocket price feed (Kraken example)
# This runs in a background thread alongside the main polling loop.

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


class KrakenWSFeed:
    """
    Lightweight WebSocket feed for Kraken ticker updates.
    Calls price_callback(symbol, price) on each update.
    Run via start() in a daemon thread.
    """

    WS_URL = "wss://ws.kraken.com"

    def __init__(self, symbols: list, price_callback: Callable):
        self.symbols       = [s.replace("/", "") for s in symbols]  # "BTC/USDT" → "BTCUSDT"
        self.callback      = price_callback
        self._ws: Optional[object] = None
        self._running      = False

    def start(self) -> threading.Thread:
        if not WS_AVAILABLE:
            log.error("Cannot start WS feed — websocket-client missing")
            return None

        self._running = True
        t = threading.Thread(target=self._run, daemon=True, name="KrakenWSFeed")
        t.start()
        log.info("WebSocket feed thread started")
        return t

    def stop(self) -> None:
        self._running = False
        if self._ws:
            self._ws.close()

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
                log.error("WS error: %s — reconnecting in 5s", exc)
            if self._running:
                time.sleep(5)

    def _on_open(self, ws) -> None:
        sub = {
            "event":        "subscribe",
            "pair":         self.symbols,
            "subscription": {"name": "ticker"},
        }
        ws.send(json.dumps(sub))
        log.info("WS subscribed to: %s", self.symbols)

    def _on_message(self, ws, message: str) -> None:
        try:
            data = json.loads(message)
            if isinstance(data, list) and len(data) >= 4:
                payload = data[1]
                pair    = data[3]
                if isinstance(payload, dict) and "c" in payload:
                    price = float(payload["c"][0])
                    self.callback(pair, price)
        except Exception as exc:
            log.debug("WS parse error: %s", exc)

    def _on_error(self, ws, error) -> None:
        log.warning("WS error: %s", error)

    def _on_close(self, ws, code, msg) -> None:
        log.info("WS closed (code=%s)", code)
