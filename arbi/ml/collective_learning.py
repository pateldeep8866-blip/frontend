# ml/collective_learning.py
#
# COLLECTIVE LEARNING PIPELINE — Arthastra's core moat
#
# Every user's closed trades feed into this anonymized dataset.
# The model learns which signals actually led to profitable trades
# across ALL users — not just one person's history.
#
# Individual users benefit from patterns discovered across thousands
# of real trades. A solo bot running the same code never gets this.

import json
import time
import sqlite3
import numpy as np
from utils.logger import get_logger
from config import DB_PATH

log = get_logger("ml.collective")

# Feature columns extracted from each trade
FEATURE_COLS = [
    "zscore_at_entry",
    "rsi_at_entry",
    "volume_spike",
    "liquidity_imbalance",
    "funding_rate",
    "spread_pct",
    "hour_of_day",
    "day_of_week",
    "market_volatility",
    "bid_ask_ratio",
]


# ─── Data collection ──────────────────────────────────────────────────────────

def record_trade_features(user_id_hash: str, symbol: str, exchange: str,
                           features: dict, pnl_pct: float, strategy: str) -> None:
    """
    Store a completed trade with its entry features and outcome.
    user_id_hash: SHA256 of user ID — never store raw user IDs here.
    pnl_pct: profit/loss as percentage of position size.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS collective_trades (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            ts            REAL    NOT NULL,
            user_hash     TEXT    NOT NULL,
            symbol        TEXT    NOT NULL,
            exchange      TEXT    NOT NULL,
            strategy      TEXT    NOT NULL,
            features      TEXT    NOT NULL,
            pnl_pct       REAL    NOT NULL,
            profitable    INTEGER NOT NULL
        )
    """)
    conn.execute("""
        INSERT INTO collective_trades
            (ts, user_hash, symbol, exchange, strategy, features, pnl_pct, profitable)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        time.time(),
        user_id_hash,
        symbol,
        exchange,
        strategy,
        json.dumps(features),
        pnl_pct,
        1 if pnl_pct > 0 else 0,
    ))
    conn.commit()
    conn.close()
    log.debug("Collective trade recorded: %s %s pnl=%.4f%%", strategy, symbol, pnl_pct)


# ─── Feature extraction ───────────────────────────────────────────────────────

def extract_features(market_row: dict, signal: dict) -> dict:
    """
    Build a feature vector from market state at trade entry.
    All values normalized to floats for model compatibility.
    """
    now = time.localtime()
    return {
        "zscore_at_entry":     signal.get("zscore", 0.0),
        "rsi_at_entry":        signal.get("rsi", 50.0),
        "volume_spike":        market_row.get("quote_volume", 0) / 1_000_000,
        "liquidity_imbalance": market_row.get("imbalance", 0.0),
        "funding_rate":        signal.get("funding_rate", 0.0),
        "spread_pct":          _spread_pct(market_row),
        "hour_of_day":         now.tm_hour / 23.0,
        "day_of_week":         now.tm_wday / 6.0,
        "market_volatility":   market_row.get("volatility", 0.0),
        "bid_ask_ratio":       _bid_ask_ratio(market_row),
    }


def _spread_pct(row: dict) -> float:
    bid = row.get("bid", 0)
    ask = row.get("ask", 0)
    if bid and ask and bid > 0:
        return (ask - bid) / bid
    return 0.0


def _bid_ask_ratio(row: dict) -> float:
    bids = row.get("bids", [])
    asks = row.get("asks", [])
    bid_vol = sum(b[1] for b in bids if len(b) >= 2)
    ask_vol = sum(a[1] for a in asks if len(a) >= 2)
    total = bid_vol + ask_vol
    return bid_vol / total if total > 0 else 0.5


# ─── Model training ───────────────────────────────────────────────────────────

def load_training_data() -> tuple:
    """
    Load all collective trades and build X, y arrays.
    Returns (X, y, feature_names) or (None, None, None) if insufficient data.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        rows = conn.execute(
            "SELECT features, profitable FROM collective_trades ORDER BY ts DESC LIMIT 10000"
        ).fetchall()
    except Exception:
        conn.close()
        return None, None, None
    conn.close()

    if len(rows) < 50:
        log.info("Not enough trades for collective learning yet (%d/50)", len(rows))
        return None, None, None

    X, y = [], []
    for row in rows:
        try:
            features = json.loads(row[0])
            vec = [features.get(col, 0.0) for col in FEATURE_COLS]
            X.append(vec)
            y.append(int(row[1]))
        except Exception:
            continue

    return np.array(X), np.array(y), FEATURE_COLS


def train_signal_filter():
    """
    Train a classifier that predicts whether a signal will be profitable.
    Returns trained model or None if insufficient data.
    Uses RandomForest — interpretable, robust to small datasets.
    """
    X, y, features = load_training_data()
    if X is None:
        return None

    try:
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.model_selection import cross_val_score
        from sklearn.preprocessing import StandardScaler

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        model = RandomForestClassifier(
            n_estimators=100,
            max_depth=6,
            min_samples_leaf=5,
            random_state=42,
        )
        model.fit(X_scaled, y)

        # Cross-validation score
        cv_scores = cross_val_score(model, X_scaled, y, cv=5, scoring="accuracy")
        accuracy = cv_scores.mean()

        log.info(
            "Collective model trained on %d trades — CV accuracy: %.2f%%",
            len(X), accuracy * 100
        )

        # Feature importance
        importances = dict(zip(features, model.feature_importances_))
        top = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:5]
        log.info("Top predictive features: %s", top)

        return {"model": model, "scaler": scaler, "accuracy": accuracy, "features": features}

    except ImportError:
        log.warning("scikit-learn not installed — collective learning disabled")
        return None
    except Exception as exc:
        log.error("Training failed: %s", exc)
        return None


