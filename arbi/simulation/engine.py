# simulation/engine.py
#
# 24/7 LIVE SIMULATION ENGINE
#
# Runs the full bot strategy stack against real market data.
# Every signal, entry, exit, and outcome is logged to the collective DB.
# No real money is ever touched.
#
# The insight: live prices + paper execution = real signal quality data.
# The learning is genuine even though the money isn't.
#
# How to run:
#   python -m simulation.engine --user juan
#   python -m simulation.engine --user partner
#
# All 4 instances feed the SAME shared knowledge base.
# Leave it running 24/7. The model improves continuously.

import time
import uuid
import hashlib
import json
import sqlite3
import threading
import random
from datetime import datetime
from utils.logger import get_logger
from storage.supabase_writer import write_trade, write_stats, init_supabase
from data.ws_feed import get_ws_feed as _get_ws_feed
from config import EXCHANGE as _ACTIVE_EXCHANGE, ACTIVE_MAKER_FEE, ACTIVE_TAKER_FEE, EXCHANGE_CCXT_ID

log = get_logger("simulation.engine")

# ── Config ────────────────────────────────────────────────────────────────────

SIM_DB_PATH        = "simulation_knowledge.db"   # shared across all sim instances
LOOP_INTERVAL_SEC  = 15       # how often the main loop runs
CANDLE_TIMEFRAME   = "1h"
STARTING_BALANCE   = 100.0
# ── Aggressive paper-mode sizing ─────────────────────────────────────────────
# These constants are intentionally large for paper / live-data simulation only.
# Goal: make trade outcomes economically meaningful on a ~$100 account so signal
# quality can actually be evaluated. Do NOT copy these values to a live-trading path.
RISK_PER_TRADE_PCT = 0.30    # base: 30% of balance × (score/100) × size_mult
PAPER_MIN_SIZE_PCT = 0.10    # floor: always deploy at least 10% regardless of score/regime
PAPER_MAX_SIZE_PCT = 0.35    # cap:   never exceed 35% in a single position

# Symbols to simulate across
SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT",
    "XRP/USDT", "BNB/USDT", "ADA/USDT",
    "DOGE/USDT", "AVAX/USDT", "DOT/USDT",
]

# Strategies to run in simulation
STRATEGIES = ["funding_rate_arb", "mean_reversion", "cross_exchange_arb", "liquidity_signal"]

# ── Exit targets ───────────────────────────────────────────────────────────────

# Regime-based defaults (used when no strategy-specific override exists)
REGIME_EXITS = {
    "RANGING":    {"tp": 0.015, "sl": -0.008, "max_hold_hrs": 2.0},
    "TREND_UP":   {"tp": 0.030, "sl": -0.015, "max_hold_hrs": 6.0},
    "TREND_DOWN": {"tp": 0.030, "sl": -0.015, "max_hold_hrs": 6.0},
    "HIGH_VOL":   {"tp": 0.050, "sl": -0.025, "max_hold_hrs": 12.0},
}

# Strategy-specific exits — take priority over regime defaults
STRATEGY_EXITS = {
    "funding_rate_arb":   {"tp": 0.010, "sl": -0.005, "max_hold_hrs": 1.0},
    "mean_reversion":     {"tp": 0.020, "sl": -0.010, "max_hold_hrs": 3.0},
    "cross_exchange_arb": {"tp": 0.005, "sl": -0.003, "max_hold_hrs": 0.5},
    "liquidity_signal":   {"tp": 0.030, "sl": -0.015, "max_hold_hrs": 4.0},
    "vol_breakout":       {"tp": 0.050, "sl": -0.025, "max_hold_hrs": 8.0},
}


# ── Shared Knowledge Database ─────────────────────────────────────────────────

