# simulation/perp_engine_scalp.py
#
# BYBIT PERP SCALP ENGINE  (2x leverage, mean-reversion only, 3s loop)
#
# Specialised for fast scalp trades:
#   - Leverage: 2x
#   - Strategy: mean_reversion only
#   - Score threshold: 65 (higher bar than base perp engine's 55)
#   - Loop interval: 3s
#   - TP: 0.3%   SL: 0.2%
#
# Run:
#   env EXCHANGE=bybit python -u -m simulation.perp_engine_scalp --live

import argparse
import time

from utils.logger import get_logger
from simulation.perp_engine import PerpSimulationEngine, PERP_DB_PATH, STARTING_BALANCE

log = get_logger("simulation.perp_engine_scalp")

# ── Scalp-specific overrides ──────────────────────────────────────────────────

SCALP_LEVERAGE          = 2.0
SCALP_LOOP_INTERVAL_SEC = 3
SCALP_MIN_SCORE         = 65
SCALP_TP_PCT            = 0.003   # 0.3%
SCALP_SL_PCT            = -0.002  # 0.2%
SCALP_MAX_HOLD_HRS      = 0.5     # 30 minutes max


class PerpScalpEngine(PerpSimulationEngine):
    """
    Mean-reversion-only perp scalp engine.
    Inherits all infra from PerpSimulationEngine; overrides strategy selection
    and exit parameters.
    """

    def __init__(self, sim_user: str = "perp_scalp", use_live: bool = True):
        super().__init__(
            sim_user   = sim_user,
            use_live   = use_live,
            leverage   = SCALP_LEVERAGE,
            scalp_mode = True,
        )
        log.info(
            "PerpScalpEngine: leverage=%.1fx TP=%.1f%% SL=%.1f%% score>=%d loop=%ds",
            SCALP_LEVERAGE,
            SCALP_TP_PCT * 100,
            abs(SCALP_SL_PCT) * 100,
            SCALP_MIN_SCORE,
            SCALP_LOOP_INTERVAL_SEC,
        )

    def _tick(self) -> None:
        """Override tick: enforce scalp score threshold and 3s loop label."""
        from datetime import datetime
        now = datetime.utcnow().strftime("%H:%M:%S")

        from simulation.perp_engine import FLOOR_USD
        if self.balance <= FLOOR_USD:
            log.warning("[SCALP] FLOOR HIT — balance=$%.2f — HALTING", self.balance)
            self.stop()
            return

        self._apply_funding_if_due()

        market_data = self._fetch_market_data()
        regime      = self._detect_regime(market_data)

        # Force mean_reversion into allowed so _scan_signals generates it regardless of regime
        scalp_regime = dict(regime)
        scalp_regime["allowed"] = list(set(regime.get("allowed", [])) | {"mean_reversion"})
        raw_signals = self._scan_signals(market_data, scalp_regime)
        signals     = [s for s in raw_signals if s.get("strategy") == "mean_reversion"]

        if signals:
            best = max(signals, key=lambda s: s.get("score", 0))
            if best["score"] >= SCALP_MIN_SCORE and len(self.positions) < 2:
                self._perp_enter(best, market_data, regime)

        self._monitor_positions_scalp(market_data, regime)

        log.debug("[SCALP/%s] %s | signals=%d | pos=%d | balance=$%.2f",
                  now, self.sim_user, len(signals), len(self.positions), self.balance)

    def _monitor_positions_scalp(self, market_data: dict, regime: dict) -> None:
        """Use tighter TP/SL/hold than base engine."""
        for sym in list(self.positions.keys()):
            row = market_data.get(sym, {})
            if row.get("source") == "synthetic":
                continue
            pos      = self.positions[sym]
            price    = row.get("price", pos["entry_price"])
            entry    = pos["entry_price"]
            liq      = pos["liq_price"]
            side     = pos.get("side", "BUY")

            pnl_pct = (price - entry) / entry
            if side == "SELL":
                pnl_pct = -pnl_pct

            # Near-liq
            from simulation.perp_engine import NEAR_LIQ_PCT
            dist_to_liq = (price - liq) / price if side == "BUY" else (liq - price) / price
            if dist_to_liq < NEAR_LIQ_PCT:
                log.warning("[SCALP] NEAR-LIQ EXIT %s liq=$%.4f current=$%.4f", sym, liq, price)
                self._perp_exit(sym, price, pnl_pct, "near_liquidation")
                continue

            hours_held = (time.time() - pos["entry_ts"]) / 3600

            if pnl_pct >= SCALP_TP_PCT:
                self._perp_exit(sym, price, pnl_pct, f"take_profit({pnl_pct:.4%})")
            elif pnl_pct <= SCALP_SL_PCT:
                self._perp_exit(sym, price, pnl_pct, f"stop_loss({pnl_pct:.4%})")
            elif hours_held >= SCALP_MAX_HOLD_HRS:
                self._perp_exit(sym, price, pnl_pct, "time_exit")

    def run(self) -> None:
        self._running = True
        log.info("Perp scalp simulation running for %s — press Ctrl+C to stop", self.sim_user)
        while self._running:
            try:
                self._tick()
                self._update_session()
            except Exception as exc:
                log.error("Scalp tick error: %s", exc)
            time.sleep(SCALP_LOOP_INTERVAL_SEC)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Bybit perp scalp simulation (2x, mean-reversion)")
    parser.add_argument("--live", action="store_true", default=False,
                        help="Use live Bybit market data")
    parser.add_argument("--user", type=str, default="perp_scalp",
                        help="Simulation user label")
    args = parser.parse_args()

    engine = PerpScalpEngine(sim_user=args.user, use_live=args.live)
    try:
        engine.run()
    except KeyboardInterrupt:
        engine.stop()
        log.info("Perp scalp simulation terminated by user")


if __name__ == "__main__":
    main()
