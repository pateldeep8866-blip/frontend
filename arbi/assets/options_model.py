# assets/options_model.py — Options asset model (STUB)
#
# Future implementation areas:
#   - Greeks computation (delta, gamma, theta, vega)
#   - IV surface fetching
#   - Defined-risk strategies (verticals, iron condors)
#   - Theta decay as a positive carry signal
#   - Earnings play sizing

from __future__ import annotations
from typing import Optional
from assets.base_asset import BaseAssetModel
from core.candidate import TradeCandidateRecord, AssetClass


class OptionsAssetModel(BaseAssetModel):

    @property
    def asset_class(self) -> str:
        return AssetClass.OPTIONS.value

    @property
    def supported_strategies(self) -> list[str]:
        return ["theta_decay", "iv_crush", "directional"]

    def scan(self, market_data, regime, candles=None) -> list:
        raise NotImplementedError("OptionsAssetModel not yet implemented")

    def estimate_fees(self, venue: str, order_type: str = "limit") -> float:
        return 0.0030  # ~$0.65 per contract ≈ 0.3% on small positions

    def estimate_slippage(self, symbol, order_book, size_usd, side) -> float:
        return 0.005  # options spreads are wide; conservative 50 bps

    def validate_order(self, candidate, balance) -> tuple[bool, str]:
        return False, "options_not_implemented"

    def exit_rules(self, position, market_data, regime) -> Optional[str]:
        return None
