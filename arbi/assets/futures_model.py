# assets/futures_model.py — Futures asset model (STUB)
#
# Placeholder for futures support (ES, NQ, CL, GC, etc.).
# Implement estimate_fees, margin logic, roll handling, and
# contract specification lookups before activating.

from __future__ import annotations
from typing import Optional
from assets.base_asset import BaseAssetModel
from core.candidate import TradeCandidateRecord, AssetClass


class FuturesAssetModel(BaseAssetModel):

    @property
    def asset_class(self) -> str:
        return AssetClass.FUTURES.value

    @property
    def supported_strategies(self) -> list[str]:
        return ["momentum", "mean_reversion", "term_structure"]

    def scan(self, market_data, regime, candles=None) -> list:
        # TODO: implement futures scanning
        # Key differences vs equities:
        #   - Contract specs (multiplier, tick size, margin)
        #   - Roll handling (front month vs continuous)
        #   - Margin-adjusted sizing
        raise NotImplementedError("FuturesAssetModel.scan() not yet implemented")

    def estimate_fees(self, venue: str, order_type: str = "limit") -> float:
        # Typical futures round-trip: ~$4–8 per contract
        # Expressed as fraction: depends on contract value
        return 0.0005  # placeholder

    def estimate_slippage(self, symbol, order_book, size_usd, side) -> float:
        return self._book_slippage(order_book, size_usd, side)

    def validate_order(self, candidate, balance) -> tuple[bool, str]:
        return False, "futures_not_implemented"

    def exit_rules(self, position, market_data, regime) -> Optional[str]:
        return None
