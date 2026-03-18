# venues/futures/generic.py — Generic futures venue adapter (STUB)
#
# Intended as a base for CME/CBOE futures via IBKR or a dedicated futures broker.
# Key differences from equities to implement:
#   - Contract specs: multiplier, tick size, initial/maintenance margin
#   - Front-month vs continuous contract roll logic
#   - Margin-adjusted position sizing (notional >> capital)
#   - Settlement type (cash-settled: ES, NQ; physically-settled: CL, GC)

from __future__ import annotations
from typing import Optional
from venues.base_venue import BaseVenue
from utils.logger import get_logger

log = get_logger("venues.futures")

# Contract specs: {root_symbol: {multiplier, tick_size, margin_fraction}}
CONTRACT_SPECS = {
    "ES":  {"multiplier": 50,    "tick_size": 0.25,  "margin_fraction": 0.05},  # S&P 500
    "NQ":  {"multiplier": 20,    "tick_size": 0.25,  "margin_fraction": 0.05},  # NASDAQ 100
    "RTY": {"multiplier": 50,    "tick_size": 0.10,  "margin_fraction": 0.05},  # Russell 2000
    "CL":  {"multiplier": 1000,  "tick_size": 0.01,  "margin_fraction": 0.06},  # WTI Crude
    "GC":  {"multiplier": 100,   "tick_size": 0.10,  "margin_fraction": 0.06},  # Gold
    "ZB":  {"multiplier": 1000,  "tick_size": 0.015625, "margin_fraction": 0.04}, # 30Y T-Bond
}


class GenericFuturesVenue(BaseVenue):

    @property
    def name(self) -> str:
        return "generic_futures"

    @property
    def asset_classes(self) -> list[str]:
        return ["futures"]

    def fetch_ticker(self, symbol: str) -> dict:
        raise NotImplementedError("GenericFuturesVenue not yet implemented")

    def fetch_order_book(self, symbol: str, depth: int = 20) -> dict:
        raise NotImplementedError("GenericFuturesVenue not yet implemented")

    def fetch_balance(self) -> dict:
        raise NotImplementedError("GenericFuturesVenue not yet implemented")

    def place_order(self, symbol, side, quantity, order_type="limit", price=None) -> dict:
        raise NotImplementedError("GenericFuturesVenue not yet implemented")

    def cancel_order(self, order_id: str, symbol: str) -> dict:
        raise NotImplementedError("GenericFuturesVenue not yet implemented")

    def fetch_order(self, order_id: str, symbol: str) -> dict:
        raise NotImplementedError("GenericFuturesVenue not yet implemented")

    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        raise NotImplementedError("GenericFuturesVenue not yet implemented")

    @staticmethod
    def contract_spec(root: str) -> dict:
        """Return contract specifications for a futures root symbol."""
        return CONTRACT_SPECS.get(root, {})

    @staticmethod
    def notional_value(root: str, price: float, contracts: int = 1) -> float:
        spec = CONTRACT_SPECS.get(root, {})
        return price * spec.get("multiplier", 1) * contracts
