# portfolio/allocator.py — Dynamic capital allocation across strategies

from utils.logger import get_logger

log = get_logger("portfolio.allocator")

STRATEGIES = ["arbitrage", "breakout", "market_maker", "liquidity"]


class StrategyTracker:
    """Tracks per-strategy performance to drive dynamic allocation."""

    def __init__(self):
        self.stats = {s: {"profit": 0.0, "trades": 0} for s in STRATEGIES}

    def update(self, strategy: str, pnl: float) -> None:
        if strategy not in self.stats:
            self.stats[strategy] = {"profit": 0.0, "trades": 0}
        self.stats[strategy]["profit"] += pnl
        self.stats[strategy]["trades"] += 1

    def avg_profit_per_trade(self) -> dict:
        scores = {}
        for s, data in self.stats.items():
            scores[s] = data["profit"] / data["trades"] if data["trades"] > 0 else 0.0
        return scores

    def report(self) -> dict:
        return {
            s: {
                "trades":    d["trades"],
                "total_pnl": round(d["profit"], 4),
                "avg_pnl":   round(d["profit"] / d["trades"], 4) if d["trades"] else 0,
            }
            for s, d in self.stats.items()
        }


def allocate_capital(balance: float, performance: dict,
                     max_single_strategy: float = 0.60) -> dict:
    """
    Distribute capital proportionally to strategy performance.
    Strategies with negative average PnL receive zero allocation.
    Returns { strategy_name: dollar_amount }
    """
    positive = {s: max(p, 0) for s, p in performance.items()}
    total    = sum(positive.values())

    allocation = {}

    if total == 0:
        # Equal split across all strategies when no performance data
        per = balance / len(STRATEGIES)
        return {s: per for s in STRATEGIES}

    for s, p in positive.items():
        weight = p / total
        # Cap any single strategy
        capped_weight = min(weight, max_single_strategy)
        allocation[s] = balance * capped_weight

    # Re-normalize if caps were applied
    alloc_total = sum(allocation.values())
    if alloc_total > 0:
        allocation = {s: (v / alloc_total) * balance for s, v in allocation.items()}

    log.debug("Capital allocation: %s", {s: round(v, 2) for s, v in allocation.items()})
    return allocation
