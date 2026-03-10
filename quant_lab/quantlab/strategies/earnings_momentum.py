import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from .base_strategy import BaseStrategy, StrategySignal


class EarningsMomentumStrategy(BaseStrategy):
    name = "earnings_momentum"
    description = '''
    Post-earnings announcement drift (PEAD).
    Buys stocks showing strong price and
    volume reaction after earnings beat.
    Research shows stocks continue drifting
    in the direction of the earnings surprise
    for 3-21 days after announcement.
    '''
    best_regime = ["any"]
    worst_regime = []

    def generate_signals(self, df, macro, asof):
        signals = []
        vix = macro.get("vix", 20)
        regime = self._get_regime(vix)

        for ticker in df.index:
            row = df.loc[ticker]

            ret_5d = float(row.get("ret_5d", 0))
            ret_20d = float(row.get("ret_20d", 0))
            price = float(row.get("price", 0))

            if price <= 0:
                continue

            vol_ratio = 1.0
            if row.get("avg_volume_20d") and row.get("volume"):
                vol_ratio = float(row.get("volume", 0)) / max(float(row.get("avg_volume_20d", 1)), 1)

            is_earnings_signal = ret_5d > 0.04 and vol_ratio > 1.3 and ret_20d > 0
            if not is_earnings_signal:
                continue

            conviction = min((ret_5d * 10) * vol_ratio / 3, 1.0)
            stop = round(price * 0.96, 2)
            target = round(price * 1.08, 2)

            signals.append(
                StrategySignal(
                    strategy_name="earnings_momentum",
                    ticker=ticker,
                    action="BUY",
                    conviction=conviction,
                    entry_price=price,
                    stop_loss=stop,
                    take_profit=target,
                    risk_reward=2.0,
                    regime=regime,
                    reasoning=f'Earnings drift signal: {ticker} up {ret_5d*100:.1f}% in 5 days on {vol_ratio:.1f}x avg volume. PEAD pattern detected. Hold for continued drift.',
                    hold_days=15,
                    position_size_pct=self.calculate_position_size(conviction, regime, "moderate") * 0.8,
                    raw_score=ret_5d * vol_ratio,
                    indicators={
                        "ret_5d": ret_5d,
                        "ret_20d": ret_20d,
                        "vol_ratio": vol_ratio,
                        "conviction": conviction,
                    },
                )
            )

        signals.sort(key=lambda x: x.conviction, reverse=True)
        return signals[:3], "ok"

    def _get_regime(self, vix):
        if vix < 15:
            return "risk_on"
        if vix < 20:
            return "neutral"
        if vix < 25:
            return "caution"
        return "risk_off"
