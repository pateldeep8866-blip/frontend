"""
yuni-ambient.py
YUNI Ambient Loop — Railway worker service.

Polls /api/internal/brief every POLL_INTERVAL seconds and writes the
snapshot to Supabase yuni_briefings for durable cross-session memory.

Required env vars:
  SITE_URL              https://your-app.up.railway.app
  YUNI_INTERNAL_TOKEN   must match the token set in the Next.js service
  SUPABASE_URL          your Supabase project URL
  SUPABASE_SERVICE_KEY  service role key (bypasses RLS)

Optional:
  POLL_INTERVAL         seconds between polls (default: 60)
  YUNI_LOG_LEVEL        DEBUG | INFO | WARNING | ERROR (default: INFO)
"""

import os
import sys
import time
import json
import logging
import requests
from datetime import datetime, timezone

# ── config ────────────────────────────────────────────────────────────────────

SITE_URL    = os.environ.get("SITE_URL", "").rstrip("/")
YUNI_TOKEN  = os.environ.get("YUNI_INTERNAL_TOKEN", "")
SUPA_URL    = os.environ.get("SUPABASE_URL", "")
SUPA_KEY    = os.environ.get("SUPABASE_SERVICE_KEY", "")
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "60"))
LOG_LEVEL   = os.environ.get("YUNI_LOG_LEVEL", "INFO").upper()

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s [YUNI] %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%SZ",
)
log = logging.getLogger("yuni-ambient")


def validate_env():
    missing = [k for k, v in {
        "SITE_URL": SITE_URL,
        "YUNI_INTERNAL_TOKEN": YUNI_TOKEN,
        "SUPABASE_URL": SUPA_URL,
        "SUPABASE_SERVICE_KEY": SUPA_KEY,
    }.items() if not v]
    if missing:
        log.critical("Missing required env vars: %s", ", ".join(missing))
        sys.exit(1)


# ── Supabase helpers ──────────────────────────────────────────────────────────

SUPA_HEADERS = None  # populated after env validation

def supa_headers():
    global SUPA_HEADERS
    if SUPA_HEADERS is None:
        SUPA_HEADERS = {
            "apikey": SUPA_KEY,
            "Authorization": f"Bearer {SUPA_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
    return SUPA_HEADERS


def persist_briefing(briefing: dict, source: str = "ambient"):
    """Insert one row into yuni_briefings."""
    url = f"{SUPA_URL}/rest/v1/yuni_briefings"
    payload = {
        "captured_utc": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "briefing": briefing,
        "alerts": briefing.get("alerts", []),
    }
    try:
        r = requests.post(url, headers=supa_headers(), json=payload, timeout=10)
        if r.status_code not in (200, 201):
            log.warning("Supabase insert failed %s: %s", r.status_code, r.text[:200])
        else:
            log.debug("Briefing persisted to Supabase")
    except requests.RequestException as e:
        log.warning("Supabase request error: %s", e)


# ── fetch brief ───────────────────────────────────────────────────────────────

def fetch_brief() -> dict | None:
    url = f"{SITE_URL}/api/internal/brief"
    try:
        r = requests.get(
            url,
            headers={"x-yuni-token": YUNI_TOKEN},
            timeout=15,
        )
        if r.status_code == 200:
            return r.json()
        log.warning("Brief returned %s: %s", r.status_code, r.text[:200])
    except requests.RequestException as e:
        log.warning("Brief fetch error: %s", e)
    return None


# ── alert handler ─────────────────────────────────────────────────────────────

def handle_alerts(alerts: list):
    """Log alerts. Extend here to push to Slack, PagerDuty, etc."""
    for alert in alerts:
        level = alert.get("level", "info")
        msg   = alert.get("message", "")
        if level == "critical":
            log.error("[ALERT:CRITICAL] %s", msg)
        elif level == "warning":
            log.warning("[ALERT:WARNING] %s", msg)
        else:
            log.info("[ALERT:INFO] %s", msg)


# ── main loop ─────────────────────────────────────────────────────────────────

def run():
    validate_env()
    log.info("YUNI ambient loop starting — polling %s every %ds", SITE_URL, POLL_INTERVAL)

    consecutive_failures = 0

    while True:
        start = time.monotonic()

        briefing = fetch_brief()
        if briefing:
            consecutive_failures = 0
            alerts = briefing.get("alerts", [])
            log.info(
                "Brief OK | db=%s quant=%s alerts=%d trades=%s win_rate=%s",
                briefing.get("site", {}).get("db_status", "?"),
                briefing.get("quant", {}).get("status", "?"),
                len(alerts),
                briefing.get("trades", {}).get("total_logged", "?"),
                briefing.get("trades", {}).get("win_rate", "?"),
            )
            if alerts:
                handle_alerts(alerts)
            persist_briefing(briefing)
        else:
            consecutive_failures += 1
            log.error("Failed to fetch brief (consecutive failures: %d)", consecutive_failures)
            if consecutive_failures >= 5:
                log.critical("5 consecutive brief failures — check SITE_URL and YUNI_INTERNAL_TOKEN")

        elapsed = time.monotonic() - start
        sleep_for = max(0, POLL_INTERVAL - elapsed)
        time.sleep(sleep_for)


if __name__ == "__main__":
    run()
