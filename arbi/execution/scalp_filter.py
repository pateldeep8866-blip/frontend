# execution/scalp_filter.py — Pre-trade signal validation for Scalp mode
#
# Maintains rolling price/volume buffers (updated each loop tick) and gates
# entries on four conditions:
#   1. Spread < 0.1% — tight enough to not eat edge on entry/exit
#   2. RSI < 35      — genuinely oversold, not just a dip in a downtrend
#   3. Z-score < -2  — price is statistically below its rolling mean
#   4. Volume ≥ 80% of rolling average — confirms the move has participation
#
# All conditions must pass. A single reject means no trade.

from collections import deque

from strategies.mean_reversion import compute_rsi, compute_zscore
from config import SCALP_PREFERRED_PAIRS, SCALP_MIN_SPREAD_PCT
from utils.logger import get_logger

log = get_logger("execution.scalp_filter")

RSI_OVERSOLD   = 35      # RSI must be at or below this for a long scalp
Z_ENTRY        = 2.0     # price must be this many std devs below the mean
PRICE_LOOKBACK = 20      # rolling window for Z-score
RSI_PERIOD     = 14      # standard RSI period
MIN_HISTORY    = 14      # minimum buffered prices before RSI is meaningful
VOL_MIN_RATIO  = 0.80    # current volume must be ≥ 80% of rolling avg


class ScalpSignalFilter:
    """
    Validates signals before a scalp entry is allowed.

    Usage:
        filt = ScalpSignalFilter()
        # each loop tick:
        filt.update(snap)
        # before entering a trade:
        approved, reason = filt.validate(symbol, exchange, snap)
    """

    def __init__(self):
        self._price_buf: dict = {}   # symbol → deque[float]
        self._vol_buf:   dict = {}   # symbol → deque[float]

    def update(self, snap: dict) -> None:
        """
        Feed latest prices and volumes from the market snapshot.
        Must be called once per main loop tick so buffers stay current.
        """
        for ex_data in snap.values():
            for symbol in SCALP_PREFERRED_PAIRS:
                row   = ex_data.get(symbol, {})
                price = row.get("last") or row.get("bid")
                vol   = row.get("base_volume") or 0

                if price and price > 0:
                    buf = self._price_buf.setdefault(
                        symbol,
                        deque(maxlen=PRICE_LOOKBACK + RSI_PERIOD + 5),
                    )
                    buf.append(float(price))

                if vol:
                    vbuf = self._vol_buf.setdefault(
                        symbol,
                        deque(maxlen=PRICE_LOOKBACK),
                    )
                    vbuf.append(float(vol))

    def validate(self, symbol: str, exchange: str, snap: dict, score: float = 0) -> tuple:
        """
        Returns (approved: bool, reason: str).
        All four conditions must pass for a scalp entry.
        During warmup (< MIN_HISTORY prices), RSI/Z-score are skipped and the
        signal is approved on score alone (score >= 40).
        """
        row = snap.get(exchange, {}).get(symbol, {})
        bid = row.get("bid") or 0
        ask = row.get("ask") or 0

        # ── 1. Spread check ──────────────────────────────────────────────────
        if bid > 0 and ask > 0:
            spread = (ask - bid) / bid
            if spread > SCALP_MIN_SPREAD_PCT:
                return False, f"spread_too_wide({spread:.4%}>{SCALP_MIN_SPREAD_PCT:.4%})"

        # ── 2. Enough price history ───────────────────────────────────────────
        prices = list(self._price_buf.get(symbol, []))
        if len(prices) < MIN_HISTORY:
            if score >= 40:
                log.info(
                    "ScalpFilter WARMUP BYPASS: %s/%s | samples=%d/%d | score=%.1f",
                    symbol, exchange, len(prices), MIN_HISTORY, score,
                )
                return True, f"warmup_bypass(score={score:.1f})"
            return False, f"warming_up({len(prices)}/{MIN_HISTORY}_prices,score={score:.1f}<40)"

        # ── 3. RSI must be oversold ───────────────────────────────────────────
        rsi = compute_rsi(prices, RSI_PERIOD)
        if rsi > RSI_OVERSOLD:
            return False, f"rsi_not_oversold({rsi:.1f}>{RSI_OVERSOLD})"

        # ── 4. Z-score must be sufficiently negative ──────────────────────────
        lookback = min(PRICE_LOOKBACK, len(prices))
        zscore   = compute_zscore(prices, lookback)
        if zscore > -Z_ENTRY:
            return False, f"zscore_weak({zscore:.2f}>-{Z_ENTRY})"

        # ── 5. Volume must meet minimum threshold ─────────────────────────────
        vols = list(self._vol_buf.get(symbol, []))
        if len(vols) >= 5:
            cur_vol = vols[-1]
            avg_vol = sum(vols[:-1]) / max(len(vols) - 1, 1)
            if avg_vol > 0 and cur_vol < avg_vol * VOL_MIN_RATIO:
                return False, f"volume_low({cur_vol:.0f}<{VOL_MIN_RATIO:.0%}_avg={avg_vol:.0f})"

        log.info(
            "ScalpFilter PASSED: %s/%s | RSI=%.1f | Z=%.2f",
            symbol, exchange, rsi, zscore,
        )
        return True, f"approved(rsi={rsi:.1f},z={zscore:.2f})"
