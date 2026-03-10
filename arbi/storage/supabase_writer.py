"""
storage/supabase_writer.py

Writes simulation data to Supabase so the dashboard can display it.
Falls back silently if Supabase is unavailable — bot keeps running.
"""

import os
import time
from pathlib import Path
from utils.logger import get_logger

log = get_logger("supabase_writer")

# Auto-load arbi/.env if env vars not already set
_env_file = Path(__file__).parent.parent / ".env"
if _env_file.exists() and not os.getenv("SUPABASE_URL"):
    for _line in _env_file.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    log.warning("SUPABASE_URL / SUPABASE_KEY not set — Supabase writes disabled")

_client = None

def get_client():
    global _client
    if _client:
        return _client
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        from supabase import create_client
        _client = create_client(SUPABASE_URL, SUPABASE_KEY)
        log.info("Supabase client connected")
        return _client
    except Exception as exc:
        log.warning("Supabase unavailable (non-fatal): %s", exc)
        return None


def write_trade(sim_user: str, symbol: str, strategy: str, side: str,
                entry_price: float, status: str = "OPEN",
                exit_price: float = None, pnl_pct: float = None,
                profitable: bool = None, hold_hrs: float = None,
                score: float = None):
    """Write a trade entry or exit to Supabase signals table."""
    client = get_client()
    if not client:
        return

    try:
        data = {
            "ticker":     symbol,
            "signal":     f"{side} {strategy}",
            "confidence": score or 0,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        client.table("signals").insert(data).execute()
    except Exception as exc:
        log.debug("Supabase write_trade failed (non-fatal): %s", exc)


def write_portfolio(sim_user: str, ticker: str, shares: float, avg_cost: float):
    """Update portfolio table in Supabase."""
    client = get_client()
    if not client:
        return

    try:
        data = {
            "ticker":   ticker,
            "shares":   shares,
            "avg_cost": avg_cost,
        }
        client.table("portfolio").upsert(data).execute()
    except Exception as exc:
        log.debug("Supabase write_portfolio failed (non-fatal): %s", exc)


def write_stats(stats: dict):
    """Write aggregate stats — used by dashboard to show collective intelligence."""
    client = get_client()
    if not client:
        return

    try:
        data = {
            "ticker":     "COLLECTIVE",
            "signal":     f"trades={stats.get('total_sim_trades',0)} winrate={stats.get('win_rate_pct',0)}%",
            "confidence": stats.get("win_rate_pct", 0),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        client.table("signals").insert(data).execute()
    except Exception as exc:
        log.debug("Supabase write_stats failed (non-fatal): %s", exc)
