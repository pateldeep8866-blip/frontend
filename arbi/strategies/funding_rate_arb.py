# strategies/alpha/funding_rate_arb.py
#
# FUNDING RATE ARBITRAGE — most reliable retail-speed edge
#
# How it works:
#   Perpetual futures contracts pay a funding rate every 8 hours to keep
#   the perp price anchored to spot. When the rate is strongly positive,
#   longs pay shorts. We:
#     1. SHORT the perpetual (collect funding)
#     2. BUY spot (delta-neutral hedge)
#   Net position = zero directional risk + funding income every 8h
#
# This is how many small crypto firms generate consistent yield.

import time
from utils.logger import get_logger

log = get_logger("strategy.funding_arb")

# Minimum annualized yield to bother entering (after fees)
MIN_ANNUAL_YIELD_PCT = 15.0

# Funding paid every 8 hours → 3x per day → 1095x per year
FUNDING_PERIODS_PER_YEAR = 1095

# Exchanges that support perpetual futures
PERP_EXCHANGES = ["binance", "kraken", "okx"]


def annualized_yield(funding_rate_8h: float) -> float:
    """Convert 8-hour funding rate to annualized percentage."""
    return funding_rate_8h * FUNDING_PERIODS_PER_YEAR * 100


def fetch_funding_rates(clients: dict) -> list:
    """
    Fetch current funding rates from perp exchanges.
    Returns list of opportunities sorted by yield.
    """
    opportunities = []

    for ex_name, client in clients.items():
        if ex_name not in PERP_EXCHANGES:
            continue
        try:
            # ccxt unified method
            funding_rates = client.fetch_funding_rates()

            for symbol, data in funding_rates.items():
                rate = data.get("fundingRate")
                next_ts = data.get("fundingDatetime")

                if rate is None:
                    continue

                annual_yield = annualized_yield(abs(float(rate)))
                direction = "short_perp" if float(rate) > 0 else "long_perp"

                if annual_yield >= MIN_ANNUAL_YIELD_PCT:
                    opportunities.append({
                        "type":          "funding_rate_arb",
                        "exchange":      ex_name,
                        "symbol":        symbol,
                        "funding_rate":  round(float(rate), 6),
                        "annual_yield":  round(annual_yield, 2),
                        "direction":     direction,
                        "next_funding":  next_ts,
                        "score":         annual_yield,  # ranker uses this
                    })

        except Exception as exc:
            log.debug("Funding rates unavailable on %s: %s", ex_name, exc)

    opportunities.sort(key=lambda x: x["annual_yield"], reverse=True)
    return opportunities


def funding_arb_signal(opportunities: list, min_yield: float = MIN_ANNUAL_YIELD_PCT) -> list:
    """Filter to only high-confidence opportunities."""
    return [o for o in opportunities if o["annual_yield"] >= min_yield]


def estimate_8h_profit(notional: float, funding_rate: float, fee_pct: float = 0.001) -> float:
    """
    Estimate profit per 8-hour period net of fees.
    notional: dollar size of the position
    funding_rate: e.g. 0.0003 = 0.03%
    """
    gross = notional * abs(funding_rate)
    fees  = notional * fee_pct * 2   # entry + exit (amortized)
    return gross - (fees / FUNDING_PERIODS_PER_YEAR)
