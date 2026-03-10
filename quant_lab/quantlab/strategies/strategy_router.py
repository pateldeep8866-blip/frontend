import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

from .base_strategy import StrategySignal
from .momentum import MomentumStrategy
from .mean_reversion import MeanReversionStrategy
from .regime_rotation import RegimeRotationStrategy
from .pairs_trading import PairsTradingStrategy
from .earnings_momentum import EarningsMomentumStrategy

DB_PATH = Path("/Users/juanramirez/NOVA/NOVA_LAB/data/trades.db")


@dataclass
class RouterDecision:
    signals: List[StrategySignal]
    top_signal: Optional[StrategySignal]
    strategy_used: str
    regime: str
    all_strategy_results: Dict
    no_trade: bool
    reason: str
    confidence: float


class StrategyRouter:
    '''
    Routes market conditions to appropriate
    strategies and combines their signals.

    Priority order:
    1. Regime Rotation (macro override)
    2. Earnings Momentum (event driven)
    3. Pairs Trading (market neutral)
    4. Momentum (trending markets)
    5. Mean Reversion (volatile markets)
    '''

    def __init__(self):
        self.strategies = {
            "momentum": MomentumStrategy(),
            "mean_reversion": MeanReversionStrategy(),
            "regime_rotation": RegimeRotationStrategy(),
            "pairs_trading": PairsTradingStrategy(),
            "earnings_momentum": EarningsMomentumStrategy(),
        }

        self.regime_weights = {
            "risk_on": {
                "momentum": 0.40,
                "earnings_momentum": 0.25,
                "pairs_trading": 0.20,
                "mean_reversion": 0.10,
                "regime_rotation": 0.05,
            },
            "neutral": {
                "momentum": 0.30,
                "pairs_trading": 0.25,
                "earnings_momentum": 0.20,
                "mean_reversion": 0.15,
                "regime_rotation": 0.10,
            },
            "caution": {
                "mean_reversion": 0.30,
                "regime_rotation": 0.30,
                "pairs_trading": 0.20,
                "momentum": 0.10,
                "earnings_momentum": 0.10,
            },
            "risk_off": {
                "regime_rotation": 0.40,
                "mean_reversion": 0.30,
                "pairs_trading": 0.20,
                "momentum": 0.05,
                "earnings_momentum": 0.05,
            },
        }

    def route(self, df, macro, asof, risk_level="moderate", strategy_weights=None):
        vix = macro.get("vix", 20)
        regime = self._get_regime(vix)
        weights = self.regime_weights.get(regime, self.regime_weights["neutral"])

        dynamic_ready = self._dynamic_weights_ready()
        if dynamic_ready and isinstance(strategy_weights, dict) and strategy_weights:
            w = {k: float(v) for k, v in strategy_weights.items() if k in self.strategies}
            if w:
                total = sum(max(0.0, x) for x in w.values())
                if total > 0:
                    weights = {k: max(0.0, w.get(k, 0.0)) / total for k in self.strategies}

        all_results = {}
        all_signals = []

        for name, strategy in self.strategies.items():
            try:
                signals, reason = strategy.generate_signals(df, macro, asof)
                all_results[name] = {"signals": signals, "reason": reason, "count": len(signals)}
                weight = weights.get(name, 0.1)
                for signal in signals:
                    if signal.action == "BUY":
                        signal.conviction *= weight
                    all_signals.append(signal)
            except Exception as e:
                all_results[name] = {"signals": [], "reason": f"error: {str(e)}", "count": 0}

        buy_signals = [s for s in all_signals if s.action == "BUY"]
        sell_signals = [s for s in all_signals if s.action == "SELL"]

        if not buy_signals:
            return RouterDecision(
                signals=[],
                top_signal=None,
                strategy_used="none",
                regime=regime,
                all_strategy_results=all_results,
                no_trade=True,
                reason="No strategies generated buy signals",
                confidence=0.0,
            )

        buy_signals.sort(key=lambda x: x.conviction, reverse=True)

        seen_tickers = set()
        top_signals = []
        for signal in buy_signals:
            if signal.ticker not in seen_tickers:
                seen_tickers.add(signal.ticker)
                top_signals.append(signal)
            if len(top_signals) >= 5:
                break

        top_signal = top_signals[0]

        seen_sells = set()
        top_sells = []
        for signal in sell_signals:
            if signal.ticker not in seen_sells:
                seen_sells.add(signal.ticker)
                top_sells.append(signal)

        return RouterDecision(
            signals=top_signals + top_sells,
            top_signal=top_signal,
            strategy_used=top_signal.strategy_name,
            regime=regime,
            all_strategy_results=all_results,
            no_trade=False,
            reason="ok",
            confidence=top_signal.conviction,
        )

    def get_strategy_summary(self):
        return {
            name: {
                "description": s.description.strip(),
                "best_regime": s.best_regime,
                "worst_regime": s.worst_regime,
            }
            for name, s in self.strategies.items()
        }

    def _dynamic_weights_ready(self) -> bool:
        try:
            conn = sqlite3.connect(DB_PATH)
            rows = conn.execute(
                """
                SELECT strategy_name, COUNT(*) AS n
                FROM trades
                WHERE strategy_name IS NOT NULL AND action='BUY'
                GROUP BY strategy_name
                """
            ).fetchall()
            conn.close()
            by = {str(r[0]): int(r[1] or 0) for r in rows}
            if not by:
                return False
            for name in self.strategies:
                if by.get(name, 0) < 50:
                    return False
            return True
        except Exception:
            return False

    def _get_regime(self, vix):
        if vix < 15:
            return "risk_on"
        if vix < 20:
            return "neutral"
        if vix < 25:
            return "caution"
        return "risk_off"
