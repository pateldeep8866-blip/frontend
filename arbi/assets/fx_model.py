# assets/fx_model.py — FX (Foreign Exchange) asset model (STUB)
#
# Placeholder for spot FX via OANDA or similar venues.
# Key differences to implement:
#   - 24/5 market hours (Sun 17:00 ET – Fri 17:00 ET)
#   - Pip-based spread quoting
#   - Carry trade signals (interest rate differential)
#   - Micro/nano lot sizing

from __future__ import annotations
from typing import Optional
from assets.base_asset import BaseAssetModel
from core.candidate import TradeCandidateRecord, AssetClass


class FxAssetModel(BaseAssetModel):

    @property
    def asset_class(self) -> str:
        return AssetClass.FX.value

    @property
    def supported_strategies(self) -> list[str]:
        return ["mean_reversion", "carry_trade", "momentum"]

    def scan(self, market_data, regime, candles=None) -> list:
        raise NotImplementedError("FxAssetModel.scan() not yet implemented")

    def estimate_fees(self, venue: str, order_type: str = "limit") -> float:
        # FX spread-based: typical 1-2 pip spread on majors ≈ 0.01%
        return 0.0001

    def estimate_slippage(self, symbol, order_book, size_usd, side) -> float:
        return 0.00005  # 0.5 pip typical slippage on majors

    def validate_order(self, candidate, balance) -> tuple[bool, str]:
        return False, "fx_not_implemented"

    def exit_rules(self, position, market_data, regime) -> Optional[str]:
        return None
