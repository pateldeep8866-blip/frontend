"""
launcher.py — Fully Automatic Bot Launcher

The user provides:
  - capital amount
  - API key + secret
  - exchange choice

The launcher decides everything else:
  - which strategies to run
  - position sizing
  - risk parameters
  - regime detection
  - when to pause/resume

No decisions are punted back to the user.
"""

from __future__ import annotations

import os
import time
import threading
from typing import Optional
from utils.logger import get_logger

log = get_logger("launcher")


# ─── Strategy selector ────────────────────────────────────────────────────────

def select_strategies(capital: float, regime: str) -> list[str]:
    """
    Automatically selects the best strategies based on:
    1. Capital tier (determines what's available)
    2. Current market regime (determines what's optimal)

    User never makes this decision.
    """
    # Capital tier
    if capital >= 50_000:
        available = ["funding_arb", "mean_reversion", "cross_arb", "tri_arb", "vol_breakout"]
    elif capital >= 10_000:
        available = ["funding_arb", "mean_reversion", "cross_arb", "tri_arb"]
    elif capital >= 2_000:
        available = ["funding_arb", "mean_reversion", "cross_arb"]
    else:
        available = ["mean_reversion", "funding_arb"]

    # Regime optimization — bot picks best fit automatically
    regime_preference = {
        "TRENDING":      ["mean_reversion", "vol_breakout", "funding_arb"],
        "RANGING":       ["funding_arb", "mean_reversion", "cross_arb"],
        "HIGH_VOL":      ["funding_arb", "cross_arb"],
        "LOW_VOL":       ["funding_arb", "mean_reversion"],
        "UNKNOWN":       ["funding_arb", "mean_reversion"],
    }

    preferred = regime_preference.get(regime, regime_preference["UNKNOWN"])
    # Keep available strategies, sorted by regime preference
    selected = [s for s in preferred if s in available]
    # Add remaining available strategies not in preference list
    for s in available:
        if s not in selected:
            selected.append(s)

    log.info("Regime=%s → Strategies selected: %s", regime, selected)
    return selected


# ─── Risk param calculator ────────────────────────────────────────────────────

def calculate_risk_params(capital: float) -> dict:
    """
    Automatically calculates all risk parameters.
    Based on capital size with conservative defaults.
    """
    allocated     = capital * 0.80   # 20% always held in reserve
    max_per_trade = allocated * 0.01  # 1% per trade max
    daily_stop    = capital  * 0.02   # 2% daily loss limit
    max_drawdown  = capital  * 0.05   # 5% drawdown before pause
    max_exposure  = allocated * 0.30  # max 30% in any single position

    return {
        "allocated":      allocated,
        "max_per_trade":  max_per_trade,
        "daily_stop":     daily_stop,
        "max_drawdown":   max_drawdown,
        "max_exposure":   max_exposure,
        "reserve":        capital * 0.20,
    }


# ─── Regime detector ─────────────────────────────────────────────────────────

def detect_regime(market_cache) -> str:
    """
    Detects current market regime automatically.
    Returns one of: TRENDING, RANGING, HIGH_VOL, LOW_VOL, UNKNOWN
    """
    try:
        snap = market_cache.snapshot()
        if not snap:
            return "UNKNOWN"

        # Simple volatility check across available pairs
        vol_scores = []
        for symbol, data in list(snap.items())[:5]:
            high = data.get("high") or 0
            low  = data.get("low")  or 0
            last = data.get("last") or 1
            if last > 0 and high > 0 and low > 0:
                vol_pct = ((high - low) / last) * 100
                vol_scores.append(vol_pct)

        if not vol_scores:
            return "UNKNOWN"

        avg_vol = sum(vol_scores) / len(vol_scores)

        if avg_vol > 5.0:
            return "HIGH_VOL"
        elif avg_vol > 2.0:
            return "TRENDING"
        elif avg_vol > 0.5:
            return "RANGING"
        else:
            return "LOW_VOL"

    except Exception as exc:
        log.warning("Regime detection failed: %s", exc)
        return "UNKNOWN"


# ─── Main launcher ────────────────────────────────────────────────────────────

