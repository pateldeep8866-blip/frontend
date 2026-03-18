# config.py — Central configuration for the Quant Trading Bot

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from this file's directory
load_dotenv(Path(__file__).parent / ".env")

# ─── Active Exchange ──────────────────────────────────────────────────────────
# Set via env var to switch venues: EXCHANGE=binance_us  (default: kraken)
EXCHANGE = os.getenv("EXCHANGE", "kraken")

# ─── Exchange Settings ───────────────────────────────────────────────────────
# Only include non-Kraken exchanges when their API key is configured.
# This prevents the scanner from fetching (and generating signals from)
# exchanges the user hasn't set up, which would pollute opportunities.
EXCHANGES = [EXCHANGE] + [
    ex for ex in ("coinbase", "kucoin")
    if os.getenv(f"{ex.upper()}_API_KEY", "")
]

EXCHANGE_CREDENTIALS = {
    "kraken": {
        "apiKey": os.getenv("KRAKEN_API_KEY", ""),
        "secret": os.getenv("KRAKEN_API_SECRET", ""),
    },
    "coinbase": {
        "apiKey": os.getenv("COINBASE_API_KEY", ""),
        "secret": os.getenv("COINBASE_API_SECRET", ""),
    },
    "kucoin": {
        "apiKey":    os.getenv("KUCOIN_API_KEY", ""),
        "secret":    os.getenv("KUCOIN_API_SECRET", ""),
        "password":  os.getenv("KUCOIN_PASSPHRASE", ""),
    },
    "binance_us": {
        "apiKey": os.getenv("BINANCE_US_API_KEY", ""),
        "secret": os.getenv("BINANCE_US_API_SECRET", ""),
    },
}

EXCHANGE_FEES = {
    "kraken":     0.0026,
    "coinbase":   0.0060,
    "kucoin":     0.0010,
    "binance_us": 0.000095,  # taker fee, Tier 0 with BNB discount
}

# ─── Trading Universe ────────────────────────────────────────────────────────
START_SYMBOLS = [
    "BTC/USD",
    "ETH/USD",
    "SOL/USD",
    "XRP/USD",
    "ADA/USD",
]

# ─── Small Account Support ───────────────────────────────────────────────────
MIN_POSITION_USD = 4.0
SMALL_ACCOUNT_THRESHOLD = 200.0

KRAKEN_MIN_ORDER_SIZES = {
    "BTC/USDT":  0.0001,
    "ETH/USDT":  0.002,
    "XRP/USDT":  1.0,
    "ADA/USDT":  1.0,
    "SOL/USDT":  0.01,
    "DOT/USDT":  0.25,
    "DOGE/USDT": 10.0,
    "LINK/USDT": 0.1,
    "BTC/USD":   0.0001,
    "ETH/USD":   0.002,
    "XRP/USD":   1.0,
    "ADA/USD":   1.0,
    "SOL/USD":   0.01,
}

QUOTE_CURRENCY = "USD"
ORDERBOOK_DEPTH = 20

# ─── Capital & Risk ──────────────────────────────────────────────────────────
START_BALANCE          = 10_000.0
TRADE_RISK_PCT         = 0.02
MAX_DAILY_LOSS_PCT     = 0.03
MAX_DRAWDOWN_PCT       = 0.05
MAX_OPEN_TRADES        = 3
MAX_SYMBOL_EXPOSURE    = 0.50
MAX_EXCHANGE_EXPOSURE  = 0.70
MAX_CONSECUTIVE_LOSSES = 5

# ─── Scanner Thresholds ──────────────────────────────────────────────────────
SPREAD_MIN_PCT                = 0.20
TRI_ARB_MIN_PCT               = 0.15
LIQUIDITY_IMBALANCE_THRESHOLD = 0.30
VOL_BREAKOUT_LOOKBACK         = 20
VOL_VOLUME_SPIKE_THRESHOLD    = 1.8

# ─── Execution ───────────────────────────────────────────────────────────────
STALE_ORDER_TIMEOUT_SEC   = 300    # 5 min — matches SCALP_MAX_HOLD_SEC
MARKET_DATA_FRESHNESS_SEC = 30
MIN_EDGE_AFTER_FEES_PCT   = 0.05
USD_FEE_RESERVE           = 0.50 if EXCHANGE == "kraken" else 0.0   # Kraken deducts fees from USD balance; other venues take from proceeds

# ─── Scan & Loop Timing ──────────────────────────────────────────────────────
MAIN_LOOP_INTERVAL_SEC     = 5
RECONCILE_INTERVAL_SEC     = 30
OPTIMIZER_RUN_INTERVAL_SEC = 86_400

