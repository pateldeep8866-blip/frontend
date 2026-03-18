# core/signals.py — Universal SignalEngine
#
# Translates a feature dict into a directional signal + confidence.
# Asset models call generate() and get back a normalised signal dict.
# Strategy implementations live in assets/*, not here.

from __future__ import annotations
from typing import Optional
from core.candidate import OrderSide


# ── Signal types ─────────────────────────────────────────────────────────────

SIGNAL_MEAN_REVERSION = "mean_reversion"
SIGNAL_MOMENTUM       = "momentum"
SIGNAL_BREAKOUT       = "breakout"
SIGNAL_FUNDING_ARB    = "funding_rate_arb"
SIGNAL_SPREAD_ARB     = "cross_exchange_arb"
SIGNAL_TRI_ARB        = "triangular_arb"
SIGNAL_LIQUIDITY      = "liquidity_imbalance"


class SignalEngine:
    """
    Stateless signal rules applied to a feature dict.
    Each method returns a signal dict or None if no signal fires.

    Signal dict schema:
      {
        "type":       str,           # signal type constant above
        "side":       OrderSide,
        "score":      float,         # 0–100
        "confidence": float,         # 0–1
        "reason":     str,
        "features":   dict,          # subset of input features used
      }
    """

    # ── Mean-reversion signal ─────────────────────────────────────────────────

    @staticmethod
    def mean_reversion(features: dict, regime: str = "RANGING") -> Optional[dict]:
        """
        Fire when price is statistically stretched and momentum is oversold.
        Tuned to be aggressive in RANGING regimes, conservative in TREND_DOWN.
        """
        rsi   = features.get("rsi_14")
        z     = features.get("zscore_20")
        trend = features.get("trend")

        if rsi is None or z is None:
            return None

        # Direction
        if rsi < 35 and z < -2.0:
            side = OrderSide.BUY
        elif rsi > 65 and z > 2.0:
            side = OrderSide.SELL
        else:
            return None

        # Regime veto
        if regime == "TREND_DOWN" and side == OrderSide.BUY:
            return None
        if regime == "TREND_UP" and side == OrderSide.SELL:
            return None

        # Score
        score = min(100.0, abs(z) * 20 + (35 - rsi if side == OrderSide.BUY else rsi - 65) * 1.5)

        return {
            "type":       SIGNAL_MEAN_REVERSION,
            "side":       side,
            "score":      score,
            "confidence": min(score / 100.0, 1.0),
            "reason":     f"rsi={rsi:.1f} z={z:.2f} regime={regime}",
            "features":   {"rsi_14": rsi, "zscore_20": z, "trend": trend, "regime": regime},
        }

    # ── Momentum signal ───────────────────────────────────────────────────────

    @staticmethod
    def momentum(features: dict, regime: str = "RANGING") -> Optional[dict]:
        """
        Trend-following signal: only fires in TREND_UP or TREND_DOWN regimes.
        """
        roc    = features.get("roc_10")
        trend  = features.get("trend")
        vol_r  = features.get("vol_ratio_20")

        if roc is None or trend is None:
            return None

        # Only trade momentum in trending regimes
        if regime not in ("TREND_UP", "TREND_DOWN"):
            return None

        if trend == "UPTREND" and roc > 0.005 and (vol_r or 1) >= 1.2:
            side = OrderSide.BUY
        elif trend == "DOWNTREND" and roc < -0.005 and (vol_r or 1) >= 1.2:
            side = OrderSide.SELL
        else:
            return None

        score = min(100.0, abs(roc) * 3000 + ((vol_r or 1) - 1) * 50)

        return {
            "type":       SIGNAL_MOMENTUM,
            "side":       side,
            "score":      score,
            "confidence": min(score / 100.0, 1.0),
            "reason":     f"roc={roc:.3%} trend={trend} vol_ratio={vol_r:.2f}",
            "features":   {"roc_10": roc, "trend": trend, "vol_ratio_20": vol_r},
        }

    # ── Volatility breakout signal ────────────────────────────────────────────

    @staticmethod
    def breakout(features: dict, regime: str = "RANGING") -> Optional[dict]:
        """
        Squeeze breakout: BB width contracting then expanding with volume.
        """
        bb    = features.get("bb")
        roc   = features.get("roc_10")
        vol_r = features.get("vol_ratio_20")

        if bb is None or roc is None or vol_r is None:
            return None

        # Breakouts need HIGH_VOL or transitional regimes
        if regime == "RANGING" and bb["width"] < 0.015:
            return None  # no squeeze yet

        if (vol_r or 0) < 1.8:
            return None  # need volume confirmation

        if roc > 0.01:
            side = OrderSide.BUY
        elif roc < -0.01:
            side = OrderSide.SELL
        else:
            return None

        score = min(100.0, (vol_r - 1) * 40 + abs(roc) * 2000)

        return {
            "type":       SIGNAL_BREAKOUT,
            "side":       side,
            "score":      score,
            "confidence": min(score / 100.0, 1.0),
            "reason":     f"vol_ratio={vol_r:.2f} roc={roc:.3%} bb_width={bb['width']:.4f}",
            "features":   {"bb": bb, "roc_10": roc, "vol_ratio_20": vol_r},
        }

    # ── Best signal ───────────────────────────────────────────────────────────

    @classmethod
    def best(cls, features: dict, regime: str, strategies: list[str]) -> Optional[dict]:
        """
        Run all requested strategies and return the highest-scoring signal.
        """
        signals = []
        for strat in strategies:
            fn = {
                SIGNAL_MEAN_REVERSION: cls.mean_reversion,
                SIGNAL_MOMENTUM:       cls.momentum,
                SIGNAL_BREAKOUT:       cls.breakout,
            }.get(strat)
            if fn:
                sig = fn(features, regime)
                if sig:
                    signals.append(sig)

        if not signals:
            return None
        return max(signals, key=lambda s: s["score"])
