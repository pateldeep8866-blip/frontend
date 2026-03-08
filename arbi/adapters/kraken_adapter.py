# adapters/kraken_adapter.py — Kraken exchange adapter (REST via ccxt)

import time
import uuid
from typing import Optional

import ccxt

from adapters.base import BaseAdapter
from config import EXCHANGE_CREDENTIALS, PAPER_TRADING
from utils.logger import get_logger

log = get_logger("adapters.kraken")


class KrakenAdapter(BaseAdapter):

    def __init__(self):
        creds = EXCHANGE_CREDENTIALS.get("kraken", {})
        params = {}
        if creds.get("apiKey"):
            params["apiKey"] = creds["apiKey"]
            params["secret"] = creds["secret"]

        self._client = ccxt.kraken(params)
        self._paper = PAPER_TRADING
        log.info("KrakenAdapter initialized (paper=%s)", self._paper)

    def get_name(self) -> str:
        return "kraken"

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
            t = self._client.fetch_ticker(symbol)
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
            book = self._client.fetch_order_book(symbol, limit=depth)
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
            raw = self._client.create_order(symbol, order_type, side, quantity, price)
            return self._normalize_order(raw)
        except Exception as exc:
            log.error("place_order error: %s", exc)
            return {"status": "REJECTED", "error": str(exc)}

    def cancel_order(self, order_id: str, symbol: str) -> dict:
        if self._paper:
            return {"order_id": order_id, "status": "CANCELED"}
        try:
            raw = self._client.cancel_order(order_id, symbol)
            return self._normalize_order(raw)
        except Exception as exc:
            log.error("cancel_order error: %s", exc)
            return {"order_id": order_id, "status": "ERROR", "error": str(exc)}

    def fetch_order(self, order_id: str, symbol: str) -> dict:
        if self._paper:
            return {"order_id": order_id, "status": "FILLED"}
        try:
            raw = self._client.fetch_order(order_id, symbol)
            return self._normalize_order(raw)
        except Exception as exc:
            log.error("fetch_order error: %s", exc)
            return {}

    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        if self._paper:
            return []
        try:
            raw = self._client.fetch_open_orders(symbol)
            return [self._normalize_order(o) for o in raw]
        except Exception as exc:
            log.warning("fetch_open_orders error: %s", exc)
            return []

    # ─── Internal helpers ─────────────────────────────────────────────────────

    def _normalize_order(self, raw: dict) -> dict:
        status_map = {
            "open":    "ACKED",
            "closed":  "FILLED",
            "canceled": "CANCELED",
            "rejected": "REJECTED",
            "expired":  "CANCELED",
        }
        raw_status = (raw.get("status") or "open").lower()
        return {
            "order_id":      str(raw.get("id", "")),
            "exchange":      "kraken",
            "symbol":        raw.get("symbol", ""),
            "side":          raw.get("side", ""),
            "order_type":    raw.get("type", "limit"),
            "quantity":      float(raw.get("amount") or 0),
            "price":         raw.get("price"),
            "status":        status_map.get(raw_status, "ACKED"),
            "filled_qty":    float(raw.get("filled") or 0),
            "avg_fill_price": raw.get("average"),
            "fee":           raw.get("fee", {}).get("cost", 0) if raw.get("fee") else 0,
            "raw_response":  raw,
            "created_ts":    time.time(),
        }

    def _paper_order(self, symbol: str, side: str, quantity: float,
                     order_type: str, price: Optional[float]) -> dict:
        oid = f"PAPER-{uuid.uuid4().hex[:8]}"
        log.info("[PAPER] %s %s %s qty=%s price=%s", "kraken", side, symbol, quantity, price)
        return {
            "order_id":      oid,
            "exchange":      "kraken",
            "symbol":        symbol,
            "side":          side,
            "order_type":    order_type,
            "quantity":      quantity,
            "price":         price,
            "status":        "FILLED",
            "filled_qty":    quantity,
            "avg_fill_price": price,
            "fee":           (price or 0) * quantity * 0.0026,
            "raw_response":  {},
            "created_ts":    time.time(),
        }
