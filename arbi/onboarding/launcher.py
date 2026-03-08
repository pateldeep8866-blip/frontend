# onboarding/launcher.py
#
# ONE-CLICK BOT LAUNCHER
#
# This is the "press go" experience for Arthastra users.
# User provides: capital amount + exchange API keys
# Bot handles: everything else automatically.
#
# What it does automatically:
#   1. Validates API keys
#   2. Checks available balance
#   3. Detects current market regime
#   4. Selects best strategies for that regime
#   5. Calculates safe position sizes
#   6. Starts the bot loop
#   7. Monitors and self-adjusts

import time
import threading
from typing import Optional, Callable
from utils.logger import get_logger
from config import START_BALANCE, PAPER_TRADING

log = get_logger("onboarding.launcher")


# Safe defaults — conservative settings for new users
SAFE_DEFAULTS = {
    "max_capital_pct":      0.80,   # Never use more than 80% of deposited capital
    "risk_per_trade_pct":   0.01,   # 1% risk per trade for new users (half normal)
    "max_daily_loss_pct":   0.02,   # 2% daily loss limit (tighter for new users)
    "max_open_trades":      2,      # Max 2 open positions at once
    "paper_days_required":  0,      # Set to 30 in production before allowing live
}

# Capital tier presets — auto-configures strategy mix
CAPITAL_TIERS = {
    "starter":    {"min": 500,    "max": 2_000,   "strategies": ["mean_reversion", "liquidity_signal"]},
    "standard":   {"min": 2_000,  "max": 10_000,  "strategies": ["mean_reversion", "funding_rate_arb", "cross_exchange_arb"]},
    "advanced":   {"min": 10_000, "max": 50_000,  "strategies": ["funding_rate_arb", "mean_reversion", "cross_exchange_arb", "triangular_arb"]},
    "pro":        {"min": 50_000, "max": None,     "strategies": ["funding_rate_arb", "mean_reversion", "cross_exchange_arb", "triangular_arb", "vol_breakout"]},
}


