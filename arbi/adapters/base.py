# adapters/base.py — Abstract base class for all exchange adapters

from abc import ABC, abstractmethod
from typing import Optional


class BaseAdapter(ABC):
    """
    All exchange adapters must implement this interface.
    Strategy and execution code should only talk to this abstraction,
    never to raw exchange payloads.
    """

    @abstractmethod
    def get_name(self) -> str:
        """Return the exchange name string."""
        ...

    @abstractmethod
    def fetch_balance(self) -> dict:
        """
        Return normalized balances:
        { "BTC": {"free": 0.5, "used": 0.1, "total": 0.6}, ... }
        """
        ...

    @abstractmethod
    def fetch_ticker(self, symbol: str) -> dict:
        """
        Return normalized ticker:
        { "last": float, "bid": float, "ask": float,
          "base_volume": float, "quote_volume": float }
        """
        ...

    @abstractmethod
    def fetch_order_book(self, symbol: str, depth: int = 20) -> dict:
        """
        Return normalized order book:
        { "bids": [[price, qty], ...], "asks": [[price, qty], ...] }
        """
        ...

    @abstractmethod
    def place_order(self, symbol: str, side: str, quantity: float,
                    order_type: str = "limit",
                    price: Optional[float] = None) -> dict:
        """
        Place an order. Return normalized order record:
        { "order_id": str, "status": str, "symbol": str,
          "side": str, "quantity": float, "price": float, ... }
        """
        ...

    @abstractmethod
    def cancel_order(self, order_id: str, symbol: str) -> dict:
        """Cancel an order by ID. Return updated order record."""
        ...

    @abstractmethod
    def fetch_order(self, order_id: str, symbol: str) -> dict:
        """Fetch latest status of an order."""
        ...

    @abstractmethod
    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        """Return list of all currently open orders."""
        ...
