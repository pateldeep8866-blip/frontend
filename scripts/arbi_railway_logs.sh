#!/usr/bin/env bash
# scripts/arbi_railway_logs.sh
#
# Tail ARBI Railway training logs from your terminal.
#
# ── One-time setup ───────────────────────────────────────────────────────────
#   npm install -g @railway/cli     # install Railway CLI
#   railway login                   # authenticate with your Railway account
#   railway link                    # run once from repo root — select
#                                   #   pateldeep8866-blip/frontend project
#
# ── Usage ────────────────────────────────────────────────────────────────────
#   bash scripts/arbi_railway_logs.sh          # live tail (Ctrl+C to stop)
#   bash scripts/arbi_railway_logs.sh dump     # last 500 lines then exit
#
# ── Morning review (recommended) ─────────────────────────────────────────────
#   bash scripts/arbi_railway_logs.sh dump | grep -E "EXIT|ENTER|balance|ERROR|WARN"
#
# ── Required Railway env vars (set in Railway dashboard → Variables) ─────────
#   SUPABASE_URL
#   SUPABASE_KEY
#   EXCHANGE          (default: kraken — set to binance_us to override)
#   PAPER_TRADING     (default: True — keep True for simulation)
#
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

if ! command -v railway &>/dev/null; then
    echo "ERROR: Railway CLI not found."
    echo "Install it with:  npm install -g @railway/cli"
    echo "Then run:         railway login && railway link"
    exit 1
fi

MODE="${1:-tail}"

if [[ "$MODE" == "dump" ]]; then
    echo "── ARBI Railway logs (last 500 lines) ─────────────────────────────"
    railway logs -n 500
else
    echo "── ARBI Railway logs — live tail ── Ctrl+C to stop ────────────────"
    railway logs --tail
fi
