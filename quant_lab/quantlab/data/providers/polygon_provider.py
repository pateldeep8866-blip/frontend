from __future__ import annotations

from quantlab.data.providers.base import DataProvider


class PolygonProvider(DataProvider):
    """Placeholder stub for a future Polygon.io integration (not implemented)."""

    def get_prices(self, symbol: str, start: str, end: str, interval: str):
        raise NotImplementedError("PolygonProvider is a stub and is not implemented in this repo.")

    def provider_name(self) -> str:
        return "polygon"

    def provider_version(self) -> str:
        return "stub"
