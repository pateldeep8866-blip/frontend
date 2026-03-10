from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime


@dataclass
class StrategySignal:
    strategy_name: str
    ticker: str
    action: str
    conviction: float
    entry_price: float
    stop_loss: float
    take_profit: float
    risk_reward: float
    regime: str
    reasoning: str
    hold_days: int
    position_size_pct: float
    raw_score: float
    indicators: dict = field(default_factory=dict)
    generated_utc: str = field(default_factory=lambda: datetime.utcnow().isoformat() + "Z")


class BaseStrategy:
    name = "base"
    description = ""
    best_regime = ["any"]
    worst_regime = []
    min_universe_size = 3

    def __init__(self, params: Optional[dict] = None):
        self.params = params or {}

    def can_run(self, regime, vix, universe_size):
        if universe_size < self.min_universe_size:
            return False, "insufficient universe"
        if regime in self.worst_regime:
            return False, f"strategy disabled in {regime}"
        return True, "ok"

    def generate_signals(self, df, macro, asof):
        raise NotImplementedError

    def calculate_stop_loss(self, price, conviction, regime):
        base_stop = 0.05
        if regime == "risk_off":
            base_stop = 0.03
        elif regime == "risk_on":
            base_stop = 0.07
        stop_pct = base_stop * (1 - conviction * 0.3)
        return round(price * (1 - stop_pct), 2)

    def calculate_take_profit(self, price, stop_loss, risk_reward=2.5):
        risk = price - stop_loss
        return round(price + (risk * risk_reward), 2)

    def calculate_position_size(self, conviction, regime, risk_level):
        sizes = {
            "conservative": 0.05,
            "moderate": 0.12,
            "aggressive": 0.18,
        }
        base = sizes.get(risk_level, 0.12)
        return min(base * conviction, 0.20)
