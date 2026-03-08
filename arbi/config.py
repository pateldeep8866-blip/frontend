# config.py — Central configuration for the Quant Trading Bot

# ─── Exchange Settings ───────────────────────────────────────────────────────
EXCHANGES = ["kraken", "coinbase", "kucoin"]

EXCHANGE_CREDENTIALS = {
    # Fill in your API keys before going live.
    # Leave empty for paper trading / scanner-only mode.
    "kraken": {
        "apiKey": "",
        "secret": "",
    },
    "coinbase": {
        "apiKey": "",
        "secret": "",
    },
    "kucoin": {
        "apiKey": "",
        "secret": "",
        "password": "",   # KuCoin requires a passphrase
    },
}

EXCHANGE_FEES = {
    "kraken":   0.0026,
    "coinbase": 0.0060,
    "kucoin":   0.0010,
}

# ─── Trading Universe ────────────────────────────────────────────────────────
START_SYMBOLS = [
    "BTC/USDT",
    "ETH/USDT",
    "SOL/USDT",
    "XRP/USDT",
    "ADA/USDT",
]

QUOTE_CURRENCY = "USDT"
ORDERBOOK_DEPTH = 20

# ─── Capital & Risk ──────────────────────────────────────────────────────────
START_BALANCE          = 10_000.0   # Paper trading starting balance (USD)
TRADE_RISK_PCT         = 0.02       # Max 2% of balance per trade
MAX_DAILY_LOSS_PCT     = 0.03       # Stop trading if daily loss exceeds 3%
MAX_DRAWDOWN_PCT       = 0.05       # Kill switch at 5% drawdown
MAX_OPEN_TRADES        = 3
MAX_SYMBOL_EXPOSURE    = 0.50       # No more than 50% of capital in one asset
MAX_EXCHANGE_EXPOSURE  = 0.70       # No more than 70% on one exchange
MAX_CONSECUTIVE_LOSSES = 5          # Pause after 5 losses in a row

# ─── Scanner Thresholds ──────────────────────────────────────────────────────
SPREAD_MIN_PCT                = 0.20
TRI_ARB_MIN_PCT               = 0.15
LIQUIDITY_IMBALANCE_THRESHOLD = 0.30
VOL_BREAKOUT_LOOKBACK         = 20
VOL_VOLUME_SPIKE_THRESHOLD    = 1.8

# ─── Execution ───────────────────────────────────────────────────────────────
STALE_ORDER_TIMEOUT_SEC  = 30    # Cancel limit orders older than this
MARKET_DATA_FRESHNESS_SEC = 10   # Reject stale data older than this
MIN_EDGE_AFTER_FEES_PCT   = 0.05 # Don't trade unless edge > fees by at least this

# ─── Scan & Loop Timing ──────────────────────────────────────────────────────
MAIN_LOOP_INTERVAL_SEC         = 5
RECONCILE_INTERVAL_SEC         = 30
OPTIMIZER_RUN_INTERVAL_SEC     = 86_400  # Re-optimize every 24 hours

# ─── Paper Trading ───────────────────────────────────────────────────────────
PAPER_TRADING = True   # Set to False only when fully tested

# ─── Database ────────────────────────────────────────────────────────────────
DB_PATH = "quant_bot.db"

# ─── Logging ─────────────────────────────────────────────────────────────────
LOG_LEVEL = "INFO"   # DEBUG, INFO, WARNING, ERROR
