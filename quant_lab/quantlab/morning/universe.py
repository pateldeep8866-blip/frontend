from __future__ import annotations

# Tier 1 — Core Market ETFs (always score)
TIER_1_CORE: list[str] = [
    "SPY",
    "QQQ",
    "IWM",
    "DIA",
    "XLK",
    "XLF",
    "XLE",
    "XLV",
    "XLI",
    "XLY",
    "XLP",
    "GLD",
    "TLT",
]

# Tier 2 — Mega Cap Stocks
TIER_2_GROWTH: list[str] = [
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
    "META",
    "TSLA",
    "AMD",
    "AVGO",
    "ORCL",
    "CRM",
    "ADBE",
    "JPM",
    "BAC",
    "GS",
    "MS",
    "JNJ",
    "UNH",
    "LLY",
    "ABBV",
    "XOM",
    "CVX",
    "WMT",
    "COST",
]

# Tier 3 — Thematic ETFs
TIER_3_THEMATIC: list[str] = [
    "SOXX",
    "ARKK",
    "IBB",
    "EEM",
    "EFA",
    "VNQ",
    "HYG",
    "USO",
    "SLV",
    "GDXJ",
]

# Full universe (Tier 1 + 2 + 3)
DEFAULT_UNIVERSE: list[str] = TIER_1_CORE + TIER_2_GROWTH + TIER_3_THEMATIC

# Minimum viable universe (fallback)
MINIMUM_UNIVERSE: list[str] = TIER_1_CORE

UNIVERSE_TIERS = {
    "core": TIER_1_CORE,
    "growth": TIER_2_GROWTH,
    "thematic": TIER_3_THEMATIC,
    "full": DEFAULT_UNIVERSE,
    "minimum": MINIMUM_UNIVERSE,
}

print(f"Universe loaded: {len(DEFAULT_UNIVERSE)} tickers")
print(f"Tier 1 core: {len(TIER_1_CORE)}")
print(f"Tier 2 growth: {len(TIER_2_GROWTH)}")
print(f"Tier 3 thematic: {len(TIER_3_THEMATIC)}")
