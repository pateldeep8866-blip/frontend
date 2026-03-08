# scanner/cache.py — Central in-memory market data cache
# All scanners read from here. Exchange adapters write here.

import time
from typing import Optional

import ccxt

from config import ORDERBOOK_DEPTH, MARKET_DATA_FRESHNESS_SEC
from scanner.normalizer import normalize_symbol
from utils.logger import get_logger

log = get_logger("scanner.cache")


def build_exchange_clients(exchange_names: list) -> dict:
    clients = {}
    for name in exchange_names:
        try:
            cls = getattr(ccxt, name)
            clients[name] = cls()
        except Exception as exc:
            log.warning("Could not init %s: %s", name, exc)
    return clients


class MarketCache:
    """
    Shared in-memory market data store.
    Structure:
      data[exchange_name][symbol] = {
        "last", "bid", "ask", "base_volume", "quote_volume",
        "bids", "asks", "ticker_ts", "orderbook_ts"
      }
    """

    def __init__(self, clients: dict, symbols: list):
        self.clients = clients
        self.symbols = [normalize_symbol(s) for s in symbols]
        self.data: dict = {}

    def refresh_tickers(self) -> None:
        now = time.time()
        for ex_name, client in self.clients.items():
            self.data.setdefault(ex_name, {})
            for symbol in self.symbols:
                try:
                    t = client.fetch_ticker(symbol)
                    self.data[ex_name].setdefault(symbol, {})
                    self.data[ex_name][symbol].update({
                        "last":         t.get("last"),
                        "bid":          t.get("bid"),
                        "ask":          t.get("ask"),
                        "base_volume":  t.get("baseVolume"),
                        "quote_volume": t.get("quoteVolume"),
                        "ticker_ts":    now,
                    })
                except Exception as exc:
                    log.debug("ticker %s/%s: %s", ex_name, symbol, exc)

    def refresh_orderbooks(self) -> None:
        now = time.time()
        for ex_name, client in self.clients.items():
            self.data.setdefault(ex_name, {})
            for symbol in self.symbols:
                try:
                    book = client.fetch_order_book(symbol, limit=ORDERBOOK_DEPTH)
                    self.data[ex_name].setdefault(symbol, {})
                    self.data[ex_name][symbol].update({
                        "bids":         book.get("bids", []),
                        "asks":         book.get("asks", []),
                        "orderbook_ts": now,
                    })
                except Exception as exc:
                    log.debug("orderbook %s/%s: %s", ex_name, symbol, exc)

    def is_fresh(self, exchange: str, symbol: str) -> bool:
        row = self.data.get(exchange, {}).get(symbol, {})
        ts = row.get("ticker_ts", 0)
        return (time.time() - ts) < MARKET_DATA_FRESHNESS_SEC

    def get(self, exchange: str, symbol: str) -> Optional[dict]:
        return self.data.get(exchange, {}).get(symbol)

    def snapshot(self) -> dict:
        return self.data
