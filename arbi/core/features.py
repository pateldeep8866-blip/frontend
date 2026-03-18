# core/features.py — Universal FeatureCalculator
#
# Computes technical features from raw OHLCV candles or tick data.
# Stateless functions grouped into a class for organisation.
# All asset classes use the same math; only the data source differs.

from __future__ import annotations
import math
from typing import Optional


class FeatureCalculator:
    """
    Compute features from price series.

    Input convention:
      candles: list of dicts with keys "close", "high", "low", "open", "volume"
               ordered oldest → newest.
    """

    # ── Trend ─────────────────────────────────────────────────────────────────

    @staticmethod
    def ema(closes: list[float], period: int) -> Optional[float]:
        if len(closes) < period:
            return None
        k = 2.0 / (period + 1)
        ema = sum(closes[:period]) / period
        for c in closes[period:]:
            ema = c * k + ema * (1 - k)
        return ema

    @staticmethod
    def sma(closes: list[float], period: int) -> Optional[float]:
        if len(closes) < period:
            return None
        return sum(closes[-period:]) / period

    @staticmethod
    def trend_direction(closes: list[float], fast: int = 20, slow: int = 50) -> Optional[str]:
        """Returns 'UPTREND', 'DOWNTREND', or None if insufficient data."""
        f = FeatureCalculator.ema(closes, fast)
        s = FeatureCalculator.ema(closes, slow)
        if f is None or s is None:
            return None
        return "UPTREND" if f > s else "DOWNTREND"

    # ── Momentum ──────────────────────────────────────────────────────────────

    @staticmethod
    def rsi(closes: list[float], period: int = 14) -> Optional[float]:
        if len(closes) < period + 1:
            return None
        gains, losses = [], []
        for i in range(1, len(closes)):
            delta = closes[i] - closes[i - 1]
            gains.append(max(delta, 0))
            losses.append(max(-delta, 0))
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return 100.0 - 100.0 / (1 + rs)

    @staticmethod
    def zscore(closes: list[float], lookback: int = 20) -> Optional[float]:
        if len(closes) < lookback:
            return None
        window = closes[-lookback:]
        mu = sum(window) / lookback
        sigma = math.sqrt(sum((x - mu) ** 2 for x in window) / lookback)
        if sigma == 0:
            return 0.0
        return (closes[-1] - mu) / sigma

    @staticmethod
    def rate_of_change(closes: list[float], period: int = 10) -> Optional[float]:
        if len(closes) < period + 1:
            return None
        return (closes[-1] - closes[-(period + 1)]) / closes[-(period + 1)]

    # ── Volatility ────────────────────────────────────────────────────────────

    @staticmethod
    def atr(candles: list[dict], period: int = 14) -> Optional[float]:
        if len(candles) < period + 1:
            return None
        trs = []
        for i in range(1, len(candles)):
            h = candles[i]["high"]
            l = candles[i]["low"]
            prev_c = candles[i - 1]["close"]
            trs.append(max(h - l, abs(h - prev_c), abs(l - prev_c)))
        return sum(trs[-period:]) / period

    @staticmethod
    def historical_volatility(closes: list[float], period: int = 20) -> Optional[float]:
        """Annualised historical volatility (log returns)."""
        if len(closes) < period + 1:
            return None
        log_returns = [math.log(closes[i] / closes[i - 1]) for i in range(1, len(closes))]
        window = log_returns[-period:]
        mu = sum(window) / len(window)
        var = sum((r - mu) ** 2 for r in window) / len(window)
        return math.sqrt(var * 252)  # annualise (252 trading days)

    @staticmethod
    def bollinger_bands(closes: list[float], period: int = 20, num_std: float = 2.0) -> Optional[dict]:
        if len(closes) < period:
            return None
        window = closes[-period:]
        mu    = sum(window) / period
        sigma = math.sqrt(sum((x - mu) ** 2 for x in window) / period)
        return {
            "upper": mu + num_std * sigma,
            "mid":   mu,
            "lower": mu - num_std * sigma,
            "width": 2 * num_std * sigma / mu if mu != 0 else 0,
        }

    # ── Volume ────────────────────────────────────────────────────────────────

    @staticmethod
    def volume_ratio(candles: list[dict], lookback: int = 20) -> Optional[float]:
        """Current volume / average volume over lookback."""
        if len(candles) < lookback + 1:
            return None
        vols    = [c["volume"] for c in candles]
        avg_vol = sum(vols[-lookback - 1:-1]) / lookback
        if avg_vol == 0:
            return None
        return vols[-1] / avg_vol

    # ── Spread ────────────────────────────────────────────────────────────────

    @staticmethod
    def spread_pct(bid: float, ask: float) -> float:
        if bid <= 0:
            return 0.0
        return (ask - bid) / bid

    # ── Composite feature vector ──────────────────────────────────────────────

    @classmethod
    def compute(cls, candles: list[dict], bid: float = 0, ask: float = 0) -> dict:
        """
        One-shot computation of all features from a candle list + current bid/ask.
        Returns a flat dict suitable for ML models or signal rules.
        """
        closes  = [c["close"] for c in candles]
        volumes = [c["volume"] for c in candles]
        return {
            "rsi_14":        cls.rsi(closes, 14),
            "rsi_7":         cls.rsi(closes, 7),
            "zscore_20":     cls.zscore(closes, 20),
            "zscore_50":     cls.zscore(closes, 50),
            "ema_20":        cls.ema(closes, 20),
            "ema_50":        cls.ema(closes, 50),
            "trend":         cls.trend_direction(closes),
            "atr_14":        cls.atr(candles, 14),
            "hv_20":         cls.historical_volatility(closes, 20),
            "bb":            cls.bollinger_bands(closes, 20),
            "roc_10":        cls.rate_of_change(closes, 10),
            "vol_ratio_20":  cls.volume_ratio(candles, 20),
            "spread_pct":    cls.spread_pct(bid, ask),
            "last_close":    closes[-1] if closes else None,
            "n_candles":     len(candles),
        }
