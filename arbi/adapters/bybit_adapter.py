# adapters/bybit_adapter.py — Bybit adapter with perpetual futures support
#
# Bybit is the primary exchange for funding rate arbitrage because:
#   - Deep perp liquidity on major pairs
#   - Low fees (0.01% maker / 0.06% taker on perps)
#   - Supports unified margin (spot + perp in same account)
#   - Reliable funding rate data via API

import time
import uuid
from typing import Optional

import ccxt

from adapters.base import BaseAdapter
from config import EXCHANGE_CREDENTIALS, PAPER_TRADING
from utils.logger import get_logger

log = get_logger("adapters.bybit")


class BybitAdapter(BaseAdapter):

    def __init__(self):
        creds = EXCHANGE_CREDENTIALS.get("bybit", {})
        params = {"options": {"defaultType": "linear"}}  # linear = USDT perps
        if creds.get("apiKey"):
            params["apiKey"] = creds["apiKey"]
            params["secret"] = creds["secret"]

        self._client = ccxt.bybit(params)
        self._paper  = PAPER_TRADING
        log.info("BybitAdapter initialized (paper=%s)", self._paper)

    def get_name(self) -> str:
        return "bybit"

    def fetch_balance(self) -> dict:
        try:
            raw = self._client.fetch_balance({"type": "unified"})
            return {
                k: {"free": v.get("free") or 0,
                    "used": v.get("used") or 0,
                    "total": v.get("total") or 0}
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
            return {"order_id": order_id, "status": "ERROR"}

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

    # ── Perp-specific methods ─────────────────────────────────────────────────

    def fetch_funding_rate(self, symbol: str) -> dict:
        """
        Fetch current + predicted funding rate for a perp symbol.
        Example symbol: 'BTC/USDT:USDT' (Bybit linear perp format)
        """
        try:
            data = self._client.fetch_funding_rate(symbol)
            rate = data.get("fundingRate", 0)
            return {
                "symbol":           symbol,
                "funding_rate":     float(rate),
                "annual_yield_pct": round(float(rate) * 1095 * 100, 2),
                "next_funding_ts":  data.get("fundingDatetime"),
                "exchange":         "bybit",
            }
        except Exception as exc:
            log.warning("fetch_funding_rate(%s) error: %s", symbol, exc)
            return {}

    def fetch_all_funding_rates(self) -> list:
        """Scan all perp markets for funding rate opportunities."""
        try:
            rates = self._client.fetch_funding_rates()
            results = []
            for symbol, data in rates.items():
                rate = data.get("fundingRate")
                if rate is None:
                    continue
                annual = abs(float(rate)) * 1095 * 100
                if annual >= 10:   # Only bother with 10%+ annualized
                    results.append({
                        "symbol":       symbol,
                        "exchange":     "bybit",
                        "funding_rate": round(float(rate), 6),
                        "annual_yield": round(annual, 2),
                        "direction":    "short_perp" if float(rate) > 0 else "long_perp",
                        "type":         "funding_rate_arb",
                        "score":        annual,
                    })
            results.sort(key=lambda x: x["annual_yield"], reverse=True)
            return results
        except Exception as exc:
            log.warning("fetch_all_funding_rates error: %s", exc)
            return []

    def place_perp_short(self, symbol: str, quantity: float,
                         price: Optional[float] = None) -> dict:
        """Open a short position on a linear perp."""
        if self._paper:
            return self._paper_order(symbol, "sell", quantity, "limit", price)
        try:
            # Bybit requires positionIdx=2 for hedge mode short
            raw = self._client.create_order(
                symbol, "limit", "sell", quantity, price,
                {"positionIdx": 2, "reduceOnly": False}
            )
            return self._normalize_order(raw)
        except Exception as exc:
            log.error("place_perp_short error: %s", exc)
            return {"status": "REJECTED", "error": str(exc)}

    def close_perp_short(self, symbol: str, quantity: float,
                         price: Optional[float] = None) -> dict:
        """Close a short position."""
        if self._paper:
            return self._paper_order(symbol, "buy", quantity, "limit", price)
        try:
            raw = self._client.create_order(
                symbol, "limit", "buy", quantity, price,
                {"positionIdx": 2, "reduceOnly": True}
            )
            return self._normalize_order(raw)
        except Exception as exc:
            log.error("close_perp_short error: %s", exc)
            return {"status": "REJECTED", "error": str(exc)}

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _normalize_order(self, raw: dict) -> dict:
        status_map = {
            "New": "ACKED", "PartiallyFilled": "PARTIALLY_FILLED",
            "Filled": "FILLED", "Cancelled": "CANCELED", "Rejected": "REJECTED",
        }
        raw_status = raw.get("status", "New")
        return {
            "order_id":       str(raw.get("id", "")),
            "exchange":       "bybit",
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

    def _paper_order(self, symbol, side, quantity, order_type, price):
        oid = f"PAPER-BYBIT-{uuid.uuid4().hex[:8]}"
        fee_rate = 0.0006  # Bybit taker
        log.info("[PAPER/BYBIT] %s %s qty=%s price=%s", side, symbol, quantity, price)
        return {
            "order_id":       oid,
            "exchange":       "bybit",
            "symbol":         symbol,
            "side":           side,
            "order_type":     order_type,
            "quantity":       quantity,
            "price":          price,
            "status":         "FILLED",
            "filled_qty":     quantity,
            "avg_fill_price": price,
            "fee":            (price or 0) * quantity * fee_rate,
            "raw_response":   {},
            "created_ts":     time.time(),
        }
