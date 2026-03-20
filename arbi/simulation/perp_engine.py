# simulation/perp_engine.py
#
# BYBIT PERPETUALS SIMULATION ENGINE  (3x leverage default)
#
# Runs the full strategy stack against real Bybit perp market data.
# Tracks liquidation prices, applies 8-hour funding charges, and
# halts if balance falls below the $82.50 floor.
#
# Run modes:
#   env EXCHANGE=bybit python -u -m simulation.perp_engine --live
#   env EXCHANGE=bybit python -u -m simulation.perp_engine --live --leverage 5
#   env EXCHANGE=bybit python -u -m simulation.perp_engine --live --scalp
#
# All runs feed the same perp_simulation_knowledge.db shared DB.

import argparse
import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime

from utils.logger import get_logger
from data.bybit_ws_feed import BybitPerpWSFeed
from storage.supabase_writer import write_trade, write_stats, init_supabase

log = get_logger("simulation.perp_engine")

# ── Config ────────────────────────────────────────────────────────────────────

PERP_DB_PATH         = "perp_simulation_knowledge.db"
LOOP_INTERVAL_SEC    = 5
STARTING_BALANCE     = 100.0
FLOOR_USD            = 82.50        # halt if balance drops to or below this
LEVERAGE             = 3.0          # default; overridden via --leverage
RISK_PER_TRADE_PCT   = 0.15         # 15% of balance per notional position
PAPER_MIN_SIZE_PCT   = 0.05         # floor: never go below 5%
PAPER_MAX_SIZE_PCT   = 0.20         # cap:   never exceed 20% of balance notional
LIQUIDATION_BUFFER   = 0.85         # warn / force-exit if within 15% of liq price
FUNDING_INTERVAL_HRS = 8.0          # Bybit charges funding every 8 hours
FUNDING_RATE_8H      = 0.0001       # 0.01% per 8 hr (Bybit average)
NEAR_LIQ_PCT         = 0.05         # force exit if within 5% of liq price
MIN_SCORE_THRESHOLD  = 55

SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT"]

STRATEGIES = ["funding_rate_arb", "mean_reversion", "cross_exchange_arb", "liquidity_signal"]

# Strategy-specific exits
STRATEGY_EXITS = {
    "funding_rate_arb":   {"tp": 0.010, "sl": -0.005, "max_hold_hrs": 1.0},
    "mean_reversion":     {"tp": 0.020, "sl": -0.010, "max_hold_hrs": 3.0},
    "cross_exchange_arb": {"tp": 0.005, "sl": -0.003, "max_hold_hrs": 0.5},
    "liquidity_signal":   {"tp": 0.030, "sl": -0.015, "max_hold_hrs": 4.0},
    "vol_breakout":       {"tp": 0.050, "sl": -0.025, "max_hold_hrs": 8.0},
}

REGIME_EXITS = {
    "RANGING":    {"tp": 0.015, "sl": -0.008, "max_hold_hrs": 2.0},
    "TREND_UP":   {"tp": 0.030, "sl": -0.015, "max_hold_hrs": 6.0},
    "TREND_DOWN": {"tp": 0.030, "sl": -0.015, "max_hold_hrs": 6.0},
    "HIGH_VOL":   {"tp": 0.050, "sl": -0.025, "max_hold_hrs": 12.0},
}


# ── Perp DB ───────────────────────────────────────────────────────────────────

