# venues/crypto/kraken.py — Kraken venue adapter
#
# Thin wrapper around the existing KrakenAdapter so the new asset model
# layer can use it without duplicating any exchange logic.

from __future__ import annotations
from typing import Optional
from venues.base_venue import BaseVenue


class KrakenVenue(BaseVenue):
    """
    Wraps adapters/kraken_adapter.py.
    All real logic lives there; this class is a façade for the new interface.
    """

    def __init__(self):
        from adapters.kraken_adapter import KrakenAdapter
        self._inner = KrakenAdapter()

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "kraken"

    @property
    def asset_classes(self) -> list[str]:
        return ["crypto"]

    # ── Market data ───────────────────────────────────────────────────────────

    def fetch_ticker(self, symbol: str) -> dict:
        return self._inner.fetch_ticker(symbol)

    def fetch_order_book(self, symbol: str, depth: int = 20) -> dict:
        return self._inner.fetch_order_book(symbol, depth)

    def fetch_balance(self) -> dict:
        return self._inner.fetch_balance()

    def fetch_candles(self, symbol: str, timeframe: str = "1h", limit: int = 100) -> list[dict]:
        """Fetch OHLCV candles via ccxt."""
        try:
            import time
            tf_map = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h",
                      "4h": "4h", "1d": "1d"}
            ccxt_tf = tf_map.get(timeframe, "1h")
            raw = self._inner._client.fetch_ohlcv(symbol, ccxt_tf, limit=limit)
            return [
                {"ts": r[0] / 1000, "open": r[1], "high": r[2],
                 "low": r[3], "close": r[4], "volume": r[5]}
                for r in raw
            ]
        except Exception:
            return []

    # ── Order management ──────────────────────────────────────────────────────

    def place_order(self, symbol: str, side: str, quantity: float,
                    order_type: str = "limit", price: Optional[float] = None) -> dict:
        return self._inner.place_order(symbol, side, quantity, order_type, price)

    def cancel_order(self, order_id: str, symbol: str) -> dict:
        return self._inner.cancel_order(order_id, symbol)

    def fetch_order(self, order_id: str, symbol: str) -> dict:
        return self._inner.fetch_order(order_id, symbol)

    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        return self._inner.fetch_open_orders(symbol)

    # ── Venue-specific ────────────────────────────────────────────────────────

    def get_trading_hours(self) -> dict:
        return {"always_open": True}
