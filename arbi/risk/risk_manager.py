# risk/risk_manager.py — Capital protection and trade validation

import time
from config import (
    MAX_DAILY_LOSS_PCT, MAX_DRAWDOWN_PCT, MAX_OPEN_TRADES,
    MAX_CONSECUTIVE_LOSSES, TRADE_RISK_PCT, MIN_EDGE_AFTER_FEES_PCT,
    MARKET_DATA_FRESHNESS_SEC,
)
from storage.db import log_risk_event
from utils.logger import get_logger

log = get_logger("risk.manager")


class RiskManager:

    def __init__(self, starting_balance: float):
        self.balance           = starting_balance
        self.peak_balance      = starting_balance
        self.daily_pnl         = 0.0
        self.open_trades       = 0
        self.consecutive_losses = 0
        self.day_start         = time.time()
        self.trading_halted    = False
        self.halt_reason       = ""

    # ─── Daily reset ──────────────────────────────────────────────────────────

    def maybe_reset_day(self) -> None:
        """Reset daily PnL counter after 24 hours."""
        if time.time() - self.day_start > 86_400:
            log.info("Daily reset: PnL was %.2f", self.daily_pnl)
            self.daily_pnl  = 0.0
            self.day_start  = time.time()

    # ─── Pre-trade checks ─────────────────────────────────────────────────────

    def allow_trade(self, edge_pct: float = 0.0, data_ts: float = None) -> bool:
        """Return True only if all risk checks pass."""
        self.maybe_reset_day()

        if self.trading_halted:
            log.warning("Trade blocked — halt: %s", self.halt_reason)
            return False

        # Daily loss limit
        if self.daily_pnl < -(self.balance * MAX_DAILY_LOSS_PCT):
            self._halt("MAX_DAILY_LOSS", "Daily loss limit breached")
            return False

        # Drawdown limit
        drawdown = (self.peak_balance - self.balance) / self.peak_balance
        if drawdown > MAX_DRAWDOWN_PCT:
            self._halt("MAX_DRAWDOWN", f"Drawdown {drawdown:.2%} exceeded {MAX_DRAWDOWN_PCT:.2%}")
            return False

        # Open trade cap
        if self.open_trades >= MAX_OPEN_TRADES:
            log.debug("Max open trades reached (%d)", MAX_OPEN_TRADES)
            return False

        # Consecutive loss limit
        if self.consecutive_losses >= MAX_CONSECUTIVE_LOSSES:
            self._halt("CONSECUTIVE_LOSSES", f"{self.consecutive_losses} losses in a row")
            return False

        # Edge must cover fees
        if edge_pct < MIN_EDGE_AFTER_FEES_PCT:
            log.debug("Edge %.4f%% too small (min %.4f%%)", edge_pct, MIN_EDGE_AFTER_FEES_PCT)
            return False

        # Stale data check
        if data_ts is not None:
            age = time.time() - data_ts
            if age > MARKET_DATA_FRESHNESS_SEC:
                log.warning("Market data stale by %.1fs — skipping", age)
                log_risk_event("STALE_DATA", f"Data age {age:.1f}s", "trade_skipped")
                return False

        return True

    def position_size(self) -> float:
        """Return the maximum dollar amount to risk on one trade."""
        return self.balance * TRADE_RISK_PCT

    # ─── Post-trade updates ───────────────────────────────────────────────────

    def record_trade_open(self) -> None:
        self.open_trades += 1

    def record_trade_close(self, pnl: float) -> None:
        self.open_trades  = max(0, self.open_trades - 1)
        self.balance     += pnl
        self.daily_pnl   += pnl
        self.peak_balance = max(self.peak_balance, self.balance)

        if pnl < 0:
            self.consecutive_losses += 1
        else:
            self.consecutive_losses = 0

        log.info("Trade closed: PnL=%.4f  Balance=%.2f  DailyPnL=%.4f",
                 pnl, self.balance, self.daily_pnl)

    # ─── Emergency halt ───────────────────────────────────────────────────────

    def _halt(self, event_type: str, reason: str) -> None:
        if not self.trading_halted:
            log.error("TRADING HALTED — %s: %s", event_type, reason)
            log_risk_event(event_type, reason, "trading_halted")
            self.trading_halted = True
            self.halt_reason    = reason

    def resume(self) -> None:
        """Manually resume trading (e.g. after operator review)."""
        log.info("Trading resumed manually")
        self.trading_halted     = False
        self.halt_reason        = ""
        self.consecutive_losses = 0

    def status(self) -> dict:
        drawdown = (self.peak_balance - self.balance) / self.peak_balance
        return {
            "balance":            round(self.balance, 2),
            "peak_balance":       round(self.peak_balance, 2),
            "daily_pnl":          round(self.daily_pnl, 2),
            "drawdown_pct":       round(drawdown * 100, 3),
            "open_trades":        self.open_trades,
            "consecutive_losses": self.consecutive_losses,
            "halted":             self.trading_halted,
            "halt_reason":        self.halt_reason,
        }
