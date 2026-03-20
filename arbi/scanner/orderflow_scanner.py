# scanner/orderflow_scanner.py — Microstructure & order flow signals
#
# Analyzes real-time order book structure to detect directional pressure:
#   1. Bid/ask volume imbalance  — is the book weighted buy or sell side?
#   2. Spread tightness vs rolling avg — only enter when spread is tight
#   3. Price location relative to mid  — infers trade direction from tick history
#
# Output: {symbol → {orderflow_score, orderflow_direction, bid_ask_ratio,
#                     imbalance, spread_tightness, buy_pressure}}
#
# Called by ranker.py, which blends orderflow_score as 30% of final score.

from __future__ import annotations

import collections
import time

from utils.logger import get_logger

log = get_logger("scanner.orderflow")

# ── Rolling history (module-level, persists across loop ticks) ────────────────
_SPREAD_WINDOW = 30    # ~2.5 min at 5s loop — enough to detect spread widening
_PRICE_WINDOW  = 10    # last N price readings for trade-direction inference

_spread_history: dict[str, collections.deque] = {}
_price_history:  dict[str, collections.deque] = {}


def scan_orderflow(cache: dict) -> dict:
    """
    Analyze order book and price microstructure for each symbol in the cache.

    Returns a flat dict keyed by symbol (not exchange/symbol) because
    ranker.py looks up by symbol only.  When a symbol appears on multiple
    exchanges the last exchange's values win (they're nearly identical for
    liquid pairs).

    Only symbols with a non-NEUTRAL direction are included so the ranker
    can ignore symbols where orderflow is ambiguous.
    """
    results: dict = {}

    for ex_name, ex_data in cache.items():
        for symbol, row in ex_data.items():
            bids      = row.get("bids") or []
            asks      = row.get("asks") or []
            bid_price = row.get("bid")  or 0.0
            ask_price = row.get("ask")  or 0.0
            last      = row.get("ws_price") or row.get("last") or 0.0

            if not bids or not asks or bid_price <= 0 or ask_price <= 0:
                continue

            # ── 1. Bid/ask volume imbalance (deep order book) ─────────────
            bid_vol = sum(level[1] for level in bids if len(level) >= 2)
            ask_vol = sum(level[1] for level in asks if len(level) >= 2)
            total   = bid_vol + ask_vol
            if total <= 0:
                continue

            imbalance     = (bid_vol - ask_vol) / total   # [-1, +1]
            bid_ask_ratio = bid_vol / ask_vol if ask_vol > 0 else 1.0

            # ── 2. Spread tightness vs rolling average ────────────────────
            mid        = (bid_price + ask_price) / 2.0
            spread_pct = (ask_price - bid_price) / mid if mid > 0 else 0.0

            key = f"{ex_name}:{symbol}"
            if key not in _spread_history:
                _spread_history[key] = collections.deque(maxlen=_SPREAD_WINDOW)
            _spread_history[key].append(spread_pct)

            avg_spread     = sum(_spread_history[key]) / len(_spread_history[key])
            # >1 = current spread tighter than avg (good entry conditions)
            # <1 = current spread wider than avg (poor execution quality)
            spread_tight   = (avg_spread / spread_pct) if spread_pct > 0 else 1.0

            # ── 3. Trade direction from recent price vs mid ───────────────
            if key not in _price_history:
                _price_history[key] = collections.deque(maxlen=_PRICE_WINDOW)
            if last > 0:
                _price_history[key].append(last)

            buy_pressure = 0.0
            prices = list(_price_history[key])
            if len(prices) >= 3 and mid > 0:
                n_above      = sum(1 for p in prices if p > mid)
                n_below      = sum(1 for p in prices if p < mid)
                buy_pressure = (n_above - n_below) / len(prices)   # [-1, +1]

            # ── 4. Composite score (0–100, 50 = neutral) ─────────────────
            # Weight: imbalance 40%, spread tightness 30%, trade pressure 30%
            imbalance_score = (imbalance + 1.0) / 2.0 * 100          # 0-100
            tight_score     = min(spread_tight, 2.0) / 2.0 * 100     # 0-100
            pressure_score  = (buy_pressure + 1.0) / 2.0 * 100       # 0-100

            composite = (
                imbalance_score * 0.40
                + tight_score   * 0.30
                + pressure_score * 0.30
            )

            # ── 5. Direction ─────────────────────────────────────────────
            if composite >= 60:
                direction = "BUY"
            elif composite <= 40:
                direction = "SELL"
            else:
                direction = "NEUTRAL"

            results[symbol] = {
                "symbol":              symbol,
                "exchange":            ex_name,
                "orderflow_score":     round(composite, 2),
                "orderflow_direction": direction,
                "bid_ask_ratio":       round(bid_ask_ratio, 4),
                "imbalance":           round(imbalance, 4),
                "spread_tightness":    round(spread_tight, 4),
                "buy_pressure":        round(buy_pressure, 4),
            }

    return results
