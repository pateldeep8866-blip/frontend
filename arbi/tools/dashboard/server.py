# tools/dashboard/server.py
# ARTHASTRA ARBI Dashboard — Flask backend
# Run: python -m tools.dashboard.server  (from arbi/ root)

from __future__ import annotations

import json
import os
import queue
import socket
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, Response, jsonify, render_template_string

# ── Paths ─────────────────────────────────────────────────────────────────────

ARBI_ROOT = Path(__file__).resolve().parents[2]   # .../arbi/
SPOT_DB    = ARBI_ROOT / "simulation_knowledge.db"
PERP_DB    = ARBI_ROOT / "perp_simulation_knowledge.db"
LIVE_STATE = Path("/tmp/arbi_live_state.json")

FLOOR_USD  = 82.50
STARTING_BALANCE = 100.0   # default starting balance

# ── Engine configs ─────────────────────────────────────────────────────────────

ENGINES = [
    {
        "name":     "Spot 1×",
        "user":     "default",
        "db":       "spot",
        "leverage": 1,
        "table":    "sim_trades",
        "color":    "#00D4A8",
    },
    {
        "name":     "Perp 3×",
        "user":     "perp",
        "db":       "perp",
        "leverage": 3,
        "table":    "perp_sim_trades",
        "color":    "#7C5CFC",
    },
    {
        "name":     "Scalp 2×",
        "user":     "perp_scalp",
        "db":       "perp",
        "leverage": 2,
        "table":    "perp_sim_trades",
        "color":    "#FF6B35",
    },
]

# ── DB helpers ────────────────────────────────────────────────────────────────

def _db_path(which: str) -> Path:
    return SPOT_DB if which == "spot" else PERP_DB


def _query(db_path: Path, sql: str, params=()):
    if not db_path.exists():
        return []
    try:
        with sqlite3.connect(str(db_path), timeout=5) as conn:
            conn.row_factory = sqlite3.Row
            return [dict(r) for r in conn.execute(sql, params)]
    except Exception as exc:
        print(f"[DB ERROR] {exc}")
        return []


def _query_one(db_path: Path, sql: str, params=()):
    rows = _query(db_path, sql, params)
    return rows[0] if rows else {}


# ── Engine state builder ───────────────────────────────────────────────────────

def _engine_state(cfg: dict) -> dict:
    db   = _db_path(cfg["db"])
    tbl  = cfg["table"]
    user = cfg["user"]

    # ── Session balance from sessions table ──────────────────────────────────
    is_perp = cfg["db"] == "perp"
    if is_perp:
        sess = _query_one(db,
            "SELECT balance, last_seen FROM perp_sim_sessions "
            "WHERE sim_user=? ORDER BY last_seen DESC LIMIT 1", (user,))
        balance   = float(sess.get("balance", STARTING_BALANCE))
        last_seen = float(sess.get("last_seen", 0))
    else:
        # Spot has no sessions table — derive balance from trades
        balance   = STARTING_BALANCE
        last_seen = time.time()

    # ── Closed trades ─────────────────────────────────────────────────────────
    closed = _query(db,
        f"SELECT * FROM {tbl} WHERE sim_user=? AND status='CLOSED' ORDER BY ts DESC",
        (user,))

    trade_count = len(closed)
    win_count   = sum(1 for t in closed if t.get("profitable") == 1)
    win_rate    = round(win_count / trade_count * 100, 1) if trade_count else 0.0

    # Reconstruct balance for spot engine from trade pnl_usd sum
    if not is_perp:
        # Sum pnl_usd via size_usd * pnl_pct for spot (no pnl_usd column)
        pnl_sum = 0.0
        for t in closed:
            sz  = t.get("size_usd") or 5.0
            pct = t.get("pnl_pct") or 0.0
            pnl_sum += sz * pct / 100.0
        balance = STARTING_BALANCE + pnl_sum
    else:
        # Sum pnl_usd for perp
        pnl_sum = sum(float(t.get("pnl_usd") or 0) for t in closed)

    start_balance = STARTING_BALANCE
    pnl_usd       = round(balance - start_balance, 4)
    pnl_pct       = round(pnl_usd / start_balance * 100, 3)

    avg_pnl_pct   = round(
        sum(float(t.get("pnl_pct") or 0) for t in closed) / trade_count, 4
    ) if trade_count else 0.0

    # ── Best / worst ──────────────────────────────────────────────────────────
    closed_with_pnl = [t for t in closed if t.get("pnl_pct") is not None]
    best  = max(closed_with_pnl, key=lambda t: t.get("pnl_pct", 0), default={})
    worst = min(closed_with_pnl, key=lambda t: t.get("pnl_pct", 0), default={})

    # ── Recent 5 closed ───────────────────────────────────────────────────────
    recent = []
    for t in closed[:5]:
        recent.append({
            "symbol":     t.get("symbol", ""),
            "strategy":   t.get("strategy", ""),
            "side":       t.get("side", ""),
            "pnl_pct":    round(float(t.get("pnl_pct") or 0), 4),
            "exit_reason": t.get("exit_reason", ""),
            "ts":         t.get("ts", 0),
            "engine":     cfg["name"],
            "color":      cfg["color"],
        })

    # Sparkline: last 10 pnl values
    sparkline = [round(float(t.get("pnl_pct") or 0), 4) for t in closed[:10]]
    sparkline.reverse()

    # ── Open positions ────────────────────────────────────────────────────────
    open_rows = _query(db,
        f"SELECT * FROM {tbl} WHERE sim_user=? AND status='OPEN' ORDER BY ts DESC",
        (user,))
    open_trades = []
    for t in open_rows:
        open_trades.append({
            "symbol":      t.get("symbol", ""),
            "side":        t.get("side", "BUY"),
            "strategy":    t.get("strategy", ""),
            "entry_price": round(float(t.get("entry_price") or 0), 6),
            "liq_price":   round(float(t.get("liq_price") or 0), 6) if is_perp else None,
            "size_usd":    round(float(t.get("size_usd") or 0), 2),
            "leverage":    float(t.get("leverage") or 1),
            "score":       t.get("score_used"),
            "ts":          t.get("ts", 0),
            "engine":      cfg["name"],
            "color":       cfg["color"],
        })

    # ── Status ────────────────────────────────────────────────────────────────
    stale_thresh = 30   # seconds — if last_seen > 30s ago, mark STOPPED
    now = time.time()
    if is_perp:
        status = "FLOOR_HIT" if balance <= FLOOR_USD else (
            "RUNNING" if (now - last_seen) < stale_thresh else "STOPPED"
        )
    else:
        status = "RUNNING"   # spot engine has no sessions table

    return {
        "name":           cfg["name"],
        "user":           user,
        "leverage":       cfg["leverage"],
        "color":          cfg["color"],
        "balance":        round(balance, 4),
        "start_balance":  start_balance,
        "pnl_usd":        pnl_usd,
        "pnl_pct":        pnl_pct,
        "trade_count":    trade_count,
        "win_count":      win_count,
        "win_rate":       win_rate,
        "avg_pnl_pct":    avg_pnl_pct,
        "open_trades":    open_trades,
        "recent_trades":  recent,
        "sparkline":      sparkline,
        "best_trade":     _fmt_trade(best),
        "worst_trade":    _fmt_trade(worst),
        "status":         status,
    }


