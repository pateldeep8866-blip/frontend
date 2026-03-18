# adapters/binance_us_adapter.py — Binance.US exchange adapter (REST via ccxt)

import time
import uuid
from typing import Optional

import ccxt

from adapters.base import BaseAdapter
from config import EXCHANGE_CREDENTIALS, PAPER_TRADING, BINANCE_US_MAKER_FEE, BINANCE_US_TAKER_FEE
from utils.logger import get_logger

log = get_logger("adapters.binance_us")


class BinanceUSAdapter(BaseAdapter):

    def __init__(self):
        creds = EXCHANGE_CREDENTIALS.get("binance_us", {})
        params = {"options": {"defaultType": "spot"}}
        if creds.get("apiKey"):
            params["apiKey"] = creds["apiKey"]
            params["secret"] = creds["secret"]

        self._client = ccxt.binanceus(params)
        self._paper  = PAPER_TRADING
        log.info("BinanceUSAdapter initialized (paper=%s)", self._paper)

    def get_name(self) -> str:
        return "binance_us"

    def fetch_balance(self) -> dict:
        try:
            raw = self._client.fetch_balance()
            return {
                k: {"free": v["free"] or 0, "used": v["used"] or 0, "total": v["total"] or 0}
                for k, v in raw.items()
                if isinstance(v, dict) and "total" in v
            }
        except Exception as exc:
            log.warning("fetch_balance error: %s", exc)
            return {}

    def fetch_ticker(self, symbol: str) -> dict:
        try:
            # Binance.US uses USDT pairs; map /USD → /USDT for the REST call
            ccxt_sym = _to_binance_symbol(symbol)
            t = self._client.fetch_ticker(ccxt_sym)
            return {
                "last":         t.get("last"),
                "bid":          t.get("bid"),
                "ask":          t.get("ask"),
                "base_volume":  t.get("baseVolume"),
                "quote_volume": t.get("quoteVolume"),
                "ts":           time.time(),
            }
        except Exception as exc:
            log.warning("fetch_ticker(%s) error: %s", symbol, exc)
            return {}

    def fetch_order_book(self, symbol: str, depth: int = 20) -> dict:
        try:
            ccxt_sym = _to_binance_symbol(symbol)
            book = self._client.fetch_order_book(ccxt_sym, limit=depth)
            return {
                "bids": book.get("bids", []),
                "asks": book.get("asks", []),
                "ts":   time.time(),
            }
        except Exception as exc:
            log.warning("fetch_order_book(%s) error: %s", symbol, exc)
            return {"bids": [], "asks": [], "ts": time.time()}

    def place_order(self, symbol: str, side: str, quantity: float,
                    order_type: str = "limit",
                    price: Optional[float] = None) -> dict:
        if self._paper:
            return self._paper_order(symbol, side, quantity, order_type, price)

        try:
            ccxt_sym = _to_binance_symbol(symbol)
            raw = self._client.create_order(ccxt_sym, order_type, side, quantity, price)
            return self._normalize_order(raw)
        except Exception as exc:
            log.error("place_order error: %s", exc)
            return {"status": "REJECTED", "error": str(exc)}

    def cancel_order(self, order_id: str, symbol: str) -> dict:
        if self._paper:
            return {"order_id": order_id, "status": "CANCELED"}
        try:
            ccxt_sym = _to_binance_symbol(symbol)
            raw = self._client.cancel_order(order_id, ccxt_sym)
            return self._normalize_order(raw)
        except Exception as exc:
            log.error("cancel_order error: %s", exc)
            return {"order_id": order_id, "status": "ERROR", "error": str(exc)}

    def fetch_order(self, order_id: str, symbol: str) -> dict:
        if self._paper:
            return {"order_id": order_id, "status": "FILLED"}
        try:
            ccxt_sym = _to_binance_symbol(symbol)
            raw = self._client.fetch_order(order_id, ccxt_sym)
            return self._normalize_order(raw)
        except Exception as exc:
            log.error("fetch_order error: %s", exc)
            return {}

    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        if self._paper:
            return []
        try:
            ccxt_sym = _to_binance_symbol(symbol) if symbol else None
            raw = self._client.fetch_open_orders(ccxt_sym)
            return [self._normalize_order(o) for o in raw]
        except Exception as exc:
            log.warning("fetch_open_orders error: %s", exc)
            return []

    # ─── Internal helpers ─────────────────────────────────────────────────────

    def _normalize_order(self, raw: dict) -> dict:
        status_map = {
            "open":     "ACKED",
            "closed":   "FILLED",
            "canceled": "CANCELED",
            "rejected": "REJECTED",
            "expired":  "CANCELED",
            "NEW":      "ACKED",
            "FILLED":   "FILLED",
            "CANCELED": "CANCELED",
        }
        raw_status = (raw.get("status") or "open").lower()
        return {
            "order_id":       str(raw.get("id", "")),
            "exchange":       "binance_us",
            "symbol":         raw.get("symbol", ""),
            "side":           raw.get("side", ""),
            "order_type":     raw.get("type", "limit"),
            "quantity":       float(raw.get("amount") or 0),
            "price":          raw.get("price"),
            "status":         status_map.get(raw_status, "ACKED"),
            "filled_qty":     float(raw.get("filled") or 0),
            "avg_fill_price": raw.get("average"),
            "fee":            raw.get("fee", {}).get("cost", 0) if raw.get("fee") else 0,
            "raw_response":   raw,
            "created_ts":     time.time(),
        }

    def _paper_order(self, symbol: str, side: str, quantity: float,
                     order_type: str, price: Optional[float]) -> dict:
        oid     = f"PAPER-{uuid.uuid4().hex[:8]}"
        fee_pct = BINANCE_US_MAKER_FEE if order_type == "limit" else BINANCE_US_TAKER_FEE
        log.info("[PAPER] %s %s %s qty=%s price=%s", "binance_us", side, symbol, quantity, price)
        return {
            "order_id":       oid,
            "exchange":       "binance_us",
            "symbol":         symbol,
            "side":           side,
            "order_type":     order_type,
            "quantity":       quantity,
            "price":          price,
            "status":         "FILLED",
            "filled_qty":     quantity,
            "avg_fill_price": price,
            "fee":            (price or 0) * quantity * fee_pct,
            "raw_response":   {},
            "created_ts":     time.time(),
        }


def _to_binance_symbol(symbol: str) -> str:
    """
    Convert internal symbol to Binance.US ccxt format.
    BTC/USD → BTC/USDT  (Binance.US uses USDT as the primary quote currency)
    BTC/USDT → BTC/USDT (already correct)
    """
    if symbol and symbol.endswith("/USD"):
        return symbol + "T"   # BTC/USD → BTC/USDT
    return symbol
