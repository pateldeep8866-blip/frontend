import pandas as pd
import numpy as np
from .base_strategy import BaseStrategy, StrategySignal


class MomentumStrategy(BaseStrategy):
    name = "momentum"
    description = '''
    Cross-sectional momentum strategy.
    Buys the strongest relative performers
    across the universe.
    Sells the weakest.
    Works best in trending, risk-on markets.
    '''
    best_regime = ["risk_on", "neutral"]
    worst_regime = ["risk_off"]
    min_universe_size = 5

    def generate_signals(self, df, macro, asof):
        signals = []
        vix = macro.get("vix", 20)
        regime = self._get_regime(vix)

        can_run, reason = self.can_run(regime, vix, len(df))
        if not can_run:
            return signals, reason

        df = df.copy()

        for col in ["ret_5d", "ret_20d", "ret_60d"]:
            if col in df.columns:
                mean = df[col].mean()
                std = df[col].std()
                if std > 0:
                    df[f"z_{col}"] = (df[col] - mean) / std
                else:
                    df[f"z_{col}"] = 0

        df["momentum_score"] = (
            0.20 * df.get("z_ret_5d", 0)
            + 0.35 * df.get("z_ret_20d", 0)
            + 0.45 * df.get("z_ret_60d", 0)
        )

        if "avg_volume_20d" in df.columns:
            vol_mean = df["avg_volume_20d"].mean()
            vol_std = df["avg_volume_20d"].std()
            if vol_std > 0:
                df["z_volume"] = (df["avg_volume_20d"] - vol_mean) / vol_std
            df["momentum_score"] += 0.10 * df.get("z_volume", 0)

        df = df.sort_values("momentum_score", ascending=False)

        top_n = min(3, max(1, len(df) // 5))
        for ticker in df.index[:top_n]:
            row = df.loc[ticker]
            score = float(row["momentum_score"])

            if score < 0.3:
                continue

            price = float(row.get("price", 0))
            if price <= 0:
                continue

            conviction = min(score / 2.0, 1.0)
            stop = self.calculate_stop_loss(price, conviction, regime)
            target = self.calculate_take_profit(price, stop)

            signals.append(
                StrategySignal(
                    strategy_name="momentum",
                    ticker=ticker,
                    action="BUY",
                    conviction=conviction,
                    entry_price=price,
                    stop_loss=stop,
                    take_profit=target,
                    risk_reward=2.5,
                    regime=regime,
                    reasoning=f'Top momentum rank {list(df.index).index(ticker)+1}/{len(df)}. 20d return: {row.get("ret_20d",0)*100:.1f}%',
                    hold_days=20,
                    position_size_pct=self.calculate_position_size(conviction, regime, "moderate"),
                    raw_score=score,
                    indicators={
                        "ret_5d": float(row.get("ret_5d", 0)),
                        "ret_20d": float(row.get("ret_20d", 0)),
                        "ret_60d": float(row.get("ret_60d", 0)),
                        "momentum_score": score,
                    },
                )
            )

        bottom_n = min(2, len(df))
        for ticker in df.index[-bottom_n:]:
            row = df.loc[ticker]
            score = float(row["momentum_score"])

            if score > -0.3:
                continue

            price = float(row.get("price", 0))
            if price <= 0:
                continue

            signals.append(
                StrategySignal(
                    strategy_name="momentum",
                    ticker=ticker,
                    action="SELL",
                    conviction=abs(score) / 2.0,
                    entry_price=price,
                    stop_loss=0,
                    take_profit=0,
                    risk_reward=0,
                    regime=regime,
                    reasoning=f'Bottom momentum rank {list(df.index).index(ticker)+1}/{len(df)}. Weakest relative performer.',
                    hold_days=0,
                    position_size_pct=0,
                    raw_score=score,
                    indicators={"momentum_score": score},
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