# ─── Paper Trading ───────────────────────────────────────────────────────────
# Read from .env — set PAPER_TRADING=False to go live
_pt_env = os.getenv("PAPER_TRADING", "True").strip().lower()
PAPER_TRADING = _pt_env not in ("false", "0", "no")

# ─── Database ────────────────────────────────────────────────────────────────
DB_PATH = "quant_bot.db"

# ─── Logging ─────────────────────────────────────────────────────────────────
LOG_LEVEL = "INFO"

# ─── Scalp Mode ──────────────────────────────────────────────────────────────
SCALP_MODE_ENABLED       = True
SCALP_TAKE_PROFIT_PCT    = 0.008
SCALP_STOP_LOSS_PCT      = 0.004
SCALP_MAX_HOLD_SEC       = 600
SCALP_SCAN_INTERVAL_SEC  = 30
SCALP_PREFERRED_PAIRS    = ["XRP/USD", "ADA/USD", "DOGE/USD"]
SCALP_MIN_SPREAD_PCT     = 0.001
SCALP_PROFITABILITY_GATE = 10

KRAKEN_MAKER_FEE     = 0.0016
KRAKEN_TAKER_FEE     = 0.0026
MICRO_ROUND_TRIP_FEE = 0.0032
SCALP_MIN_NET_EDGE   = 0.005

# ─── Binance.US Settings ──────────────────────────────────────────────────────
BINANCE_US_BASE_URL  = "https://api.binance.us"
BINANCE_US_WS_URL    = "wss://stream.binance.us:9443/stream"
BINANCE_US_MAKER_FEE = 0.0        # Tier 0 with BNB: maker free
BINANCE_US_TAKER_FEE = 0.000095   # Tier 0 with BNB: 0.0095% taker

BINANCE_US_MIN_ORDER_SIZES = {
    "BTC/USD":   0.00001,  "BTC/USDT":   0.00001,
    "ETH/USD":   0.0001,   "ETH/USDT":   0.0001,
    "SOL/USD":   0.01,     "SOL/USDT":   0.01,
    "XRP/USD":   0.1,      "XRP/USDT":   0.1,
    "ADA/USD":   1.0,      "ADA/USDT":   1.0,
    "DOGE/USD":  1.0,      "DOGE/USDT":  1.0,
    "AVAX/USD":  0.01,     "AVAX/USDT":  0.01,
    "DOT/USD":   0.1,      "DOT/USDT":   0.1,
    "LINK/USD":  0.1,      "LINK/USDT":  0.1,
    "ATOM/USD":  0.01,     "ATOM/USDT":  0.01,
    "LTC/USD":   0.001,    "LTC/USDT":   0.001,
    "UNI/USD":   0.1,      "UNI/USDT":   0.1,
}

# ─── Exchange CCXT IDs ────────────────────────────────────────────────────────
# Maps our internal exchange names to ccxt library identifiers.
EXCHANGE_CCXT_ID = {
    "kraken":     "kraken",
    "binance_us": "binanceus",
    "coinbase":   "coinbase",
    "kucoin":     "kucoin",
}

# ─── Per-exchange minimum order sizes ────────────────────────────────────────
EXCHANGE_MIN_ORDER_SIZES = {
    "kraken":     KRAKEN_MIN_ORDER_SIZES,
    "binance_us": BINANCE_US_MIN_ORDER_SIZES,
}

# ─── Active exchange fee shortcuts ────────────────────────────────────────────
ACTIVE_MAKER_FEE = BINANCE_US_MAKER_FEE if EXCHANGE == "binance_us" else KRAKEN_MAKER_FEE
ACTIVE_TAKER_FEE = BINANCE_US_TAKER_FEE if EXCHANGE == "binance_us" else KRAKEN_TAKER_FEE

# ─── Fast Scalp Mode ─────────────────────────────────────────────────────────
FAST_SCALP_TP_PCT              = 0.006     # 0.6% take profit
FAST_SCALP_SL_PCT              = 0.0025    # 0.25% stop loss
FAST_SCALP_MAX_HOLD_SEC        = 180       # 3 minutes max hold
FAST_SCALP_SCAN_INTERVAL_SEC   = 15        # 15s scan interval
FAST_SCALP_PAIRS               = ["SOL/USD", "XRP/USD"]
FAST_SCALP_MIN_SCORE           = 50        # minimum signal score to enter
FAST_SCALP_MAX_SPREAD_PCT      = 0.0015    # skip if spread > 0.15%
FAST_SCALP_CAPITAL_PCT         = 0.25      # 25% of available USD per trade
FAST_SCALP_MAX_TRADES_PER_HOUR = 10
FAST_SCALP_CONSEC_LOSS_LIMIT   = 3
FAST_SCALP_COOLDOWN_SEC        = 1800      # 30-minute cooldown after 3 consecutive losses
