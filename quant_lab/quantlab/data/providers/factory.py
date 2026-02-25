from __future__ import annotations

import os
from typing import Optional

from quantlab.data.providers.base import DataProvider


class ProviderFactory:
    """Factory for market data providers.

    Selection order:
    1) explicit `name`
    2) env var `QUANTLAB_DATA_PROVIDER`
    3) REQUIRED: no implicit defaults (operational safety)

    Notes:
    - Provider SDK imports must stay inside provider modules.
    - This factory is intentionally small; additional providers can be
      added later without touching strategy code.
    """

    @staticmethod
    def new(name: Optional[str] = None) -> DataProvider:
        # Operational safety: provider selection is explicit only.
        prov = (str(name).strip() if name is not None else "").lower()
        if not prov:
            prov = (os.environ.get("QUANTLAB_DATA_PROVIDER") or "").strip().lower()
        if not prov:
            raise ValueError(
                "QUANTLAB_DATA_PROVIDER is required. "
                "Set it to one of: alphavantage, finnhub, stockdata."
            )

        if prov in {"alphavantage", "alpha_vantage", "av"}:
            from quantlab.data.providers.alphavantage_provider import AlphaVantageProvider

            return AlphaVantageProvider()

        if prov in {"finnhub"}:
            from quantlab.data.providers.finnhub_provider import FinnhubProvider

            return FinnhubProvider()

        if prov in {"stockdata", "stockdata.org", "stockdata_org"}:
            from quantlab.data.providers.stockdata_provider import StockDataProvider

            return StockDataProvider()

        raise ValueError(
            f"Unknown data provider: {prov!r}. "
            "Set QUANTLAB_DATA_PROVIDER to one of: alphavantage, finnhub, stockdata."
        )
