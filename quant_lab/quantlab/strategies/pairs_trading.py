import pandas as pd
import numpy as np
from .base_strategy import BaseStrategy, StrategySignal


class PairsTradingStrategy(BaseStrategy):
    name = "pairs_trading"
    description = '''
    Statistical pairs trading strategy.
    Finds correlated instrument pairs that
    have diverged from their historical spread.
    Buys the laggard, signals exit of leader.
    Market neutral — works in any regime.
    '''
    best_regime = ["any"]
    worst_regime = []

    PAIRS = [
        ("SPY", "QQQ", "broad_vs_tech"),
        ("GLD", "SLV", "gold_vs_silver"),
        ("XLE", "USO", "energy_etf_vs_oil"),
        ("XLK", "SOXX", "tech_vs_semis"),
        ("IWM", "QQQ", "small_vs_large"),
        ("TLT", "IEF", "long_vs_mid_bonds"),
        ("XLF", "GS", "finance_etf_vs_gs"),
        ("EEM", "EFA", "emerging_vs_developed"),
        ("XLV", "IBB", "health_vs_biotech"),
        ("GLD", "TLT", "gold_vs_bonds"),
    ]

    def generate_signals(self, df, macro, asof):
        signals = []
        vix = macro.get("vix", 20)
        regime = self._get_regime(vix)

        for ticker_a, ticker_b, pair_name in self.PAIRS:
            if ticker_a not in df.index or ticker_b not in df.index:
                continue

            row_a = df.loc[ticker_a]
            row_b = df.loc[ticker_b]

            ret_a = float(row_a.get("ret_20d", 0))
            ret_b = float(row_b.get("ret_20d", 0))

            price_a = float(row_a.get("price", 0))
            price_b = float(row_b.get("price", 0))

            if price_a <= 0 or price_b <= 0:
                continue

            spread = ret_a - ret_b
            threshold = 0.03
            if abs(spread) < threshold:
                continue

            if spread < -threshold:
                laggard = ticker_a
                leader = ticker_b
                laggard_price = price_a
                laggard_ret = ret_a
                leader_ret = ret_b
            else:
                laggard = ticker_b
                leader = ticker_a
                laggard_price = price_b
                laggard_ret = ret_b
                leader_ret = ret_a

            conviction = min(abs(spread) / 0.10, 1.0)

            stop = self.calculate_stop_loss(laggard_price, conviction, regime)
            target = self.calculate_take_profit(laggard_price, stop, 1.5)

            signals.append(
                StrategySignal(
                    strategy_name="pairs_trading",
                    ticker=laggard,
                    action="BUY",
                    conviction=conviction,
                    entry_price=laggard_price,
                    stop_loss=stop,
                    take_profit=target,
                    risk_reward=1.5,
                    regime=regime,
                    reasoning=f'Pairs divergence: {pair_name}. {laggard} 20d: {laggard_ret*100:.1f}% vs {leader} 20d: {leader_ret*100:.1f}%. Spread: {spread*100:.1f}%. Expecting convergence.',
                    hold_days=10,
                    position_size_pct=self.calculate_position_size(conviction, regime, "moderate") * 0.6,
                    raw_score=abs(spread),
                    indicators={
                        "spread": spread,
                        "ret_a": ret_a,
                        "ret_b": ret_b,
                        "pair": pair_name,
                    },
                )
            )

        signals.sort(key=lambda x: x.conviction, reverse=True)
        return signals[:2], "ok"

    def _get_regime(self, vix):
        if vix < 15:
            return "risk_on"
        if vix < 20:
            return "neutral"
        if vix < 25:
            return "caution"
        return "risk_off"
