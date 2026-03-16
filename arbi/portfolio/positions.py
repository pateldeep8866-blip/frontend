# portfolio/positions.py — Live position and PnL tracking

import time
from typing import Optional

from storage.db import upsert_position, get_all_positions
from utils.logger import get_logger

log = get_logger("portfolio.positions")


class PositionManager:
    """
    Tracks open positions per (symbol, exchange) pair.
    Updates realized and unrealized PnL.
    Persists state to SQLite on every change.
    """

    def __init__(self):
        self._positions: dict = {}   # (symbol, exchange) → position record
        self._load_from_db()

    def _load_from_db(self) -> None:
        rows = get_all_positions()
        for row in rows:
            key = (row["symbol"], row["exchange"])
            self._positions[key] = {
                "symbol":         row["symbol"],
                "exchange":       row["exchange"],
                "quantity":       row["quantity"],
                "avg_entry":      row["avg_entry"],
                "realized_pnl":   row["realized_pnl"],
                "unrealized_pnl": row["unrealized_pnl"],
                "entry_ts":       None,   # Not persisted; unknown after restart
            }
        log.info("Loaded %d positions from DB", len(self._positions))

    # ─── Open position ────────────────────────────────────────────────────────

    def record_buy(self, symbol: str, exchange: str,
                   quantity: float, fill_price: float) -> None:
        key = (symbol, exchange)
        pos = self._positions.get(key) or self._new_position(symbol, exchange)

        prev_qty   = pos["quantity"]
        prev_entry = pos["avg_entry"] or fill_price

        # Weighted average entry
        new_qty          = prev_qty + quantity
        pos["avg_entry"] = ((prev_qty * prev_entry) + (quantity * fill_price)) / new_qty
        pos["quantity"]  = new_qty

        # Track entry time for scalp mode (only on first fill into a flat position)
        if prev_qty == 0:
            pos["entry_ts"] = time.time()

        self._save(key, pos)
        log.info("BUY recorded: %s/%s qty=%.6f avg_entry=%.4f",
                 symbol, exchange, new_qty, pos["avg_entry"])

    # ─── Close / partial close ────────────────────────────────────────────────

    def record_sell(self, symbol: str, exchange: str,
                    quantity: float, fill_price: float) -> float:
        key = (symbol, exchange)
        pos = self._positions.get(key)

        if not pos or pos["quantity"] <= 0:
            log.warning("record_sell: no open position for %s/%s", symbol, exchange)
            return 0.0

        sell_qty   = min(quantity, pos["quantity"])
        entry      = pos["avg_entry"] or fill_price
        trade_pnl  = (fill_price - entry) * sell_qty

        pos["quantity"]      -= sell_qty
        pos["realized_pnl"]  += trade_pnl
        pos["unrealized_pnl"] = 0.0 if pos["quantity"] <= 0 else pos["unrealized_pnl"]

        self._save(key, pos)
        log.info("SELL recorded: %s/%s pnl=%.4f realized_total=%.4f",
                 symbol, exchange, trade_pnl, pos["realized_pnl"])
        return trade_pnl

    # ─── Mark-to-market ───────────────────────────────────────────────────────

    def update_prices(self, prices: dict) -> None:
        """
        prices: { (symbol, exchange): current_market_price }
        Updates unrealized PnL for all open positions.
        """
        for key, pos in self._positions.items():
            if pos["quantity"] <= 0:
                continue
            market_price = prices.get(key)
            if market_price and pos["avg_entry"]:
                pos["unrealized_pnl"] = (market_price - pos["avg_entry"]) * pos["quantity"]

    # ─── Query helpers ────────────────────────────────────────────────────────

    def get(self, symbol: str, exchange: str) -> Optional[dict]:
        return self._positions.get((symbol, exchange))

    def open_positions(self) -> list:
        return [p for p in self._positions.values() if p["quantity"] > 0]

    def total_exposure(self, balance: float) -> float:
        """Return fraction of balance currently in open positions."""
        total_notional = sum(
            (p["quantity"] * (p["avg_entry"] or 0))
            for p in self._positions.values()
            if p["quantity"] > 0
        )
        return total_notional / balance if balance > 0 else 0.0

    def summary(self) -> dict:
        open_pos = self.open_positions()
        total_realized   = sum(p["realized_pnl"] for p in self._positions.values())
        total_unrealized = sum(p["unrealized_pnl"] for p in self._positions.values())
        return {
            "open_count":      len(open_pos),
            "realized_pnl":    round(total_realized, 4),
            "unrealized_pnl":  round(total_unrealized, 4),
            "positions":       open_pos,
        }

    # ─── Persistence ─────────────────────────────────────────────────────────

    def _new_position(self, symbol: str, exchange: str) -> dict:
        pos = {
            "symbol":         symbol,
            "exchange":       exchange,
            "quantity":       0.0,
            "avg_entry":      None,
            "realized_pnl":   0.0,
            "unrealized_pnl": 0.0,
            "entry_ts":       None,
        }
        self._positions[(symbol, exchange)] = pos
        return pos

    def _save(self, key: tuple, pos: dict) -> None:
        upsert_position(
            pos["symbol"], pos["exchange"], pos["quantity"],
            pos["avg_entry"], pos["realized_pnl"], pos["unrealized_pnl"],
        )