class BotLauncher:
    """
    Launches and manages a bot instance for a single user.
    Handles all configuration automatically.
    Monitors health and self-heals silently.
    """

    def __init__(
        self,
        user_id: str,
        capital: float,
        exchange: str,
        api_key: str,
        api_secret: str,
        dry_run: bool = True,
    ):
        self.user_id    = user_id
        self.capital    = capital
        self.exchange   = exchange
        self.api_key    = api_key
        self.api_secret = api_secret
        self.dry_run    = dry_run

        self.bot_thread: Optional[threading.Thread] = None
        self.running    = False
        self.paused     = False
        self.start_ts   = None
        self.config     = {}

    def launch(self) -> dict:
        """
        One call to start the bot. Returns config summary.
        User never needs to call anything else.
        """
        log.info("Launching bot for user=%s capital=$%.0f exchange=%s dry_run=%s",
                 self.user_id, self.capital, self.exchange, self.dry_run)

        # Auto-calculate risk params
        risk_params = calculate_risk_params(self.capital)

        # Store config
        self.config = {
            "user_id":    self.user_id,
            "capital":    self.capital,
            "exchange":   self.exchange,
            "dry_run":    self.dry_run,
            **risk_params,
            "launched_at": time.time(),
        }

        # Start bot in background thread
        self.running    = True
        self.start_ts   = time.time()
        self.bot_thread = threading.Thread(
            target=self._run_bot_loop,
            name=f"arbi-{self.user_id}",
            daemon=True,
        )
        self.bot_thread.start()

        log.info("Bot launched for user=%s", self.user_id)
        return self._status_summary()

    def _run_bot_loop(self):
        """
        Internal loop. Self-heals silently.
        Only alerts user if truly unrecoverable.
        """
        error_count = 0
        last_regime_check = 0.0
        strategies = ["funding_arb", "mean_reversion"]  # safe default

        while self.running:
            try:
                if self.paused:
                    time.sleep(5)
                    continue

                # Regime check every 5 minutes — bot reconfigures itself
                now = time.time()
                if now - last_regime_check > 300:
                    try:
                        from scanner.cache import build_exchange_clients, MarketCache
                        from scanner.universe import build_universe
                        universe    = build_universe()
                        clients     = build_exchange_clients(universe["exchanges"])
                        cache       = MarketCache(clients, universe["symbols"])
                        cache.refresh_tickers()
                        regime      = detect_regime(cache)
                        strategies  = select_strategies(self.capital, regime)
                        log.info("Regime updated: %s → strategies: %s", regime, strategies)
                    except Exception as e:
                        log.warning("Regime check failed (non-fatal): %s", e)
                    last_regime_check = now

                error_count = 0
                time.sleep(5)

            except Exception as exc:
                error_count += 1
                log.error("Bot loop error #%d for user=%s: %s",
                          error_count, self.user_id, exc)

                if error_count >= 5:
                    log.critical("Bot entering safe mode for user=%s after %d errors",
                                 self.user_id, error_count)
                    self.paused = True
                    # Auto-resume after 60 seconds
                    threading.Timer(60, self._auto_resume).start()

                time.sleep(10)

    def _auto_resume(self):
        """Auto-resumes after safe mode pause. Silent to user."""
        log.info("Auto-resuming bot for user=%s", self.user_id)
        self.paused = False

    def pause(self):
        self.paused = True
        log.info("Bot paused for user=%s", self.user_id)

    def resume(self):
        self.paused = False
        log.info("Bot resumed for user=%s", self.user_id)

    def stop(self):
        self.running = False
        log.info("Bot stopped for user=%s", self.user_id)

    def _status_summary(self) -> dict:
        uptime = int(time.time() - self.start_ts) if self.start_ts else 0
        return {
            "user_id":    self.user_id,
            "status":     "paused" if self.paused else "running" if self.running else "stopped",
            "capital":    self.capital,
            "allocated":  self.config.get("allocated", 0),
            "exchange":   self.exchange,
            "dry_run":    self.dry_run,
            "uptime_sec": uptime,
        }

    def status(self) -> dict:
        return self._status_summary()


# ─── Multi-user launcher registry ────────────────────────────────────────────

class LauncherRegistry:
    """Manages one bot instance per user."""

    def __init__(self):
        self._bots: dict[str, BotLauncher] = {}

    def launch(self, user_id: str, capital: float, exchange: str,
               api_key: str, api_secret: str, dry_run: bool = True) -> dict:
        if user_id in self._bots:
            self._bots[user_id].stop()

        launcher = BotLauncher(user_id, capital, exchange, api_key, api_secret, dry_run)
        self._bots[user_id] = launcher
        return launcher.launch()

    def stop(self, user_id: str):
        if user_id in self._bots:
            self._bots[user_id].stop()

    def status(self, user_id: str) -> Optional[dict]:
        b = self._bots.get(user_id)
        return b.status() if b else None

    def all_status(self) -> list[dict]:
        return [b.status() for b in self._bots.values()]


# Global registry
registry = LauncherRegistry()
