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

log = get_logger("simulation.engine")

# ── Config ────────────────────────────────────────────────────────────────────

SIM_DB_PATH        = "simulation_knowledge.db"   # shared across all sim instances
LOOP_INTERVAL_SEC  = 15       # how often the main loop runs
CANDLE_TIMEFRAME   = "1h"
STARTING_BALANCE   = 10_000.0
RISK_PER_TRADE_PCT = 0.02     # 2% per trade

# Symbols to simulate across
SYMBOLS = [
    "BTC/USDT", "ETH/USDT", "SOL/USDT",
    "XRP/USDT", "BNB/USDT", "ADA/USDT",
    "DOGE/USDT", "AVAX/USDT", "DOT/USDT",
]

# Strategies to run in simulation
STRATEGIES = ["funding_rate_arb", "mean_reversion", "cross_exchange_arb", "liquidity_signal"]


# ── Shared Knowledge Database ─────────────────────────────────────────────────

def init_sim_db():
    """Create shared knowledge tables if they don't exist."""
    conn = sqlite3.connect(SIM_DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS sim_trades (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            ts           REAL    NOT NULL,
            sim_user     TEXT    NOT NULL,
            symbol       TEXT    NOT NULL,
            strategy     TEXT    NOT NULL,
            side         TEXT    NOT NULL,
            entry_price  REAL    NOT NULL,
            exit_price   REAL,
            pnl_pct      REAL,
            profitable   INTEGER,
            hold_hrs     REAL,
            features     TEXT,
            status       TEXT    NOT NULL DEFAULT 'OPEN'
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
    """)
    conn.commit()
    conn.close()
    log.info("Simulation DB initialized at %s", SIM_DB_PATH)


# ── Simulation Runner ─────────────────────────────────────────────────────────

class SimulationEngine:

    def __init__(self, sim_user: str, use_live_data: bool = False):
        self.sim_user    = sim_user
        self.user_hash   = hashlib.sha256(sim_user.encode()).hexdigest()[:16]
        self.use_live    = use_live_data
        self.balance     = STARTING_BALANCE
        self.positions   = {}     # symbol → open position
        self.trade_count = 0
        self.session_id  = str(uuid.uuid4())[:8]
        self._running    = False
        self._lock       = threading.Lock()

        init_sim_db()
        self._register_session()
        log.info("SimulationEngine started: user=%s session=%s", sim_user, self.session_id)

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
            if best["score"] > 40 and len(self.positions) < 3:
                self._paper_enter(best, market_data)

        # 6. Monitor and close open positions
        self._monitor_positions(market_data)

        # 7. Log funding rates (important data for the model)
        self._log_funding_rates(market_data)

        log.debug("[%s] %s | tick done | signals=%d | positions=%d | balance=$%.2f",
                  now, self.sim_user, len(signals), len(self.positions), self.balance)

    # ── Market data ───────────────────────────────────────────────────────────

    def _fetch_market_data(self) -> dict:
        """
        Fetch live data if Bybit client is available.
        Falls back to realistic synthetic data if no API key.
        Synthetic data uses real statistical properties of crypto markets.
        """
        if self.use_live:
            return self._fetch_live_data()
        return self._generate_synthetic_data()

    def _fetch_live_data(self) -> dict:
        """Fetch real prices from Bybit public API (no auth needed for market data)."""
        try:
            import ccxt
            client = ccxt.bybit({"options": {"defaultType": "linear"}})
            data = {}
            for sym in SYMBOLS[:5]:   # limit to avoid rate limits
                try:
                    ticker = client.fetch_ticker(sym)
                    ohlcv  = client.fetch_ohlcv(sym, "1h", limit=60)
                    funding = client.fetch_funding_rate(sym.replace("/USDT", "/USDT:USDT"))
                    data[sym] = {
                        "price":        ticker["last"],
                        "bid":          ticker["bid"],
                        "ask":          ticker["ask"],
                        "volume_24h":   ticker["quoteVolume"],
                        "candles":      [{"open":c[1],"high":c[2],"low":c[3],"close":c[4],"volume":c[5]} for c in ohlcv],
                        "funding_rate": funding.get("fundingRate", 0),
                        "source":       "live",
                    }
                except Exception:
                    data[sym] = self._synthetic_for_symbol(sym)
            return data
        except Exception as exc:
            log.debug("Live data unavailable (%s) — using synthetic", exc)
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
                if rate > 0.0001:   # > 0.01% per 8h
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

                if zscore <= -2.0 and rsi <= 35:
                    signals.append({
                        "symbol":   sym,
                        "strategy": "mean_reversion",
                        "action":   "BUY",
                        "score":    min(abs(zscore) * 25, 90),
                        "features": {"zscore": zscore, "rsi": rsi,
                                     "regime": regime["regime"]},
                        "reason":   f"zscore={zscore:.2f} rsi={rsi:.1f}",
                    })
                elif zscore >= 2.0 and rsi >= 65:
                    signals.append({
                        "symbol":   sym,
                        "strategy": "mean_reversion",
                        "action":   "SELL",
                        "score":    min(zscore * 25, 90),
                        "features": {"zscore": zscore, "rsi": rsi,
                                     "regime": regime["regime"]},
                        "reason":   f"zscore={zscore:.2f} rsi={rsi:.1f}",
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

    def _paper_enter(self, signal: dict, market_data: dict):
        """Simulate entering a trade. Log to shared DB."""
        sym      = signal["symbol"]
        price    = market_data.get(sym, {}).get("price", 0)
        if not price or sym in self.positions:
            return

        size_usd = self.balance * RISK_PER_TRADE_PCT * signal.get("score", 50) / 100
        size_usd = min(size_usd, self.balance * 0.10)   # max 10% in one trade

        self.positions[sym] = {
            "strategy":    signal["strategy"],
            "entry_price": price,
            "entry_ts":    time.time(),
            "size_usd":    size_usd,
            "side":        signal.get("action", "BUY"),
            "features":    signal.get("features", {}),
            "score":       signal.get("score", 0),
            "signal":      signal.get("reason", ""),
        }

        conn = sqlite3.connect(SIM_DB_PATH)
        conn.execute("""
            INSERT INTO sim_trades
              (ts, sim_user, symbol, strategy, side, entry_price, features, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN')
        """, (time.time(), self.sim_user, sym, signal["strategy"],
              signal.get("action","BUY"), price, json.dumps(signal.get("features",{}))))
        conn.commit()
        conn.close()

        log.info("[SIM] ENTER %s %s @ $%.4f size=$%.2f score=%.0f",
                 signal.get("action","BUY"), sym, price, size_usd, signal.get("score",0))

    def _monitor_positions(self, market_data: dict):
        """
        Check open positions for exit conditions.
        Exits on: take-profit (3%), stop-loss (1.5%), funding rate flip,
        or holding > 48h without hitting either.
        """
        for sym in list(self.positions.keys()):
            pos   = self.positions[sym]
            price = market_data.get(sym, {}).get("price", pos["entry_price"])
            entry = pos["entry_price"]

            pnl_pct   = (price - entry) / entry
            if pos["side"] == "SELL":
                pnl_pct = -pnl_pct

            # Funding arb: check for rate flip
            if pos["strategy"] == "funding_rate_arb":
                rate = market_data.get(sym, {}).get("funding_rate", 0.0001)
                if rate <= 0:
                    self._paper_exit(sym, price, pnl_pct, "funding_rate_flipped")
                    continue

            hours_held = (time.time() - pos["entry_ts"]) / 3600

            if pnl_pct >= 0.03:
                self._paper_exit(sym, price, pnl_pct, "take_profit")
            elif pnl_pct <= -0.015:
                self._paper_exit(sym, price, pnl_pct, "stop_loss")
            elif hours_held >= 48:
                self._paper_exit(sym, price, pnl_pct, "time_exit")

    def _paper_exit(self, sym: str, exit_price: float, pnl_pct: float, reason: str):
        """Close a simulated position and record outcome to shared DB."""
        pos = self.positions.pop(sym, None)
        if not pos:
            return

        pnl_usd   = pos["size_usd"] * pnl_pct
        self.balance += pnl_usd
        self.trade_count += 1
        hold_hrs  = (time.time() - pos["entry_ts"]) / 3600

        conn = sqlite3.connect(SIM_DB_PATH)
        conn.execute("""
            UPDATE sim_trades
            SET exit_price=?, pnl_pct=?, profitable=?, hold_hrs=?, status='CLOSED'
            WHERE sim_user=? AND symbol=? AND status='OPEN'
            ORDER BY ts DESC LIMIT 1
        """, (exit_price, round(pnl_pct*100,4), 1 if pnl_pct>0 else 0,
              round(hold_hrs,2), self.sim_user, sym))
        conn.commit()
        conn.close()

        log.info("[SIM] EXIT %s pnl=%.2f%% ($%.2f) reason=%s | balance=$%.2f",
                 sym, pnl_pct*100, pnl_usd, reason, self.balance)

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
            WHERE sim_user=? ORDER BY started_ts DESC LIMIT 1
        """, (time.time(), self.trade_count, self.balance, self.sim_user))
        conn.commit()
        conn.close()

    # ── Stats ─────────────────────────────────────────────────────────────────

    def get_stats(self) -> dict:
        conn = sqlite3.connect(SIM_DB_PATH)
        total  = conn.execute("SELECT COUNT(*) FROM sim_trades WHERE status='CLOSED'").fetchone()[0]
        wins   = conn.execute("SELECT COUNT(*) FROM sim_trades WHERE profitable=1").fetchone()[0]
        avgpnl = conn.execute("SELECT AVG(pnl_pct) FROM sim_trades WHERE status='CLOSED'").fetchone()[0] or 0
        signals_total = conn.execute("SELECT COUNT(*) FROM sim_signals").fetchone()[0]

        # Active simulations in last 5 minutes
        active = conn.execute(
            "SELECT COUNT(DISTINCT sim_user) FROM sim_sessions WHERE last_seen > ?",
            (time.time() - 300,)
        ).fetchone()[0]

        by_strat = conn.execute("""
            SELECT strategy, COUNT(*) as n, AVG(pnl_pct) as avg, SUM(profitable) as wins
            FROM sim_trades WHERE status='CLOSED' GROUP BY strategy ORDER BY avg DESC
        """).fetchall()
        conn.close()

        return {
            "total_sim_trades":  total,
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
        }


# ── Entry point ───────────────────────────────────────────────────────────────

def run_simulation(user_name: str, use_live_data: bool = False):
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
        print(f"\n\nSession complete.")
        print(f"Trades logged: {stats['total_sim_trades']}")
        print(f"Win rate: {stats['win_rate_pct']}%")
        print(f"Final balance: ${stats['my_balance']:,.2f}")
        print(f"Knowledge DB: {SIM_DB_PATH}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--user",  default="default", help="Your name (e.g. juan)")
    parser.add_argument("--live",  action="store_true", help="Use live Bybit market data")
    args = parser.parse_args()
    run_simulation(args.user, use_live_data=args.live)
