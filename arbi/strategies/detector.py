# strategies/regime/detector.py
#
# MARKET REGIME DETECTOR
#
# The single biggest reason strategies fail: they fire in the wrong
# market conditions. A mean reversion signal in a strong trend is just
# a losing trade with extra steps.
#
# This module labels the current market state so each strategy only
# activates when conditions actually suit it.
#
# Regimes:
#   TREND_UP    → breakout + momentum strategies
#   TREND_DOWN  → short bias, avoid longs
#   RANGING     → mean reversion + market making
#   HIGH_VOL    → reduce size, widen stops, arb focus
#   LOW_VOL     → funding rate arb ideal conditions
#   RISK_OFF    → stop all directional trading

import numpy as np
from utils.logger import get_logger

log = get_logger("regime.detector")

REGIME_LABELS = ["TREND_UP", "TREND_DOWN", "RANGING", "HIGH_VOL", "LOW_VOL", "RISK_OFF"]

# Which strategies are allowed in each regime
REGIME_STRATEGY_MAP = {
    "TREND_UP":   ["breakout", "vol_breakout", "cross_exchange_arb"],
    "TREND_DOWN": ["cross_exchange_arb", "funding_rate_arb"],
    "RANGING":    ["mean_reversion", "market_maker", "liquidity_signal", "funding_rate_arb"],
    "HIGH_VOL":   ["cross_exchange_arb", "triangular_arb"],
    "LOW_VOL":    ["funding_rate_arb", "mean_reversion", "market_maker"],
    "RISK_OFF":   [],  # nothing trades in risk-off
}

# Position size multiplier per regime
REGIME_SIZE_MULTIPLIER = {
    "TREND_UP":   1.0,
    "TREND_DOWN": 0.5,
    "RANGING":    0.8,
    "HIGH_VOL":   0.4,
    "LOW_VOL":    1.0,
    "RISK_OFF":   0.0,
}


def compute_atr(candles: list, period: int = 14) -> float:
    """Average True Range — measures raw volatility."""
    if len(candles) < period + 1:
        return 0.0
    trs = []
    for i in range(1, len(candles)):
        high  = candles[i]["high"]
        low   = candles[i]["low"]
        close = candles[i - 1]["close"]
        tr = max(high - low, abs(high - close), abs(low - close))
        trs.append(tr)
    return float(np.mean(trs[-period:]))


def compute_adx(candles: list, period: int = 14) -> float:
    """
    Average Directional Index — measures trend STRENGTH (not direction).
    ADX > 25 = trending market
    ADX < 20 = ranging market
    """
    if len(candles) < period * 2:
        return 0.0

    plus_dm, minus_dm, tr_list = [], [], []

    for i in range(1, len(candles)):
        h, l, pc = candles[i]["high"], candles[i]["low"], candles[i - 1]["close"]
        ph, pl   = candles[i - 1]["high"], candles[i - 1]["low"]

        up_move   = h - ph
        down_move = pl - l

        plus_dm.append(up_move   if up_move > down_move and up_move > 0   else 0)
        minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0)
        tr_list.append(max(h - l, abs(h - pc), abs(l - pc)))

    def smooth(data, n):
        s = sum(data[:n])
        result = [s]
        for v in data[n:]:
            s = s - s / n + v
            result.append(s)
        return result

    tr_s    = smooth(tr_list, period)
    pdm_s   = smooth(plus_dm, period)
    mdm_s   = smooth(minus_dm, period)

    dx_list = []
    for i in range(len(tr_s)):
        if tr_s[i] == 0:
            continue
        pdi = 100 * pdm_s[i] / tr_s[i]
        mdi = 100 * mdm_s[i] / tr_s[i]
        denom = pdi + mdi
        if denom == 0:
            continue
        dx_list.append(100 * abs(pdi - mdi) / denom)

    return float(np.mean(dx_list[-period:])) if dx_list else 0.0