def predict_signal_quality(model_bundle: dict, features: dict) -> float:
    """
    Score a signal using the collective model.
    Returns probability [0.0 → 1.0] that the trade will be profitable.
    0.5 = no edge, 0.7+ = meaningful confidence.
    """
    if not model_bundle:
        return 0.5   # neutral when no model available

    try:
        vec = [[features.get(col, 0.0) for col in model_bundle["features"]]]
        X_scaled = model_bundle["scaler"].transform(vec)
        proba = model_bundle["model"].predict_proba(X_scaled)[0][1]
        return round(float(proba), 4)
    except Exception as exc:
        log.debug("Prediction error: %s", exc)
        return 0.5


# ─── Insight reporting ────────────────────────────────────────────────────────

def collective_insights() -> dict:
    """
    Pull aggregate stats from collective trade history.
    Powers the platform dashboard's 'Community Performance' section.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("SELECT 1 FROM collective_trades LIMIT 1")
    except Exception:
        conn.close()
        return {"status": "no_data"}

    total = conn.execute("SELECT COUNT(*) FROM collective_trades").fetchone()[0]
    wins  = conn.execute("SELECT COUNT(*) FROM collective_trades WHERE profitable=1").fetchone()[0]
    avg_pnl = conn.execute("SELECT AVG(pnl_pct) FROM collective_trades").fetchone()[0] or 0

    by_strategy = conn.execute("""
        SELECT strategy, COUNT(*) as trades,
               AVG(pnl_pct) as avg_pnl,
               SUM(profitable) as wins
        FROM collective_trades
        GROUP BY strategy
        ORDER BY avg_pnl DESC
    """).fetchall()

    conn.close()

    return {
        "total_trades":    total,
        "win_rate":        round(wins / total * 100, 1) if total else 0,
        "avg_pnl_pct":     round(avg_pnl, 4),
        "by_strategy":     [
            {
                "strategy": r[0],
                "trades":   r[1],
                "avg_pnl":  round(r[2], 4),
                "win_rate": round(r[3] / r[1] * 100, 1) if r[1] else 0,
            }
            for r in by_strategy
        ],
    }
