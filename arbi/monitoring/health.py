# monitoring/health.py — System health monitor and reconciliation

import time
import sqlite3

from config import DB_PATH, MARKET_DATA_FRESHNESS_SEC
from storage.db import log_risk_event, get_open_orders
from utils.logger import get_logger

log = get_logger("monitoring.health")


class HealthMonitor:

    def __init__(self, adapters: dict, market_cache):
        self.adapters     = adapters
        self.market_cache = market_cache
        self._last_reconcile = 0.0

    def check_data_freshness(self) -> bool:
        """Returns True if all configured symbols have fresh data."""
        cache_data = self.market_cache.snapshot()
        stale_count = 0
        now = time.time()

        for ex_name, ex_data in cache_data.items():
            for symbol, row in ex_data.items():
                age = now - row.get("ticker_ts", 0)
                if age > MARKET_DATA_FRESHNESS_SEC * 2:
                    log.warning("Stale data: %s/%s — %.0fs old", ex_name, symbol, age)
                    stale_count += 1

        return stale_count == 0

    def check_db_writable(self) -> bool:
        """Confirm SQLite is reachable and writable."""
        try:
            conn = sqlite3.connect(DB_PATH)
            conn.execute("SELECT 1")
            conn.close()
            return True
        except Exception as exc:
            log.error("DB not writable: %s", exc)
            return False

    def reconcile_orders(self, order_manager) -> int:
        """
        Compare local open orders vs exchange open orders.
        Returns number of discrepancies found.
        """
        local_open = {o["order_id"] for o in order_manager.get_open()}
        discrepancies = 0

        for ex_name, adapter in self.adapters.items():
            try:
                exchange_open = {o["order_id"] for o in adapter.fetch_open_orders()}
            except Exception as exc:
                log.warning("Could not fetch open orders from %s: %s", ex_name, exc)
                continue

            # Orders we think are open but exchange doesn't know about
            ghost_orders = local_open - exchange_open
            for oid in ghost_orders:
                log.warning("Ghost order detected: %s on %s", oid, ex_name)
                log_risk_event("GHOST_ORDER", f"Order {oid} missing on {ex_name}", "flagged")
                discrepancies += 1

        return discrepancies

    def full_report(self, risk_manager, position_manager) -> dict:
        risk_status     = risk_manager.status()
        position_summary = position_manager.summary()
        cache_size      = sum(len(v) for v in self.market_cache.snapshot().values())

        return {
            "timestamp":   time.strftime("%Y-%m-%d %H:%M:%S"),
            "risk":        risk_status,
            "positions":   position_summary,
            "cache_rows":  cache_size,
            "db_ok":       self.check_db_writable(),
            "data_fresh":  self.check_data_freshness(),
        }
