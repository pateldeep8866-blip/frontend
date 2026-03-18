# core/allocator.py — PortfolioAllocator
#
# Ranks trade candidates across ALL asset classes by EV,
# applies portfolio-level constraints, and stamps allocated_capital
# on the approved subset.
#
# This is the single place where cross-market capital competition happens.

from __future__ import annotations
from typing import Optional
from core.candidate import TradeCandidateRecord, AssetClass


class PortfolioAllocator:
    """
    Input : list of TradeCandidateRecord (any asset class, any venue)
    Output: subset with allocated_capital stamped, sorted by rank

    Constraints enforced:
      - max_open_trades        (global count)
      - max_capital_pct        (max fraction of balance in one trade)
      - max_asset_class_pct    (max fraction of balance in one asset class)
      - max_venue_pct          (max fraction of balance in one venue)
      - min_ev_threshold       (drop candidates below this EV)
    """

    def __init__(
        self,
        max_open_trades:     int   = 5,
        max_capital_pct:     float = 0.25,    # 25% of balance per trade
        max_asset_class_pct: float = 0.60,    # 60% in one asset class
        max_venue_pct:       float = 0.70,    # 70% at one venue
        min_ev_threshold:    float = 0.0,     # drop non-positive EV
    ):
        self.max_open_trades     = max_open_trades
        self.max_capital_pct     = max_capital_pct
        self.max_asset_class_pct = max_asset_class_pct
        self.max_venue_pct       = max_venue_pct
        self.min_ev_threshold    = min_ev_threshold

    def rank_and_allocate(
        self,
        candidates:        list[TradeCandidateRecord],
        available_capital: float,
        open_positions:    Optional[dict] = None,   # {venue: committed_usd}
    ) -> list[TradeCandidateRecord]:
        """
        Rank all candidates by EV × confidence, apply constraints,
        allocate capital to the best N.

        Returns the approved list (allocated_capital stamped) sorted best-first.
        """
        if not candidates or available_capital <= 0:
            return []

        open_pos = open_positions or {}

        # ── 1. Filter non-viable candidates ───────────────────────────────────
        viable = [c for c in candidates if c.ev > self.min_ev_threshold and c.suggested_capital > 0]

        # ── 2. Rank by EV × confidence ────────────────────────────────────────
        ranked = sorted(viable, key=lambda c: c.ev * c.confidence, reverse=True)

        # ── 3. Greedy allocation with portfolio constraints ────────────────────
        approved: list[TradeCandidateRecord] = []
        committed_total:      float = sum(open_pos.values())
        committed_by_class:   dict  = {}
        committed_by_venue:   dict  = {}

        # Seed with currently open position exposure
        for venue, usd in open_pos.items():
            committed_by_venue[venue] = committed_by_venue.get(venue, 0) + usd

        for c in ranked:
            if len(approved) >= self.max_open_trades:
                break

            want = min(c.suggested_capital, available_capital * self.max_capital_pct)
            if want <= 0:
                continue

            # Asset-class cap
            cls_key  = c.asset_class.value
            cls_used = committed_by_class.get(cls_key, 0)
            if cls_used + want > available_capital * self.max_asset_class_pct:
                continue

            # Venue cap
            vn_used = committed_by_venue.get(c.venue, 0)
            if vn_used + want > available_capital * self.max_venue_pct:
                continue

            # Total capital check
            if committed_total + want > available_capital:
                want = available_capital - committed_total
                if want < 4.0:
                    break

            # Approve
            c.allocated_capital = want
            approved.append(c)
            committed_total               += want
            committed_by_class[cls_key]   = cls_used + want
            committed_by_venue[c.venue]   = vn_used + want

        return approved

    # ── Diagnostics ───────────────────────────────────────────────────────────

    def explain(self, candidates: list[TradeCandidateRecord]) -> list[dict]:
        """Return a ranked summary table for logging."""
        ranked = sorted(candidates, key=lambda c: c.ev * c.confidence, reverse=True)
        return [
            {
                "rank":       i + 1,
                "symbol":     c.symbol,
                "asset":      c.asset_class.value,
                "venue":      c.venue,
                "strategy":   c.strategy,
                "ev":         f"{c.ev:.4%}",
                "p_win":      f"{c.p_win:.1%}",
                "confidence": f"{c.confidence:.2f}",
                "suggested":  f"${c.suggested_capital:.0f}",
                "allocated":  f"${c.allocated_capital:.0f}",
                "viable":     c.is_viable,
            }
            for i, c in enumerate(ranked)
        ]