def compute_trend_direction(candles: list, fast: int = 20, slow: int = 50) -> str:
    """Simple MA relationship for direction."""
    if len(candles) < slow:
        return "NEUTRAL"
    closes    = [c["close"] for c in candles]
    ma_fast   = np.mean(closes[-fast:])
    ma_slow   = np.mean(closes[-slow:])
    if ma_fast > ma_slow * 1.005:
        return "UP"
    if ma_fast < ma_slow * 0.995:
        return "DOWN"
    return "NEUTRAL"


def compute_volatility_percentile(candles: list, lookback: int = 100) -> float:
    """
    Where is current volatility relative to recent history?
    Returns 0.0 → 1.0 (1.0 = highest volatility in lookback window)
    """
    if len(candles) < lookback:
        return 0.5
    returns = [
        abs(candles[i]["close"] / candles[i - 1]["close"] - 1)
        for i in range(1, len(candles))
    ]
    recent_vol  = np.std(returns[-20:])
    history_vol = sorted(
        [np.std(returns[i:i+20]) for i in range(0, len(returns)-20, 5)]
    )
    if not history_vol:
        return 0.5
    rank = sum(1 for v in history_vol if v <= recent_vol) / len(history_vol)
    return round(rank, 3)


def detect_regime(candles: list) -> dict:
    """
    Master regime detection function.
    Returns full regime report including which strategies are allowed.
    """
    if len(candles) < 60:
        return {
            "regime":      "RANGING",
            "confidence":  0.3,
            "allowed":     REGIME_STRATEGY_MAP["RANGING"],
            "size_mult":   REGIME_SIZE_MULTIPLIER["RANGING"],
            "reason":      "insufficient_data",
        }

    adx        = compute_adx(candles)
    direction  = compute_trend_direction(candles)
    vol_pct    = compute_volatility_percentile(candles)
    atr        = compute_atr(candles)

    # ── Regime classification logic ──────────────────────────────────────────
    # Risk-off: extreme volatility spike
    if vol_pct > 0.92:
        regime = "RISK_OFF"
        confidence = 0.85

    # High vol: elevated but not extreme
    elif vol_pct > 0.75:
        regime = "HIGH_VOL"
        confidence = 0.70

    # Strong trend
    elif adx > 25 and direction == "UP":
        regime = "TREND_UP"
        confidence = min(adx / 50, 0.95)

    elif adx > 25 and direction == "DOWN":
        regime = "TREND_DOWN"
        confidence = min(adx / 50, 0.95)

    # Low vol ranging — ideal for funding arb and mean reversion
    elif adx < 20 and vol_pct < 0.35:
        regime = "LOW_VOL"
        confidence = 0.75

    # Default: ranging
    else:
        regime = "RANGING"
        confidence = 0.60

    result = {
        "regime":     regime,
        "confidence": round(confidence, 3),
        "allowed":    REGIME_STRATEGY_MAP[regime],
        "size_mult":  REGIME_SIZE_MULTIPLIER[regime],
        "adx":        round(adx, 2),
        "direction":  direction,
        "vol_pct":    vol_pct,
        "atr":        round(atr, 4),
        "reason":     f"adx={adx:.1f} dir={direction} vol_pct={vol_pct:.2f}",
    }

    log.info("Regime: %s (confidence=%.2f) | %s", regime, confidence, result["reason"])
    return result


def filter_signals_by_regime(signals: list, regime: dict) -> list:
    """
    Remove any signals whose strategy type isn't allowed in current regime.
    Also scales signal scores by size multiplier.
    """
    allowed   = set(regime.get("allowed", []))
    size_mult = regime.get("size_mult", 1.0)

    filtered = []
    for sig in signals:
        sig_type = sig.get("type", "")
        if sig_type in allowed or any(a in sig_type for a in allowed):
            s = dict(sig)
            s["score"]     = s.get("score", 0) * size_mult
            s["size_mult"] = size_mult
            filtered.append(s)

    log.debug("Regime filter: %d → %d signals (regime=%s)",
              len(signals), len(filtered), regime.get("regime"))
    return filtered
