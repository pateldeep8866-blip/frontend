# core/ev_model.py — Universal Expected Value model
#
# Stateless math only. Asset models call enrich() to stamp EV onto a
# TradeCandidateRecord. No exchange-specific logic here.

from __future__ import annotations
from core.candidate import TradeCandidateRecord


class EVModel:
    """
    EV = p_win * avg_win - (1 - p_win) * avg_loss - fees_pct - slippage_pct

    All inputs are fractions (0.006 = 0.6%), not percentages.
    """

    # ── Core formula ──────────────────────────────────────────────────────────

    @staticmethod
    def compute(
        p_win:        float,
        avg_win:      float,
        avg_loss:     float,
        fees_pct:     float,
        slippage_pct: float,
    ) -> float:
        """Return expected value per dollar risked."""
        return p_win * avg_win - (1.0 - p_win) * avg_loss - fees_pct - slippage_pct

    @staticmethod
    def kelly_fraction(p_win: float, avg_win: float, avg_loss: float) -> float:
        """
        Full Kelly fraction. Use half-Kelly in practice.
        Returns 0 if the edge is negative or avg_loss is zero.
        """
        if avg_loss <= 0 or avg_win <= 0:
            return 0.0
        b = avg_win / avg_loss  # win/loss payout ratio
        k = p_win - (1.0 - p_win) / b
        return max(k, 0.0)

    @staticmethod
    def min_p_win(avg_win: float, avg_loss: float, fees_pct: float, slippage_pct: float) -> float:
        """
        Break-even win probability (EV = 0).
        Solve: p_win*(avg_win + avg_loss) = fees + slippage + avg_loss
        """
        denom = avg_win + avg_loss
        if denom <= 0:
            return 1.0
        return (fees_pct + slippage_pct + avg_loss) / denom

    # ── Record enrichment ─────────────────────────────────────────────────────

    def enrich(self, candidate: TradeCandidateRecord) -> TradeCandidateRecord:
        """
        Stamp ev onto a TradeCandidateRecord.
        Returns the same object (mutated in place) for chaining convenience.
        """
        candidate.ev = self.compute(
            candidate.p_win,
            candidate.avg_win,
            candidate.avg_loss,
            candidate.fees_pct,
            candidate.slippage_pct,
        )
        return candidate

    # ── Batch ─────────────────────────────────────────────────────────────────

    def enrich_batch(self, candidates: list[TradeCandidateRecord]) -> list[TradeCandidateRecord]:
        """Enrich a list in-place. Returns the same list."""
        for c in candidates:
            self.enrich(c)
        return candidates

    # ── Diagnostics ───────────────────────────────────────────────────────────

    def explain(self, candidate: TradeCandidateRecord) -> dict:
        """Return a human-readable breakdown of the EV calculation."""
        gross_edge     = candidate.p_win * candidate.avg_win
        expected_loss  = (1 - candidate.p_win) * candidate.avg_loss
        net_edge       = gross_edge - expected_loss
        cost           = candidate.fees_pct + candidate.slippage_pct
        breakeven_p    = self.min_p_win(
            candidate.avg_win, candidate.avg_loss,
            candidate.fees_pct, candidate.slippage_pct,
        )
        kelly          = self.kelly_fraction(
            candidate.p_win, candidate.avg_win, candidate.avg_loss
        )
        return {
            "symbol":          candidate.symbol,
            "p_win":           f"{candidate.p_win:.1%}",
            "avg_win":         f"{candidate.avg_win:.3%}",
            "avg_loss":        f"{candidate.avg_loss:.3%}",
            "gross_edge":      f"{gross_edge:.4%}",
            "expected_loss":   f"{expected_loss:.4%}",
            "net_edge":        f"{net_edge:.4%}",
            "fees":            f"{candidate.fees_pct:.4%}",
            "slippage":        f"{candidate.slippage_pct:.4%}",
            "total_cost":      f"{cost:.4%}",
            "ev":              f"{candidate.ev:.4%}",
            "break_even_p":    f"{breakeven_p:.1%}",
            "kelly_fraction":  f"{kelly:.1%}",
            "viable":          candidate.ev > 0,
        }
