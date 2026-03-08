# execution/order_manager.py — Full order lifecycle tracking

import time
import uuid
from typing import Optional

from storage.db import upsert_order, log_event, get_open_orders
from utils.logger import get_logger

log = get_logger("execution.order_manager")

# Valid order state transitions
VALID_TRANSITIONS = {
    "NEW":              {"ACKED", "REJECTED", "CANCELED"},
    "ACKED":            {"PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED"},
    "PARTIALLY_FILLED": {"FILLED", "CANCELED"},
    "FILLED":           set(),
    "CANCELED":         set(),
    "REJECTED":         set(),
}


class OrderManager:

    def __init__(self, adapters: dict):
        """
        adapters: dict of exchange_name → BaseAdapter instance
        """
        self.adapters: dict = adapters
        self._orders:  dict = {}   # order_id → order record (in-memory)

    # ─── Submit ───────────────────────────────────────────────────────────────

    def submit(self, exchange: str, symbol: str, side: str,
               quantity: float, strategy: str,
               order_type: str = "limit",
               price: Optional[float] = None) -> Optional[dict]:

        adapter = self.adapters.get(exchange)
        if not adapter:
            log.error("No adapter for exchange: %s", exchange)
            return None

        order_id = f"LOCAL-{uuid.uuid4().hex[:10]}"
        order = {
            "order_id":       order_id,
            "exchange":       exchange,
            "symbol":         symbol,
            "side":           side,
            "order_type":     order_type,
            "quantity":       quantity,
            "price":          price,
            "status":         "NEW",
            "strategy":       strategy,
            "created_ts":     time.time(),
            "updated_ts":     time.time(),
            "filled_qty":     0.0,
            "avg_fill_price": None,
            "fee":            0.0,
            "pnl":            None,
            "raw_response":   None,
        }

        self._orders[order_id] = order
        upsert_order(order)
        log_event("ORDER_SUBMITTED", "order_manager",
                  {"order_id": order_id, "exchange": exchange,
                   "symbol": symbol, "side": side, "qty": quantity})

        log.info("Submitting %s %s %s qty=%.6f price=%s", side, symbol, exchange, quantity, price)

        result = adapter.place_order(symbol, side, quantity, order_type, price)

        if result:
            # Merge exchange response into local order
            if result.get("order_id"):
                # Use exchange's order_id from here on
                new_id = result["order_id"]
                self._orders.pop(order_id, None)
                order.update(result)
                order["order_id"] = new_id
                order["updated_ts"] = time.time()
                self._orders[new_id] = order
            else:
                order.update({k: v for k, v in result.items() if v is not None})
                order["updated_ts"] = time.time()

            upsert_order(order)
            log_event("ORDER_ACKED", "order_manager", {"order_id": order.get("order_id")})
            log.info("Order acked: %s status=%s", order.get("order_id"), order.get("status"))

        return order

    # ─── Cancel ───────────────────────────────────────────────────────────────

    def cancel(self, order_id: str) -> bool:
        order = self._orders.get(order_id)
        if not order:
            log.warning("cancel: order %s not in memory", order_id)
            return False

        if order["status"] in ("FILLED", "CANCELED", "REJECTED"):
            log.debug("cancel: order %s already %s", order_id, order["status"])
            return True

        adapter = self.adapters.get(order["exchange"])
        if not adapter:
            log.error("cancel: no adapter for %s", order["exchange"])
            return False

        result = adapter.cancel_order(order_id, order["symbol"])
        if result:
            order["status"]     = "CANCELED"
            order["updated_ts"] = time.time()
            upsert_order(order)
            log_event("ORDER_CANCELED", "order_manager", {"order_id": order_id})
            log.info("Order %s canceled", order_id)
            return True

        return False

    # ─── Cancel all ───────────────────────────────────────────────────────────

    def cancel_all(self) -> int:
        canceled = 0
        for oid, order in list(self._orders.items()):
            if order["status"] in ("NEW", "ACKED", "PARTIALLY_FILLED"):
                if self.cancel(oid):
                    canceled += 1
        log.warning("cancel_all: canceled %d orders", canceled)
        return canceled

    # ─── Refresh stale orders ─────────────────────────────────────────────────

    def refresh_open_orders(self, max_age_sec: float = 30.0) -> None:
        now = time.time()
        for oid, order in list(self._orders.items()):
            if order["status"] not in ("NEW", "ACKED", "PARTIALLY_FILLED"):
                continue

            age = now - order.get("created_ts", now)
            if age > max_age_sec:
                log.warning("Order %s stale (%.0fs) — canceling", oid, age)
                self.cancel(oid)
                continue

            # Sync with exchange
            adapter = self.adapters.get(order["exchange"])
            if adapter:
                fresh = adapter.fetch_order(oid, order["symbol"])
                if fresh:
                    order.update({k: v for k, v in fresh.items() if v is not None})
                    order["updated_ts"] = now
                    upsert_order(order)

    # ─── Transition helper ────────────────────────────────────────────────────

    def _transition(self, order: dict, new_status: str) -> bool:
        current = order.get("status", "NEW")
        allowed = VALID_TRANSITIONS.get(current, set())
        if new_status in allowed:
            order["status"]     = new_status
            order["updated_ts"] = time.time()
            return True
        log.warning("Invalid transition %s → %s for %s", current, new_status, order.get("order_id"))
        return False

    # ─── Query ────────────────────────────────────────────────────────────────

    def get_open(self) -> list:
        return [o for o in self._orders.values()
                if o["status"] in ("NEW", "ACKED", "PARTIALLY_FILLED")]

    def get_by_strategy(self, strategy: str) -> list:
        return [o for o in self._orders.values() if o.get("strategy") == strategy]
