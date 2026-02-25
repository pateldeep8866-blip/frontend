"""Data access layer (research/paper-only).

This package contains provider abstractions for market data retrieval.
Quant logic should not import provider SDKs directly (e.g., yfinance);
it should go through `quantlab.data_cache.get_prices_cached()` or a provider
implementing the `DataProvider` interface.
"""

