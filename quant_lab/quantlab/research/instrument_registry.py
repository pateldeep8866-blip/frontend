from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List


@dataclass(frozen=True)
class InstrumentSpec:
    symbol: str
    asset_class: str
    data_source: str
    quote_endpoint: str
    history_endpoint: str
    timezone: str
    trading_hours: str


# Unified cross-asset registry used by research pipeline.
DEFAULT_INSTRUMENTS: Dict[str, InstrumentSpec] = {
    # Stocks / ETFs
    "SPY": InstrumentSpec("SPY", "etf", "stooq", "stooq_quote", "stooq_history", "America/New_York", "09:30-16:00"),
    "QQQ": InstrumentSpec("QQQ", "etf", "stooq", "stooq_quote", "stooq_history", "America/New_York", "09:30-16:00"),
    "IWM": InstrumentSpec("IWM", "etf", "stooq", "stooq_quote", "stooq_history", "America/New_York", "09:30-16:00"),
    "TLT": InstrumentSpec("TLT", "bond_etf", "stooq", "stooq_quote", "stooq_history", "America/New_York", "09:30-16:00"),
    "IEF": InstrumentSpec("IEF", "bond_etf", "stooq", "stooq_quote", "stooq_history", "America/New_York", "09:30-16:00"),
    "SHY": InstrumentSpec("SHY", "bond_etf", "stooq", "stooq_quote", "stooq_history", "America/New_York", "09:30-16:00"),
    "GLD": InstrumentSpec("GLD", "metal_etf", "stooq", "stooq_quote", "stooq_history", "America/New_York", "09:30-16:00"),
    "SLV": InstrumentSpec("SLV", "metal_etf", "stooq", "stooq_quote", "stooq_history", "America/New_York", "09:30-16:00"),
    # Macro / rates / fx
    "DXY": InstrumentSpec("DXY", "fx_index", "stooq", "stooq_quote", "stooq_history", "America/New_York", "24h"),
    "EURUSD": InstrumentSpec("EURUSD", "fx", "stooq", "stooq_quote", "stooq_history", "UTC", "24h"),
    "USDJPY": InstrumentSpec("USDJPY", "fx", "stooq", "stooq_quote", "stooq_history", "UTC", "24h"),
    "GBPUSD": InstrumentSpec("GBPUSD", "fx", "stooq", "stooq_quote", "stooq_history", "UTC", "24h"),
    # Crypto
    "BTC": InstrumentSpec("BTC", "crypto", "yahoo", "yahoo_quote(BTC-USD)", "yahoo_history(BTC-USD)", "UTC", "24h"),
    "ETH": InstrumentSpec("ETH", "crypto", "yahoo", "yahoo_quote(ETH-USD)", "yahoo_history(ETH-USD)", "UTC", "24h"),
    "SOL": InstrumentSpec("SOL", "crypto", "yahoo", "yahoo_quote(SOL-USD)", "yahoo_history(SOL-USD)", "UTC", "24h"),
    "ADA": InstrumentSpec("ADA", "crypto", "yahoo", "yahoo_quote(ADA-USD)", "yahoo_history(ADA-USD)", "UTC", "24h"),
}


def build_registry(universe: List[str]) -> Dict[str, Dict[str, str]]:
    out: Dict[str, Dict[str, str]] = {}
    for raw in universe:
        sym = str(raw or "").upper().strip()
        if not sym:
            continue
        spec = DEFAULT_INSTRUMENTS.get(sym)
        if spec is None:
            spec = InstrumentSpec(sym, "stock", "finnhub", "finnhub_quote", "finnhub_history", "America/New_York", "09:30-16:00")
        out[sym] = {
            "symbol": spec.symbol,
            "asset_class": spec.asset_class,
            "data_source": spec.data_source,
            "quote_endpoint": spec.quote_endpoint,
            "history_endpoint": spec.history_endpoint,
            "timezone": spec.timezone,
            "trading_hours": spec.trading_hours,
        }
    return out
