# storage/db.py — SQLite persistent event store and trade logger

import sqlite3
import json
import time
from pathlib import Path
from typing import Optional

from config import DB_PATH
from utils.logger import get_logger

log = get_logger("storage.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create all tables if they don't exist."""
    conn = get_connection()
    cur = conn.cursor()

    cur.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          REAL    NOT NULL,
            event_type  TEXT    NOT NULL,
            source      TEXT,
            payload     TEXT
        );

        CREATE TABLE IF NOT EXISTS orders (
            order_id        TEXT    PRIMARY KEY,
            exchange        TEXT    NOT NULL,
            symbol          TEXT    NOT NULL,
            side            TEXT    NOT NULL,
            order_type      TEXT    NOT NULL,
            quantity        REAL    NOT NULL,
            price           REAL,
            status          TEXT    NOT NULL DEFAULT 'NEW',
            strategy        TEXT,
            created_ts      REAL    NOT NULL,
            updated_ts      REAL,
            filled_qty      REAL    DEFAULT 0,
            avg_fill_price  REAL,
            fee             REAL    DEFAULT 0,
            pnl             REAL,
            raw_response    TEXT
        );

        CREATE TABLE IF NOT EXISTS fills (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id    TEXT    NOT NULL REFERENCES orders(order_id),
            ts          REAL    NOT NULL,
            quantity    REAL    NOT NULL,
            price       REAL    NOT NULL,
            fee         REAL    NOT NULL DEFAULT 0,
            fee_currency TEXT
        );

        CREATE TABLE IF NOT EXISTS positions (
            symbol          TEXT    NOT NULL,
            exchange        TEXT    NOT NULL,
            quantity        REAL    NOT NULL DEFAULT 0,
            avg_entry       REAL,
            realized_pnl    REAL    NOT NULL DEFAULT 0,
            unrealized_pnl  REAL    NOT NULL DEFAULT 0,
            updated_ts      REAL,
            PRIMARY KEY (symbol, exchange)
        );

        CREATE TABLE IF NOT EXISTS account_snapshots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          REAL    NOT NULL,
            exchange    TEXT    NOT NULL,
            currency    TEXT    NOT NULL,
            free        REAL    NOT NULL,
            used        REAL    NOT NULL,
            total       REAL    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS strategy_signals (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          REAL    NOT NULL,
            strategy    TEXT    NOT NULL,
            symbol      TEXT,
            exchange    TEXT,
            signal_type TEXT,
            score       REAL,
            details     TEXT
        );

        CREATE TABLE IF NOT EXISTS risk_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ts          REAL    NOT NULL,
            event_type  TEXT    NOT NULL,
            details     TEXT,
            action_taken TEXT
        );
    """)

    conn.commit()
    conn.close()
    log.info("Database initialized at %s", DB_PATH)


# ─── Generic event logging ────────────────────────────────────────────────────

def log_event(event_type: str, source: str = "", payload: dict = None) -> None:
    conn = get_connection()
    conn.execute(
        "INSERT INTO events (ts, event_type, source, payload) VALUES (?,?,?,?)",
        (time.time(), event_type, source, json.dumps(payload or {})),
    )
    conn.commit()
    conn.close()


# ─── Order persistence ────────────────────────────────────────────────────────

def upsert_order(order: dict) -> None:
    conn = get_connection()
    conn.execute("""
        INSERT INTO orders
            (order_id, exchange, symbol, side, order_type, quantity, price,
             status, strategy, created_ts, updated_ts, filled_qty,
             avg_fill_price, fee, pnl, raw_response)
        VALUES
            (:order_id, :exchange, :symbol, :side, :order_type, :quantity,
             :price, :status, :strategy, :created_ts, :updated_ts,
             :filled_qty, :avg_fill_price, :fee, :pnl, :raw_response)
        ON CONFLICT(order_id) DO UPDATE SET
            status         = excluded.status,
            updated_ts     = excluded.updated_ts,
            filled_qty     = excluded.filled_qty,
            avg_fill_price = excluded.avg_fill_price,
            fee            = excluded.fee,
            pnl            = excluded.pnl,
            raw_response   = excluded.raw_response
    """, {
        "order_id":      order.get("order_id", ""),
        "exchange":      order.get("exchange", ""),
        "symbol":        order.get("symbol", ""),
        "side":          order.get("side", ""),
        "order_type":    order.get("order_type", "limit"),
        "quantity":      order.get("quantity", 0),
        "price":         order.get("price"),
        "status":        order.get("status", "NEW"),
        "strategy":      order.get("strategy"),
        "created_ts":    order.get("created_ts", time.time()),
        "updated_ts":    time.time(),
        "filled_qty":    order.get("filled_qty", 0),
        "avg_fill_price": order.get("avg_fill_price"),
        "fee":           order.get("fee", 0),
        "pnl":           order.get("pnl"),
        "raw_response":  json.dumps(order.get("raw_response")),
    })
    conn.commit()
    conn.close()


def get_open_orders() -> list:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM orders WHERE status IN ('NEW','ACKED','PARTIALLY_FILLED')"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Position persistence ─────────────────────────────────────────────────────

def upsert_position(symbol: str, exchange: str, quantity: float,
                    avg_entry: Optional[float], realized_pnl: float,
                    unrealized_pnl: float) -> None:
    conn = get_connection()
    conn.execute("""
        INSERT INTO positions
            (symbol, exchange, quantity, avg_entry, realized_pnl, unrealized_pnl, updated_ts)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(symbol, exchange) DO UPDATE SET
            quantity       = excluded.quantity,
            avg_entry      = excluded.avg_entry,
            realized_pnl   = excluded.realized_pnl,
            unrealized_pnl = excluded.unrealized_pnl,
            updated_ts     = excluded.updated_ts
    """, (symbol, exchange, quantity, avg_entry, realized_pnl, unrealized_pnl, time.time()))
    conn.commit()
    conn.close()


def get_all_positions() -> list:
    conn = get_connection()
    rows = conn.execute("SELECT * FROM positions WHERE quantity != 0").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Signal logging ───────────────────────────────────────────────────────────

def log_signal(strategy: str, symbol: str, exchange: str,
               signal_type: str, score: float, details: dict = None) -> None:
    conn = get_connection()
    conn.execute("""
        INSERT INTO strategy_signals (ts, strategy, symbol, exchange, signal_type, score, details)
        VALUES (?,?,?,?,?,?,?)
    """, (time.time(), strategy, symbol, exchange, signal_type, score, json.dumps(details or {})))
    conn.commit()
    conn.close()


# ─── Risk event logging ───────────────────────────────────────────────────────

def log_risk_event(event_type: str, details: str, action: str = "") -> None:
    conn = get_connection()
    conn.execute("""
        INSERT INTO risk_events (ts, event_type, details, action_taken)
        VALUES (?,?,?,?)
    """, (time.time(), event_type, details, action))
    conn.commit()
    conn.close()


# ─── Account snapshot ─────────────────────────────────────────────────────────

def save_account_snapshot(exchange: str, balances: dict) -> None:
    conn = get_connection()
    now = time.time()
    for currency, data in balances.items():
        if data.get("total", 0) > 0:
            conn.execute("""
                INSERT INTO account_snapshots (ts, exchange, currency, free, used, total)
                VALUES (?,?,?,?,?,?)
            """, (now, exchange, currency,
                  data.get("free", 0), data.get("used", 0), data.get("total", 0)))
    conn.commit()
    conn.close()
