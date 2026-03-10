import pandas as pd
import numpy as np
from .base_strategy import BaseStrategy, StrategySignal


class RegimeRotationStrategy(BaseStrategy):
    name = "regime_rotation"
    description = '''
    Macro regime rotation strategy.
    Rotates between asset classes based on
    VIX level, yield curve, and dollar strength.
    Risk-on: equities and growth
    Risk-off: bonds, gold, defensive sectors
    Works in all regimes by design.
    '''
    best_regime = ["any"]
    worst_regime = []

    RISK_ON_ASSETS = ["QQQ", "IWM", "XLK", "XLY", "XLE"]
    RISK_OFF_ASSETS = ["TLT", "GLD", "XLP", "XLV", "VNQ"]
    NEUTRAL_ASSETS = ["SPY", "XLF", "XLI", "DIA"]
    AVOID_IN_RISK_OFF = ["QQQ", "ARKK", "XLK", "TSLA", "NVDA", "AMD", "META", "IWM"]

    def generate_signals(self, df, macro, asof):
        signals = []

        vix = macro.get("vix", 20)
        dxy = macro.get("dxy", 100)
        ten_year = macro.get("tenYear", 4.0)

        regime = self._classify_regime(vix, dxy, ten_year)

        if regime == "risk_on":
            buy_list = self.RISK_ON_ASSETS
            sell_list = self.RISK_OFF_ASSETS[:2]
            conviction_base = 0.75
        elif regime == "risk_off":
            buy_list = self.RISK_OFF_ASSETS
            sell_list = self.AVOID_IN_RISK_OFF
            conviction_base = 0.85
        elif regime == "caution":
            buy_list = self.NEUTRAL_ASSETS + self.RISK_OFF_ASSETS[:2]
            sell_list = ["ARKK", "IWM", "XLE"]
            conviction_base = 0.60
        else:
            buy_list = self.NEUTRAL_ASSETS
            sell_list = []
            conviction_base = 0.50

        for ticker in buy_list:
            if ticker not in df.index:
                continue

            row = df.loc[ticker]
            price = float(row.get("price", 0))
            if price <= 0:
                continue

            ret_20d = float(row.get("ret_20d", 0))
            min_ret = -0.05 if regime == "risk_off" else -0.02
            if ret_20d < min_ret:
                continue

            stop = self.calculate_stop_loss(price, conviction_base, regime)
            target = self.calculate_take_profit(price, stop)

            signals.append(
                StrategySignal(
                    strategy_name="regime_rotation",
                    ticker=ticker,
                    action="BUY",
                    conviction=conviction_base,
                    entry_price=price,
                    stop_loss=stop,
                    take_profit=target,
                    risk_reward=2.5,
                    regime=regime,
                    reasoning=f'Regime rotation: {regime.upper()} detected. VIX={vix:.1f} DXY={dxy:.1f} 10Y={ten_year:.2f}%. {ticker} is preferred asset in this regime.',
                    hold_days=30,
                    position_size_pct=0.08,
                    raw_score=conviction_base,
                    indicators={
                        "regime": regime,
                        "vix": vix,
                        "dxy": dxy,
                        "ten_year": ten_year,
                        "ret_20d": ret_20d,
                    },
                )
            )

        for ticker in sell_list:
            if ticker not in df.index:
                continue

            row = df.loc[ticker]
            price = float(row.get("price", 0))
            if price <= 0:
                continue

            signals.append(
                StrategySignal(
                    strategy_name="regime_rotation",
                    ticker=ticker,
                    action="SELL",
                    conviction=conviction_base,
                    entry_price=price,
                    stop_loss=0,
                    take_profit=0,
                    risk_reward=0,
                    regime=regime,
                    reasoning=f'Regime rotation: Exit {ticker} in {regime.upper()} regime. Asset class not appropriate for current conditions.',
                    hold_days=0,
                    position_size_pct=0,
                    raw_score=-conviction_base,
                    indicators={"regime": regime, "vix": vix},
                )
            )

        return signals, "ok"

    def _classify_regime(self, vix, dxy, ten_year):
        if vix > 25:
            return "risk_off"
        if vix > 20:
            return "caution"
        if ten_year > 5.0 and vix > 18:
            return "caution"
        if dxy > 106 and vix > 17:
            return "caution"
        if vix < 15:
            return "risk_on"
        return "neutral"
