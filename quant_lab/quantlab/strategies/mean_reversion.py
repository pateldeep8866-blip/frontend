import pandas as pd
import numpy as np
from .base_strategy import BaseStrategy, StrategySignal


class MeanReversionStrategy(BaseStrategy):
    name = "mean_reversion"
    description = '''
    Short-term mean reversion strategy.
    Buys instruments that have pulled back
    significantly but have strong underlying
    medium-term trends.
    Sells when price reverts to mean.
    Works best in volatile, risk-off markets.
    '''
    best_regime = ["risk_off", "caution", "neutral"]
    worst_regime = []
    min_universe_size = 5

    def generate_signals(self, df, macro, asof):
        signals = []
        vix = macro.get("vix", 20)
        regime = self._get_regime(vix)

        can_run, reason = self.can_run(regime, vix, len(df))
        if not can_run:
            return signals, reason

        df = df.copy()

        if "ret_5d" in df.columns:
            mean = df["ret_5d"].mean()
            std = df["ret_5d"].std()
            if std > 0:
                df["z_ret_5d"] = (df["ret_5d"] - mean) / std

        if "ret_20d" in df.columns:
            mean = df["ret_20d"].mean()
            std = df["ret_20d"].std()
            if std > 0:
                df["z_ret_20d"] = (df["ret_20d"] - mean) / std

        df["mr_score"] = -1.0 * df.get("z_ret_5d", 0) + 0.5 * df.get("z_ret_20d", 0)

        if "vol_20d" in df.columns:
            vol_mean = df["vol_20d"].mean()
            vol_std = df["vol_20d"].std()
            if vol_std > 0:
                df["z_vol"] = (df["vol_20d"] - vol_mean) / vol_std
                df["mr_score"] -= 0.3 * df["z_vol"]

        df = df.sort_values("mr_score", ascending=False)

        top_n = min(2, max(1, len(df) // 8))
        for ticker in df.index[:top_n]:
            row = df.loc[ticker]
            score = float(row["mr_score"])

            if score < 0.5:
                continue

            ret_5d = float(row.get("ret_5d", 0))
            ret_20d = float(row.get("ret_20d", 0))

            if ret_5d >= 0:
                continue
            if ret_20d < 0:
                continue

            price = float(row.get("price", 0))
            if price <= 0:
                continue

            conviction = min(score / 3.0, 1.0)
            stop = round(price * (1 - 0.03), 2)
            target = round(price * (1 + 0.05), 2)

            signals.append(
                StrategySignal(
                    strategy_name="mean_reversion",
                    ticker=ticker,
                    action="BUY",
                    conviction=conviction,
                    entry_price=price,
                    stop_loss=stop,
                    take_profit=target,
                    risk_reward=1.67,
                    regime=regime,
                    reasoning=f'Mean reversion setup: 5d pullback {ret_5d*100:.1f}% on strong 20d trend {ret_20d*100:.1f}%. Expecting reversion in 3-7 days.',
                    hold_days=7,
                    position_size_pct=self.calculate_position_size(conviction, regime, "moderate") * 0.7,
                    raw_score=score,
                    indicators={
                        "ret_5d": ret_5d,
                        "ret_20d": ret_20d,
                        "mr_score": score,
                    },
                )
            )

        return signals, "ok"

    def _get_regime(self, vix):
        if vix < 15:
            return "risk_on"
        if vix < 20:
            return "neutral"
        if vix < 25:
            return "caution"
        return "risk_off"
