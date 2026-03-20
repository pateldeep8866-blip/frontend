# scanner/ranker.py — Score and rank all scanner opportunities
#
# Scoring weights:
#   70% — signal quality  (spread edge, volume, imbalance)
#   30% — orderflow score (bid/ask pressure, spread tightness, price location)
#
# Orderflow alignment bonus: +15% when orderflow direction agrees with the trade.

from config import ORDERFLOW_SCORE_WEIGHT
from utils.logger import get_logger

log = get_logger("scanner.ranker")


# Map signal type → expected trade direction (for orderflow alignment check)
_SIGNAL_DIRECTION = {
    "cross_exchange_arb": "BUY",
    "triangular_arb":     "BUY",
    "vol_breakout":       "BUY",
    "liquidity_signal":   None,   # direction comes from the signal itself
}


def rank_opportunities(items: list, orderflow_data: dict = None) -> list:
    """
    Score and sort all scanner opportunities.

    Args:
        items:          Raw findings from all scanners.
        orderflow_data: Optional {symbol → orderflow dict} from orderflow_scanner.
                        When provided, blended as 30% of final score.

    Returns:
        List sorted by score descending, with 'score' stamped on each entry.
    """
    ranked = []

    for item in items:
        score = 0.0
        t     = item.get("type", "")

        # ── Base signal score ───────────────────────────────────────────────
        if t == "cross_exchange_arb":
            score += item.get("net_edge_pct", 0) * 3.0

        elif t == "triangular_arb":
            score += item.get("net_edge_pct", 0) * 2.5

        elif t == "liquidity_signal":
            score += abs(item.get("imbalance", 0)) * 100

        elif t == "vol_breakout":
            score += item.get("volume_score", 0) * 10
            score += item.get("range_score",  0) * 20

        # ── Orderflow overlay (30% blend) ───────────────────────────────────
        raw_signal_score = score   # capture before blending for debug log
        entry = dict(item)
        of_score_val = -1.0
        if orderflow_data:
            symbol = item.get("symbol", "")
            of     = orderflow_data.get(symbol, {})

            if of:
                of_score     = of.get("orderflow_score", 50.0)
                of_score_val = of_score
                of_dir       = of.get("orderflow_direction", "NEUTRAL")

                # Determine expected trade direction for this signal type
                sig_dir = _SIGNAL_DIRECTION.get(t)
                if sig_dir is None:
                    sig_dir = item.get("signal", "BUY")   # from liquidity_signal

                # Blend: 70% signal + 30% orderflow
                blended = score * (1.0 - ORDERFLOW_SCORE_WEIGHT) + of_score * ORDERFLOW_SCORE_WEIGHT

                # +15% alignment bonus when orderflow agrees with trade direction
                if of_dir != "NEUTRAL" and of_dir == sig_dir:
                    blended *= 1.15

                score = blended
                entry["orderflow_score"]     = round(of_score, 2)
                entry["orderflow_direction"] = of_dir

        entry["score"] = round(score, 4)
        log.debug("[RANK] %s signal=%.2f of=%.1f final=%.4f",
                  item.get("symbol", "?"), raw_signal_score, of_score_val, score)
        ranked.append(entry)

    ranked.sort(key=lambda x: x["score"], reverse=True)
    return ranked