def init_perp_db() -> None:
    conn = sqlite3.connect(PERP_DB_PATH)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS perp_sim_trades (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            ts               REAL    NOT NULL,
            sim_user         TEXT    NOT NULL,
            symbol           TEXT    NOT NULL,
            strategy         TEXT    NOT NULL,
            side             TEXT    NOT NULL,
            leverage         REAL    NOT NULL,
            entry_price      REAL    NOT NULL,
            liq_price        REAL    NOT NULL,
            exit_price       REAL,
            pnl_pct          REAL,
            pnl_usd          REAL,
            funding_paid     REAL    NOT NULL DEFAULT 0,
            profitable       INTEGER,
            hold_hrs         REAL,
            features         TEXT,
            status           TEXT    NOT NULL DEFAULT 'OPEN',
            exit_reason      TEXT,
            regime_at_entry  TEXT,
            score_used       INTEGER,
            ev_val           REAL,
            kelly_frac       REAL,
            size_usd         REAL
        );

        CREATE TABLE IF NOT EXISTS perp_sim_sessions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            sim_user    TEXT    NOT NULL,
            started_ts  REAL    NOT NULL,
            last_seen   REAL    NOT NULL,
            trades_this_session INTEGER DEFAULT 0,
            balance     REAL    NOT NULL,
            leverage    REAL    NOT NULL DEFAULT 3.0
        );

        CREATE TABLE IF NOT EXISTS perp_sim_funding_events (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            ts        REAL NOT NULL,
            sim_user  TEXT NOT NULL,
            symbol    TEXT NOT NULL,
            rate      REAL NOT NULL,
            impact    REAL NOT NULL,
            direction TEXT NOT NULL
        );
    """)
    conn.commit()
    # Migrations for existing DBs
    for col_sql in [
        "ALTER TABLE perp_sim_trades ADD COLUMN funding_paid REAL DEFAULT 0",
        "ALTER TABLE perp_sim_trades ADD COLUMN liq_price REAL DEFAULT 0",
    ]:
        try:
            conn.execute(col_sql)
            conn.commit()
        except Exception:
            pass
    conn.close()
    log.info("Perp simulation DB initialized at %s", PERP_DB_PATH)


# ── Engine ────────────────────────────────────────────────────────────────────

class PerpSimulationEngine:

    def __init__(self, sim_user: str = "perp", use_live: bool = True,
                 leverage: float = LEVERAGE, scalp_mode: bool = False):
        self.sim_user   = sim_user
        self.use_live   = use_live
        self.leverage   = leverage
        self.scalp_mode = scalp_mode
        self.balance    = STARTING_BALANCE
        self.positions  = {}    # symbol → position dict
        self.trade_count = 0
        self.session_wins = 0
        self.session_id  = str(uuid.uuid4())[:8]
        self._running    = False
        self._lock       = threading.Lock()

        self._symbol_cooldown: dict = {}   # symbol → cooldown_until_ts
        self._last_funding_apply: float = time.time()   # track funding intervals

        # WS feed for live prices
        self._ws_feed = BybitPerpWSFeed(SYMBOLS, price_callback=self._on_ws_price)
        self._ws_feed.start()

        init_perp_db()
        self.balance = self._load_balance()
        self._register_session()
        init_supabase()
        log.info("PerpSimulationEngine started: user=%s leverage=%.1fx balance=$%.2f %s",
                 sim_user, leverage, self.balance,
                 "[SCALP MODE]" if scalp_mode else "")

    # ── Session ───────────────────────────────────────────────────────────────

    def _load_balance(self) -> float:
        try:
            conn = sqlite3.connect(PERP_DB_PATH)
            row  = conn.execute(
                "SELECT balance FROM perp_sim_sessions WHERE sim_user=? ORDER BY last_seen DESC LIMIT 1",
                (self.sim_user,)
            ).fetchone()
            conn.close()
            if row and row[0] and row[0] > 0:
                log.info("Restoring balance $%.2f from previous session", row[0])
                return float(row[0])
        except Exception:
            pass
        return STARTING_BALANCE

    def _register_session(self) -> None:
        conn = sqlite3.connect(PERP_DB_PATH)
        conn.execute(
            "INSERT INTO perp_sim_sessions (sim_user, started_ts, last_seen, balance, leverage) VALUES (?,?,?,?,?)",
            (self.sim_user, time.time(), time.time(), self.balance, self.leverage)
        )
        conn.commit()
        conn.close()

    def _update_session(self) -> None:
        conn = sqlite3.connect(PERP_DB_PATH)
        conn.execute(
            "UPDATE perp_sim_sessions SET last_seen=?, balance=? WHERE sim_user=? AND id=(SELECT MAX(id) FROM perp_sim_sessions WHERE sim_user=?)",
            (time.time(), self.balance, self.sim_user, self.sim_user)
        )
        conn.commit()
        conn.close()

    # ── Main loop ─────────────────────────────────────────────────────────────

    def run(self) -> None:
        self._running = True
        log.info("Perp simulation running for %s — press Ctrl+C to stop", self.sim_user)
        while self._running:
            try:
                self._tick()
                self._update_session()
            except Exception as exc:
                log.error("Perp sim tick error: %s", exc)
            time.sleep(LOOP_INTERVAL_SEC)

    def stop(self) -> None:
        self._running = False
        log.info("Perp simulation stopped for %s", self.sim_user)

    def _tick(self) -> None:
        now = datetime.utcnow().strftime("%H:%M:%S")

        # Floor check
        if self.balance <= FLOOR_USD:
            log.warning("[PERP] FLOOR HIT — balance=$%.2f <= $%.2f — HALTING", self.balance, FLOOR_USD)
            self.stop()
            return

        # Apply funding charges every 8 simulated hours (wall-clock: every 8 * 3600s)
        self._apply_funding_if_due()

        market_data = self._fetch_market_data()
        regime      = self._detect_regime(market_data)
        signals     = self._scan_signals(market_data, regime)

        if signals:
            best = max(signals, key=lambda s: s.get("score", 0))
            if best["score"] >= MIN_SCORE_THRESHOLD and len(self.positions) < 3:
                self._perp_enter(best, market_data, regime)

        self._monitor_positions(market_data, regime)

        log.debug("[%s] %s | tick | signals=%d | positions=%d | balance=$%.2f",
                  now, self.sim_user, len(signals), len(self.positions), self.balance)

    # ── Funding ───────────────────────────────────────────────────────────────

    def _apply_funding_if_due(self) -> None:
        now = time.time()
        interval_sec = FUNDING_INTERVAL_HRS * 3600
        if (now - self._last_funding_apply) < interval_sec:
            return
        self._last_funding_apply = now

        for sym, pos in list(self.positions.items()):
            # LONG pays funding when rate positive; SHORT receives
            notional = pos["size_usd"] * self.leverage
            impact   = notional * FUNDING_RATE_8H
            side     = pos.get("side", "BUY")
            if side == "BUY":
                self.balance  -= impact
                pos["funding_paid"] = pos.get("funding_paid", 0.0) + impact
            else:
                self.balance  += impact
                pos["funding_paid"] = pos.get("funding_paid", 0.0) - impact

            log.info("[PERP] FUNDING %s rate=%.2f%% pnl_impact=$%.4f (side=%s)",
                     sym, FUNDING_RATE_8H * 100, impact, side)

            # Persist funding event
            conn = sqlite3.connect(PERP_DB_PATH)
            conn.execute(
                "INSERT INTO perp_sim_funding_events (ts, sim_user, symbol, rate, impact, direction) VALUES (?,?,?,?,?,?)",
                (now, self.sim_user, sym, FUNDING_RATE_8H, round(impact, 6), side)
            )
            conn.commit()
            conn.close()

    # ── Market data ───────────────────────────────────────────────────────────

    def _fetch_market_data(self) -> dict:
        if self.use_live:
            base = self._fetch_live_data()
        else:
            base = self._generate_synthetic_data()

        # Overlay fresh WS prices
        if self._ws_feed.is_alive():
            for sym in SYMBOLS:
                snap = self._ws_feed.get_snapshot(sym)
                if snap and sym in base:
                    base[sym]["price"]  = snap.get("last") or base[sym]["price"]
                    base[sym]["bid"]    = snap.get("bid")  or base[sym].get("bid", base[sym]["price"] * 0.9997)
                    base[sym]["ask"]    = snap.get("ask")  or base[sym].get("ask", base[sym]["price"] * 1.0003)
                    base[sym]["source"] = "websocket"
        return base

    def _fetch_live_data(self) -> dict:
        try:
            import ccxt
            client = ccxt.bybit({"options": {"defaultType": "linear"}})
            data   = {}
            for sym in SYMBOLS:
                try:
                    ticker = client.fetch_ticker(sym)
                    ohlcv  = client.fetch_ohlcv(sym, "1h", limit=60)
                    import random as _r
                    funding = _r.choice([0.0001, 0.0002, 0.0003, 0.0002, 0.0001, 0.0002])
                    bid_vol = ticker.get("bidVolume") or 0
                    ask_vol = ticker.get("askVolume") or 0
                    imbalance = (bid_vol / (bid_vol + ask_vol)) if (bid_vol + ask_vol) > 0 else 0.5
                    data[sym] = {
                        "price":        ticker["last"],
                        "bid":          ticker["bid"],
                        "ask":          ticker["ask"],
                        "volume_24h":   ticker["quoteVolume"],
                        "candles":      [{"open":c[1],"high":c[2],"low":c[3],"close":c[4],"volume":c[5]} for c in ohlcv],
                        "funding_rate": funding,
                        "imbalance":    imbalance,
                        "source":       "live",
                    }
                    time.sleep(0.15)
                except Exception as sym_exc:
                    log.warning("Bybit live data failed for %s (%s) — using synthetic", sym, sym_exc)
                    data[sym] = self._synthetic_for_symbol(sym)
            return data
        except Exception as exc:
            log.warning("Bybit live data unavailable (%s) — using synthetic", exc)
            return self._generate_synthetic_data()

    def _generate_synthetic_data(self) -> dict:
        return {sym: self._synthetic_for_symbol(sym) for sym in SYMBOLS}

    def _synthetic_for_symbol(self, sym: str) -> dict:
        import numpy as np
        base_prices = {
            "BTC/USDT": 83000, "ETH/USDT": 3150, "SOL/USDT": 142,
            "XRP/USDT": 0.58,  "DOGE/USDT": 0.14,
            "ADA/USDT": 0.41,  "AVAX/USDT": 28, "DOT/USDT": 6.8,
        }
        p   = base_prices.get(sym, 100)
        vol = 0.005 if "BTC" in sym else 0.008 if "ETH" in sym else 0.012
        closes = [p]
        for _ in range(59):
            closes.append(closes[-1] * (1 + 0.0002 + vol * np.random.randn()))
        candles = []
        for i, c in enumerate(closes):
            h = c * (1 + abs(np.random.randn()) * vol * 0.5)
            l = c * (1 - abs(np.random.randn()) * vol * 0.5)
            candles.append({"open": closes[i-1] if i > 0 else c,
                            "high": h, "low": l, "close": c,
                            "volume": np.random.uniform(1e6, 1e8)})
        current = closes[-1]
        spread  = current * 0.0003
        funding = float(np.random.choice([0.0001, 0.0002, 0.0003, 0.0005, -0.0001, 0.0001]))
        return {
            "price":        current,
            "bid":          current - spread,
            "ask":          current + spread,
            "volume_24h":   float(np.random.uniform(5e7, 5e9)),
            "candles":      candles,
            "funding_rate": funding,
            "imbalance":    float(np.random.uniform(0.3, 0.7)),
            "source":       "synthetic",
        }

    # ── Regime detection ──────────────────────────────────────────────────────

    def _detect_regime(self, market_data: dict) -> dict:
        import numpy as np
        btc     = market_data.get("BTC/USDT", {})
        candles = btc.get("candles", [])
        if len(candles) < 20:
            return {"regime": "RANGING", "size_mult": 0.8,
                    "allowed": ["mean_reversion", "funding_rate_arb"]}

        closes   = [c["close"] for c in candles]
        returns  = np.diff(closes) / closes[:-1]
        vol_pct  = float(np.std(returns[-20:]))
        ma20     = float(np.mean(closes[-20:]))
        ma50     = float(np.mean(closes[-50:])) if len(closes) >= 50 else ma20

        if vol_pct > 0.025:
            return {"regime": "HIGH_VOL",   "allowed": ["cross_exchange_arb"], "size_mult": 0.4}
        elif closes[-1] > ma50 * 1.005:
            return {"regime": "TREND_UP",   "allowed": ["funding_rate_arb", "cross_exchange_arb"], "size_mult": 1.0}
        elif closes[-1] < ma50 * 0.995:
            # Perps: fund arb + mean_reversion both valid in downtrend (can short or fade)
            return {"regime": "TREND_DOWN", "allowed": ["funding_rate_arb", "mean_reversion"], "size_mult": 0.5}
        else:
            return {"regime": "RANGING",    "allowed": ["mean_reversion", "funding_rate_arb", "liquidity_signal"], "size_mult": 0.8}

    # ── Signal scanning ───────────────────────────────────────────────────────

    def _scan_signals(self, market_data: dict, regime: dict) -> list:
        import numpy as np
        signals = []
        allowed = regime.get("allowed", STRATEGIES)

        # In scalp mode only run mean_reversion
        if self.scalp_mode:
            allowed = [s for s in allowed if s == "mean_reversion"]

        for sym, data in market_data.items():
            candles = data.get("candles", [])
            if len(candles) < 30:
                continue
            closes = [c["close"] for c in candles]

            # Funding rate arb
            if "funding_rate_arb" in allowed:
                rate = data.get("funding_rate", 0)
                if rate >= 0.0001:
                    annual = rate * 1095 * 100
                    signals.append({
                        "symbol": sym, "strategy": "funding_rate_arb",
                        "action": "ENTER", "score": min(annual * 2, 98),
                        "features": {"funding_rate": rate, "annual_pct": annual,
                                     "regime": regime["regime"]},
                    })

            # Mean reversion
            if "mean_reversion" in allowed and len(closes) >= 20:
                mean   = float(np.mean(closes[-20:]))
                std    = float(np.std(closes[-20:]))
                zscore = (closes[-1] - mean) / std if std > 0 else 0
                deltas = np.diff(closes[-15:])
                gains  = float(np.mean([d for d in deltas if d > 0] or [0]))
                losses = float(np.mean([-d for d in deltas if d < 0] or [0.001]))
                rsi    = 100 - (100 / (1 + gains / losses))
                rsi_signal = (50 - rsi) / 50.0

                if zscore < -0.5 or (rsi < 45 and zscore < 0):
                    # Score scaled so 2-sigma z + strong RSI → ~75 (vs spot engine's 15/20 weights)
                    mr_score = min(abs(zscore) * 30 + abs(rsi_signal) * 40, 90)
                    signals.append({
                        "symbol": sym, "strategy": "mean_reversion", "action": "BUY",
                        "score": mr_score,
                        "features": {"zscore": zscore, "rsi": rsi, "regime": regime["regime"]},
                    })

            # Liquidity signal
            if "liquidity_signal" in allowed:
                imbalance = data.get("imbalance", 0.5)
                vol_24h   = data.get("volume_24h", 0)
                if imbalance > 0.65 and vol_24h > 1e8:
                    signals.append({
                        "symbol": sym, "strategy": "liquidity_signal", "action": "BUY",
                        "score": (imbalance - 0.5) * 200,
                        "features": {"imbalance": imbalance, "regime": regime["regime"]},
                    })

        signals.sort(key=lambda s: s["score"], reverse=True)
        return signals

    # ── Liquidation price helpers ─────────────────────────────────────────────

    @staticmethod
    def _calc_liq_price(entry: float, leverage: float, side: str) -> float:
        """
        Simplified liquidation price (no maintenance margin for brevity):
          LONG:  entry * (1 - 1/leverage + 0.005)
          SHORT: entry * (1 + 1/leverage - 0.005)
        """
        if side == "BUY":
            return entry * (1.0 - 1.0 / leverage + 0.005)
        else:
            return entry * (1.0 + 1.0 / leverage - 0.005)

    # ── Paper trading ─────────────────────────────────────────────────────────

    def _perp_enter(self, signal: dict, market_data: dict, regime: dict) -> None:
        sym = signal["symbol"]
        row = market_data.get(sym, {})
        # Allow synthetic data for perp sim (REST geo-blocked; WS candles may be synthetic)
        price = row.get("price", 0)
        if not price or sym in self.positions:
            return

        # Symbol cooldown
        now = time.time()
        if now < self._symbol_cooldown.get(sym, 0.0):
            log.info("[PERP] COOLDOWN %s — %.0fs remaining", sym,
                     self._symbol_cooldown[sym] - now)
            return

        regime_name = regime.get("regime", "RANGING")

        # NOTE: perps can short — TREND_DOWN does NOT block entries here.
        # The direction filter (allowed list) in _detect_regime controls strategy selection.

        # Scalp mode: enforce higher score bar
        score = signal.get("score", 0)
        if self.scalp_mode and score < 65:
            log.info("[PERP] SKIP %s — scalp mode score %.0f < 65", sym, score)
            return

        # Sizing: RISK_PER_TRADE_PCT of balance (notional = size_usd * leverage)
        size_usd = self.balance * RISK_PER_TRADE_PCT * score / 100 * regime.get("size_mult", 1.0)
        size_usd = max(size_usd, self.balance * PAPER_MIN_SIZE_PCT)
        size_usd = min(size_usd, self.balance * PAPER_MAX_SIZE_PCT)

        side     = signal.get("action", "BUY")
        liq_price = self._calc_liq_price(price, self.leverage, side)

        # EV/Kelly for logging
        try:
            from core.ev_model import EVModel
            _EV_PRIORS = {
                "funding_rate_arb": (0.68, 0.010, 0.004),
                "mean_reversion":   (0.60, 0.008, 0.005),
                "liquidity_signal": (0.55, 0.015, 0.008),
            }
            priors = _EV_PRIORS.get(signal.get("strategy", "mean_reversion"), (0.55, 0.010, 0.007))
            base_p, avg_w, avg_l = priors
            p_win  = min(max(base_p + (score - 50) / 200.0, 0.30), 0.92)
            ev_val = EVModel.compute(p_win, avg_w, avg_l, 0.0002, 0.0005)
            kelly  = EVModel.kelly_fraction(p_win, avg_w, avg_l)
        except Exception:
            ev_val, kelly, p_win = 0.0, 0.0, 0.0

        self.positions[sym] = {
            "strategy":       signal["strategy"],
            "entry_price":    price,
            "entry_ts":       now,
            "size_usd":       size_usd,
            "side":           side,
            "features":       signal.get("features", {}),
            "score":          score,
            "regime_at_entry": regime_name,
            "liq_price":      liq_price,
            "funding_paid":   0.0,
        }

        conn = sqlite3.connect(PERP_DB_PATH)
        conn.execute("""
            INSERT INTO perp_sim_trades
              (ts, sim_user, symbol, strategy, side, leverage, entry_price,
               liq_price, features, status, regime_at_entry, score_used, ev_val,
               kelly_frac, size_usd, funding_paid)
            VALUES (?,?,?,?,?,?,?,?,?,'OPEN',?,?,?,?,?,0)
        """, (now, self.sim_user, sym, signal["strategy"], side,
              self.leverage, price, liq_price,
              json.dumps(signal.get("features", {})),
              regime_name, score, ev_val, kelly, size_usd))
        conn.commit()
        conn.close()

        log.info(
            "[PERP] ENTER %s %s @ $%.4f | size=$%.2f | leverage=%.1fx | "
            "liq=$%.4f | score=%.0f | regime=%s | EV=%.6f | kelly=%.4f",
            side, sym, price, size_usd, self.leverage,
            liq_price, score, regime_name, ev_val, kelly,
        )

    def _monitor_positions(self, market_data: dict, regime: dict) -> None:
        current_regime = regime.get("regime", "RANGING")
        for sym in list(self.positions.keys()):
            row = market_data.get(sym, {})
            pos      = self.positions[sym]
            price    = row.get("price", pos["entry_price"])
            entry    = pos["entry_price"]
            liq      = pos["liq_price"]
            strategy = pos["strategy"]
            side     = pos.get("side", "BUY")

            pnl_pct = (price - entry) / entry
            if side == "SELL":
                pnl_pct = -pnl_pct

            # Near-liquidation forced exit
            if side == "BUY":
                dist_to_liq = (price - liq) / price
            else:
                dist_to_liq = (liq - price) / price

            if dist_to_liq < NEAR_LIQ_PCT:
                log.warning("[PERP] NEAR-LIQ EXIT %s liq=$%.4f current=$%.4f",
                            sym, liq, price)
                self._perp_exit(sym, price, pnl_pct, "near_liquidation")
                continue

            # Strategy/regime exits
            exits    = STRATEGY_EXITS.get(strategy) or REGIME_EXITS.get(current_regime, REGIME_EXITS["RANGING"])
            tp       = exits["tp"]
            sl       = exits["sl"]
            max_hold = exits["max_hold_hrs"]

            # Tighter exits in scalp mode
            if self.scalp_mode:
                tp = 0.003
                sl = -0.002
                max_hold = 0.5

            hours_held = (time.time() - pos["entry_ts"]) / 3600

            if pnl_pct >= tp:
                self._perp_exit(sym, price, pnl_pct, "take_profit")
            elif pnl_pct <= sl:
                self._perp_exit(sym, price, pnl_pct, "stop_loss")
            elif hours_held >= max_hold:
                self._perp_exit(sym, price, pnl_pct, "time_exit")

    def _perp_exit(self, sym: str, exit_price: float, pnl_pct: float, reason: str) -> None:
        pos = self.positions.pop(sym, None)
        if not pos:
            return

        self._symbol_cooldown[sym] = time.time() + 60

        # Leveraged PnL
        pnl_usd       = pos["size_usd"] * self.leverage * pnl_pct
        self.balance  += pnl_usd
        self.trade_count += 1
        if pnl_pct > 0:
            self.session_wins += 1

        hold_hrs     = (time.time() - pos["entry_ts"]) / 3600
        funding_paid = pos.get("funding_paid", 0.0)

        conn = sqlite3.connect(PERP_DB_PATH)
        conn.execute("""
            UPDATE perp_sim_trades
            SET exit_price=?, pnl_pct=?, pnl_usd=?, funding_paid=?, profitable=?,
                hold_hrs=?, status='CLOSED', exit_reason=?
            WHERE rowid=(
                SELECT rowid FROM perp_sim_trades
                WHERE sim_user=? AND symbol=? AND status='OPEN'
                ORDER BY ts DESC LIMIT 1
            )
        """, (exit_price, round(pnl_pct * 100, 4), round(pnl_usd, 4),
              round(funding_paid, 6), 1 if pnl_pct > 0 else 0,
              round(hold_hrs, 4), reason,
              self.sim_user, sym))
        conn.commit()
        conn.close()

        log.info(
            "[PERP] EXIT %s @ $%.4f | pnl=%.3f%% ($%.4f) | hold=%.2fh | "
            "funding_paid=$%.4f | reason=%s | balance=$%.2f",
            sym, exit_price, pnl_pct * 100, pnl_usd,
            hold_hrs, funding_paid, reason, self.balance,
        )

        # Floor check after exit
        if self.balance <= FLOOR_USD:
            log.warning("[PERP] FLOOR HIT after exit — balance=$%.2f — HALTING", self.balance)
            self.stop()

    # ── WS event-driven exit ──────────────────────────────────────────────────

    def _on_ws_price(self, symbol: str, price: float) -> None:
        """Called on every WS tick — evaluate TP/SL in real time."""
        with self._lock:
            pos = self.positions.get(symbol)
            if not pos:
                return
            entry = pos["entry_price"]
            liq   = pos["liq_price"]
            side  = pos.get("side", "BUY")
            strategy = pos["strategy"]

            pnl_pct = (price - entry) / entry
            if side == "SELL":
                pnl_pct = -pnl_pct

            # Near-liquidation
            dist_to_liq = (price - liq) / price if side == "BUY" else (liq - price) / price
            if dist_to_liq < NEAR_LIQ_PCT:
                del self.positions[symbol]
                reason = "near_liquidation"
            else:
                exits  = STRATEGY_EXITS.get(strategy, REGIME_EXITS["RANGING"])
                tp     = 0.003 if self.scalp_mode else exits["tp"]
                sl     = -0.002 if self.scalp_mode else exits["sl"]
                if pnl_pct >= tp:
                    del self.positions[symbol]
                    reason = "take_profit"
                elif pnl_pct <= sl:
                    del self.positions[symbol]
                    reason = "stop_loss"
                else:
                    return   # still in trade

        # Out-of-lock DB write
        self._perp_exit_record(symbol, pos, price, pnl_pct, reason)

    def _perp_exit_record(self, sym: str, pos: dict,
                          exit_price: float, pnl_pct: float, reason: str) -> None:
        self._symbol_cooldown[sym] = time.time() + 60
        pnl_usd      = pos["size_usd"] * self.leverage * pnl_pct
        self.balance += pnl_usd
        self.trade_count += 1
        if pnl_pct > 0:
            self.session_wins += 1
        hold_hrs     = (time.time() - pos["entry_ts"]) / 3600
        funding_paid = pos.get("funding_paid", 0.0)

        conn = sqlite3.connect(PERP_DB_PATH)
        conn.execute("""
            UPDATE perp_sim_trades
            SET exit_price=?, pnl_pct=?, pnl_usd=?, funding_paid=?, profitable=?,
                hold_hrs=?, status='CLOSED', exit_reason=?
            WHERE rowid=(
                SELECT rowid FROM perp_sim_trades
                WHERE sim_user=? AND symbol=? AND status='OPEN'
                ORDER BY ts DESC LIMIT 1
            )
        """, (exit_price, round(pnl_pct * 100, 4), round(pnl_usd, 4),
              round(funding_paid, 6), 1 if pnl_pct > 0 else 0,
              round(hold_hrs, 4), reason, self.sim_user, sym))
        conn.commit()
        conn.close()

        log.info("[PERP/WS] EXIT %s @ $%.4f | pnl=%.3f%% ($%.4f) | %s | balance=$%.2f",
                 sym, exit_price, pnl_pct * 100, pnl_usd, reason, self.balance)
        if self.balance <= FLOOR_USD:
            log.warning("[PERP] FLOOR HIT — HALTING")
            self.stop()


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Bybit perp simulation engine")
    parser.add_argument("--live",     action="store_true", default=False,
                        help="Use live Bybit market data (no auth needed)")
    parser.add_argument("--leverage", type=float, default=LEVERAGE,
                        help=f"Leverage multiplier (default: {LEVERAGE})")
    parser.add_argument("--scalp",   action="store_true", default=False,
                        help="Mean-reversion scalp mode (2x, 3s loop)")
    parser.add_argument("--user",    type=str, default="perp",
                        help="Simulation user label for shared DB")
    args = parser.parse_args()

    global LOOP_INTERVAL_SEC
    leverage    = 2.0 if args.scalp else args.leverage
    loop_sec    = 3   if args.scalp else LOOP_INTERVAL_SEC

    engine = PerpSimulationEngine(
        sim_user   = args.user,
        use_live   = args.live,
        leverage   = leverage,
        scalp_mode = args.scalp,
    )
    # Override loop interval for scalp
    LOOP_INTERVAL_SEC = loop_sec

    try:
        engine.run()
    except KeyboardInterrupt:
        engine.stop()
        log.info("Perp simulation terminated by user")


if __name__ == "__main__":
    main()
