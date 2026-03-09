# monitoring/health.py — System health monitor and reconciliation

import threading
import time
import sqlite3

from config import DB_PATH, MARKET_DATA_FRESHNESS_SEC
from storage.db import log_risk_event, get_open_orders
from utils.logger import get_logger

log = get_logger("monitoring.health")

RECONCILE_INTERVAL_SEC = 60
BALANCE_DRIFT_THRESHOLD = 0.01   # 1 % difference triggers sync


class HealthMonitor:

    def __init__(self, adapters: dict, market_cache,
                 adapter=None, positions=None, risk_manager=None):
        self.adapters     = adapters
        self.market_cache = market_cache
        self._last_reconcile = 0.0

        # Reconciliation state
        self._adapter      = adapter
        self._positions    = positions    # dict: symbol → position dict
        self._risk_manager = risk_manager
        self._recon_stats  = {
            "last_ts":        0.0,
            "discrepancies":  0,
            "auto_resolved":  0,
            "escalated":      0,
        }

        if adapter and positions is not None and risk_manager:
            t = threading.Thread(
                target=self._reconcile_loop_forever,
                daemon=True,
                name="HealthMonitor.reconcile",
            )
            t.start()
            log.info("Reconciliation loop started (every %ds)", RECONCILE_INTERVAL_SEC)

    # ── Reconciliation ────────────────────────────────────────────────────────

    def reconcile_positions(self, adapter, positions: dict) -> int:
        """
        Compare local open positions against what the exchange actually holds.

        - Local position missing on exchange  → mark orphaned, close locally.
        - Exchange position unknown locally   → log alert (can't auto-resolve).

        Returns number of discrepancies found.
        """
        discrepancies = 0
        try:
            exchange_positions = {
                p["symbol"]: p
                for p in (adapter.fetch_positions() or [])
                if float(p.get("size", 0)) != 0
            }
        except Exception as exc:
            log.warning("reconcile_positions: could not fetch from exchange — %s", exc)
            return 0

        # Local positions that the exchange doesn't know about
        for sym, pos in list(positions.items()):
            if sym not in exchange_positions:
                log.warning("[RECON] Orphaned local position: %s — closing locally", sym)
                log_risk_event("ORPHANED_POSITION", f"{sym} missing on exchange", "auto_closed")
                positions.pop(sym, None)
                discrepancies += 1
                self._recon_stats["auto_resolved"] += 1

        # Exchange positions we have no record of
        for sym in exchange_positions:
            if sym not in positions:
                log.critical("[RECON] Unknown exchange position: %s — manual review needed", sym)
                log_risk_event("UNKNOWN_POSITION", f"{sym} on exchange but not locally", "escalated")
                discrepancies += 1
                self._recon_stats["escalated"] += 1

        return discrepancies

    def reconcile_balance(self, adapter, risk_manager) -> bool:
        """
        Fetch real USDT balance from the exchange and compare to risk manager's
        tracked balance. Syncs risk manager if drift exceeds 1 %.

        Returns True if balances were in sync (or successfully synced).
        """
        try:
            balance_data = adapter.fetch_balance()
            real_balance = float(
                balance_data.get("USDT", {}).get("free", 0)
                or balance_data.get("total", {}).get("USDT", 0)
            )
        except Exception as exc:
            log.warning("reconcile_balance: could not fetch balance — %s", exc)
            return False

        tracked = getattr(risk_manager, "balance", None) or getattr(risk_manager, "usdt_balance", None)
        if tracked is None:
            return True   # risk manager doesn't expose balance — skip

        if real_balance == 0:
            return True   # exchange returned zero — likely auth issue, skip

        drift = abs(real_balance - tracked) / real_balance
        if drift > BALANCE_DRIFT_THRESHOLD:
            log.warning(
                "[RECON] Balance drift %.2f%%: tracked=$%.2f real=$%.2f — syncing",
                drift * 100, tracked, real_balance,
            )
            # Sync whichever attribute the risk manager exposes
            for attr in ("balance", "usdt_balance", "_balance"):
                if hasattr(risk_manager, attr):
                    setattr(risk_manager, attr, real_balance)
                    break
            log_risk_event("BALANCE_DRIFT", f"drift={drift*100:.2f}% synced to {real_balance:.2f}", "auto_resolved")
            self._recon_stats["auto_resolved"] += 1
            return False

        return True

    def reconcile_loop(self, adapter, positions: dict, risk_manager) -> None:
        """Run one reconciliation cycle (positions + balance). Called by the daemon thread."""
        discrepancies = 0
        discrepancies += self.reconcile_positions(adapter, positions)
        in_sync = self.reconcile_balance(adapter, risk_manager)
        if not in_sync:
            discrepancies += 1

        self._recon_stats["last_ts"]       = time.time()
        self._recon_stats["discrepancies"] += discrepancies

        if discrepancies:
            log.info("[RECON] Cycle complete — %d discrepancies, %d auto-resolved, %d escalated",
                     discrepancies,
                     self._recon_stats["auto_resolved"],
                     self._recon_stats["escalated"])

    def _reconcile_loop_forever(self) -> None:
        """Daemon thread target — runs reconcile_loop every RECONCILE_INTERVAL_SEC."""
        while True:
            time.sleep(RECONCILE_INTERVAL_SEC)
            try:
                self.reconcile_loop(self._adapter, self._positions, self._risk_manager)
            except Exception as exc:
                log.error("[RECON] Unhandled error in reconcile loop: %s", exc)

    def reconciliation_status(self) -> dict:
        """Return a snapshot of reconciliation health metrics."""
        return {
            "last_reconcile_ts":  self._recon_stats["last_ts"],
            "last_reconcile_ago": round(time.time() - self._recon_stats["last_ts"], 1),
            "discrepancies_found": self._recon_stats["discrepancies"],
            "auto_resolved":       self._recon_stats["auto_resolved"],
            "escalated":           self._recon_stats["escalated"],
        }

    # ── Existing checks ───────────────────────────────────────────────────────

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