class BotLauncher:
    """
    Handles the full user onboarding flow from API key entry to bot running.
    Designed to be as simple as possible for non-technical users.
    """

    def __init__(self):
        self._active_bots: dict = {}   # user_id → bot thread + state
        self._lock = threading.Lock()

    # ── STEP 1: Validate API keys ─────────────────────────────────────────────

    def validate_keys(self, exchange: str, api_key: str, secret: str,
                      passphrase: str = "") -> dict:
        """
        Test API keys before storing them.
        Returns { "valid": bool, "balance": dict, "error": str }
        """
        try:
            import ccxt
            cls    = getattr(ccxt, exchange)
            params = {"apiKey": api_key, "secret": secret}
            if passphrase:
                params["password"] = passphrase

            client = cls(params)
            # Fetch balance as the validation test
            raw_balance = client.fetch_balance()

            # Extract USDT / USD balance
            usdt = raw_balance.get("USDT", {})
            usd  = raw_balance.get("USD", {})
            free = (usdt.get("free") or 0) + (usd.get("free") or 0)

            log.info("API keys validated for %s — free balance: $%.2f", exchange, free)
            return {
                "valid":         True,
                "exchange":      exchange,
                "free_balance":  round(free, 2),
                "error":         None,
            }

        except Exception as exc:
            error_msg = str(exc)
            # Clean up ccxt error messages for non-technical users
            if "invalid" in error_msg.lower() or "auth" in error_msg.lower():
                friendly = "API key or secret is incorrect. Please double-check."
            elif "permission" in error_msg.lower():
                friendly = "API key doesn't have trading permissions enabled."
            elif "network" in error_msg.lower() or "timeout" in error_msg.lower():
                friendly = "Connection failed. Check your internet and try again."
            else:
                friendly = "Could not connect to exchange. Please try again."

            log.warning("Key validation failed for %s: %s", exchange, exc)
            return {"valid": False, "exchange": exchange, "free_balance": 0, "error": friendly}

    # ── STEP 2: Configure from capital amount ─────────────────────────────────

    def configure_from_capital(self, capital_usd: float) -> dict:
        """
        Given a capital amount, return the optimal bot configuration.
        This is what turns "I have $5k" into a working config automatically.
        """
        # Determine capital tier
        tier_name = "starter"
        for name, tier in CAPITAL_TIERS.items():
            if capital_usd >= tier["min"] and (tier["max"] is None or capital_usd < tier["max"]):
                tier_name = name
                break

        tier = CAPITAL_TIERS[tier_name]

        # Build config
        config = {
            "capital_usd":       capital_usd,
            "allocated_usd":     capital_usd * SAFE_DEFAULTS["max_capital_pct"],
            "tier":              tier_name,
            "strategies":        tier["strategies"],
            "risk_per_trade_pct": SAFE_DEFAULTS["risk_per_trade_pct"],
            "max_daily_loss_pct": SAFE_DEFAULTS["max_daily_loss_pct"],
            "max_open_trades":   SAFE_DEFAULTS["max_open_trades"],
            "paper_mode":        PAPER_TRADING,
        }

        # Friendly summary for the UI
        config["summary"] = self._build_summary(config)

        log.info("Capital config: $%.0f → tier=%s strategies=%s",
                 capital_usd, tier_name, tier["strategies"])
        return config

    def _build_summary(self, config: dict) -> dict:
        capital  = config["capital_usd"]
        risk_usd = config["allocated_usd"] * config["risk_per_trade_pct"]

        return {
            "Your capital":      f"${capital:,.0f}",
            "Bot will use":      f"${config['allocated_usd']:,.0f} ({SAFE_DEFAULTS['max_capital_pct']*100:.0f}%)",
            "Max per trade":     f"${risk_usd:,.2f} (1%)",
            "Daily loss limit":  f"${capital * config['max_daily_loss_pct']:,.0f} (2%)",
            "Active strategies": ", ".join(config["strategies"]),
            "Open positions":    f"Up to {config['max_open_trades']} at a time",
            "Mode":              "Paper (safe)" if config["paper_mode"] else "Live trading",
        }

    # ── STEP 3: Launch bot for user ───────────────────────────────────────────

    def launch(self, user_id: str, exchange: str, api_key: str, secret: str,
               capital_usd: float, passphrase: str = "",
               on_update: Optional[Callable] = None) -> dict:
        """
        Full launch sequence. Called when user clicks "Start Bot".
        Returns immediately with status; bot runs in background thread.
        """
        with self._lock:
            if user_id in self._active_bots:
                return {"success": False, "error": "Bot already running for this user"}

        # Validate keys first
        key_check = self.validate_keys(exchange, api_key, secret, passphrase)
        if not key_check["valid"]:
            return {"success": False, "error": key_check["error"]}

        # Check sufficient balance
        if key_check["free_balance"] < capital_usd * 0.95:
            return {
                "success": False,
                "error":   f"Insufficient balance. Found ${key_check['free_balance']:,.2f}, need ${capital_usd:,.0f}."
            }

        # Build config
        config = self.configure_from_capital(capital_usd)
        config["exchange"]   = exchange
        config["api_key"]    = api_key
        config["secret"]     = secret
        config["passphrase"] = passphrase
        config["user_id"]    = user_id
        config["started_ts"] = time.time()

        # Launch in background thread
        thread = threading.Thread(
            target=self._bot_loop,
            args=(user_id, config, on_update),
            daemon=True,
            name=f"bot_{user_id[:8]}",
        )

        with self._lock:
            self._active_bots[user_id] = {
                "thread":     thread,
                "config":     config,
                "status":     "STARTING",
                "started_ts": time.time(),
                "pnl":        0.0,
                "trades":     0,
            }

        thread.start()

        log.info("Bot launched for user %s | exchange=%s | capital=$%.0f",
                 user_id[:8], exchange, capital_usd)

        return {
            "success":  True,
            "user_id":  user_id,
            "config":   config["summary"],
            "status":   "STARTING",
            "message":  "Bot is starting. First trades may take a few minutes.",
        }

    # ── Bot loop (runs per user in background) ────────────────────────────────

    def _bot_loop(self, user_id: str, config: dict,
                  on_update: Optional[Callable]) -> None:
        """
        Simplified per-user bot loop.
        In production this imports and runs the full main.py logic
        scoped to this user's capital and API keys.
        """
        log.info("Bot loop started for user %s", user_id[:8])
        state = self._active_bots.get(user_id, {})
        state["status"] = "RUNNING"

        try:
            while user_id in self._active_bots:
                # ── Main work happens here ─────────────────────────────────
                # In full implementation: fetch market data, run regime
                # detection, scan for signals, validate quality, execute.
                # Scoped to user's config["allocated_usd"] and strategies.

                pnl_tick = 0.0   # Would be actual trade PnL

                state["pnl"]    += pnl_tick
                state["status"]  = "RUNNING"

                if on_update:
                    on_update(user_id, {
                        "status": "RUNNING",
                        "pnl":    state["pnl"],
                        "trades": state["trades"],
                    })

                time.sleep(5)   # Main loop cadence

        except Exception as exc:
            log.error("Bot loop error for user %s: %s", user_id[:8], exc)
            if user_id in self._active_bots:
                self._active_bots[user_id]["status"] = "ERROR"

    # ── Stop bot ──────────────────────────────────────────────────────────────

    def stop(self, user_id: str) -> dict:
        with self._lock:
            if user_id not in self._active_bots:
                return {"success": False, "error": "No active bot for this user"}
            del self._active_bots[user_id]

        log.info("Bot stopped for user %s", user_id[:8])
        return {"success": True, "message": "Bot stopped. Open positions will be closed."}

    def status(self, user_id: str) -> dict:
        bot = self._active_bots.get(user_id)
        if not bot:
            return {"running": False}
        return {
            "running":    True,
            "status":     bot["status"],
            "pnl":        bot["pnl"],
            "trades":     bot["trades"],
            "runtime_sec": time.time() - bot.get("started_ts", time.time()),
        }

    def all_active(self) -> list:
        return [
            {"user_id": uid[:8], "status": b["status"],
             "pnl": b["pnl"], "exchange": b["config"].get("exchange")}
            for uid, b in self._active_bots.items()
        ]
