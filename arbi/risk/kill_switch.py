# risk/kill_switch.py — Emergency stop controller

import time
from storage.db import log_risk_event
from utils.logger import get_logger

log = get_logger("risk.kill_switch")


class KillSwitch:
    """
    Monitors for system-level anomalies and can trigger a full trading halt.
    Cancel-all is delegated to the order manager to avoid circular imports.
    """

    def __init__(self):
        self.triggered    = False
        self.trigger_time = None
        self.reason       = ""

    def check(self, checks: dict) -> bool:
        """
        Pass a dict of condition_name → bool.
        If any value is True, fire the kill switch.
        Returns True if the kill switch is active.
        """
        if self.triggered:
            return True

        for condition, fired in checks.items():
            if fired:
                self._fire(condition)
                return True

        return False

    def _fire(self, reason: str) -> None:
        if not self.triggered:
            self.triggered    = True
            self.trigger_time = time.time()
            self.reason       = reason
            log.critical("KILL SWITCH FIRED — reason: %s", reason)
            log_risk_event("KILL_SWITCH", reason, "all_trading_stopped")

    def reset(self) -> None:
        """Operator reset after investigation."""
        log.warning("Kill switch manually reset")
        self.triggered    = False
        self.trigger_time = None
        self.reason       = ""

    def status(self) -> dict:
        return {
            "triggered": self.triggered,
            "reason":    self.reason,
            "at":        self.trigger_time,
        }
