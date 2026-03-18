# core/regime.py — Universal RegimeDetector
#
# Thin wrapper around the existing strategies/detector.py logic,
# exposing a clean interface for the new asset model layer.

from __future__ import annotations
from typing import Optional


# Regime constants shared by all asset models
REGIME_RANGING   = "RANGING"
REGIME_TREND_UP  = "TREND_UP"
REGIME_TREND_DOWN = "TREND_DOWN"
REGIME_HIGH_VOL  = "HIGH_VOL"
REGIME_UNKNOWN   = "UNKNOWN"


class RegimeDetector:
    """
    Detect the current market regime from candles.

    Output dict:
      {
        "regime":        str,    # RANGING | TREND_UP | TREND_DOWN | HIGH_VOL
        "volatility":    float,  # annualised historical volatility
        "trend":         str,    # "UPTREND" | "DOWNTREND"
        "adx":           float,  # average directional index (0–100)
        "size_mult":     float,  # suggested position size multiplier
        "tp_mult":       float,  # suggested take-profit multiplier
        "sl_mult":       float,  # suggested stop-loss multiplier
      }
    """

    # Regime → execution parameter multipliers
    _REGIME_PARAMS: dict[str, dict] = {
        REGIME_RANGING:    {"size_mult": 1.0, "tp_mult": 1.0, "sl_mult": 1.0},
        REGIME_TREND_UP:   {"size_mult": 1.2, "tp_mult": 1.5, "sl_mult": 0.8},
        REGIME_TREND_DOWN: {"size_mult": 0.5, "tp_mult": 0.8, "sl_mult": 1.2},
        REGIME_HIGH_VOL:   {"size_mult": 0.6, "tp_mult": 0.7, "sl_mult": 1.5},
        REGIME_UNKNOWN:    {"size_mult": 0.5, "tp_mult": 1.0, "sl_mult": 1.0},
    }

    def detect(self, candles: list[dict]) -> dict:
        """
        Detect regime from candle list.
        Falls back to existing strategies/detector.py if available.
        """
        try:
            from strategies.detector import detect_regime
            result = detect_regime(candles)
        except Exception:
            result = self._fallback(candles)

        regime = result.get("regime", REGIME_UNKNOWN)
        params = self._REGIME_PARAMS.get(regime, self._REGIME_PARAMS[REGIME_UNKNOWN])
        return {**result, **params}

    # ── Fallback if strategies/detector is unavailable ────────────────────────

    def _fallback(self, candles: list[dict]) -> dict:
        """Simple ATR-based regime fallback."""
        if len(candles) < 20:
            return {"regime": REGIME_UNKNOWN, "volatility": 0.0, "trend": "UNKNOWN", "adx": 0.0}

        import math
        closes = [c["close"] for c in candles]
        window = closes[-20:]
        mu = sum(window) / 20
        hv = math.sqrt(sum((x - mu) ** 2 for x in window) / 20) / mu

        fast_ema = sum(closes[-10:]) / 10
        slow_ema = sum(closes[-20:]) / 20

        if hv > 0.04:
            regime = REGIME_HIGH_VOL
            trend  = "UPTREND" if fast_ema > slow_ema else "DOWNTREND"
        elif fast_ema > slow_ema * 1.005:
            regime = REGIME_TREND_UP
            trend  = "UPTREND"
        elif fast_ema < slow_ema * 0.995:
            regime = REGIME_TREND_DOWN
            trend  = "DOWNTREND"
        else:
            regime = REGIME_RANGING
            trend  = "UPTREND" if fast_ema >= slow_ema else "DOWNTREND"

        return {
            "regime":     regime,
            "volatility": hv,
            "trend":      trend,
            "adx":        0.0,
        }

    @classmethod
    def params_for(cls, regime: str) -> dict:
        """Return execution multipliers for a given regime string."""
        return cls._REGIME_PARAMS.get(regime, cls._REGIME_PARAMS[REGIME_UNKNOWN])
