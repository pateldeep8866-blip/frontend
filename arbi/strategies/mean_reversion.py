# strategies/alpha/mean_reversion.py
#
# STATISTICAL MEAN REVERSION
#
# Better than simple MA crossover because it's based on measured
# statistical deviation rather than lagging averages.
#
# Logic:
#   - Calculate rolling mean + std of returns
#   - When price deviates > N std devs from mean → expect reversion
#   - Enter against the move, exit at mean
#   - Add RSI filter to avoid entering during genuine trends

import numpy as np
from utils.logger import get_logger

log = get_logger("strategy.mean_reversion")

# Parameters (optimizer will tune these)
LOOKBACK       = 20     # rolling window for mean/std
Z_ENTRY        = 2.0    # std devs to trigger entry
Z_EXIT         = 0.5    # std devs to exit (near mean)
RSI_PERIOD     = 14
RSI_OVERSOLD   = 35     # only buy when RSI confirms oversold
RSI_OVERBOUGHT = 65     # only sell when RSI confirms overbought
MIN_CANDLES    = 50     # need at least this many candles


def compute_rsi(closes: list, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0

    gains, losses = [], []
    for i in range(1, len(closes)):
        delta = closes[i] - closes[i - 1]
        gains.append(max(delta, 0))
        losses.append(max(-delta, 0))

    avg_gain = np.mean(gains[-period:])
    avg_loss = np.mean(losses[-period:])

    if avg_loss == 0:
        return 100.0

    rs  = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    return round(rsi, 2)


def compute_zscore(closes: list, lookback: int = LOOKBACK) -> float:
    """Z-score of latest price relative to rolling window."""
    if len(closes) < lookback:
        return 0.0

    window = closes[-lookback:]
    mean   = np.mean(window)
    std    = np.std(window)

    if std == 0:
        return 0.0

    return (closes[-1] - mean) / std


def mean_reversion_signal(candles: list, symbol: str = "") -> dict:
    """
    candles: list of dicts with 'close' key (OHLCV format)
    Returns signal dict with action and confidence metrics.
    """
    if len(candles) < MIN_CANDLES:
        return {"action": "HOLD", "reason": "insufficient_data"}

    closes = [c["close"] for c in candles]
    zscore = compute_zscore(closes)
    rsi    = compute_rsi(closes, RSI_PERIOD)

    # Strong negative deviation + oversold RSI → expect bounce up
    if zscore <= -Z_ENTRY and rsi <= RSI_OVERSOLD:
        confidence = min(abs(zscore) / Z_ENTRY, 3.0)   # cap at 3x
        return {
            "action":     "BUY",
            "zscore":     round(zscore, 3),
            "rsi":        rsi,
            "confidence": round(confidence, 2),
            "reason":     f"zscore={zscore:.2f} rsi={rsi:.1f}",
            "strategy":   "mean_reversion",
            "symbol":     symbol,
        }

    # Strong positive deviation + overbought RSI → expect pullback
    if zscore >= Z_ENTRY and rsi >= RSI_OVERBOUGHT:
        confidence = min(zscore / Z_ENTRY, 3.0)
        return {
            "action":     "SELL",
            "zscore":     round(zscore, 3),
            "rsi":        rsi,
            "confidence": round(confidence, 2),
            "reason":     f"zscore={zscore:.2f} rsi={rsi:.1f}",
            "strategy":   "mean_reversion",
            "symbol":     symbol,
        }

    # Near mean → exit if in position
    if abs(zscore) <= Z_EXIT:
        return {
            "action":   "EXIT",
            "zscore":   round(zscore, 3),
            "rsi":      rsi,
            "reason":   "price_near_mean",
            "strategy": "mean_reversion",
            "symbol":   symbol,
        }

    return {
        "action": "HOLD",
        "zscore": round(zscore, 3),
        "rsi":    rsi,
        "reason": "no_signal",
    }


def score_signal(signal: dict) -> float:
    """Convert signal to ranker score."""
    if signal["action"] == "HOLD":
        return 0.0
    return signal.get("confidence", 1.0) * 50