def _fmt_trade(t: dict) -> dict:
    if not t:
        return {}
    return {
        "symbol":   t.get("symbol", ""),
        "pnl_pct":  round(float(t.get("pnl_pct") or 0), 4),
        "strategy": t.get("strategy", ""),
        "side":     t.get("side", ""),
    }


# ── Full state ────────────────────────────────────────────────────────────────

def build_state() -> dict:
    engines = [_engine_state(cfg) for cfg in ENGINES]

    total_pnl  = round(sum(e["pnl_usd"] for e in engines), 4)
    best_eng   = max(engines, key=lambda e: e["pnl_usd"])["name"] if engines else ""

    # Collect all recent trades across engines, sort by ts
    all_recent = []
    for e in engines:
        all_recent.extend(e["recent_trades"])
    all_recent.sort(key=lambda t: t.get("ts", 0), reverse=True)

    # Collect all open trades
    all_open = []
    for e in engines:
        all_open.extend(e["open_trades"])

    raw_state = None
    if LIVE_STATE.exists():
        try:
            raw_state = json.loads(LIVE_STATE.read_text())
        except Exception:
            pass

    return {
        "updated_at":   datetime.now().strftime("%H:%M:%S"),
        "floor_usd":    FLOOR_USD,
        "engines":      engines,
        "leaderboard":  sorted(engines, key=lambda e: e["pnl_usd"], reverse=True),
        "total_pnl":    total_pnl,
        "best_engine":  best_eng,
        "all_recent":   all_recent[:15],
        "all_open":     all_open,
        "raw_state":    raw_state,
    }


# ── SSE broadcast ─────────────────────────────────────────────────────────────

_sse_clients: list[queue.Queue] = []
_sse_lock = threading.Lock()


def _broadcast_loop():
    while True:
        time.sleep(5)
        try:
            data = json.dumps(build_state())
            msg  = f"data: {data}\n\n"
            with _sse_lock:
                dead = []
                for q in _sse_clients:
                    try:
                        q.put_nowait(msg)
                    except queue.Full:
                        dead.append(q)
                for q in dead:
                    _sse_clients.remove(q)
        except Exception as exc:
            print(f"[SSE] broadcast error: {exc}")


threading.Thread(target=_broadcast_loop, daemon=True, name="SSEBroadcast").start()

# ── Flask app ─────────────────────────────────────────────────────────────────

app = Flask(__name__)

# Load index.html from same directory
_INDEX_PATH = Path(__file__).parent / "index.html"


@app.route("/")
def index():
    lan_ip = _get_lan_ip()
    html   = _INDEX_PATH.read_text()
    html   = html.replace("{{LAN_IP}}", lan_ip)
    return html


@app.route("/api/state")
def api_state():
    return jsonify(build_state())


@app.route("/stream")
def stream():
    q = queue.Queue(maxsize=20)
    with _sse_lock:
        _sse_clients.append(q)

    def generate():
        # Send initial state immediately
        try:
            yield f"data: {json.dumps(build_state())}\n\n"
        except Exception:
            pass
        while True:
            try:
                msg = q.get(timeout=30)
                yield msg
            except queue.Empty:
                yield ": keepalive\n\n"   # prevent nginx/proxy timeout
            except GeneratorExit:
                break
        with _sse_lock:
            try:
                _sse_clients.remove(q)
            except ValueError:
                pass

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={
            "Cache-Control":   "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":      "keep-alive",
        },
    )


# ── LAN IP ────────────────────────────────────────────────────────────────────

def _get_lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "localhost"


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    lan_ip = _get_lan_ip()
    print()
    print("┌─────────────────────────────────────────┐")
    print("│  ARTHASTRA Dashboard                    │")
    print(f"│  Local:  http://localhost:8888          │")
    print(f"│  Phone:  http://{lan_ip}:8888{' ' * max(0, 13 - len(lan_ip))}│")
    print("└─────────────────────────────────────────┘")
    print()
    app.run(host="0.0.0.0", port=8888, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
