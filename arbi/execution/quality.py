# execution/quality.py — Smart execution quality layer
#
# This is the difference between "knowing what to trade" and
# "actually getting a good fill." Theoretical edge evaporates
# without this layer.
#
# Handles:
#   - Book depth validation before sizing
#   - Dynamic position sizing by signal confidence + regime
#   - Slippage estimation and go/no-go decision
#   - Iceberg sizing for larger orders
#   - Post-fill slippage tracking

import time
import numpy as np
from utils.logger import get_logger
from config import (
    TRADE_RISK_PCT, MIN_EDGE_AFTER_FEES_PCT,
    MIN_POSITION_USD, KRAKEN_MIN_ORDER_SIZES,
)

log = get_logger("execution.quality")

# How much of the available book depth we're willing to consume
MAX_BOOK_CONSUMPTION_PCT = 0.15   # never take more than 15% of visible depth

# Minimum book depth required (in quote currency).
# Kept low so small accounts aren't blocked on liquid pairs.
MIN_BOOK_DEPTH_USD = 50

# Slippage model — impact grows non-linearly with order size
SLIPPAGE_BASE_BPS    = 5     # 5 basis points for tiny orders
SLIPPAGE_IMPACT_COEF = 0.3   # additional bps per 1% of book consumed


class ExecutionQuality:

    def __init__(self):
        self._fill_history = []   # Track actual vs expected fills

    # ── Pre-trade validation ──────────────────────────────────────────────────

    def validate(self, symbol: str, exchange: str, side: str,
                 order_book: dict, signal: dict,
                 balance: float, regime: dict) -> dict:
        """
        Full pre-trade quality check.
        Returns { "approved": bool, "quantity": float, "reason": str,
                  "estimated_slippage_pct": float, "edge_after_slippage": float }
        """
        bids = order_book.get("bids", [])
        asks = order_book.get("asks", [])

        if not bids or not asks:
            return self._reject("empty_order_book")

        # ── Step 1: Book depth check ─────────────────────────────────────────
        levels    = asks if side == "buy" else bids
        book_usd  = sum(level[0] * level[1] for level in levels[:20])

        if book_usd < MIN_BOOK_DEPTH_USD:
            return self._reject(f"insufficient_depth ${book_usd:.0f} < ${MIN_BOOK_DEPTH_USD}")

        # ── Step 2: Base position size from risk budget ───────────────────────
        base_size_usd = balance * TRADE_RISK_PCT

        # Scale by signal confidence and regime multiplier
        confidence  = signal.get("confidence", 1.0)
        size_mult   = regime.get("size_mult", 1.0)
        adjusted_usd = base_size_usd * min(confidence, 2.0) * size_mult

        # ── Step 3: Cap at book depth limit ───────────────────────────────────
        max_by_depth = book_usd * MAX_BOOK_CONSUMPTION_PCT
        final_usd    = min(adjusted_usd, max_by_depth)

        if final_usd < MIN_POSITION_USD:
            return self._reject(f"position_too_small ${final_usd:.2f} < ${MIN_POSITION_USD:.0f} floor")

        # ── Step 4: Estimate slippage ─────────────────────────────────────────
        consumption_pct    = final_usd / book_usd
        slippage_bps       = SLIPPAGE_BASE_BPS + (consumption_pct * 100 * SLIPPAGE_IMPACT_COEF)
        slippage_pct       = slippage_bps / 10_000

        # ── Step 5: Net edge check ────────────────────────────────────────────
        raw_edge = signal.get("net_edge_pct", signal.get("score", 0)) / 100
        net_edge = raw_edge - slippage_pct

        if net_edge < MIN_EDGE_AFTER_FEES_PCT / 100:
            return self._reject(
                f"edge_too_small after_slip={net_edge*100:.4f}% min={MIN_EDGE_AFTER_FEES_PCT}%"
            )

        # ── Step 6: Compute quantity from best ask/bid ────────────────────────
        ref_price = asks[0][0] if side == "buy" else bids[0][0]
        quantity  = final_usd / ref_price if ref_price > 0 else 0

        if quantity <= 0:
            return self._reject("zero_quantity")

        # ── Step 7: Validate against Kraken minimum order size ────────────────
        min_qty = KRAKEN_MIN_ORDER_SIZES.get(symbol)
        if min_qty is not None and quantity < min_qty:
            return self._reject(
                f"below_exchange_minimum qty={quantity:.6f} < min={min_qty} for {symbol}"
            )

        log.info(
            "Quality check PASSED: %s %s %s | size=$%.0f | slip=%.3f%% | edge=%.4f%%",
            side, symbol, exchange, final_usd, slippage_pct * 100, net_edge * 100
        )

        return {
            "approved":               True,
            "quantity":               round(quantity, 6),
            "size_usd":               round(final_usd, 2),
            "ref_price":              ref_price,
            "estimated_slippage_pct": round(slippage_pct * 100, 4),
            "edge_after_slippage":    round(net_edge * 100, 4),
            "book_depth_usd":         round(book_usd, 0),
            "book_consumption_pct":   round(consumption_pct * 100, 2),
            "reason":                 "approved",
        }

    # ── Iceberg order splitting ───────────────────────────────────────────────

    def split_order(self, quantity: float, ref_price: float,
                    max_single_pct: float = 0.40) -> list:
        """
        Split a large order into smaller chunks to reduce market impact.
        Returns list of (quantity, delay_seconds) tuples.
        """
        max_single = quantity * max_single_pct
        chunks = []
        remaining = quantity

        while remaining > 0:
            chunk = min(remaining, max_single)
            # Add slight random delay between chunks to avoid pattern detection
            delay = 0 if not chunks else np.random.uniform(0.5, 2.0)
            chunks.append({"quantity": round(chunk, 6), "delay_sec": delay})
            remaining -= chunk

        log.debug("Split order into %d chunks: %s", len(chunks), chunks)
        return chunks

    # ── Post-fill slippage tracking ───────────────────────────────────────────

    def record_fill(self, expected_price: float, actual_price: float,
                    side: str, quantity: float, symbol: str) -> dict:
        """
        Compare expected vs actual fill. Feed into optimizer.
        """
        if side == "buy":
            slippage = (actual_price - expected_price) / expected_price
        else:
            slippage = (expected_price - actual_price) / expected_price

        cost = slippage * actual_price * quantity

        record = {
            "ts":             time.time(),
            "symbol":         symbol,
            "side":           side,
            "expected":       expected_price,
            "actual":         actual_price,
            "slippage_pct":   round(slippage * 100, 4),
            "slippage_cost":  round(cost, 4),
        }
        self._fill_history.append(record)

        if slippage > 0.005:   # >0.5% slippage is a warning
            log.warning("High slippage detected: %.3f%% on %s %s",
                        slippage * 100, side, symbol)

        return record

    def avg_slippage(self) -> float:
        if not self._fill_history:
            return 0.0
        return np.mean([r["slippage_pct"] for r in self._fill_history])

    def slippage_report(self) -> dict:
        if not self._fill_history:
            return {"fills": 0, "avg_slippage_pct": 0, "total_cost": 0}
        return {
            "fills":            len(self._fill_history),
            "avg_slippage_pct": round(self.avg_slippage(), 4),
            "total_cost":       round(sum(r["slippage_cost"] for r in self._fill_history), 4),
            "worst_fill":       max(self._fill_history, key=lambda x: x["slippage_pct"]),
        }

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _reject(self, reason: str) -> dict:
        log.debug("Quality check REJECTED: %s", reason)
        return {
            "approved":               False,
            "quantity":               0,
            "size_usd":               0,
            "estimated_slippage_pct": 0,
            "edge_after_slippage":    0,
            "reason":                 reason,
        }
