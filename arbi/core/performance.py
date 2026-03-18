# core/performance.py — PerformanceTracker
#
# Tracks realized trade outcomes per strategy, asset class, and venue.
# Used by the allocator and risk manager to bias capital toward winners.
# Persists to an in-memory store; storage/db.py handles DB writes.

from __future__ import annotations
import time
import math
from collections import defaultdict
from typing import Optional


class PerformanceTracker:
    """
    Rolling performance statistics computed from closed trade records.

    Supports per-strategy, per-asset-class, and per-venue slicing.
    All computations are O(n) over recent trade history — no ML.
    """

    def __init__(self, window: int = 100):
        """
        window: maximum number of recent trades to keep per bucket.
        """
        self.window = window
        # bucket → list of trade records
        self._trades: dict[str, list[dict]] = defaultdict(list)

    # ── Recording ─────────────────────────────────────────────────────────────

    def record(
        self,
        strategy:    str,
        asset_class: str,
        venue:       str,
        pnl_pct:     float,   # realised PnL as fraction (+0.006 = +0.6%)
        hold_sec:    float,
        exit_reason: str = "",
        ts:          Optional[float] = None,
    ) -> None:
        trade = {
            "pnl_pct":     pnl_pct,
            "hold_sec":    hold_sec,
            "exit_reason": exit_reason,
            "ts":          ts or time.time(),
            "win":         pnl_pct > 0,
        }
        for key in (strategy, asset_class, venue, "global"):
            self._trades[key].append(trade)
            if len(self._trades[key]) > self.window:
                self._trades[key].pop(0)

    # ── Aggregation ───────────────────────────────────────────────────────────

    def stats(self, bucket: str) -> dict:
        """
        Return statistics for a bucket (strategy name, asset class, venue, or "global").
        """
        trades = self._trades.get(bucket, [])
        if not trades:
            return self._empty()

        n     = len(trades)
        wins  = [t for t in trades if t["win"]]
        losses = [t for t in trades if not t["win"]]

        avg_win  = sum(t["pnl_pct"] for t in wins)  / len(wins)  if wins  else 0.0
        avg_loss = sum(t["pnl_pct"] for t in losses) / len(losses) if losses else 0.0
        p_win    = len(wins) / n

        pnl_list = [t["pnl_pct"] for t in trades]
        avg_pnl  = sum(pnl_list) / n
        std_pnl  = math.sqrt(sum((x - avg_pnl) ** 2 for x in pnl_list) / n) if n > 1 else 0.0
        sharpe   = avg_pnl / std_pnl if std_pnl > 0 else 0.0

        avg_hold = sum(t["hold_sec"] for t in trades) / n

        return {
            "n":           n,
            "p_win":       p_win,
            "avg_win":     avg_win,
            "avg_loss":    abs(avg_loss),
            "avg_pnl":     avg_pnl,
            "std_pnl":     std_pnl,
            "sharpe":      sharpe,
            "total_pnl":   sum(pnl_list),
            "avg_hold_sec": avg_hold,
            "recent_wins":  sum(1 for t in trades[-10:] if t["win"]),
        }

    def all_stats(self) -> dict:
        """Return stats for every tracked bucket."""
        return {bucket: self.stats(bucket) for bucket in self._trades}

    # ── Allocation weight ─────────────────────────────────────────────────────

    def allocation_weight(self, strategy: str, min_trades: int = 5) -> float:
        """
        Capital allocation weight for a strategy relative to "global".
        Returns 1.0 (neutral) until min_trades data points exist.
        """
        s = self.stats(strategy)
        if s["n"] < min_trades:
            return 1.0
        g = self.stats("global")
        if g["avg_pnl"] <= 0:
            return 1.0
        # Weight = strategy sharpe / global sharpe, clamped
        ratio = (s["sharpe"] / g["sharpe"]) if g["sharpe"] > 0 else 1.0
        return max(0.2, min(ratio, 3.0))

    # ── Helpers ───────────────────────────────────────────────────────────────

    @staticmethod
    def _empty() -> dict:
        return {
            "n": 0, "p_win": 0.0, "avg_win": 0.0, "avg_loss": 0.0,
            "avg_pnl": 0.0, "std_pnl": 0.0, "sharpe": 0.0,
            "total_pnl": 0.0, "avg_hold_sec": 0.0, "recent_wins": 0,
        }
