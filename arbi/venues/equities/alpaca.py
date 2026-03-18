# venues/equities/alpaca.py — Alpaca Markets venue adapter
#
# Supports US equities and ETFs via Alpaca's REST API.
# Requires: pip install alpaca-trade-api  (or alpaca-py)
# Env vars: ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_BASE_URL
#           ALPACA_DATA_URL (optional, defaults to market data endpoint)
#           ALPACA_PAPER=true → paper trading endpoint

from __future__ import annotations
import os
import time
from typing import Optional
from venues.base_venue import BaseVenue
from utils.logger import get_logger

log = get_logger("venues.alpaca")

_PAPER_BASE = "https://paper-api.alpaca.markets"
_LIVE_BASE  = "https://api.alpaca.markets"
_DATA_BASE  = "https://data.alpaca.markets"


class AlpacaVenue(BaseVenue):
    """
    Alpaca Markets adapter for US equities and ETFs.

    Uses alpaca-py (v0.18+) when available, falls back to alpaca-trade-api.
    Paper trading is the default unless ALPACA_PAPER=false is set.
    """

    def __init__(self):
        self._key    = os.getenv("ALPACA_API_KEY", "")
        self._secret = os.getenv("ALPACA_API_SECRET", "")
        self._paper  = os.getenv("ALPACA_PAPER", "true").lower() != "false"
        self._base   = _PAPER_BASE if self._paper else _LIVE_BASE
        self._client = self._build_client()
        log.info("AlpacaVenue initialized (paper=%s)", self._paper)

    def _build_client(self):
        """Try alpaca-py first, then alpaca-trade-api."""
        try:
            from alpaca.trading.client import TradingClient
            from alpaca.data.historical import StockHistoricalDataClient
            client = TradingClient(self._key, self._secret, paper=self._paper)
            self._data_client = StockHistoricalDataClient(self._key, self._secret)
            self._mode = "alpaca_py"
            return client
        except ImportError:
            pass
        try:
            import alpaca_trade_api as tradeapi
            client = tradeapi.REST(
                self._key, self._secret, self._base, api_version="v2"
            )
            self._mode = "alpaca_trade_api"
            return client
        except ImportError:
            log.warning("Neither alpaca-py nor alpaca-trade-api installed. "
                        "AlpacaVenue will not function. Run: pip install alpaca-py")
            self._mode = "unavailable"
            return None

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def name(self) -> str:
        return "alpaca"

    @property
    def asset_classes(self) -> list[str]:
        return ["equities"]

    def supports_paper_trading(self) -> bool:
        return True

    # ── Market data ───────────────────────────────────────────────────────────

    def fetch_ticker(self, symbol: str) -> dict:
        """Fetch latest quote (bid/ask/last) for a US equity symbol."""
        try:
            if self._mode == "alpaca_py":
                from alpaca.data.requests import StockLatestQuoteRequest
                req    = StockLatestQuoteRequest(symbol_or_symbols=symbol)
                quotes = self._data_client.get_stock_latest_quote(req)
                q      = quotes[symbol]
                return {
                    "last":         float(q.ask_price or q.bid_price or 0),
                    "bid":          float(q.bid_price or 0),
                    "ask":          float(q.ask_price or 0),
                    "base_volume":  float(q.bid_size or 0),
                    "quote_volume": 0.0,
                    "ts":           time.time(),
                }
            elif self._mode == "alpaca_trade_api":
                q = self._client.get_latest_quote(symbol)
                return {
                    "last":         float(q.ap or q.bp or 0),
                    "bid":          float(q.bp or 0),
                    "ask":          float(q.ap or 0),
                    "base_volume":  float(q.bs or 0),
                    "quote_volume": 0.0,
                    "ts":           time.time(),
                }
        except Exception as exc:
            log.warning("fetch_ticker(%s) error: %s", symbol, exc)
        return {}

    def fetch_order_book(self, symbol: str, depth: int = 20) -> dict:
        """Alpaca does not expose full order book — return best bid/ask only."""
        ticker = self.fetch_ticker(symbol)
        bids = [[ticker["bid"], 100]] if ticker.get("bid") else []
        asks = [[ticker["ask"], 100]] if ticker.get("ask") else []
        return {"bids": bids, "asks": asks, "ts": time.time()}

    def fetch_balance(self) -> dict:
        """Fetch account equity and cash."""
        try:
            if self._mode == "alpaca_py":
                acct = self._client.get_account()
                return {
                    "USD": {
                        "free":  float(acct.cash or 0),
                        "used":  float(acct.portfolio_value or 0) - float(acct.cash or 0),
                        "total": float(acct.portfolio_value or 0),
                    }
                }
            elif self._mode == "alpaca_trade_api":
                acct = self._client.get_account()
                return {
                    "USD": {
                        "free":  float(acct.cash),
                        "used":  float(acct.portfolio_value) - float(acct.cash),
                        "total": float(acct.portfolio_value),
                    }
                }
        except Exception as exc:
            log.warning("fetch_balance error: %s", exc)
        return {}

    def fetch_candles(self, symbol: str, timeframe: str = "1h", limit: int = 100) -> list[dict]:
        """Fetch OHLCV bars."""
        try:
            if self._mode == "alpaca_py":
                from alpaca.data.requests import StockBarsRequest
                from alpaca.data.timeframe import TimeFrame, TimeFrameUnit
                tf_map = {
                    "1m": TimeFrame(1, TimeFrameUnit.Minute),
                    "5m": TimeFrame(5, TimeFrameUnit.Minute),
                    "15m": TimeFrame(15, TimeFrameUnit.Minute),
                    "1h": TimeFrame(1, TimeFrameUnit.Hour),
                    "1d": TimeFrame(1, TimeFrameUnit.Day),
                }
                tf = tf_map.get(timeframe, TimeFrame(1, TimeFrameUnit.Hour))
                req  = StockBarsRequest(symbol_or_symbols=symbol, timeframe=tf, limit=limit)
                bars = self._data_client.get_stock_bars(req)[symbol]
                return [
                    {"ts": b.timestamp.timestamp(), "open": float(b.open),
                     "high": float(b.high), "low": float(b.low),
                     "close": float(b.close), "volume": float(b.volume)}
                    for b in bars
                ]
            elif self._mode == "alpaca_trade_api":
                tf_map = {"1m": "1Min", "5m": "5Min", "15m": "15Min",
                          "1h": "1Hour", "1d": "1Day"}
                tf   = tf_map.get(timeframe, "1Hour")
                bars = self._client.get_bars(symbol, tf, limit=limit).df
                return [
                    {"ts": idx.timestamp(), "open": float(row["open"]),
                     "high": float(row["high"]), "low": float(row["low"]),
                     "close": float(row["close"]), "volume": float(row["volume"])}
                    for idx, row in bars.iterrows()
                ]
        except Exception as exc:
            log.warning("fetch_candles(%s) error: %s", symbol, exc)
        return []

    # ── Order management ──────────────────────────────────────────────────────

    def place_order(
        self,
        symbol:     str,
        side:       str,
        quantity:   float,
        order_type: str = "limit",
        price:      Optional[float] = None,
    ) -> dict:
        try:
            if self._mode == "alpaca_py":
                from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest
                from alpaca.trading.enums import OrderSide, TimeInForce
                alpaca_side = OrderSide.BUY if side == "buy" else OrderSide.SELL
                if order_type == "market":
                    req = MarketOrderRequest(
                        symbol=symbol, qty=quantity,
                        side=alpaca_side, time_in_force=TimeInForce.DAY,
                    )
                else:
                    req = LimitOrderRequest(
                        symbol=symbol, qty=quantity, limit_price=price,
                        side=alpaca_side, time_in_force=TimeInForce.DAY,
                    )
                raw = self._client.submit_order(req)
                return self._normalize_order(raw.__dict__)
            elif self._mode == "alpaca_trade_api":
                raw = self._client.submit_order(
                    symbol=symbol, qty=quantity, side=side,
                    type=order_type, time_in_force="day",
                    limit_price=str(price) if price else None,
                )
                return self._normalize_order(vars(raw))
        except Exception as exc:
            log.error("place_order error: %s", exc)
            return {"status": "REJECTED", "error": str(exc)}

    def cancel_order(self, order_id: str, symbol: str = "") -> dict:
        try:
            if self._mode == "alpaca_py":
                self._client.cancel_order_by_id(order_id)
            elif self._mode == "alpaca_trade_api":
                self._client.cancel_order(order_id)
            return {"order_id": order_id, "status": "CANCELED"}
        except Exception as exc:
            log.error("cancel_order error: %s", exc)
            return {"order_id": order_id, "status": "ERROR", "error": str(exc)}

    def fetch_order(self, order_id: str, symbol: str = "") -> dict:
        try:
            if self._mode == "alpaca_py":
                raw = self._client.get_order_by_id(order_id)
                return self._normalize_order(raw.__dict__)
            elif self._mode == "alpaca_trade_api":
                raw = self._client.get_order(order_id)
                return self._normalize_order(vars(raw))
        except Exception as exc:
            log.error("fetch_order error: %s", exc)
        return {}

    def fetch_open_orders(self, symbol: Optional[str] = None) -> list:
        try:
            if self._mode == "alpaca_py":
                from alpaca.trading.requests import GetOrdersRequest
                from alpaca.trading.enums import QueryOrderStatus
                req  = GetOrdersRequest(status=QueryOrderStatus.OPEN, symbols=[symbol] if symbol else None)
                raw  = self._client.get_orders(req)
                return [self._normalize_order(o.__dict__) for o in raw]
            elif self._mode == "alpaca_trade_api":
                raw = self._client.list_orders(status="open", symbols=[symbol] if symbol else None)
                return [self._normalize_order(vars(o)) for o in raw]
        except Exception as exc:
            log.warning("fetch_open_orders error: %s", exc)
        return []

    # ── Trading hours ─────────────────────────────────────────────────────────

    def get_trading_hours(self) -> dict:
        return {
            "market_open":  "09:30",
            "market_close": "16:00",
            "timezone":     "America/New_York",
            "always_open":  False,
        }

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _normalize_order(raw: dict) -> dict:
        status_map = {
            "new":             "ACKED",
            "partially_filled": "ACKED",
            "filled":          "FILLED",
            "canceled":        "CANCELED",
            "expired":         "CANCELED",
            "replaced":        "CANCELED",
            "rejected":        "REJECTED",
            "pending_new":     "ACKED",
            "accepted":        "ACKED",
        }
        raw_status = str(raw.get("status") or "new").lower()
        filled_qty = float(raw.get("filled_qty") or raw.get("qty") or 0)
        avg_price  = raw.get("filled_avg_price") or raw.get("limit_price")
        return {
            "order_id":       str(raw.get("id") or ""),
            "exchange":       "alpaca",
            "symbol":         str(raw.get("symbol") or ""),
            "side":           str(raw.get("side") or ""),
            "order_type":     str(raw.get("type") or "limit"),
            "quantity":       float(raw.get("qty") or 0),
            "price":          float(raw.get("limit_price") or 0) or None,
            "status":         status_map.get(raw_status, "ACKED"),
            "filled_qty":     filled_qty,
            "avg_fill_price": float(avg_price) if avg_price else None,
            "fee":            0.0,   # Alpaca commission-free
            "raw_response":   raw,
            "created_ts":     time.time(),
        }
