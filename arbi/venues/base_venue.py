# venues/base_venue.py — Abstract base for all venue adapters
#
# Venues are execution endpoints: exchanges, brokers, or data providers.
# They know nothing about signals or EV — only about placing/cancelling orders
# and fetching market data in the canonical format.

from __future__ import annotations
from abc import ABC, abstractmethod
from typing import Optional


class BaseVenue(ABC):
    """
    Minimal contract every venue must satisfy.

    Symbol convention: venues normalize to the internal format on the way out
    (fetch_ticker → returns "BTC/USD") and accept internal symbols on the way in
    (place_order("BTC/USD", ...) → translates to venue-native symbol internally).
    """

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique venue identifier, e.g. 'binance_us', 'alpaca'."""
        ...

    @property
    @abstractmethod
    def asset_classes(self) -> list[str]:
        """Asset classes this venue supports, e.g. ['crypto'], ['equities']."""
        ...

    # ── Market data ───────────────────────────────────────────────────────────

    @abstractmethod
    def fetch_ticker(self, symbol: str) -> dict:
        """
        Returns: {"last": float, "bid": float, "ask": float,
                  "base_volume": float, "quote_volume": float, "ts": float}
        """
        ...

    @abstractmethod
    def fetch_order_book(self, symbol: str, depth: int = 20) -> dict:
        """
        Returns: {"bids": [[price, qty], ...], "asks": [[price, qty], ...], "ts": float}
        """
        ...

    @abstractmethod
    def fetch_balance(self) -> dict:
        """
        Returns: {"BTC": {"free": float, "used": float, "total": float}, ...}
        """
        ...

    # ── Order management ──────────────────────────────────────────────────────

    @abstractmethod
    def place_order(
        self,
        symbol:     str,
        side:       str,       # "buy" | "sell"
        quantity:   float,
        order_type: str        = "limit",
        price:      Optional[float] = None,
    ) -> dict:
        """
        Returns normalized order dict:
        {"order_id": str, "status": str, "symbol": str, "side": str,
         "quantity": float, "price": float, "filled_qty": float,
         "avg_fill_price": float, "fee": float, "exchange": str}
        """
        ...

    @abstractmethod
    def cancel_order(self, order_id: str, symbol: str) -> dict:
        """Returns updated order dict."""
        ...

    @abstractmethod
    def fetch_order(self, order_id: str, symbol: str) -> dict:
        """Returns current order dict."""
        ...

    @abstractmethod
    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        """Returns list of open order dicts."""
        ...

    # ── Optional overrides ────────────────────────────────────────────────────

    def normalize_symbol(self, internal: str) -> str:
        """
        Translate internal symbol to venue-native form.
        Default: pass through unchanged (override where needed).
        """
        return internal

    def get_min_order_size(self, symbol: str) -> float:
        """Minimum order size in base currency. Default: 0 (no minimum)."""
        return 0.0

    def get_trading_hours(self) -> dict:
        """
        Return trading hours metadata.
        crypto: {"always_open": True}
        equities: {"market_open": "09:30", "market_close": "16:00", "timezone": "America/New_York"}
        """
        return {"always_open": True}

    def supports_paper_trading(self) -> bool:
        """True if venue supports built-in paper/sandbox mode."""
        return False

    def fetch_candles(
        self,
        symbol:    str,
        timeframe: str = "1h",
        limit:     int = 100,
    ) -> list[dict]:
        """
        Fetch OHLCV candles. Optional — not all venues support this.
        Returns: [{"open": float, "high": float, "low": float,
                   "close": float, "volume": float, "ts": float}, ...]
        """
        raise NotImplementedError(f"{self.name} does not implement fetch_candles()")

    # ── Compatibility shim: expose as BaseAdapter for existing execution code ──

    def get_name(self) -> str:
        return self.name
