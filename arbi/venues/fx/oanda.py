# venues/fx/oanda.py — OANDA FX venue adapter (STUB)
#
# Requires: oandapyV20 (pip install oandapyV20)
# Env vars: OANDA_API_KEY, OANDA_ACCOUNT_ID, OANDA_ENV (practice|live)
#
# Key OANDA-specific features to implement:
#   - Pip-based spread quoting (5-digit pricing)
#   - Units-based sizing (not lots) for micro/nano account support
#   - Streaming prices via /v3/accounts/{id}/pricing/stream
#   - Guaranteed stops (GTC orders with stop-loss attachment)
#   - Margin utilisation checks

from __future__ import annotations
from typing import Optional
from venues.base_venue import BaseVenue
from utils.logger import get_logger

log = get_logger("venues.oanda")


class OandaVenue(BaseVenue):

    def __init__(self):
        import os
        self._api_key    = os.getenv("OANDA_API_KEY", "")
        self._account_id = os.getenv("OANDA_ACCOUNT_ID", "")
        self._env        = os.getenv("OANDA_ENV", "practice")  # "practice" | "live"
        log.info("OandaVenue initialized (env=%s)", self._env)

    @property
    def name(self) -> str:
        return "oanda"

    @property
    def asset_classes(self) -> list[str]:
        return ["fx"]

    def fetch_ticker(self, symbol: str) -> dict:
        raise NotImplementedError("OandaVenue.fetch_ticker() not yet implemented")

    def fetch_order_book(self, symbol: str, depth: int = 20) -> dict:
        raise NotImplementedError("OandaVenue.fetch_order_book() not yet implemented")

    def fetch_balance(self) -> dict:
        raise NotImplementedError("OandaVenue.fetch_balance() not yet implemented")

    def place_order(self, symbol, side, quantity, order_type="limit", price=None) -> dict:
        raise NotImplementedError("OandaVenue.place_order() not yet implemented")

    def cancel_order(self, order_id: str, symbol: str) -> dict:
        raise NotImplementedError("OandaVenue.cancel_order() not yet implemented")

    def fetch_order(self, order_id: str, symbol: str) -> dict:
        raise NotImplementedError("OandaVenue.fetch_order() not yet implemented")

    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        raise NotImplementedError("OandaVenue.fetch_open_orders() not yet implemented")

    def normalize_symbol(self, internal: str) -> str:
        # EURUSD → EUR_USD  (OANDA convention)
        if "/" in internal:
            return internal.replace("/", "_")
        if len(internal) == 6 and "_" not in internal:
            return f"{internal[:3]}_{internal[3:]}"
        return internal

    def get_trading_hours(self) -> dict:
        # FX: 24/5 — Sun 17:00 ET to Fri 17:00 ET
        return {
            "market_open":  "17:00",
            "market_close": "17:00",
            "days":         "Sun-Fri",
            "timezone":     "America/New_York",
            "always_open":  False,
        }
