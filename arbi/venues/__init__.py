# venues/__init__.py — Venue registry
from venues.base_venue import BaseVenue


def get_venue(venue_name: str) -> BaseVenue:
    """
    Factory: return an initialized venue adapter by name.
    Defers imports so unused venues don't fail on missing dependencies.
    """
    mapping = {
        "kraken":      ("venues.crypto.kraken",     "KrakenVenue"),
        "binance_us":  ("venues.crypto.binance_us",  "BinanceUSVenue"),
        "alpaca":      ("venues.equities.alpaca",    "AlpacaVenue"),
        "ibkr":        ("venues.equities.ibkr",      "IBKRVenue"),
        "oanda":       ("venues.fx.oanda",           "OandaVenue"),
        "generic_futures": ("venues.futures.generic", "GenericFuturesVenue"),
    }
    if venue_name not in mapping:
        raise ValueError(f"Unknown venue: {venue_name!r}. Options: {list(mapping)}")
    module_path, class_name = mapping[venue_name]
    import importlib
    mod = importlib.import_module(module_path)
    return getattr(mod, class_name)()


__all__ = ["BaseVenue", "get_venue"]
