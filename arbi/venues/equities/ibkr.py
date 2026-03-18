# venues/equities/ibkr.py — Interactive Brokers venue adapter (STUB)
#
# Requires: ib_insync (pip install ib_insync) or ibapi
# IBKR TWS or IB Gateway must be running locally on port 7497 (paper) / 7496 (live)
#
# Key IBKR-specific features to implement:
#   - Contract lookup (reqContractDetails)
#   - Fractional shares (optional, account-dependent)
#   - Bracket orders (limit + stop-loss as linked orders)
#   - Options chains via reqSecDefOptParams
#   - Futures contracts
#   - Multiple asset classes: STK, OPT, FUT, CASH (FX)

from __future__ import annotations
from typing import Optional
from venues.base_venue import BaseVenue
from utils.logger import get_logger

log = get_logger("venues.ibkr")


class IBKRVenue(BaseVenue):

    def __init__(self, port: int = 7497, client_id: int = 1):
        # port 7497 = paper TWS, 7496 = live TWS
        # port 4002 = paper IB Gateway, 4001 = live IB Gateway
        self._port      = port
        self._client_id = client_id
        self._ib        = self._connect()
        log.info("IBKRVenue initialized (port=%d)", self._port)

    def _connect(self):
        try:
            from ib_insync import IB
            ib = IB()
            ib.connect("127.0.0.1", self._port, clientId=self._client_id)
            return ib
        except Exception as exc:
            log.warning("IBKR connection failed: %s. Methods will raise NotImplementedError.", exc)
            return None

    @property
    def name(self) -> str:
        return "ibkr"

    @property
    def asset_classes(self) -> list[str]:
        return ["equities", "options", "futures", "fx"]

    def fetch_ticker(self, symbol: str) -> dict:
        raise NotImplementedError("IBKRVenue.fetch_ticker() not yet implemented")

    def fetch_order_book(self, symbol: str, depth: int = 20) -> dict:
        raise NotImplementedError("IBKRVenue.fetch_order_book() not yet implemented")

    def fetch_balance(self) -> dict:
        raise NotImplementedError("IBKRVenue.fetch_balance() not yet implemented")

    def place_order(self, symbol, side, quantity, order_type="limit", price=None) -> dict:
        raise NotImplementedError("IBKRVenue.place_order() not yet implemented")

    def cancel_order(self, order_id: str, symbol: str) -> dict:
        raise NotImplementedError("IBKRVenue.cancel_order() not yet implemented")

    def fetch_order(self, order_id: str, symbol: str) -> dict:
        raise NotImplementedError("IBKRVenue.fetch_order() not yet implemented")

    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        raise NotImplementedError("IBKRVenue.fetch_open_orders() not yet implemented")

    def get_trading_hours(self) -> dict:
        return {
            "market_open":  "09:30",
            "market_close": "16:00",
            "timezone":     "America/New_York",
            "always_open":  False,
        }