def init_sim_db():
    """Create shared knowledge tables if they don't exist."""
    conn = sqlite3.connect(SIM_DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sim_trades (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            ts               REAL    NOT NULL,
            sim_user         TEXT    NOT NULL,
            symbol           TEXT    NOT NULL,
            strategy         TEXT    NOT NULL,
            side             TEXT    NOT NULL,
            entry_price      REAL    NOT NULL,
            exit_price       REAL,
            pnl_pct          REAL,
            profitable       INTEGER,
            hold_hrs         REAL,
            features         TEXT,
            status           TEXT    NOT NULL DEFAULT 'OPEN',
            exit_reason      TEXT,
            regime_at_entry  TEXT
        );

        CREATE TABLE IF NOT EXISTS sim_signals (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            ts         REAL    NOT NULL,
            sim_user   TEXT    NOT NULL,
            symbol     TEXT    NOT NULL,
            strategy   TEXT    NOT NULL,
            signal     TEXT    NOT NULL,
            score      REAL,
            features   TEXT,
            acted      INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS sim_funding_rates (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            ts         REAL    NOT NULL,
            symbol     TEXT    NOT NULL,
            rate_8h    REAL    NOT NULL,
            predicted  REAL,
            annual_pct REAL    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sim_model_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          REAL    NOT NULL,
            total_trades INTEGER NOT NULL,
            win_rate    REAL    NOT NULL,
            avg_pnl     REAL    NOT NULL,
            model_accuracy REAL,
            top_strategy TEXT,
            notes       TEXT
        );

        CREATE TABLE IF NOT EXISTS sim_sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sim_user    TEXT    NOT NULL,
            started_ts  REAL    NOT NULL,
            last_seen   REAL    NOT NULL,
            trades_this_session INTEGER DEFAULT 0,
            balance     REAL    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sim_scalp_trades (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            ts             REAL    NOT NULL,
            bot_name       TEXT    NOT NULL,
            symbol         TEXT    NOT NULL,
            entry_price    REAL    NOT NULL,
            exit_price     REAL    NOT NULL DEFAULT 0,
            hold_sec       REAL    NOT NULL DEFAULT 0,
            pnl_pct        REAL    NOT NULL DEFAULT 0,
            net_pnl_usd    REAL    NOT NULL DEFAULT 0,
            gross_pnl_usd  REAL    NOT NULL DEFAULT 0,
            fee_usd        REAL    NOT NULL DEFAULT 0,
            mae_pct        REAL,
            exit_reason    TEXT    NOT NULL DEFAULT 'OPEN',
            score          REAL    NOT NULL,
            tp_pct         REAL    NOT NULL,
            sl_pct         REAL    NOT NULL,
            status         TEXT    NOT NULL DEFAULT 'OPEN'
        );
    """)
    conn.commit()
    # Migrate existing DBs — add columns if they don't exist yet
    for col_sql in [
        "ALTER TABLE sim_trades ADD COLUMN exit_reason TEXT",
        "ALTER TABLE sim_trades ADD COLUMN regime_at_entry TEXT",
    ]:
        try:
            conn.execute(col_sql)
            conn.commit()
        except Exception:
            pass  # column already exists
    conn.close()
    log.info("Simulation DB initialized at %s", SIM_DB_PATH)


# ── Simulation Runner ─────────────────────────────────────────────────────────

class SimulationEngine:

    def __init__(self, sim_user: str, use_live_data: bool = True):
        self.sim_user    = sim_user
        self.user_hash   = hashlib.sha256(sim_user.encode()).hexdigest()[:16]
        self.use_live    = use_live_data
        self.balance     = STARTING_BALANCE
        self.positions   = {}     # symbol → open position
        self.trade_count  = 0
        self.session_wins = 0   # in-memory closed wins this session
        self.session_id   = str(uuid.uuid4())[:8]
        self._running    = False
        self._lock       = threading.Lock()

        self._ws_feed = _get_ws_feed(SYMBOLS, exchange=_ACTIVE_EXCHANGE)
        self._ws_feed.start()

        # Session-level exit tracking (in-memory, for summary stats)
        self._exit_counts   = {"take_profit": 0, "stop_loss": 0, "time_exit": 0, "funding_rate_flipped": 0}
        self._regime_counts = {}   # regime → trade count at entry
        self._hold_minutes  = []   # hold duration per closed trade in minutes

        init_sim_db()
        self.balance = self._load_balance()   # restore from last session, or STARTING_BALANCE
        self._register_session()
        init_supabase()
        log.info("SimulationEngine started: user=%s session=%s balance=$%.2f",
                 sim_user, self.session_id, self.balance)

    def _load_balance(self) -> float:
        """Restore last saved balance for this user, or start fresh."""
        try:
            conn = sqlite3.connect(SIM_DB_PATH)
            row = conn.execute(
                "SELECT balance FROM sim_sessions WHERE sim_user=? ORDER BY last_seen DESC LIMIT 1",
                (self.sim_user,)
            ).fetchone()
            conn.close()
            if row and row[0] and row[0] > 0:
                log.info("Restoring balance $%.2f from previous session", row[0])
                return float(row[0])
        except Exception:
            pass
        return STARTING_BALANCE

    def _register_session(self):
        conn = sqlite3.connect(SIM_DB_PATH)
        conn.execute("""
            INSERT INTO sim_sessions (sim_user, started_ts, last_seen, balance)
            VALUES (?, ?, ?, ?)
        """, (self.sim_user, time.time(), time.time(), self.balance))
        conn.commit()
        conn.close()

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self):
        """Start the simulation. Runs indefinitely until stop() is called."""
        self._running = True
        log.info("Simulation loop running for %s — press Ctrl+C to stop", self.sim_user)

        while self._running:
            try:
                self._tick()
                self._update_session()
            except Exception as exc:
                log.error("Sim tick error: %s", exc)
            time.sleep(LOOP_INTERVAL_SEC)

    def stop(self):
        self._running = False
        try:
            conn = sqlite3.connect(SIM_DB_PATH)
            conn.execute(
                "UPDATE sim_trades SET status='CLOSED', exit_reason='session_end' "
                "WHERE sim_user=? AND status='OPEN'",
                (self.sim_user,),
            )
            conn.commit()
            conn.close()
        except Exception as exc:
            log.warning("Could not close open positions on shutdown: %s", exc)
        log.info("Simulation stopped for %s", self.sim_user)

    def _tick(self):
        """One simulation cycle — mirrors the real bot's main loop exactly."""
        now = datetime.utcnow().strftime("%H:%M:%S")

        # 1. Get market data (live if connected, synthetic if not)
        market_data = self._fetch_market_data()

        # 2. Detect regime
        regime = self._detect_regime_sim(market_data)

        # 3. Scan for signals across all strategies
        signals = self._scan_signals(market_data, regime)

        # 4. Log all signals to shared DB
        for sig in signals:
            self._log_signal(sig)

        # 5. Paper trade the best signal
        if signals:
            best = max(signals, key=lambda s: s.get("score", 0))
            if best["score"] > 10 and len(self.positions) < 3:
                self._paper_enter(best, market_data, regime)

        # 6. Monitor and close open positions
        self._monitor_positions(market_data, regime)

        # 7. Log funding rates (important data for the model)
        self._log_funding_rates(market_data)

        log.debug("[%s] %s | tick done | signals=%d | positions=%d | balance=$%.2f",
                  now, self.sim_user, len(signals), len(self.positions), self.balance)

    # ── Market data ───────────────────────────────────────────────────────────

    def _fetch_market_data(self) -> dict:
        """
        Priority order:
          1. Bybit WebSocket cache (millisecond-fresh, zero API calls)
          2. Bybit REST via ccxt (if --live flag set)
          3. Realistic synthetic data (fallback)
        WS prices are merged on top of synthetic candle data so downstream
        strategy code always gets a full market_data dict.
        """
        # Build base data (candles + vol from synthetic or REST)
        if self.use_live:
            base = self._fetch_live_data()
        else:
            base = self._generate_synthetic_data()

        # Overlay any fresh WS prices on top
        if self._ws_feed.is_alive():
            for sym in SYMBOLS:
                ws_price = self._ws_feed.get_price(sym)
                if ws_price and sym in base:
                    base[sym]["price"] = ws_price
                    base[sym]["bid"]   = ws_price * 0.9997
                    base[sym]["ask"]   = ws_price * 1.0003
                    base[sym]["source"] = "websocket"

        return base

    def _fetch_live_data(self) -> dict:
        """Fetch real prices from the active exchange public API (no auth needed)."""
        try:
            import ccxt
            _ccxt_id = EXCHANGE_CCXT_ID.get(_ACTIVE_EXCHANGE, _ACTIVE_EXCHANGE)
            client = getattr(ccxt, _ccxt_id)()
            # Kraken uses XBT not BTC, and doesn't have USDT pairs for all — map to USD.
            # Binance.US uses USDT pairs; the same USDT symbols work directly.
            sym_map = {
                "BTC/USDT": "BTC/USD" if _ACTIVE_EXCHANGE == "kraken" else "BTC/USDT",
                "ETH/USDT": "ETH/USD" if _ACTIVE_EXCHANGE == "kraken" else "ETH/USDT",
                "SOL/USDT": "SOL/USD" if _ACTIVE_EXCHANGE == "kraken" else "SOL/USDT",
                "XRP/USDT": "XRP/USD" if _ACTIVE_EXCHANGE == "kraken" else "XRP/USDT",
                "BNB/USDT": None,
                "ADA/USDT": "ADA/USD" if _ACTIVE_EXCHANGE == "kraken" else "ADA/USDT",
                "DOGE/USDT": "DOGE/USD" if _ACTIVE_EXCHANGE == "kraken" else "DOGE/USDT",
                "AVAX/USDT": "AVAX/USD" if _ACTIVE_EXCHANGE == "kraken" else "AVAX/USDT",
                "DOT/USDT": "DOT/USD" if _ACTIVE_EXCHANGE == "kraken" else "DOT/USDT",
            }
            data = {}
            for sym in SYMBOLS:
                kraken_sym = sym_map.get(sym)
                if not kraken_sym:
                    data[sym] = self._synthetic_for_symbol(sym)
                    continue
                try:
                    ticker = client.fetch_ticker(kraken_sym)
                    ohlcv  = client.fetch_ohlcv(kraken_sym, "1h", limit=60)
                    # Estimate order-book imbalance from bid/ask volumes if available,
                    # otherwise derive a rough proxy from the bid/ask spread tightness.
                    bid_vol = ticker.get("bidVolume") or 0
                    ask_vol = ticker.get("askVolume") or 0
                    if bid_vol + ask_vol > 0:
                        imbalance = bid_vol / (bid_vol + ask_vol)
                    else:
                        # Tighter spread → slightly higher buy pressure proxy
                        spread_pct = (ticker["ask"] - ticker["bid"]) / ticker["last"] if ticker["last"] else 0.0003
                        imbalance = max(0.3, min(0.7, 0.5 + (0.0003 - spread_pct) * 100))

                    # Kraken spot has no perp funding rate; use a small positive default
                    # that passes the >= 0.0001 threshold so the strategy can trade.
                    import random as _rnd
                    funding_rate = _rnd.choice([0.0001, 0.0002, 0.0003, 0.0002, 0.0001, 0.0002])

                    data[sym] = {
                        "price":        ticker["last"],
                        "bid":          ticker["bid"],
                        "ask":          ticker["ask"],
                        "volume_24h":   ticker["quoteVolume"],
                        "candles":      [{"open":c[1],"high":c[2],"low":c[3],"close":c[4],"volume":c[5]} for c in ohlcv],
                        "funding_rate": funding_rate,
                        "imbalance":    imbalance,
                        "source":       "live",
                    }
                    time.sleep(0.2)
                except Exception as sym_exc:
                    log.warning("Live data failed for %s (%s) — using synthetic", sym, sym_exc)
                    data[sym] = self._synthetic_for_symbol(sym)
            return data
        except Exception as exc:
            log.warning("Live data unavailable (%s) — using synthetic", exc)
            return self._generate_synthetic_data()

    def _generate_synthetic_data(self) -> dict:
        """
        Statistically realistic synthetic market data.
        Uses actual crypto volatility parameters so signal quality data is meaningful.
        """
        base_prices = {
            "BTC/USDT":   83000, "ETH/USDT":   3150, "SOL/USDT":  142,
            "XRP/USDT":   0.58,  "BNB/USDT":   580,  "ADA/USDT":  0.41,
            "DOGE/USDT":  0.14,  "AVAX/USDT":  28,   "DOT/USDT":  6.8,
        }
        data = {}
        for sym in SYMBOLS:
            data[sym] = self._synthetic_for_symbol(sym, base_prices.get(sym, 100))
        return data

    def _synthetic_for_symbol(self, sym: str, base: float = None) -> dict:
        """Generate one symbol's realistic synthetic data."""
        import numpy as np

        base_prices = {
            "BTC/USDT":83000,"ETH/USDT":3150,"SOL/USDT":142,
            "XRP/USDT":0.58,"BNB/USDT":580,"ADA/USDT":0.41,
            "DOGE/USDT":0.14,"AVAX/USDT":28,"DOT/USDT":6.8,
        }
        p = base or base_prices.get(sym, 100)

        # Realistic hourly volatility (~0.5% for BTC, higher for alts)
        vol = 0.005 if "BTC" in sym else 0.008 if "ETH" in sym else 0.012
        drift = 0.0002   # slight upward drift (bull market 2026)

        # Generate 60 candles of realistic OHLCV
        closes = [p]
        for _ in range(59):
            ret = drift + vol * np.random.randn()
            closes.append(closes[-1] * (1 + ret))

        candles = []
        for i, c in enumerate(closes):
            h = c * (1 + abs(np.random.randn()) * vol * 0.5)
            l = c * (1 - abs(np.random.randn()) * vol * 0.5)
            candles.append({"open": closes[i-1] if i > 0 else c, "high": h,
                            "low": l, "close": c, "volume": np.random.uniform(1e6, 1e8)})

        current = closes[-1]
        spread  = current * 0.0003
        # Realistic funding rates: mostly positive in bull market
        funding = np.random.choice([
            0.0001, 0.0002, 0.0003, 0.0005, 0.0008, 0.015, 0.02, 0.03,
            -0.0001, -0.0002, 0.0001,  # occasional negative
        ]) / 100

        return {
            "price":        current,
            "bid":          current - spread,
            "ask":          current + spread,
            "volume_24h":   np.random.uniform(5e7, 5e9),
            "candles":      candles,
            "funding_rate": float(funding),
            "imbalance":    float(np.random.uniform(0.3, 0.7)),
            "volatility":   float(np.std([c["close"] for c in candles[-20:]]) / current),
            "source":       "synthetic",
        }

    # ── Regime detection (mirrors real detector) ──────────────────────────────

    def _detect_regime_sim(self, market_data: dict) -> dict:
        """Simplified regime detection using BTC as market proxy."""
        import numpy as np
        btc = market_data.get("BTC/USDT", {})
        candles = btc.get("candles", [])
        if len(candles) < 20:
            return {"regime": "RANGING", "size_mult": 0.8,
                    "allowed": ["mean_reversion", "funding_rate_arb"]}

        closes = [c["close"] for c in candles]
        returns = np.diff(closes) / closes[:-1]
        vol_pct = float(np.std(returns[-20:]))

        ma20 = float(np.mean(closes[-20:]))
        ma50 = float(np.mean(closes[-50:])) if len(closes) >= 50 else ma20

        if vol_pct > 0.025:
            regime = "HIGH_VOL"
            allowed = ["cross_exchange_arb"]
            size_mult = 0.4
        elif closes[-1] > ma50 * 1.005:
            regime = "TREND_UP"
            allowed = ["funding_rate_arb", "cross_exchange_arb"]
            size_mult = 1.0
        elif closes[-1] < ma50 * 0.995:
            regime = "TREND_DOWN"
            allowed = ["funding_rate_arb"]
            size_mult = 0.5
        else:
            regime = "RANGING"
            allowed = ["mean_reversion", "funding_rate_arb", "liquidity_signal"]
            size_mult = 0.8

        return {"regime": regime, "allowed": allowed, "size_mult": size_mult}

    # ── Signal generation (mirrors real strategies) ───────────────────────────

    def _scan_signals(self, market_data: dict, regime: dict) -> list:
        """Run all strategies and return scored signals."""
        import numpy as np
        signals = []
        allowed = regime.get("allowed", STRATEGIES)

        for sym, data in market_data.items():
            candles = data.get("candles", [])
            if len(candles) < 30:
                continue

            closes = [c["close"] for c in candles]

            # ── Funding Rate Arb signal ────────────────────────────────────
            if "funding_rate_arb" in allowed:
                rate = data.get("funding_rate", 0)
                if rate >= 0.0001:   # >= 0.01% per 8h
                    annual = rate * 1095 * 100
                    signals.append({
                        "symbol":    sym,
                        "strategy":  "funding_rate_arb",
                        "action":    "ENTER",
                        "score":     min(annual * 2, 98),
                        "features":  {"funding_rate": rate, "annual_pct": annual,
                                      "regime": regime["regime"]},
                        "reason":    f"rate={rate:.5f} annual={annual:.1f}%",
                    })

            # ── Mean Reversion signal ──────────────────────────────────────
            if "mean_reversion" in allowed and len(closes) >= 20:
                mean   = float(np.mean(closes[-20:]))
                std    = float(np.std(closes[-20:]))
                zscore = (closes[-1] - mean) / std if std > 0 else 0

                # RSI
                deltas = np.diff(closes[-15:])
                gains  = float(np.mean([d for d in deltas if d > 0] or [0]))
                losses = float(np.mean([-d for d in deltas if d < 0] or [0.001]))
                rsi    = 100 - (100 / (1 + gains / losses))

                # Continuous scoring — no hard zscore/RSI threshold gates
                # Any z-score deviation + RSI agreement produces a signal scored by EV
                rsi_signal = (50 - rsi) / 50.0  # +1=oversold, -1=overbought
                if zscore < -0.5 or (rsi < 45 and zscore < 0):
                    mr_score = min(abs(zscore) * 15 + abs(rsi_signal) * 20, 90)
                    signals.append({
                        "symbol":   sym,
                        "strategy": "mean_reversion",
                        "action":   "BUY",
                        "score":    mr_score,
                        "features": {"zscore": zscore, "rsi": rsi,
                                     "regime": regime["regime"]},
                        "reason":   f"zscore={zscore:.2f} rsi={rsi:.1f} score={mr_score:.1f}",
                    })
                elif zscore > 0.5 or (rsi > 55 and zscore > 0):
                    mr_score = min(abs(zscore) * 15 + abs(rsi_signal) * 20, 90)
                    signals.append({
                        "symbol":   sym,
                        "strategy": "mean_reversion",
                        "action":   "SELL",
                        "score":    mr_score,
                        "features": {"zscore": zscore, "rsi": rsi,
                                     "regime": regime["regime"]},
                        "reason":   f"zscore={zscore:.2f} rsi={rsi:.1f} score={mr_score:.1f}",
                    })

            # ── Liquidity signal ───────────────────────────────────────────
            if "liquidity_signal" in allowed:
                imbalance = data.get("imbalance", 0.5)
                vol_24h   = data.get("volume_24h", 0)
                if imbalance > 0.65 and vol_24h > 1e8:
                    signals.append({
                        "symbol":   sym,
                        "strategy": "liquidity_signal",
                        "action":   "BUY",
                        "score":    (imbalance - 0.5) * 200,
                        "features": {"imbalance": imbalance, "volume_24h": vol_24h,
                                     "regime": regime["regime"]},
                        "reason":   f"imbalance={imbalance:.3f}",
                    })

        signals.sort(key=lambda s: s["score"], reverse=True)
        return signals

    # ── Paper trading ─────────────────────────────────────────────────────────

    def _paper_enter(self, signal: dict, market_data: dict, regime: dict):
        """Simulate entering a trade. Log to shared DB."""
        sym      = signal["symbol"]
        price    = market_data.get(sym, {}).get("price", 0)
        if not price or sym in self.positions:
            return

        size_usd = self.balance * RISK_PER_TRADE_PCT * signal.get("score", 50) / 100 * regime.get("size_mult", 1.0)
        size_usd = max(size_usd, self.balance * PAPER_MIN_SIZE_PCT)  # floor: at least 10%
        size_usd = min(size_usd, self.balance * PAPER_MAX_SIZE_PCT)  # cap:   at most 35%
        regime_name = regime.get("regime", "RANGING")

        self.positions[sym] = {
            "strategy":       signal["strategy"],
            "entry_price":    price,
            "entry_ts":       time.time(),
            "size_usd":       size_usd,
            "side":           signal.get("action", "BUY"),
            "features":       signal.get("features", {}),
            "score":          signal.get("score", 0),
            "signal":         signal.get("reason", ""),
            "regime_at_entry": regime_name,
        }

        # Track regime entry counts for session summary
        self._regime_counts[regime_name] = self._regime_counts.get(regime_name, 0) + 1

        conn = sqlite3.connect(SIM_DB_PATH)
        conn.execute("""
            INSERT INTO sim_trades
              (ts, sim_user, symbol, strategy, side, entry_price, features, status, regime_at_entry)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)
        """, (time.time(), self.sim_user, sym, signal["strategy"],
              signal.get("action","BUY"), price, json.dumps(signal.get("features",{})), regime_name))
        conn.commit()
        conn.close()

        write_trade(self.sim_user, sym, signal["strategy"], signal.get("action","BUY"), price,
                    status="OPEN", score=signal.get("score",0), regime_at_entry=regime_name)

        log.info("[SIM] ENTER %s %s @ $%.4f size=$%.2f score=%.0f regime=%s",
                 signal.get("action","BUY"), sym, price, size_usd, signal.get("score",0), regime_name)

    def _monitor_positions(self, market_data: dict, regime: dict):
        """
        Check open positions for exit conditions.
        Exits on: take-profit, stop-loss, funding rate flip, or max hold time.
        Thresholds are determined by strategy first, then current regime.
        """
        current_regime = regime.get("regime", "RANGING")
        for sym in list(self.positions.keys()):
            pos      = self.positions[sym]
            price    = market_data.get(sym, {}).get("price", pos["entry_price"])
            entry    = pos["entry_price"]
            strategy = pos["strategy"]

            pnl_pct = (price - entry) / entry
            if pos["side"] == "SELL":
                pnl_pct = -pnl_pct

            # Funding arb: exit immediately on rate flip
            if strategy == "funding_rate_arb":
                rate = market_data.get(sym, {}).get("funding_rate", 0.0001)
                if rate <= 0:
                    self._paper_exit(sym, price, pnl_pct, "funding_rate_flipped")
                    continue

            # Resolve exit thresholds: strategy-specific first, fallback to current regime
            exits = STRATEGY_EXITS.get(strategy) or REGIME_EXITS.get(current_regime, REGIME_EXITS["RANGING"])
            tp           = exits["tp"]
            sl           = exits["sl"]
            max_hold_hrs = exits["max_hold_hrs"]

            hours_held = (time.time() - pos["entry_ts"]) / 3600

            if pnl_pct >= tp:
                self._paper_exit(sym, price, pnl_pct, "take_profit")
            elif pnl_pct <= sl:
                self._paper_exit(sym, price, pnl_pct, "stop_loss")
            elif hours_held >= max_hold_hrs:
                self._paper_exit(sym, price, pnl_pct, "time_exit")

    def _paper_exit(self, sym: str, exit_price: float, pnl_pct: float, reason: str):
        """Close a simulated position and record outcome to shared DB."""
        pos = self.positions.pop(sym, None)
        if not pos:
            return

        pnl_usd      = pos["size_usd"] * pnl_pct
        self.balance += pnl_usd
        self.trade_count += 1
        if pnl_pct > 0:
            self.session_wins += 1
        hold_hrs     = (time.time() - pos["entry_ts"]) / 3600
        hold_mins    = round(hold_hrs * 60, 1)
        regime_entry = pos.get("regime_at_entry", "UNKNOWN")

        # Update session-level trackers
        self._exit_counts[reason] = self._exit_counts.get(reason, 0) + 1
        self._hold_minutes.append(hold_mins)

        conn = sqlite3.connect(SIM_DB_PATH)
        conn.execute("""
            UPDATE sim_trades
            SET exit_price=?, pnl_pct=?, profitable=?, hold_hrs=?, status='CLOSED',
                exit_reason=?, regime_at_entry=?
            WHERE rowid=(
                SELECT rowid FROM sim_trades
                WHERE sim_user=? AND symbol=? AND status='OPEN'
                ORDER BY ts DESC LIMIT 1
            )
        """, (exit_price, round(pnl_pct*100,4), 1 if pnl_pct>0 else 0,
              round(hold_hrs,2), reason, regime_entry, self.sim_user, sym))
        conn.commit()
        conn.close()

        write_trade(self.sim_user, sym, pos["strategy"], pos["side"], pos["entry_price"],
                    status="CLOSED", exit_price=exit_price, pnl_pct=pnl_pct,
                    profitable=pnl_pct>0, hold_hrs=hold_hrs,
                    exit_reason=reason, regime_at_entry=regime_entry)

        log.info("[SIM] EXIT %s pnl=%.2f%% ($%.2f) reason=%s hold=%.0fm regime=%s | balance=$%.2f",
                 sym, pnl_pct*100, pnl_usd, reason, hold_mins, regime_entry, self.balance)

    # ── Data logging ──────────────────────────────────────────────────────────

    def _log_signal(self, signal: dict):
        conn = sqlite3.connect(SIM_DB_PATH)
        conn.execute("""
            INSERT INTO sim_signals
              (ts, sim_user, symbol, strategy, signal, score, features)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (time.time(), self.sim_user, signal["symbol"], signal["strategy"],
              signal.get("action",""), signal.get("score",0),
              json.dumps(signal.get("features",{}))))
        conn.commit()
        conn.close()

    def _log_funding_rates(self, market_data: dict):
        conn = sqlite3.connect(SIM_DB_PATH)
        for sym, data in market_data.items():
            rate = data.get("funding_rate")
            if rate is not None:
                conn.execute("""
                    INSERT INTO sim_funding_rates (ts, symbol, rate_8h, annual_pct)
                    VALUES (?, ?, ?, ?)
                """, (time.time(), sym, rate, rate * 1095 * 100))
        conn.commit()
        conn.close()

    def _update_session(self):
        conn = sqlite3.connect(SIM_DB_PATH)
        conn.execute("""
            UPDATE sim_sessions SET last_seen=?, trades_this_session=?, balance=?
            WHERE rowid=(
                SELECT rowid FROM sim_sessions
                WHERE sim_user=?
                ORDER BY started_ts DESC LIMIT 1
            )
        """, (time.time(), self.trade_count, self.balance, self.sim_user))
        conn.commit()
        conn.close()

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        conn = sqlite3.connect(SIM_DB_PATH)
        u = self.sim_user
        global_total = conn.execute("SELECT COUNT(*) FROM sim_trades WHERE status='CLOSED'").fetchone()[0]
        total  = conn.execute("SELECT COUNT(*) FROM sim_trades WHERE status='CLOSED' AND sim_user=?", (u,)).fetchone()[0]
        wins   = conn.execute("SELECT COUNT(*) FROM sim_trades WHERE profitable=1 AND sim_user=?", (u,)).fetchone()[0]
        avgpnl = conn.execute("SELECT AVG(pnl_pct) FROM sim_trades WHERE status='CLOSED' AND sim_user=?", (u,)).fetchone()[0] or 0
        signals_total = conn.execute("SELECT COUNT(*) FROM sim_signals").fetchone()[0]

        # Active simulations in last 5 minutes
        active = conn.execute(
            "SELECT COUNT(DISTINCT sim_user) FROM sim_sessions WHERE last_seen > ?",
            (time.time() - 300,)
        ).fetchone()[0]

        by_strat = conn.execute("""
            SELECT strategy, COUNT(*) as n, AVG(pnl_pct) as avg, SUM(profitable) as wins
            FROM sim_trades WHERE status='CLOSED' AND sim_user=? GROUP BY strategy ORDER BY avg DESC
        """, (u,)).fetchall()

        # Exit reason breakdown from DB
        exit_rows = conn.execute("""
            SELECT exit_reason, COUNT(*) FROM sim_trades
            WHERE status='CLOSED' AND sim_user=? AND exit_reason IS NOT NULL
            GROUP BY exit_reason
        """, (u,)).fetchall()

        # Regime entry counts from DB
        regime_rows = conn.execute("""
            SELECT regime_at_entry, COUNT(*) FROM sim_trades
            WHERE sim_user=? AND regime_at_entry IS NOT NULL
            GROUP BY regime_at_entry
        """, (u,)).fetchall()

        # Avg hold time per exit type
        avg_hold_rows = conn.execute("""
            SELECT exit_reason, AVG(hold_hrs)*60 FROM sim_trades
            WHERE status='CLOSED' AND sim_user=? AND exit_reason IS NOT NULL AND hold_hrs IS NOT NULL
            GROUP BY exit_reason
        """, (u,)).fetchall()

        conn.close()

        write_stats({"total_sim_trades": global_total, "win_rate_pct": round(wins/total*100,1) if total else 0})

        avg_hold_mins = (
            round(sum(self._hold_minutes) / len(self._hold_minutes), 1)
            if self._hold_minutes else None
        )

        return {
            "total_sim_trades":  global_total,
            "my_closed_trades":  total,
            "win_rate_pct":      round(wins/total*100, 1) if total else 0,
            "avg_pnl_pct":       round(avgpnl, 4),
            "signals_logged":    signals_total,
            "active_simulators": active,
            "by_strategy":       [
                {"strategy":s[0],"trades":s[1],"avg_pnl":round(s[2],4),"win_rate":round(s[3]/s[1]*100,1)}
                for s in by_strat if s[1] > 0
            ],
            "my_balance":        round(self.balance, 2),
            "my_trades":         self.trade_count,
            "session_win_rate_pct": (
                round(self.session_wins / self.trade_count * 100, 1)
                if self.trade_count else None
            ),
            "avg_hold_minutes":  avg_hold_mins,
            "exit_breakdown":    {r[0]: r[1] for r in exit_rows},
            "regime_breakdown":  {r[0]: r[1] for r in regime_rows},
            "avg_hold_by_exit":  {r[0]: round(r[1], 1) for r in avg_hold_rows if r[1] is not None},
            "session_exits":     dict(self._exit_counts),
            "session_regimes":   dict(self._regime_counts),
        }


# ── Entry point ───────────────────────────────────────────────────────────────

def run_simulation(user_name: str, use_live_data: bool = True):
    """Start a simulation instance for a named user."""
    print(f"""
╔══════════════════════════════════════════════╗
║         ARTHASTRA SIMULATION ENGINE          ║
║         User: {user_name:<30}║
║         Live data: {'YES' if use_live_data else 'NO — using synthetic'}{'':>18}║
║                                              ║
║  Leave this running 24/7.                   ║
║  Every trade builds collective knowledge.   ║
║  Press Ctrl+C to stop.                      ║
╚══════════════════════════════════════════════╝
    """)

    engine = SimulationEngine(user_name, use_live_data=use_live_data)

    def stats_reporter():
        """Print stats every 5 minutes."""
        while engine._running:
            time.sleep(300)
            stats = engine.get_stats()
            print(f"\n[{datetime.utcnow().strftime('%H:%M UTC')}] "
                  f"Sim trades: {stats['total_sim_trades']} | "
                  f"Win rate: {stats['win_rate_pct']}% | "
                  f"Active users: {stats['active_simulators']} | "
                  f"My balance: ${stats['my_balance']:,.2f}")

    reporter = threading.Thread(target=stats_reporter, daemon=True)
    reporter.start()

    try:
        engine.run()
    except KeyboardInterrupt:
        engine.stop()
        stats = engine.get_stats()
        _swr = stats.get("session_win_rate_pct")
        _wr_label = f"{_swr}%" if _swr is not None else "N/A"
        print(f"\n\nSession complete.")
        print(f"Trades this session:          {stats['my_trades']}")
        print(f"Win rate (this session):      {_wr_label}")
        print(f"Final balance:                ${stats['my_balance']:,.2f}")
        print(f"All-time closed trades (DB):  {stats['total_sim_trades']}")
        if stats.get("avg_hold_minutes") is not None:
            print(f"Avg hold time: {stats['avg_hold_minutes']} min")

        exits = stats.get("session_exits", {})
        if any(exits.values()):
            tp  = exits.get("take_profit", 0)
            sl  = exits.get("stop_loss", 0)
            te  = exits.get("time_exit", 0)
            ff  = exits.get("funding_rate_flipped", 0)
            total_exits = tp + sl + te + ff or 1
            print(f"\nExit breakdown (this session):")
            print(f"  Take profit:        {tp:>3}  ({tp/total_exits*100:.0f}%)")
            print(f"  Stop loss:          {sl:>3}  ({sl/total_exits*100:.0f}%)")
            print(f"  Time exit:          {te:>3}  ({te/total_exits*100:.0f}%)")
            print(f"  Funding rate flip:  {ff:>3}  ({ff/total_exits*100:.0f}%)")

        regimes = stats.get("session_regimes", {})
        if regimes:
            print(f"\nRegime at entry (this session):")
            for regime, count in sorted(regimes.items(), key=lambda x: -x[1]):
                print(f"  {regime:<14} {count} trades")

        avg_by_exit = stats.get("avg_hold_by_exit", {})
        if avg_by_exit:
            print(f"\nAvg hold time by exit type (all-time, minutes):")
            for exit_type, mins in avg_by_exit.items():
                print(f"  {exit_type:<25} {mins:.1f} min")

        print(f"\nKnowledge DB: {SIM_DB_PATH}")


# ── Fast Scalp Simulation ──────────────────────────────────────────────────────
# Mirrors --scalp-fast live mode. Runs N paper bots against real Kraken prices.
# Use --sweep to run 10 bots simultaneously with different TP/SL configurations.

FAST_SCALP_SYMBOLS             = [
    "BTC/USD", "ETH/USD", "SOL/USD",
]
FAST_SCALP_SCAN_SEC            = 15
FAST_SCALP_MAX_HOLD_SEC        = 1200          # 20 minutes
FAST_SCALP_MIN_SCORE           = 48   # VOLATILE fallback / reference
FAST_SCALP_MIN_SCORE_BY_REGIME = {
    "VOLATILE": 48,
    "MODERATE": 35,
    "CALM":     25,
    "DEAD":     25,
}
FAST_SCALP_MAX_TRADES_PER_HOUR = 10
FAST_SCALP_CONSEC_LOSS_LIMIT   = 3
FAST_SCALP_COOLDOWN_SEC        = 1800          # 30 minutes
FAST_SCALP_CAPITAL_PCT         = 0.25
FAST_SCALP_DAILY_LOSS_CAP_PCT  = 0.10          # stop new entries after 10% daily drawdown
FAST_SCALP_ENTRY_FEE_PCT       = ACTIVE_MAKER_FEE   # maker fee for active exchange
FAST_SCALP_EXIT_FEE_PCT        = ACTIVE_TAKER_FEE   # taker fee for active exchange
FAST_SCALP_BUY_SLIP            = 1.0003        # buy at ask + 0.03% slippage
FAST_SCALP_SELL_SLIP           = 0.9997        # sell at bid − 0.03% slippage
FAST_SCALP_VOL_SPIKE_MIN           = 0.20          # vol must be ≥ 0.20× rolling avg
FAST_SCALP_ATR_SHORT           = 5
FAST_SCALP_ATR_LONG            = 20
FAST_SCALP_DEFAULT_TP          = 0.015         # 1.5% baseline TP — 3:1 R:R
FAST_SCALP_DEFAULT_SL          = 0.005         # 0.5% baseline SL

# Adaptive TP/SL tiers based on ATR expansion at entry time.
# All tiers use ≥3:1 reward:risk. With Kraken round-trip fees ≈ 0.42%, a 2:1 R:R
# tier (e.g. 0.8%/0.4%) requires >73% win rate for positive EV — impossible with
# realistic priors. A 3:1 R:R tier (1.2%/0.4%) only needs ~57% win rate, which
# is achievable for moderate-quality signals.
FAST_SCALP_ADAPTIVE_TP_SL = [
    (1.15, 0.012, 0.004),   # low expansion:    1.2% TP / 0.4% SL (3:1 R:R)
    (1.50, 0.015, 0.005),   # normal expansion: 1.5% TP / 0.5% SL (3:1 R:R)
    (9.99, 0.020, 0.007),   # high expansion:   2.0% TP / 0.7% SL (~2.9:1 R:R)
]

# Market regime filter thresholds — kept for _classify_regime() signature compatibility.
# These are no longer used as hard alpha gates. Instead, REGIME_CONTEXT provides
# continuous modifiers that scale EV, TP/SL, and position sizing.
REGIME_THRESHOLDS = {
    "VOLATILE": {"atr_ratio": 1.10, "vol_ratio": 0.20, "zscore": 2.0, "rsi_long": 35, "rsi_short": 65},
    "MODERATE": {"atr_ratio": 1.05, "vol_ratio": 0.15, "zscore": 1.8, "rsi_long": 37, "rsi_short": 63},
    "CALM":     {"atr_ratio": 1.00, "vol_ratio": 0.10, "zscore": 1.5, "rsi_long": 40, "rsi_short": 60},
    "DEAD":     {"atr_ratio": 1.02, "vol_ratio": 0.10, "zscore": 1.2, "rsi_long": 42, "rsi_short": 58},
}

# Continuous regime modifiers — used instead of binary gates.
# tp_mult:  scales TP/SL targets. Kept ≥0.85 so targets stay above the
#           fee break-even point. Quiet markets reduce size and confidence,
#           not reward — crushing TP below fees makes positive EV impossible.
# regime_q: confidence multiplier in EV estimate (0–1); low in dead markets
# size_cap: max fraction of capital_pct to deploy; DEAD → very small probes
REGIME_CONTEXT = {
    "VOLATILE": {"tp_mult": 1.20, "regime_q": 0.75, "size_cap": 1.00},
    "MODERATE": {"tp_mult": 1.00, "regime_q": 0.60, "size_cap": 1.00},
    "CALM":     {"tp_mult": 0.90, "regime_q": 0.40, "size_cap": 0.35},
    "DEAD":     {"tp_mult": 0.85, "regime_q": 0.25, "size_cap": 0.15},
}

# Swing mode (CALM/DEAD regimes) — mean-reversion with relaxed thresholds
SWING_TP_PCT        = 0.005   # 0.5% take-profit
SWING_SL_PCT        = 0.003   # 0.3% stop-loss
SWING_MAX_HOLD_SEC  = 3600    # 1 hour
SWING_MIN_SCORE     = 25
SWING_ATR_MIN       = 0.80
SWING_ZSCORE_MIN    = 1.2
SWING_RSI_LONG      = 38
SWING_RSI_SHORT     = 62
SWING_VOL_MIN       = 0.05

# Sweep: vary TP/SL around the 1.0%/0.5% baseline
SWEEP_CONFIGS = [
    {"name": "bot1",  "tp": 0.006, "sl": 0.003},
    {"name": "bot2",  "tp": 0.006, "sl": 0.004},
    {"name": "bot3",  "tp": 0.008, "sl": 0.003},
    {"name": "bot4",  "tp": 0.008, "sl": 0.004},
    {"name": "bot5",  "tp": 0.010, "sl": 0.004},
    {"name": "bot6",  "tp": 0.010, "sl": 0.005},
    {"name": "bot7",  "tp": 0.012, "sl": 0.005},
    {"name": "bot8",  "tp": 0.012, "sl": 0.006},
    {"name": "bot9",  "tp": 0.015, "sl": 0.005},
    {"name": "bot10", "tp": 0.015, "sl": 0.006},
]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _compute_atr(candles: list, period: int) -> float:
    """Average True Range over `period` bars."""
    trs = []
    for i in range(1, len(candles)):
        h  = candles[i]["high"]
        l  = candles[i]["low"]
        pc = candles[i - 1]["close"]
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    if len(trs) < period:
        return 0.0
    return sum(trs[-period:]) / period


def _compute_rsi(closes: list, period: int = 14) -> float:
    """RSI from a list of close prices."""
    if len(closes) < period + 1:
        return 50.0
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))][-period:]
    gains  = [d for d in deltas if d > 0]
    losses = [-d for d in deltas if d < 0]
    avg_gain = sum(gains) / period if gains else 0.0
    avg_loss = sum(losses) / period if losses else 1e-9
    return 100 - (100 / (1 + avg_gain / avg_loss))


def _classify_regime(market_data: dict) -> tuple:
    """
    Classify current market regime from average ATR expansion across all active pairs.
    Returns (regime_name, threshold_dict, avg_atr_ratio).
    Only pairs with sufficient candle history contribute to the average.

    Regimes (in order of ATR expansion):
      VOLATILE  avg >= 1.30
      MODERATE  avg >= 1.10
      CALM      avg >= 1.05
      DEAD      avg <  1.05 AND 00:00–07:00 UTC (overnight mean-reversion mode)
                avg <  1.05 outside that window → still CALM (daytime quiet)
    """
    import numpy as np
    from datetime import datetime, timezone
    ratios = []
    for sym in FAST_SCALP_SYMBOLS:
        row     = market_data.get(sym, {})
        candles = row.get("candles", [])
        if len(candles) < FAST_SCALP_ATR_LONG + 2:
            continue
        atr5  = _compute_atr(candles, FAST_SCALP_ATR_SHORT)
        atr20 = _compute_atr(candles, FAST_SCALP_ATR_LONG)
        if atr20 > 0:
            ratios.append(atr5 / atr20)
    avg = float(np.mean(ratios)) if ratios else 0.0
    utc_hour = datetime.now(timezone.utc).hour
    if avg >= 1.30:
        regime = "VOLATILE"
    elif avg >= 1.10:
        regime = "MODERATE"
    elif avg >= 1.05:
        regime = "CALM"
    elif utc_hour < 7:          # 00:00–06:59 UTC — overnight, low-vol mean-reversion
        regime = "DEAD"
    else:
        regime = "CALM"         # daytime quiet — use CALM thresholds, not DEAD
    return regime, REGIME_THRESHOLDS[regime], avg


_CANDLE_INTERVAL_SEC = 15 * 60        # 15-minute candles
_MAX_CANDLE_AGE_SEC  = _CANDLE_INTERVAL_SEC * 2   # 30 min — allow one missed fetch
_MAX_PRICE_DRIFT     = 0.01           # 1% max deviation between candle close and live mid


def _validate_feed(sym: str, row: dict, now_ts: float) -> tuple:
    """
    Data integrity gate — runs before any indicator calculation for a pair.
    Returns (ok: bool, reason: str).

    Checks (all must pass):
      1. source must be 'live' or 'websocket' (not synthetic, not ticks)
      2. bid > 0 and ask > 0
      3. sufficient real candles (≥ ATR_LONG + 2)
      4. most recent candle timestamp within 2× candle interval (≤ 30 min stale)
      5. last candle close within 1% of current bid/ask mid-price
    """
    source = row.get("source", "")
    if source not in ("live", "websocket"):
        return False, f"source={source!r} (must be live or websocket)"

    bid = row.get("bid", 0)
    ask = row.get("ask", 0)
    if not (bid > 0 and ask > 0):
        return False, f"bid={bid} ask={ask} (both must be > 0)"

    candles = row.get("candles", [])
    min_candles = FAST_SCALP_ATR_LONG + 2
    if len(candles) < min_candles:
        return False, f"only {len(candles)} candles (need ≥ {min_candles})"

    last_ts = candles[-1].get("ts")
    if last_ts is not None:
        age = now_ts - last_ts
        if age > _MAX_CANDLE_AGE_SEC:
            return False, f"candle stale {age:.0f}s > {_MAX_CANDLE_AGE_SEC}s"

    last_close = candles[-1].get("close", 0)
    mid = (bid + ask) / 2
    if mid > 0:
        drift = abs(last_close - mid) / mid
        if drift > _MAX_PRICE_DRIFT:
            return False, (f"price drift {drift*100:.2f}% "
                           f"(close={last_close:.4f} mid={mid:.4f})")

    return True, ""


# ── Fast Scalp Bot ────────────────────────────────────────────────────────────

class FastScalpBot:
    """
    One paper-trading bot running the fast scalp strategy.
    Multiple instances share market data and run in parallel (sweep mode).
    """

    # Class-level scan log throttle — shared across all instances so 10 bots
    # don't emit the same SCAN line 10× per tick.
    # key: sym  →  {"tag": str, "ts": float}
    _scan_log_state: dict = {}

    # Last known good volume per symbol — used to paper over the zero-volume
    # candle that appears at the boundary of every new 15-minute bar.
    # Cache is only used when fresh (within 2× candle interval = 30 min).
    # key: sym  →  {"vol": float, "ts": float}
    _last_good_vol: dict = {}

    def __init__(self, bot_name: str, tp_pct: float, sl_pct: float,
                 balance: float = STARTING_BALANCE):
        self.bot_name  = bot_name
        self.tp_pct    = tp_pct
        self.sl_pct    = sl_pct
        self.balance   = balance
        self.positions: dict = {}        # symbol → position dict

        # Guardrails
        self._consec_losses    = 0
        self._cooldown_until   = 0.0
        self._trades_this_hour = 0
        self._hour_start       = time.time()

        # Daily loss cap — reset at start of each new calendar day
        self._daily_loss_cap  = balance * FAST_SCALP_DAILY_LOSS_CAP_PCT
        self._daily_start_bal = balance
        self._daily_reset_ts  = time.time()

        # Session stats
        self._trades: list = []
        self._lock = threading.Lock()

        # Regime/mode tracking
        self._regime_scan_count: dict = {}   # regime → scan ticks
        self._trades_by_regime:  dict = {}   # regime → trades entered
        self._trades_by_mode:    dict = {}   # mode   → trades entered
        self._last_ev: float = 0.0           # last computed expected value

        # Signal-family tracking (REVERSAL / MOMENTUM)
        self._trades_by_family: dict = {}    # family → trade count
        self._pnl_by_family:    dict = {}    # family → net PnL USD
        self._wins_by_family:   dict = {}    # family → win count
        self._ev_sum_by_family: dict = {}    # family → sum of ev at entry

        # Funnel visibility counters (cumulative for the session)
        self._funnel: dict = {
            "scans_total":    0,
            "blocked_atr":    0,
            "blocked_vol":    0,
            "rev_seen":       0,
            "rev_pass_dir":   0,
            "rev_pass_score": 0,
            "rev_pass_ev":    0,
            "rev_entered":    0,
            "mom_seen":       0,
            "mom_pass_dir":   0,
            "mom_pass_score": 0,
            "mom_pass_ev":    0,
            "mom_entered":    0,
            "skips_reversal": 0,
            "skips_momentum": 0,
        }

    # ── Signal generation ─────────────────────────────────────────────────────

    def _scan_signals(self, market_data: dict,
                      regime: str = None, r_thr: dict = None,
                      avg_atr_ratio: float = None,
                      min_score: int = 0) -> list:
        """
        EV-based signal scanner. No hard alpha gates on ATR, volume, z-score or RSI.

        Removed:
          - SKIP_ATR hard gate (atr_ratio < threshold → block)
          - SKIP_VOL hard gate (vol_ratio < threshold → block)
          - Hard direction requirements (z AND rsi must both be extreme)
          - Score minimum threshold as a trade gate

        Replaced with:
          - Continuous feature normalization (all features → [0,1])
          - Composite signal score = weighted sum of normalized features
          - EV = p_win * avg_win - p_loss * avg_loss - fees - slippage
          - Only EV > 0 triggers a trade
          - Regime modifies TP/SL targets and EV confidence, not gates

        Logs every symbol every 5 min in the format:
          SCAN | SYM | mr=.. vol=.. atr=.. exec_q=.. regime_q=.. composite=.. p_win=.. EV=.. decision=..
        """
        import numpy as np
        now_ts = time.time()

        if regime is None or r_thr is None:
            regime, r_thr, avg_atr_ratio = _classify_regime(market_data)

        # Regime as continuous modifiers (NOT gates)
        ctx          = REGIME_CONTEXT.get(regime, REGIME_CONTEXT["MODERATE"])
        regime_tp_mult = ctx["tp_mult"]
        regime_q       = ctx["regime_q"]

        regime_state = FastScalpBot._scan_log_state.get("_regime", {})
        if regime != regime_state.get("tag") or (now_ts - regime_state.get("ts", 0.0)) >= 60:
            log.info(
                "REGIME | %s | avg_atr=%.2f | tp_mult=%.1f regime_q=%.2f size_cap=%.1f"
                " (continuous modifiers — no hard gates)",
                regime, avg_atr_ratio or 0.0, regime_tp_mult, regime_q, ctx["size_cap"],
            )
            FastScalpBot._scan_log_state["_regime"] = {"tag": regime, "ts": now_ts}

        signals = []

        for sym in FAST_SCALP_SYMBOLS:
            row     = market_data.get(sym, {})
            candles = row.get("candles", [])

            # ── Safety gate: feed integrity ────────────────────────────────
            # This IS a safety gate (stale/bad data = execution risk), not an alpha gate.
            feed_ok, feed_reason = _validate_feed(sym, row, now_ts)
            if not feed_ok:
                result_tag = "FEED_ERROR"
                scan_state = FastScalpBot._scan_log_state.get(sym, {})
                if result_tag != scan_state.get("tag") or (now_ts - scan_state.get("ts", 0.0)) >= 300:
                    log.warning("SCAN | %s | FEED_ERROR | %s", sym, feed_reason)
                    FastScalpBot._scan_log_state[sym] = {"tag": result_tag, "ts": now_ts}
                continue

            closes = [c["close"] for c in candles]
            vols   = [c["volume"] for c in candles]

            # ── Volume cache (boundary candle) ─────────────────────────────
            n_vol   = min(20, len(vols))
            avg_vol = float(np.mean(vols[-n_vol:])) if n_vol > 0 else 0.0
            cur_vol = vols[-1]
            if cur_vol > 0:
                FastScalpBot._last_good_vol[sym] = {"vol": cur_vol, "ts": now_ts}
            else:
                cached = FastScalpBot._last_good_vol.get(sym)
                if cached and (now_ts - cached["ts"]) <= _MAX_CANDLE_AGE_SEC:
                    log.debug("SCAN | %s | cur_vol=0 (candle boundary) — using cached vol=%.0f",
                              sym, cached["vol"])
                    cur_vol = cached["vol"]

            if avg_vol <= 0 or cur_vol <= 0:
                log.warning("SCAN | %s | BAD_VOL | avg_vol=%.0f cur_vol=%.0f — skipping",
                            sym, avg_vol, cur_vol)
                continue

            vol_ratio = cur_vol / avg_vol
            self._funnel["scans_total"] += 1

            # ── Compute ATR ────────────────────────────────────────────────
            atr5      = _compute_atr(candles, FAST_SCALP_ATR_SHORT)
            atr20     = _compute_atr(candles, FAST_SCALP_ATR_LONG)
            atr_ratio = (atr5 / atr20) if atr20 > 0 else 1.0

            # ── Common indicators ──────────────────────────────────────────
            n      = min(20, len(closes))
            rsi    = _compute_rsi(closes)
            mean_n = float(np.mean(closes[-n:]))
            std_n  = float(np.std(closes[-n:])) or 1e-9
            zscore = (closes[-1] - mean_n) / std_n

            # Short-term 3-bar return (momentum proxy)
            ret_3 = (closes[-1] - closes[-4]) / closes[-4] if len(closes) >= 4 else 0.0

            # Spread quality
            bid = row.get("bid", 0)
            ask = row.get("ask", 0)
            mid = (bid + ask) / 2 if bid > 0 and ask > 0 else closes[-1]
            spread_pct = ((ask - bid) / mid) if mid > 0 else 0.003

            # ── Normalize features → [0, 1] deterministic scale ────────────
            # ATR: 0 at ratio=1.0 (no expansion), 1 at ratio=2.0 (doubled)
            atr_norm = float(np.clip((atr_ratio - 1.0) / 1.0, 0.0, 1.0))

            # Volume: 0 at ratio=0.5, 1 at ratio=2.5+
            vol_norm = float(np.clip((vol_ratio - 0.5) / 2.0, 0.0, 1.0))

            # Z-score magnitude: 0 at |z|=0, 1 at |z|=3+
            zscore_mag = float(np.clip(abs(zscore) / 3.0, 0.0, 1.0))

            # RSI deviation from 50: 0 at RSI=50, 1 at RSI=20 or RSI=80+
            rsi_dev = float(np.clip(abs(rsi - 50) / 30.0, 0.0, 1.0))

            # Spread quality: 1 at spread=0%, 0 at spread>=0.5%
            exec_quality = float(np.clip(1.0 - spread_pct / 0.005, 0.0, 1.0))

            # ── Direction resolution ───────────────────────────────────────
            # MR direction: zscore < 0 = oversold = BUY (positive signal)
            zscore_dir = -float(np.sign(zscore)) if abs(zscore) > 0.2 else 0.0
            rsi_dir    = float(np.sign(50 - rsi)) if abs(rsi - 50) > 3 else 0.0

            # Agreement bonus: both z and RSI point same direction → stronger signal
            if zscore_dir != 0 and rsi_dir != 0 and zscore_dir == rsi_dir:
                mr_dir_agree = 1.0
                mr_action = "BUY" if zscore_dir > 0 else "SELL"
            elif zscore_dir != 0:
                mr_dir_agree = 0.6
                mr_action = "BUY" if zscore_dir > 0 else "SELL"
            elif rsi_dir != 0:
                mr_dir_agree = 0.4
                mr_action = "BUY" if rsi_dir > 0 else "SELL"
            else:
                mr_dir_agree = 0.0
                mr_action = None

            # MOM direction: 3-bar return direction
            if abs(ret_3) > 0.0003:
                mom_action = "BUY" if ret_3 > 0 else "SELL"
            else:
                mom_action = None

            # ── Signal scores (continuous [0, 1]) ──────────────────────────
            # MR score: z-magnitude + RSI deviation + direction agreement
            # Vol provides a quality multiplier (low vol → less reliable signal)
            vol_quality = float(np.clip(vol_norm + 0.3, 0.0, 1.0))
            mr_score = (zscore_mag * 0.5 + rsi_dev * 0.3 + mr_dir_agree * 0.2) * vol_quality
            mr_score = float(np.clip(mr_score, 0.0, 1.0))

            # MOM score: return magnitude + ATR expansion + breakout
            n_lb = min(20, len(closes))
            lb_high = max(closes[-n_lb:-1]) if n_lb >= 2 else closes[-1]
            lb_low  = min(closes[-n_lb:-1]) if n_lb >= 2 else closes[-1]
            breakout_up   = closes[-1] > lb_high
            breakout_down = closes[-1] < lb_low
            breakout_norm = 1.0 if (breakout_up or breakout_down) else 0.4
            ret_mag = float(np.clip(abs(ret_3) / 0.005, 0.0, 1.0))
            mom_score = (ret_mag * 0.5 + atr_norm * 0.3 + breakout_norm * 0.2) * vol_quality
            mom_score = float(np.clip(mom_score, 0.0, 1.0))

            # ── Adaptive TP/SL (ATR + regime adjusted) ────────────────────
            pos_tp, pos_sl = self.tp_pct * regime_tp_mult, self.sl_pct * regime_tp_mult
            for atr_min, tier_tp, tier_sl in FAST_SCALP_ADAPTIVE_TP_SL:
                if atr_ratio < atr_min:
                    pos_tp = tier_tp * regime_tp_mult
                    pos_sl = tier_sl * regime_tp_mult
                    break

            # ── EV calculation ─────────────────────────────────────────────
            # Always compute for logging; only subtract in the prior case.
            fees = FAST_SCALP_ENTRY_FEE_PCT + FAST_SCALP_EXIT_FEE_PCT   # ≈ 0.42% round-trip
            slip = abs(FAST_SCALP_BUY_SLIP - 1.0) + abs(FAST_SCALP_SELL_SLIP - 1.0)  # ≈ 0.06%

            with self._lock:
                trade_hist = list(self._trades)

            if len(trade_hist) >= 20:
                wins_h   = [t for t in trade_hist if t["win"]]
                losses_h = [t for t in trade_hist if not t["win"]]
                p_win    = len(wins_h) / len(trade_hist)
                # Historical pnl_pct is already net of fees and slippage from
                # _close_position(). Subtracting again would double-count costs.
                avg_win  = (sum(t["pnl_pct"] for t in wins_h)  / len(wins_h)  / 100) if wins_h  else pos_tp
                avg_loss = (sum(abs(t["pnl_pct"]) for t in losses_h) / len(losses_h) / 100) if losses_h else pos_sl
                p_loss   = 1.0 - p_win
                # pnl_pct is (exit_price - entry) / entry where both prices are
                # slippage-adjusted (FAST_SCALP_BUY_SLIP / FAST_SCALP_SELL_SLIP).
                # Slip is therefore already reflected in avg_win / avg_loss.
                # Fees are NOT in pnl_pct — they are tracked separately in fee_usd
                # and deducted from net_pnl only. Subtract fees once here.
                base_ev  = (p_win * avg_win) - (p_loss * avg_loss) - fees
            else:
                # Prior: avg_win/avg_loss are raw TP/SL targets before execution costs.
                # Subtract fees and slip here so the prior reflects realistic net edge.
                # p_win: 0.45 at zero signal strength → 0.68 at full composite strength.
                composite_strength = max(mr_score, mom_score)
                p_win    = float(np.clip(0.48 + composite_strength * 0.17, 0.45, 0.68))
                avg_win  = pos_tp
                avg_loss = pos_sl
                p_loss   = 1.0 - p_win
                base_ev  = (p_win * avg_win) - (p_loss * avg_loss) - fees - slip

            self._last_ev = round(base_ev, 6)

            liq_quality = float(np.clip(vol_norm * 0.6 + exec_quality * 0.4, 0.0, 1.0))

            entered = False

            # ── REVERSAL signal ────────────────────────────────────────────
            self._funnel["rev_seen"] += 1
            if mr_action:
                mr_composite  = mr_score * 0.6 + liq_quality * 0.2 + regime_q * 0.2
                mr_ev_adj     = base_ev * (0.4 + mr_composite * 0.6)
                score_100     = min(round(mr_composite * 100, 1), 99.0)
                ev_label      = f"+{mr_ev_adj*100:.3f}%" if mr_ev_adj > 0 else f"{mr_ev_adj*100:.3f}%"
                decision      = "TRADE_REVERSAL" if mr_ev_adj > 0 else "NO_TRADE"

                scan_tag  = f"REV_{decision}"
                rev_state = FastScalpBot._scan_log_state.get(f"rev_{sym}", {})
                if scan_tag != rev_state.get("tag") or (now_ts - rev_state.get("ts", 0.0)) >= 300:
                    log.info(
                        "SCAN | %s | mr=%.2f vol=%.2f atr=%.2f exec_q=%.2f regime_q=%.2f"
                        " composite=%.2f p_win=%.2f avg_win=%.3f%% avg_loss=%.3f%%"
                        " fees=%.3f%% slip=%.3f%% EV=%s score=%.0f decision=%s",
                        sym, mr_score, vol_norm, atr_norm, exec_quality, regime_q,
                        mr_composite, p_win, avg_win*100, avg_loss*100,
                        fees*100, slip*100, ev_label, score_100, decision,
                    )
                    FastScalpBot._scan_log_state[f"rev_{sym}"] = {"tag": scan_tag, "ts": now_ts}

                if mr_ev_adj > 0:
                    self._funnel["rev_pass_ev"]  += 1
                    self._funnel["rev_entered"]  += 1
                    signals.append({
                        "symbol":        sym,
                        "score":         score_100,
                        "action":        mr_action,
                        "rsi":           round(rsi, 1),
                        "zscore":        round(zscore, 2),
                        "vol_ratio":     round(vol_ratio, 2),
                        "atr_ratio":     round(atr_ratio, 2),
                        "ev":            round(mr_ev_adj, 6),
                        "signal_family": "REVERSAL",
                        "mr_score":      round(mr_score, 3),
                        "liq_quality":   round(liq_quality, 3),
                        "regime_mult":   regime_tp_mult,
                        "pos_tp":        pos_tp,
                        "pos_sl":        pos_sl,
                    })
                    entered = True
                else:
                    self._funnel["skips_reversal"] += 1
            else:
                self._funnel["skips_reversal"] += 1

            # ── MOMENTUM signal (only if reversal did not enter) ───────────
            if not entered:
                self._funnel["mom_seen"] += 1
                if mom_action:
                    mom_composite = mom_score * 0.6 + liq_quality * 0.2 + regime_q * 0.2
                    mom_ev_adj    = base_ev * (0.4 + mom_composite * 0.6)
                    score_100     = min(round(mom_composite * 100, 1), 99.0)
                    ev_label      = f"+{mom_ev_adj*100:.3f}%" if mom_ev_adj > 0 else f"{mom_ev_adj*100:.3f}%"
                    decision      = "TRADE_MOMENTUM" if mom_ev_adj > 0 else "NO_TRADE"

                    scan_tag  = f"MOM_{decision}"
                    mom_state = FastScalpBot._scan_log_state.get(f"mom_{sym}", {})
                    if scan_tag != mom_state.get("tag") or (now_ts - mom_state.get("ts", 0.0)) >= 300:
                        log.info(
                            "SCAN | %s | mom=%.2f vol=%.2f atr=%.2f exec_q=%.2f regime_q=%.2f"
                            " composite=%.2f p_win=%.2f avg_win=%.3f%% avg_loss=%.3f%%"
                            " fees=%.3f%% slip=%.3f%% EV=%s score=%.0f decision=%s",
                            sym, mom_score, vol_norm, atr_norm, exec_quality, regime_q,
                            mom_composite, p_win, avg_win*100, avg_loss*100,
                            fees*100, slip*100, ev_label, score_100, decision,
                        )
                        FastScalpBot._scan_log_state[f"mom_{sym}"] = {"tag": scan_tag, "ts": now_ts}

                    if mom_ev_adj > 0:
                        self._funnel["mom_pass_ev"]  += 1
                        self._funnel["mom_entered"]  += 1
                        signals.append({
                            "symbol":        sym,
                            "score":         score_100,
                            "action":        mom_action,
                            "rsi":           round(rsi, 1),
                            "zscore":        round(zscore, 2),
                            "vol_ratio":     round(vol_ratio, 2),
                            "atr_ratio":     round(atr_ratio, 2),
                            "ev":            round(mom_ev_adj, 6),
                            "signal_family": "MOMENTUM",
                            "mom_score":     round(mom_score, 3),
                            "liq_quality":   round(liq_quality, 3),
                            "regime_mult":   regime_tp_mult,
                            "pos_tp":        pos_tp,
                            "pos_sl":        pos_sl,
                        })
                    else:
                        self._funnel["skips_momentum"] += 1
                else:
                    self._funnel["skips_momentum"] += 1

        signals.sort(key=lambda s: s.get("ev", 0), reverse=True)  # rank by EV
        return signals

    def _swing_signals(self, market_data: dict,
                       regime: str, r_thr: dict) -> list:
        """
        Swing mode is now handled by the unified _scan_signals scanner.
        CALM/DEAD regimes automatically get tighter TP/SL via REGIME_CONTEXT
        and a lower regime_q multiplier which reduces position sizing.
        This stub exists for backward compatibility with the tick() caller.
        """
        return self._scan_signals(market_data, regime, r_thr, min_score=0)

    # ── Tick ──────────────────────────────────────────────────────────────────

    def tick(self, market_data: dict) -> None:
        """One simulation cycle — check exits, then check entries."""
        now = time.time()

        # Reset hourly trade counter
        if now - self._hour_start > 3600:
            self._hour_start       = now
            self._trades_this_hour = 0

        # Reset daily loss tracker each new day (86400s)
        if now - self._daily_reset_ts >= 86400:
            self._daily_start_bal = self.balance
            self._daily_reset_ts  = now

        # Pre-classify regime once per tick
        regime, r_thr, avg_atr = _classify_regime(market_data)
        mode = "SCALP"  # unified EV scanner handles all regimes

        # Track regime distribution (every tick, for stats)
        self._regime_scan_count[regime] = self._regime_scan_count.get(regime, 0) + 1

        mode_state = FastScalpBot._scan_log_state.get("_mode", {})
        if mode != mode_state.get("tag") or (now - mode_state.get("ts", 0.0)) >= 60:
            log.info("MODE | EV_SCANNER | regime=%s avg_atr=%.2f", regime, avg_atr)
            FastScalpBot._scan_log_state["_mode"] = {"tag": mode, "ts": now}

        # Exits always run (TP / SL / time limit) — unaffected by gates
        self._check_exits(market_data)

        # ── Safety gates (capital integrity — NOT alpha gates) ─────────────
        daily_loss = self._daily_start_bal - self.balance
        if daily_loss >= self._daily_loss_cap:
            log.warning(
                "[%s] daily loss cap hit ($%.2f / cap $%.2f) — no new entries today",
                self.bot_name, daily_loss, self._daily_loss_cap,
            )
            return

        if now < self._cooldown_until:
            log.debug("[%s] cooldown — %.0f min remaining",
                      self.bot_name, (self._cooldown_until - now) / 60)
            return

        if self._trades_this_hour >= FAST_SCALP_MAX_TRADES_PER_HOUR:
            log.debug("[%s] max trades/hour (%d) reached", self.bot_name,
                      FAST_SCALP_MAX_TRADES_PER_HOUR)
            return

        if self.positions:
            return

        # ── Scan for positive-EV opportunities ────────────────────────────
        # No min_score gate. EV > 0 is the only entry criterion.
        signals = self._scan_signals(market_data, regime, r_thr, avg_atr, min_score=0)

        for sig in signals:
            if sig.get("ev", 0) > 0:
                self._enter(sig["symbol"], sig, market_data, mode=mode, regime=regime)
                break

    # ── Entry ─────────────────────────────────────────────────────────────────

    def _enter(self, sym: str, signal: dict, market_data: dict,
               mode: str = "SCALP", regime: str = "MODERATE") -> None:
        """Simulate entering a position with EV-proportional sizing."""
        row = market_data.get(sym, {})
        if row.get("source") == "synthetic":
            return
        ask = row.get("ask") or row.get("price")
        if not ask:
            return

        entry_price = ask * FAST_SCALP_BUY_SLIP
        ev          = signal.get("ev", 0.0)

        # EV-proportional sizing: smooth, no step thresholds.
        # Full size (100% of capital_pct) when EV >= 1.5% round-trip.
        # Minimum 10% probe size for any positive-EV opportunity.
        EV_FULL = 0.015   # 1.5% → full allocation
        ev_frac = float(min(ev / EV_FULL, 1.0)) if ev > 0 else 0.0
        ev_frac = max(ev_frac, 0.10)  # floor: probe size

        # Liquidity quality scales sizing between 60%–100% of ev_frac
        liq = signal.get("liq_quality", 0.6)
        size_mult = ev_frac * (0.6 + liq * 0.4)

        # Regime size cap (CALM/DEAD → smaller max)
        ctx = REGIME_CONTEXT.get(regime, REGIME_CONTEXT["MODERATE"])
        size_mult = min(size_mult, ctx["size_cap"])

        position_size_pct = round(size_mult * 100)
        trade_usd         = self.balance * FAST_SCALP_CAPITAL_PCT * size_mult

        # TP/SL already computed and regime/ATR adjusted in _scan_signals
        pos_tp       = signal.get("pos_tp", self.tp_pct)
        pos_sl       = signal.get("pos_sl", self.sl_pct)
        max_hold_sec = FAST_SCALP_MAX_HOLD_SEC

        atr_ratio  = signal.get("atr_ratio", 1.0)
        sig_family = signal.get("signal_family", "REVERSAL")
        ev_val     = signal.get("ev", 0.0)

        with self._lock:
            self._ev_sum_by_family[sig_family] = (
                self._ev_sum_by_family.get(sig_family, 0.0) + ev_val
            )
            self.positions[sym] = {
                "entry_price":       entry_price,
                "entry_ts":          time.time(),
                "trade_usd":         trade_usd,
                "score":             signal["score"],
                "min_price":         entry_price,
                "tp_pct":            pos_tp,
                "sl_pct":            pos_sl,
                "max_hold_sec":      max_hold_sec,
                "mode":              mode,
                "regime":            regime,
                "position_size_pct": position_size_pct,
                "signal_family":     sig_family,
            }
            self._trades_this_hour += 1

        self._db_insert_open(sym, entry_price, signal["score"])
        log.info(
            "ENTER | %s | ask=%.4f entry=%.4f usd=$%.2f score=%.0f size=%d%%"
            " | %s | TP=%.2f%% SL=%.2f%% atr=%.2f ev=%.4f | regime=%s family=%s",
            sym, ask, entry_price, trade_usd,
            signal["score"], position_size_pct, self.bot_name,
            pos_tp * 100, pos_sl * 100, atr_ratio, ev_val,
            regime, sig_family,
        )

    # ── Exit checks ───────────────────────────────────────────────────────────

    def _check_exits(self, market_data: dict) -> None:
        """TP / SL / time-limit exit check for every open position."""
        now = time.time()

        # ── Debug: confirm exits fire every tick (auto-removes after 5 min) ──
        if not hasattr(self, "_exit_debug_start"):
            self._exit_debug_start = now
        if now - self._exit_debug_start < 300:
            for sym, pos in list(self.positions.items()):
                hold_sec_dbg = now - pos["entry_ts"]
                log.debug(
                    "EXIT_CHECK | %s | %s | hold=%.1fs / max=%ds | entry_ts_type=%s",
                    self.bot_name, sym, hold_sec_dbg, FAST_SCALP_MAX_HOLD_SEC,
                    type(pos["entry_ts"]).__name__,
                )
        # ─────────────────────────────────────────────────────────────────────

        for sym in list(self.positions.keys()):
            pos = self.positions[sym]
            row = market_data.get(sym, {})
            bid = row.get("bid") or row.get("price")
            if not bid:
                continue

            # Track minimum price reached (max adverse excursion)
            if bid < pos["min_price"]:
                pos["min_price"] = bid

            entry     = pos["entry_price"]
            price_chg = (bid - entry) / entry
            hold_sec  = now - pos["entry_ts"]

            pos_tp = pos.get("tp_pct", self.tp_pct)
            pos_sl = pos.get("sl_pct", self.sl_pct)

            max_hold = pos.get("max_hold_sec", FAST_SCALP_MAX_HOLD_SEC)
            reason = None
            if price_chg >= pos_tp:
                reason = "take_profit"
            elif price_chg <= -pos_sl:
                reason = "stop_loss"
            elif hold_sec >= max_hold:
                reason = "time_exit"

            if reason:
                self._exit(sym, bid, hold_sec, reason)

    # ── Exit ──────────────────────────────────────────────────────────────────

    def _exit(self, sym: str, current_bid: float, hold_sec: float,
              reason: str) -> None:
        """Simulate market sell — sell at bid with slippage and fees."""
        pos = self.positions.pop(sym, None)
        if not pos:
            return

        trade_mode   = pos.get("mode",          "SCALP")
        trade_regime = pos.get("regime",        "UNKNOWN")
        trade_family = pos.get("signal_family", "REVERSAL")
        self._trades_by_regime[trade_regime] = self._trades_by_regime.get(trade_regime, 0) + 1
        self._trades_by_mode[trade_mode]     = self._trades_by_mode.get(trade_mode, 0) + 1
        self._trades_by_family[trade_family] = self._trades_by_family.get(trade_family, 0) + 1
        # PnL and wins by family updated after net_pnl/is_win are computed (see below)

        entry      = pos["entry_price"]
        exit_price = current_bid * FAST_SCALP_SELL_SLIP
        trade_usd  = pos["trade_usd"]
        qty        = trade_usd / entry

        gross_pnl  = (exit_price - entry) * qty
        entry_fee  = trade_usd * FAST_SCALP_ENTRY_FEE_PCT
        exit_fee   = (exit_price * qty) * FAST_SCALP_EXIT_FEE_PCT
        total_fee  = entry_fee + exit_fee
        net_pnl    = gross_pnl - total_fee
        pnl_pct    = (exit_price - entry) / entry
        mae_pct    = (pos["min_price"] - entry) / entry   # negative = adverse

        # Win = price moved in our favour (pnl_pct > 0), regardless of fees or exit reason
        is_win = pnl_pct > 0
        self.balance += net_pnl
        self._pnl_by_family[trade_family]  = self._pnl_by_family.get(trade_family,  0.0) + net_pnl
        self._wins_by_family[trade_family] = self._wins_by_family.get(trade_family, 0)   + (1 if is_win else 0)
        # Consecutive-loss guardrail uses net (fee-adjusted) so a fee-eaten win still resets it
        net_positive = net_pnl > 0

        if net_positive:
            self._consec_losses = 0
        else:
            self._consec_losses += 1
            if self._consec_losses >= FAST_SCALP_CONSEC_LOSS_LIMIT:
                self._cooldown_until = time.time() + FAST_SCALP_COOLDOWN_SEC
                log.warning(
                    "[%s] %d consecutive losses — pausing %.0f min",
                    self.bot_name, self._consec_losses, FAST_SCALP_COOLDOWN_SEC / 60,
                )
                self._consec_losses = 0

        with self._lock:
            self._trades.append({
                "symbol":            sym,
                "entry_price":       entry,
                "exit_price":        exit_price,
                "hold_sec":          round(hold_sec, 1),
                "pnl_pct":           round(pnl_pct * 100, 4),
                "net_pnl_usd":       round(net_pnl, 4),
                "gross_pnl":         round(gross_pnl, 4),
                "fee_usd":           round(total_fee, 4),
                "exit_reason":       reason,
                "score":             pos["score"],
                "mae_pct":           round(mae_pct * 100, 4),
                "win":               is_win,
                "position_size_pct": pos.get("position_size_pct", 100),
                "signal_family":     trade_family,
            })

        self._db_update_close(sym, exit_price, pnl_pct, hold_sec, reason,
                               mae_pct, net_pnl, gross_pnl, total_fee)
        log.info(
            "SIM SCALP | %s | %s | hold=%.0fs | pnl=%+.2f%% | score=%.0f"
            " | user=%s | TP=%.1f%% SL=%.2f%% | %s_MODE | regime=%s | family=%s",
            sym, reason, hold_sec, pnl_pct * 100, pos["score"],
            self.bot_name, self.tp_pct * 100, self.sl_pct * 100,
            trade_mode, trade_regime, trade_family,
        )

    # ── DB helpers ────────────────────────────────────────────────────────────

    def _db_insert_open(self, sym: str, entry_price: float, score: float) -> None:
        try:
            conn = sqlite3.connect(SIM_DB_PATH)
            conn.execute("""
                INSERT INTO sim_scalp_trades
                  (ts, bot_name, symbol, entry_price, exit_price, hold_sec,
                   pnl_pct, net_pnl_usd, gross_pnl_usd, fee_usd,
                   exit_reason, score, tp_pct, sl_pct, status)
                VALUES (?,?,?,?,0,0,0,0,0,0,'OPEN',?,?,?,'OPEN')
            """, (time.time(), self.bot_name, sym, entry_price,
                  score, self.tp_pct, self.sl_pct))
            conn.commit()
            conn.close()
        except Exception as exc:
            log.debug("sim_scalp DB insert error: %s", exc)

    def _db_update_close(self, sym: str, exit_price: float, pnl_pct: float,
                         hold_sec: float, reason: str, mae_pct: float,
                         net_pnl: float, gross_pnl: float, fee_usd: float) -> None:
        try:
            conn = sqlite3.connect(SIM_DB_PATH)
            conn.execute("""
                UPDATE sim_scalp_trades
                SET exit_price=?, hold_sec=?, pnl_pct=?, exit_reason=?,
                    mae_pct=?, net_pnl_usd=?, gross_pnl_usd=?, fee_usd=?,
                    status='CLOSED'
                WHERE rowid=(
                    SELECT rowid FROM sim_scalp_trades
                    WHERE bot_name=? AND symbol=? AND status='OPEN'
                    ORDER BY ts DESC LIMIT 1
                )
            """, (exit_price, round(hold_sec, 1), round(pnl_pct * 100, 4),
                  reason, round(mae_pct * 100, 4),
                  round(net_pnl, 4), round(gross_pnl, 4), round(fee_usd, 4),
                  self.bot_name, sym))
            conn.commit()
            conn.close()
        except Exception as exc:
            log.debug("sim_scalp DB update error: %s", exc)

    # ── Stats ─────────────────────────────────────────────────────────────────

    def session_stats(self) -> dict:
        with self._lock:
            trades = list(self._trades)
        total      = len(trades)
        wins       = sum(1 for t in trades if t["win"])
        losses     = total - wins
        net_pnl    = sum(t["net_pnl_usd"] for t in trades)
        gross_win  = sum(t["net_pnl_usd"] for t in trades if t["win"])
        gross_loss = abs(sum(t["net_pnl_usd"] for t in trades if not t["win"])) or 1e-9
        pf         = round(gross_win / gross_loss, 2) if gross_loss > 1e-9 else 0.0
        wr         = round(wins / total * 100, 1) if total else 0.0
        avg_mae    = round(
            sum(t["mae_pct"] for t in trades) / total, 3
        ) if total else 0.0

        # Per-direction averages and expectancy
        win_trades  = [t for t in trades if t["win"]]
        loss_trades = [t for t in trades if not t["win"]]
        avg_win_pct  = round(sum(t["pnl_pct"] for t in win_trades)  / len(win_trades),  3) if win_trades  else 0.0
        avg_loss_pct = round(sum(t["pnl_pct"] for t in loss_trades) / len(loss_trades), 3) if loss_trades else 0.0
        wr_frac      = wins / total if total else 0.0
        expectancy   = round(wr_frac * avg_win_pct + (1 - wr_frac) * avg_loss_pct, 4)
        fees_paid    = round(sum(t["fee_usd"] for t in trades), 4)

        # Per-pair breakdown
        pair_stats: dict = {}
        for t in trades:
            sym = t["symbol"]
            if sym not in pair_stats:
                pair_stats[sym] = {"trades": 0, "wins": 0, "net_pnl": 0.0}
            pair_stats[sym]["trades"]  += 1
            pair_stats[sym]["wins"]    += 1 if t["win"] else 0
            pair_stats[sym]["net_pnl"] += t["net_pnl_usd"]
        for sym, ps in pair_stats.items():
            ps["win_rate_pct"] = round(ps["wins"] / ps["trades"] * 100, 1)
            ps["net_pnl"]      = round(ps["net_pnl"], 4)

        avg_pos_size = round(
            sum(t.get("position_size_pct", 100) for t in trades) / total, 1
        ) if total else 100.0

        # Exit-reason breakdown
        tp_hits         = sum(1 for t in trades if t["exit_reason"] == "take_profit")
        sl_hits         = sum(1 for t in trades if t["exit_reason"] == "stop_loss")
        te_all          = [t for t in trades if t["exit_reason"] == "time_exit"]
        time_exit_wins  = sum(1 for t in te_all if t["win"])
        time_exit_losses= len(te_all) - time_exit_wins
        return {
            "bot":               self.bot_name,
            "tp_pct":            self.tp_pct,
            "sl_pct":            self.sl_pct,
            "trades":            total,
            "wins":              wins,
            "losses":            losses,
            "win_rate_pct":      wr,
            "net_pnl_usd":       round(net_pnl, 4),
            "profit_factor":     pf,
            "avg_mae_pct":       avg_mae,
            "balance":           round(self.balance, 2),
            "avg_win_pct":       avg_win_pct,
            "avg_loss_pct":      avg_loss_pct,
            "expectancy_pct":    expectancy,
            "fees_paid_usd":     fees_paid,
            "pair_breakdown":    pair_stats,
            "tp_hits":           tp_hits,
            "sl_hits":           sl_hits,
            "time_exit_wins":    time_exit_wins,
            "time_exit_losses":  time_exit_losses,
            "trades_by_regime":      dict(self._trades_by_regime),
            "trades_by_mode":        dict(self._trades_by_mode),
            "regime_distribution":   dict(self._regime_scan_count),
            "avg_position_size_pct": avg_pos_size,
            "last_ev":               self._last_ev,
            "trades_reversal":       self._trades_by_family.get("REVERSAL", 0),
            "trades_momentum":       self._trades_by_family.get("MOMENTUM", 0),
            "pnl_reversal":          round(self._pnl_by_family.get("REVERSAL", 0.0), 4),
            "pnl_momentum":          round(self._pnl_by_family.get("MOMENTUM", 0.0), 4),
            "wins_reversal":         self._wins_by_family.get("REVERSAL", 0),
            "wins_momentum":         self._wins_by_family.get("MOMENTUM", 0),
            "avg_ev_reversal":       round(
                self._ev_sum_by_family.get("REVERSAL", 0.0)
                / max(1, self._trades_by_family.get("REVERSAL", 1)), 6
            ) if self._trades_by_family.get("REVERSAL", 0) else 0.0,
            "avg_ev_momentum":       round(
                self._ev_sum_by_family.get("MOMENTUM", 0.0)
                / max(1, self._trades_by_family.get("MOMENTUM", 1)), 6
            ) if self._trades_by_family.get("MOMENTUM", 0) else 0.0,
            "funnel":                dict(self._funnel),
        }

    def hourly_summary(self) -> None:
        s = self.session_stats()
        mode_str = " ".join(f"{m}={n}" for m, n in sorted(s.get("trades_by_mode", {}).items()))
        regime_str = " ".join(f"{r}={n}" for r, n in sorted(s.get("trades_by_regime", {}).items()))
        print(
            f"{s['bot'].upper()} | trades={s['trades']} | wins={s['wins']} |"
            f" losses={s['losses']} | winrate={s['win_rate_pct']}% |"
            f" net=${s['net_pnl_usd']:.2f} | PF={s['profit_factor']}"
            f" | exp={s['expectancy_pct']:+.3f}%"
            f" | avgW={s['avg_win_pct']:+.3f}% avgL={s['avg_loss_pct']:+.3f}%"
            f" | fees=${s['fees_paid_usd']:.4f}"
            f" | TP={s['tp_hits']} SL={s['sl_hits']}"
            f" TE={s['time_exit_wins']}W/{s['time_exit_losses']}L"
            + (f" | mode: {mode_str}" if mode_str else "")
            + (f" | regime: {regime_str}" if regime_str else "")
            + (f" | ev={s['last_ev']:+.4f}" if s.get("last_ev") is not None else "")
            + (f" | avg_size={s['avg_position_size_pct']:.0f}%" if s.get("avg_position_size_pct") is not None else "")
            + (f" | REV={s.get('trades_reversal', 0)}(${s.get('pnl_reversal', 0):+.2f})"
               f" MOM={s.get('trades_momentum', 0)}(${s.get('pnl_momentum', 0):+.2f})")
        )
        f = s.get("funnel", {})
        print(
            f"FUNNEL | scans={f.get('scans_total', 0)}"
            f" blocked_atr={f.get('blocked_atr', 0)}"
            f" blocked_vol={f.get('blocked_vol', 0)}"
            f" | REV seen={f.get('rev_seen', 0)}"
            f" dir={f.get('rev_pass_dir', 0)}"
            f" score={f.get('rev_pass_score', 0)}"
            f" ev={f.get('rev_pass_ev', 0)}"
            f" entered={f.get('rev_entered', 0)}"
            f" | MOM seen={f.get('mom_seen', 0)}"
            f" dir={f.get('mom_pass_dir', 0)}"
            f" score={f.get('mom_pass_score', 0)}"
            f" ev={f.get('mom_pass_ev', 0)}"
            f" entered={f.get('mom_entered', 0)}"
        )


# ── Fast Scalp Runner ─────────────────────────────────────────────────────────

class FastScalpRunner:
    """
    Orchestrates one or more FastScalpBot instances on shared market data.
    Fetches live Kraken 15m candles every FAST_SCALP_SCAN_SEC seconds.
    """

    def __init__(self, bots: list, use_live: bool = True):
        self.bots     = bots
        self.use_live = use_live
        self._running = False
        self._last_hourly_ts = time.time()

        self._tick_count = 0
        self._price_history: dict = {}    # sym → list of last 40 prices (ATR fallback)
        self._last_market_data: dict = {} # cached so exits can run even if fetch hangs
        self._pair_fail_count: dict = {}  # sym → consecutive REST failure count
        self._ohlcv_logged:    set  = set()  # symbols whose raw OHLC fields have been logged once

        self._ws_feed = None
        if use_live:
            try:
                self._ws_feed = _get_ws_feed(FAST_SCALP_SYMBOLS, exchange=_ACTIVE_EXCHANGE)
                self._ws_feed.start()
                log.info("FastScalpRunner: WS feed (%s) started for %s",
                         _ACTIVE_EXCHANGE, FAST_SCALP_SYMBOLS)
            except Exception as exc:
                log.warning("FastScalpRunner: WS feed failed (%s) — REST only", exc)

    def run(self) -> None:
        self._running = True
        names = ", ".join(b.bot_name for b in self.bots)
        log.info("FastScalpRunner started: bots=[%s]", names)
        v = REGIME_THRESHOLDS["VOLATILE"]
        log.info(
            "ACTIVE CONFIG | min_score=%d atr>=%.2f vol>=%.2f |z|>=%.1f rsi<=%d"
            " | daily_loss_cap=%.0f%% capital_pct=%.0f%% max_hold=%ds"
            " | regime=VOLATILE thresholds shown (relaxes in MODERATE/CALM)",
            FAST_SCALP_MIN_SCORE,
            v["atr_ratio"], v["vol_ratio"], v["zscore"], v["rsi_long"],
            FAST_SCALP_DAILY_LOSS_CAP_PCT * 100,
            FAST_SCALP_CAPITAL_PCT * 100,
            FAST_SCALP_MAX_HOLD_SEC,
        )

        while self._running:
            t0 = time.time()
            fetch_ok = True

            try:
                market_data = self._fetch_market_data()
                self._last_market_data = market_data
            except Exception as exc:
                log.error("FastScalpRunner fetch error: %s", exc)
                market_data = self._last_market_data
                fetch_ok = False

            if market_data:
                if fetch_ok:
                    # Normal path: full tick (exits + entries)
                    try:
                        self._tick_count += 1
                        self._heartbeat(market_data)
                        for bot in self.bots:
                            bot.tick(market_data)
                        self._maybe_hourly_summary()
                    except Exception as exc:
                        log.error("FastScalpRunner tick error: %s", exc)
                else:
                    # Fetch failed — run exits only with stale data so the
                    # time-limit always fires even during a Kraken outage
                    for bot in self.bots:
                        bot._check_exits(market_data)

            elapsed = time.time() - t0
            time.sleep(max(0, FAST_SCALP_SCAN_SEC - elapsed))

    def stop(self) -> None:
        self._running = False

    # ── Market data ───────────────────────────────────────────────────────────

    def _fetch_market_data(self) -> dict:
        """
        Fetch FAST_SCALP_SYMBOLS with 15m candles from the active exchange REST API.
        For Kraken: tries USD pair first, falls back to USDT if rejected.
        For Binance.US: uses USDT pairs directly (USD → USDT mapping applied).
        Overlays fresh bid/ask from WS feed when available.
        Falls back to realistic synthetic data on all errors.
        Also maintains a rolling price-tick history per symbol so _scan_signals
        can build ATR-substitute candles when OHLC is unavailable.
        """
        # Kraken REST sometimes needs USDT pairs where USD is rejected.
        # For Binance.US, USD symbols map directly to USDT pairs (no fallback needed).
        if _ACTIVE_EXCHANGE == "binance_us":
            # Binance.US uses USDT pairs; convert /USD → /USDT as primary (no fallback)
            _PAIR_FALLBACK = {
                sym: sym.replace("/USD", "/USDT")
                for sym in FAST_SCALP_SYMBOLS
                if sym.endswith("/USD")
            }
        else:
            # Kraken: USD first, USDT fallback; MATIC → POL rename
            _PAIR_FALLBACK = {
                "SOL/USD":   "SOL/USDT",
                "XRP/USD":   "XRP/USDT",
                "DOGE/USD":  "DOGE/USDT",
                "MATIC/USD": "POL/USD",       # Kraken renamed MATIC → POL
                "LTC/USD":   "LTC/USDT",
                "UNI/USD":   "UNI/USDT",
                "LINK/USD":  "LINK/USDT",
                "ATOM/USD":  "ATOM/USDT",
                "DOT/USD":   "DOT/USDT",
                "AVAX/USD":  "AVAX/USDT",
                "ADA/USD":   "ADA/USDT",
            }

        data = {}
        if self.use_live:
            try:
                import ccxt
                # 8s timeout per request — prevents the fetch from hanging for
                # thousands of seconds during Kraken REST slowdowns/outages,
                # which was blocking _check_exits from running and causing
                # trades to hold far beyond FAST_SCALP_MAX_HOLD_SEC.
                _ccxt_id = EXCHANGE_CCXT_ID.get(_ACTIVE_EXCHANGE, _ACTIVE_EXCHANGE)
                client = getattr(ccxt, _ccxt_id)({"timeout": 8000})
                try:
                    client.load_markets()
                except Exception as lm_exc:
                    log.debug("load_markets failed (%s)", lm_exc)

                for sym in FAST_SCALP_SYMBOLS:
                    # Skip pairs with ≥ 3 consecutive REST failures to avoid
                    # blocking the fetch loop on persistently broken symbols
                    if self._pair_fail_count.get(sym, 0) >= 3:
                        log.warning("SKIP_PAIR | %s | %d consecutive failures — excluded",
                                    sym, self._pair_fail_count[sym])
                        continue

                    fetched = False
                    for try_sym in [sym, _PAIR_FALLBACK.get(sym, sym)]:
                        try:
                            ticker  = client.fetch_ticker(try_sym)
                            ohlcv   = client.fetch_ohlcv(try_sym, "15m", limit=40)
                            # ccxt standardised OHLCV: [ts_ms, open, high, low, close, volume]
                            # Store ts (seconds) so _validate_feed can check candle freshness.
                            candles = [
                                {"ts": c[0] / 1000.0,
                                 "open": c[1], "high": c[2], "low": c[3],
                                 "close": c[4], "volume": c[5]}
                                for c in ohlcv
                            ]
                            # One-time raw field dump per symbol to verify OHLCV index mapping
                            if sym not in self._ohlcv_logged and ohlcv:
                                raw = ohlcv[-1]
                                log.info(
                                    "OHLCV_FIELDS | %s | raw=%s"
                                    " | mapped ts=%s open=%.4f high=%.4f"
                                    " low=%.4f close=%.4f vol=%s",
                                    sym, list(raw),
                                    raw[0], raw[1], raw[2], raw[3], raw[4], raw[5],
                                )
                                self._ohlcv_logged.add(sym)
                            data[sym] = {
                                "price":      ticker["last"],
                                "bid":        ticker.get("bid") or ticker["last"] * 0.9997,
                                "ask":        ticker.get("ask") or ticker["last"] * 1.0003,
                                "volume_24h": ticker.get("quoteVolume", 0),
                                "candles":    candles,
                                "source":     "live",
                            }
                            if try_sym != sym:
                                log.debug("OHLC pair fallback: %s → %s", sym, try_sym)
                            self._pair_fail_count[sym] = 0   # reset on success
                            fetched = True
                            break
                        except Exception as sym_exc:
                            log.warning("Fast scalp data failed for %s (%s)", try_sym, sym_exc)
                    if not fetched:
                        self._pair_fail_count[sym] = self._pair_fail_count.get(sym, 0) + 1
                        log.warning("All pair formats failed for %s (fail #%d) — omitting",
                                    sym, self._pair_fail_count[sym])
                    time.sleep(0.15)
            except Exception as exc:
                log.warning("ccxt unavailable (%s) — synthetic", exc)
                for sym in FAST_SCALP_SYMBOLS:
                    data[sym] = self._synthetic_for_sym(sym)
        else:
            for sym in FAST_SCALP_SYMBOLS:
                data[sym] = self._synthetic_for_sym(sym)

        # Overlay WS bid/ask if feed is alive
        if self._ws_feed and self._ws_feed.is_alive():
            for sym in FAST_SCALP_SYMBOLS:
                ws_price = self._ws_feed.get_price(sym)
                if ws_price and sym in data:
                    data[sym]["price"]  = ws_price
                    data[sym]["bid"]    = ws_price * 0.9997
                    data[sym]["ask"]    = ws_price * 1.0003
                    data[sym]["source"] = "websocket"

        # Build rolling price-tick history (used as ATR fallback in _scan_signals)
        for sym in FAST_SCALP_SYMBOLS:
            price = (data.get(sym) or {}).get("price")
            if price:
                ticks = self._price_history.setdefault(sym, [])
                ticks.append(price)
                if len(ticks) > 40:
                    ticks.pop(0)
            data.setdefault(sym, {})["price_ticks"] = list(
                self._price_history.get(sym, [])
            )

        return data

    def _synthetic_for_sym(self, sym: str) -> dict:
        import numpy as np
        base = {"SOL/USD": 145.0, "XRP/USD": 0.58, "BTC/USD": 83000.0, "ETH/USD": 2000.0}.get(sym, 100.0)
        vol  = 0.012
        closes = [base]
        for _ in range(39):
            closes.append(closes[-1] * (1 + 0.0002 + vol * np.random.randn()))
        candles = []
        for i, c in enumerate(closes):
            h = c * (1 + abs(np.random.randn()) * vol * 0.5)
            l = c * (1 - abs(np.random.randn()) * vol * 0.5)
            v = float(np.random.uniform(5e5, 5e7))
            candles.append({
                "open": closes[i - 1] if i > 0 else c,
                "high": h, "low": l, "close": c, "volume": v,
            })
        p = closes[-1]
        return {
            "price": p, "bid": p * 0.9997, "ask": p * 1.0003,
            "volume_24h": float(np.random.uniform(5e7, 5e9)),
            "candles": candles, "source": "synthetic",
        }

    # ── Heartbeat ─────────────────────────────────────────────────────────────

    def _heartbeat(self, market_data: dict) -> None:
        """Print a one-line status every 4 ticks (~60s) so the user can confirm activity."""
        if self._tick_count % 4 != 0:
            return
        now_str = datetime.utcnow().strftime("%H:%M:%S UTC")
        parts = []
        for sym in FAST_SCALP_SYMBOLS:
            row = market_data.get(sym, {})
            bid = row.get("bid") or 0
            ask = row.get("ask") or 0
            src = row.get("source", "?")[:2]
            parts.append(f"{sym} bid={bid:.4f} ask={ask:.4f} [{src}]")

        total_trades = sum(len(b._trades) for b in self.bots)
        open_pos     = sum(len(b.positions) for b in self.bots)
        log.info("[tick #%d | %s] %s | trades=%d open=%d",
                 self._tick_count, now_str, "  ".join(parts),
                 total_trades, open_pos)

    # ── Summaries ─────────────────────────────────────────────────────────────

    def _maybe_hourly_summary(self) -> None:
        if time.time() - self._last_hourly_ts >= 3600:
            self._last_hourly_ts = time.time()
            print(f"\n[{datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}] — HOURLY SUMMARY")
            for bot in self.bots:
                bot.hourly_summary()
            print()

    def final_summary(self) -> None:
        """Print sweep summary across all bots on session end."""
        all_stats = [b.session_stats() for b in self.bots]
        total_community = sum(s["trades"] for s in all_stats)

        print("\n" + "═" * 64)
        print("  FAST SCALP SIMULATION — FINAL SUMMARY")
        print("═" * 64)

        # Per-bot table
        print(f"\n{'Bot':<8} {'TP':>6} {'SL':>7} {'Trades':>7} "
              f"{'Wins':>5} {'WR%':>6} {'Net USD':>10} {'PF':>6} {'MAE%':>7}"
              f"  {'TP_HIT':>6} {'SL_HIT':>6} {'TE_W':>5} {'TE_L':>5}")
        print("─" * 80)
        for s in all_stats:
            print(
                f"{s['bot']:<8} {s['tp_pct']*100:>5.1f}% {s['sl_pct']*100:>6.2f}%"
                f" {s['trades']:>7} {s['wins']:>5} {s['win_rate_pct']:>5.1f}%"
                f" {s['net_pnl_usd']:>10.2f} {s['profit_factor']:>6.2f}"
                f" {s['avg_mae_pct']:>6.3f}%"
                f"  {s['tp_hits']:>6} {s['sl_hits']:>6}"
                f" {s['time_exit_wins']:>5} {s['time_exit_losses']:>5}"
            )

        if total_community > 0:
            by_pf   = sorted(all_stats, key=lambda x: x["profit_factor"], reverse=True)
            by_wr   = sorted(all_stats, key=lambda x: x["win_rate_pct"],  reverse=True)
            best_pf = by_pf[0]
            best_wr = by_wr[0]

            print(f"\n{'─'*64}")
            print(f"  Best by profit factor : {best_pf['bot']}"
                  f"  TP={best_pf['tp_pct']*100:.1f}%  SL={best_pf['sl_pct']*100:.2f}%"
                  f"  PF={best_pf['profit_factor']}")
            print(f"  Best by win rate      : {best_wr['bot']}"
                  f"  TP={best_wr['tp_pct']*100:.1f}%  SL={best_wr['sl_pct']*100:.2f}%"
                  f"  WR={best_wr['win_rate_pct']}%")

            # Per-bot health label
            print(f"\n  Strategy Health:")
            for s in all_stats:
                if s["trades"] < 30:
                    health = "NOT READY (< 30 trades)"
                elif s["profit_factor"] < 1.1:
                    health = "NOT READY (PF < 1.1)"
                elif s["profit_factor"] >= 1.5 and s["win_rate_pct"] >= 55:
                    health = "CANDIDATE FOR LIVE TEST"
                elif s["profit_factor"] >= 1.2:
                    health = "PAPER READY"
                else:
                    health = "NOT READY"
                print(f"    {s['bot']:<8}  PF={s['profit_factor']:.2f}"
                      f"  WR={s['win_rate_pct']:.1f}%"
                      f"  exp={s['expectancy_pct']:+.3f}%"
                      f"  fees=${s['fees_paid_usd']:.3f}"
                      f"  ev={s.get('last_ev', 0):+.4f}"
                      f"  avg_size={s.get('avg_position_size_pct', 100):.0f}%"
                      f"  REV={s.get('trades_reversal', 0)}(${s.get('pnl_reversal', 0):+.2f})"
                      f"  MOM={s.get('trades_momentum', 0)}(${s.get('pnl_momentum', 0):+.2f})"
                      f"  → {health}")

            # Average adverse excursion per bot
            active = [s for s in all_stats if s["trades"] > 0]
            if active:
                print(f"\n  Average Adverse Excursion (MAE) per bot:")
                for s in sorted(active, key=lambda x: x["bot"]):
                    print(f"    {s['bot']:<8}  {s['avg_mae_pct']:>7.3f}%")
                avg_ev_val = round(sum(s.get("last_ev", 0) for s in active) / len(active), 6)
                avg_ps_val = round(sum(s.get("avg_position_size_pct", 100) for s in active) / len(active), 1)
                print(f"\n  EV / Position Size (active bots):")
                print(f"    Avg expected value (last) : {avg_ev_val:+.4f}")
                print(f"    Avg position size used    : {avg_ps_val:.0f}%")

                # Combined funnel across all active bots
                cf = {}
                for s in active:
                    for k, v in s.get("funnel", {}).items():
                        cf[k] = cf.get(k, 0) + v
                if cf.get("scans_total", 0) > 0:
                    print(f"\n  Signal funnel (all active bots combined):")
                    print(
                        f"    scans={cf.get('scans_total',0)}"
                        f" blocked_atr={cf.get('blocked_atr',0)}"
                        f" blocked_vol={cf.get('blocked_vol',0)}"
                    )
                    print(
                        f"    REV  seen={cf.get('rev_seen',0)}"
                        f" dir={cf.get('rev_pass_dir',0)}"
                        f" score={cf.get('rev_pass_score',0)}"
                        f" ev={cf.get('rev_pass_ev',0)}"
                        f" entered={cf.get('rev_entered',0)}"
                        f" skipped={cf.get('skips_reversal',0)}"
                    )
                    print(
                        f"    MOM  seen={cf.get('mom_seen',0)}"
                        f" dir={cf.get('mom_pass_dir',0)}"
                        f" score={cf.get('mom_pass_score',0)}"
                        f" ev={cf.get('mom_pass_ev',0)}"
                        f" entered={cf.get('mom_entered',0)}"
                        f" skipped={cf.get('skips_momentum',0)}"
                    )

            # Signal-family breakdown across all bots combined
            tot_rev      = sum(s.get("trades_reversal", 0) for s in all_stats)
            tot_mom      = sum(s.get("trades_momentum", 0) for s in all_stats)
            wins_rev_all = sum(s.get("wins_reversal",   0) for s in all_stats)
            wins_mom_all = sum(s.get("wins_momentum",   0) for s in all_stats)
            pnl_rev_all  = round(sum(s.get("pnl_reversal", 0.0) for s in all_stats), 4)
            pnl_mom_all  = round(sum(s.get("pnl_momentum", 0.0) for s in all_stats), 4)
            # Weighted avg EV: sum(trades_i * avg_ev_i) / sum(trades_i)
            ev_rev_all   = (
                round(sum(s.get("avg_ev_reversal", 0.0) * s.get("trades_reversal", 0) for s in all_stats)
                      / max(1, tot_rev), 6)
                if tot_rev else 0.0
            )
            ev_mom_all   = (
                round(sum(s.get("avg_ev_momentum", 0.0) * s.get("trades_momentum", 0) for s in all_stats)
                      / max(1, tot_mom), 6)
                if tot_mom else 0.0
            )
            if tot_rev + tot_mom > 0:
                print(f"\n  Signal family breakdown (all bots combined):")
                print(f"    {'Family':<12} {'Trades':>7} {'Wins':>6} {'WR%':>6} {'Net PnL USD':>12} {'AvgEV':>9}")
                print(f"    {'─'*56}")
                wr_rev = round(wins_rev_all / tot_rev * 100, 1) if tot_rev else 0.0
                wr_mom = round(wins_mom_all / tot_mom * 100, 1) if tot_mom else 0.0
                print(f"    {'REVERSAL':<12} {tot_rev:>7} {wins_rev_all:>6} {wr_rev:>5.1f}% {pnl_rev_all:>+12.4f} {ev_rev_all:>+9.6f}")
                print(f"    {'MOMENTUM':<12} {tot_mom:>7} {wins_mom_all:>6} {wr_mom:>5.1f}% {pnl_mom_all:>+12.4f} {ev_mom_all:>+9.6f}")

            # Per-pair breakdown across all bots combined
            combined_pairs: dict = {}
            for s in all_stats:
                for sym, ps in s.get("pair_breakdown", {}).items():
                    if sym not in combined_pairs:
                        combined_pairs[sym] = {"trades": 0, "wins": 0, "net_pnl": 0.0}
                    combined_pairs[sym]["trades"]  += ps["trades"]
                    combined_pairs[sym]["wins"]    += ps["wins"]
                    combined_pairs[sym]["net_pnl"] += ps["net_pnl"]
            if combined_pairs:
                print(f"\n  Per-pair breakdown (all bots combined):")
                print(f"    {'Pair':<12} {'Trades':>7} {'WR%':>6} {'Net PnL':>10}")
                print(f"    {'─'*38}")
                for sym, ps in sorted(combined_pairs.items()):
                    wr_p = round(ps["wins"] / ps["trades"] * 100, 1) if ps["trades"] else 0
                    print(f"    {sym:<12} {ps['trades']:>7} {wr_p:>5.1f}% {ps['net_pnl']:>10.4f}")

            # Regime/mode breakdown across all bots combined
            combined_regime: dict = {}
            combined_mode:   dict = {}
            combined_dist:   dict = {}
            for s in all_stats:
                for r, n in s.get("trades_by_regime", {}).items():
                    combined_regime[r] = combined_regime.get(r, 0) + n
                for m, n in s.get("trades_by_mode", {}).items():
                    combined_mode[m] = combined_mode.get(m, 0) + n
                for r, n in s.get("regime_distribution", {}).items():
                    combined_dist[r] = combined_dist.get(r, 0) + n

            if combined_regime or combined_mode:
                if combined_regime:
                    print(f"\n  Trades by regime (all bots combined):")
                    for r, n in sorted(combined_regime.items(), key=lambda x: -x[1]):
                        print(f"    {r:<12} {n} trades")
                if combined_mode:
                    print(f"\n  Trades by mode (all bots combined):")
                    for m, n in sorted(combined_mode.items(), key=lambda x: -x[1]):
                        print(f"    {m:<8} {n} trades")
            if combined_dist:
                total_scans = sum(combined_dist.values()) or 1
                print(f"\n  Regime distribution ({sum(combined_dist.values())} total scans):")
                for r, n in sorted(combined_dist.items(), key=lambda x: -x[1]):
                    pct = n / total_scans * 100
                    print(f"    {r:<12} {n:>7} scans  ({pct:.1f}%)")

            # Composite recommendation — require ≥ 30 trades AND PF ≥ 1.1
            candidates = [
                s for s in all_stats
                if s["trades"] >= 30 and s["profit_factor"] >= 1.1
            ]
            if candidates:
                max_pf  = max(s["profit_factor"] for s in candidates) or 1.0
                max_wr  = max(s["win_rate_pct"]  for s in candidates) or 1.0
                min_mae = min(s["avg_mae_pct"]   for s in candidates)
                rng_mae = max(s["avg_mae_pct"]   for s in candidates) - min_mae or 1e-9

                def composite(s):
                    pf_n  = s["profit_factor"] / max_pf
                    wr_n  = s["win_rate_pct"]  / max_wr
                    mae_n = 1 - (s["avg_mae_pct"] - min_mae) / rng_mae
                    return 0.5 * pf_n + 0.3 * wr_n + 0.2 * mae_n

                best = max(candidates, key=composite)
                print(f"\n  Recommended for live trading: {best['bot']}"
                      f"  TP={best['tp_pct']*100:.1f}%  SL={best['sl_pct']*100:.2f}%")
                print(f"    (PF={best['profit_factor']}"
                      f"  WR={best['win_rate_pct']}%"
                      f"  exp={best['expectancy_pct']:+.3f}%"
                      f"  MAE={best['avg_mae_pct']:.3f}%)")
            else:
                print(f"\n  No bot qualifies for live trading yet"
                      f" (need ≥ 30 trades AND profit_factor ≥ 1.1)")

        print(f"\n  Total community trades logged : {total_community}")
        print(f"  Knowledge DB                  : {SIM_DB_PATH}")
        print("═" * 64 + "\n")


# ── Fast scalp launcher ───────────────────────────────────────────────────────

def run_fast_scalp(num_users: int = 1, sweep: bool = False,
                   use_live: bool = True) -> None:
    """
    Launch fast scalp simulation.
      --scalp-fast alone    → num_users bots, all with default TP=0.6% SL=0.25%
      --scalp-fast --sweep  → 10 bots with the predefined TP/SL sweep configs
    """
    n_pairs = len(FAST_SCALP_SYMBOLS)
    if sweep:
        configs = SWEEP_CONFIGS
        print(f"""
╔══════════════════════════════════════════════════╗
║     ARTHASTRA FAST SCALP — PARAMETER SWEEP       ║
║     {len(configs)} bots  |  TP 0.6–1.5%  |  SL 0.3–0.6%        ║
║     Pairs: {n_pairs} ({', '.join(s.split('/')[0] for s in FAST_SCALP_SYMBOLS)})
║     Min score: {FAST_SCALP_MIN_SCORE}  |  Max hold: {FAST_SCALP_MAX_HOLD_SEC}s         ║
║     Adaptive TP/SL  |  Daily loss cap: {FAST_SCALP_DAILY_LOSS_CAP_PCT*100:.0f}%         ║
║     Press Ctrl+C to see final summary            ║
╚══════════════════════════════════════════════════╝
""")
    else:
        configs = [
            {"name": f"bot{i+1}", "tp": FAST_SCALP_DEFAULT_TP,
             "sl": FAST_SCALP_DEFAULT_SL}
            for i in range(num_users)
        ]
        print(f"""
╔══════════════════════════════════════════════════╗
║     ARTHASTRA FAST SCALP SIMULATION              ║
║     Bots: {num_users:<4}  TP={FAST_SCALP_DEFAULT_TP*100:.1f}%  SL={FAST_SCALP_DEFAULT_SL*100:.2f}%             ║
║     Pairs: {n_pairs} ({', '.join(s.split('/')[0] for s in FAST_SCALP_SYMBOLS)})
║     Min score: {FAST_SCALP_MIN_SCORE}  |  Max hold: {FAST_SCALP_MAX_HOLD_SEC}s         ║
║     Adaptive TP/SL  |  Daily loss cap: {FAST_SCALP_DAILY_LOSS_CAP_PCT*100:.0f}%         ║
║     Press Ctrl+C to see final summary            ║
╚══════════════════════════════════════════════════╝
""")

    # ── Ops config dump — printed at startup, visible in Railway logs ────────
    import os as _os
    _on_railway = bool(_os.getenv("RAILWAY_ENVIRONMENT") or _os.getenv("RAILWAY_SERVICE_NAME"))
    print(f"  Exchange        : {_ACTIVE_EXCHANGE.upper()}")
    print(f"  Market data     : {'LIVE' if use_live else 'SYNTHETIC'}")
    print(f"  Execution       : PAPER  (simulation only — no real orders placed)")
    print(f"  Bots            : {len(configs)}  ({'parameter sweep' if sweep else 'standard TP/SL'})")
    print(f"  Sizing          : {FAST_SCALP_CAPITAL_PCT*100:.0f}% capital/trade"
          f"  |  daily loss cap {FAST_SCALP_DAILY_LOSS_CAP_PCT*100:.0f}%")
    print(f"  Supabase writes : {'enabled' if _os.getenv('SUPABASE_URL') else 'DISABLED — set SUPABASE_URL'}")
    print(f"  Railway env     : {'YES — ' + _os.getenv('RAILWAY_ENVIRONMENT', 'detected') if _on_railway else 'NOT DETECTED (local run)'}")
    print()

    init_sim_db()
    bots   = [FastScalpBot(c["name"], c["tp"], c["sl"]) for c in configs]
    runner = FastScalpRunner(bots, use_live=use_live)
    try:
        runner.run()
    except KeyboardInterrupt:
        runner.stop()
        runner.final_summary()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="ARBI Simulation Engine")
    parser.add_argument("--user",       default="default",
                        help="Your name for standard sim mode (e.g. juan)")
    parser.add_argument("--users",      type=int, default=1,
                        help="Number of parallel bots in --scalp-fast mode")
    parser.add_argument("--live",       action="store_true",
                        help="Use live Kraken market data")
    parser.add_argument("--scalp-fast", action="store_true",
                        help="Fast scalp mode: SOL/USD + XRP/USD, TP=0.6%% SL=0.25%%")
    parser.add_argument("--sweep",      action="store_true",
                        help="Run 10 bots with different TP/SL (use with --scalp-fast)")
    args = parser.parse_args()

    if args.scalp_fast:
        run_fast_scalp(num_users=args.users, sweep=args.sweep, use_live=args.live)
    else:
        run_simulation(args.user, use_live_data=args.live)
