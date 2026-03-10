from __future__ import annotations

import argparse
import json
import math
import sqlite3
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

DB_PATH = Path("/Users/juanramirez/NOVA/NOVA_LAB/data/trades.db")
REPORT_PATH = Path("/Users/juanramirez/NOVA/NOVA_LAB/QUANT_LAB/reports/learning_outcome_report.json")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def to_float(v: Any) -> Optional[float]:
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except Exception:
        return None


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS trade_outcomes (
          outcome_id TEXT PRIMARY KEY,
          trade_id TEXT,
          evaluated_utc TEXT,
          days_held INTEGER,
          exit_price REAL,
          return_pct REAL,
          return_1d REAL,
          return_5d REAL,
          return_21d REAL,
          hit_stop_loss INTEGER,
          hit_take_profit INTEGER,
          outcome TEXT,
          market_regime_during_hold TEXT,
          vix_during_hold_avg REAL
        )
        """
    )


def fetch_quote(symbol: str) -> Dict[str, Any]:
    url = "https://query1.finance.yahoo.com/v7/finance/quote?" + urllib.parse.urlencode({"symbols": symbol})
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    row = (data.get("quoteResponse", {}).get("result") or [{}])[0]
    return {
        "price": to_float(row.get("regularMarketPrice")),
        "pct": to_float(row.get("regularMarketChangePercent")),
    }


def fetch_chart(symbol: str) -> List[Dict[str, Any]]:
    query = urllib.parse.urlencode({"range": "6mo", "interval": "1d"})
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(symbol)}?{query}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    result = (data.get("chart", {}).get("result") or [{}])[0]
    ts = result.get("timestamp") or []
    closes = (((result.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [])
    rows: List[Dict[str, Any]] = []
    for t, c in zip(ts, closes):
        px = to_float(c)
        if px is None:
            continue
        rows.append({"t": int(t) * 1000, "c": px})
    return rows


def close_at_or_after(rows: List[Dict[str, Any]], ts_ms: int) -> Optional[float]:
    for r in rows:
        if int(r.get("t", 0)) >= ts_ms:
            return to_float(r.get("c"))
    if rows:
        return to_float(rows[-1].get("c"))
    return None


def directional_return(action: str, entry: float, exit_price: float) -> Optional[float]:
    if entry <= 0:
        return None
    if action.upper() == "SELL":
        return (entry - exit_price) / entry
    return (exit_price - entry) / entry


def classify_outcome(ret: Optional[float]) -> str:
    if ret is None:
        return "NEUTRAL"
    if ret > 0.002:
        return "WIN"
    if ret < -0.002:
        return "LOSS"
    return "NEUTRAL"


def evaluate_pending(conn: sqlite3.Connection, limit: int = 500) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat().replace("+00:00", "Z")
    cur = conn.execute(
        """
        SELECT t.*
        FROM trades t
        LEFT JOIN trade_outcomes o ON o.trade_id = t.trade_id
        WHERE o.trade_id IS NULL
          AND t.created_utc <= ?
          AND t.action IN ('BUY','SELL')
        ORDER BY t.created_utc ASC
        LIMIT ?
        """,
        (cutoff, int(limit)),
    )
    rows = cur.fetchall()

    inserted = 0
    for row in rows:
        trade = dict(row)
        ticker = str(trade.get("ticker") or "").upper().strip()
        entry = to_float(trade.get("entry_price")) or 0.0
        if not ticker or entry <= 0:
            continue
        try:
            quote = fetch_quote(ticker)
            chart = fetch_chart(ticker)
            vix = fetch_quote("^VIX")
            exit_price = to_float(quote.get("price"))
            if exit_price is None:
                continue

            created = datetime.fromisoformat(str(trade["created_utc"]).replace("Z", "+00:00"))
            created_ms = int(created.timestamp() * 1000)
            d1 = close_at_or_after(chart, created_ms + 1 * 24 * 3600 * 1000)
            d5 = close_at_or_after(chart, created_ms + 5 * 24 * 3600 * 1000)
            d21 = close_at_or_after(chart, created_ms + 21 * 24 * 3600 * 1000)

            action = str(trade.get("action") or "BUY").upper()
            ret_pct = directional_return(action, entry, exit_price)
            ret_1d = directional_return(action, entry, d1) if d1 is not None else None
            ret_5d = directional_return(action, entry, d5) if d5 is not None else None
            ret_21d = directional_return(action, entry, d21) if d21 is not None else None

            stop = to_float(trade.get("stop_loss"))
            target = to_float(trade.get("take_profit"))
            is_buy = action != "SELL"
            hit_stop = 1 if (stop is not None and ((is_buy and exit_price <= stop) or ((not is_buy) and exit_price >= stop))) else 0
            hit_target = 1 if (target is not None and ((is_buy and exit_price >= target) or ((not is_buy) and exit_price <= target))) else 0

            days_held = max(1, int((datetime.now(timezone.utc) - created).total_seconds() // 86400))

            conn.execute(
                """
                INSERT INTO trade_outcomes (
                  outcome_id, trade_id, evaluated_utc, days_held, exit_price,
                  return_pct, return_1d, return_5d, return_21d,
                  hit_stop_loss, hit_take_profit, outcome,
                  market_regime_during_hold, vix_during_hold_avg
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid4()),
                    trade["trade_id"],
                    now_iso(),
                    days_held,
                    exit_price,
                    ret_pct,
                    ret_1d,
                    ret_5d,
                    ret_21d,
                    hit_stop,
                    hit_target,
                    classify_outcome(ret_pct),
                    trade.get("market_regime") or "unknown",
                    to_float(vix.get("price")),
                ),
            )
            inserted += 1
        except Exception:
            continue

    conn.commit()
    return inserted


def make_report(conn: sqlite3.Connection) -> Dict[str, Any]:
    total = int(conn.execute("SELECT COUNT(*) FROM trades").fetchone()[0])
    started = conn.execute("SELECT MIN(created_utc) FROM trades").fetchone()[0]

    rows = conn.execute(
        """
        SELECT t.market_regime, o.return_pct, o.return_5d, o.outcome
        FROM trades t
        JOIN trade_outcomes o ON o.trade_id = t.trade_id
        WHERE t.action IN ('BUY','SELL')
        """
    ).fetchall()

    evaluated = len(rows)
    wins = sum(1 for r in rows if str(r[3]) == "WIN")
    win_rate = (wins / evaluated) if evaluated else 0.0

    by_regime_cur = conn.execute(
        """
        SELECT COALESCE(t.market_regime, 'unknown') AS regime,
               COUNT(*) AS n,
               SUM(CASE WHEN o.outcome='WIN' THEN 1 ELSE 0 END) AS wins,
               AVG(o.return_pct) AS avg_return,
               AVG(o.return_5d) AS avg_5d
        FROM trades t
        JOIN trade_outcomes o ON o.trade_id=t.trade_id
        WHERE t.action IN ('BUY','SELL')
        GROUP BY COALESCE(t.market_regime, 'unknown')
        """
    )
    by_regime = []
    for regime, n, rwins, avg_ret, avg_5d in by_regime_cur.fetchall():
        n = int(n or 0)
        by_regime.append(
            {
                "regime": str(regime),
                "trades": n,
                "win_rate": (float(rwins or 0) / n) if n else 0.0,
                "avg_return": to_float(avg_ret) or 0.0,
                "avg_return_5d": to_float(avg_5d) or 0.0,
            }
        )

    best = max(by_regime, key=lambda x: x["avg_return"], default=None)
    worst = min(by_regime, key=lambda x: x["avg_return"], default=None)

    ret_vals = [to_float(r[1]) for r in rows if to_float(r[1]) is not None]
    sharpe = None
    if ret_vals:
      mean = sum(ret_vals) / len(ret_vals)
      var = sum((x - mean) ** 2 for x in ret_vals) / len(ret_vals)
      if var > 0:
          sharpe = mean / math.sqrt(var)

    weights = conn.execute("SELECT * FROM weight_history ORDER BY created_utc DESC LIMIT 1").fetchone()
    w = dict(weights) if weights else {}

    report = {
        "generated_utc": now_iso(),
        "db_path": str(DB_PATH),
        "total_trades_logged": total,
        "data_collection_started": started,
        "evaluated_trades": evaluated,
        "win_rate": win_rate,
        "win_rate_risk_on": next((x["win_rate"] for x in by_regime if x["regime"] == "risk_on"), None),
        "win_rate_risk_off": next((x["win_rate"] for x in by_regime if x["regime"] == "risk_off"), None),
        "average_5d_return": (sum((to_float(r[2]) or 0.0) for r in rows) / len(rows)) if rows else 0.0,
        "best_regime": best["regime"] if best else None,
        "best_performing_conditions": best,
        "worst_performing_conditions": worst,
        "current_weight_version": w.get("version_id", "v1"),
        "last_weight_update": w.get("created_utc"),
        "sharpe_ratio": sharpe,
        "next_learning_run": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
        "progress": {"current": total, "target": 200, "pct": min(100.0, (total / 200.0) * 100.0)},
        "by_regime": by_regime,
    }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate simulator trade outcomes and generate learning report")
    parser.add_argument("--db", type=str, default=str(DB_PATH))
    parser.add_argument("--report", type=str, default=str(REPORT_PATH))
    parser.add_argument("--limit", type=int, default=500)
    args = parser.parse_args()

    db_path = Path(args.db)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    ensure_schema(conn)
    inserted = evaluate_pending(conn, limit=max(1, int(args.limit)))
    report = make_report(conn)
    report["evaluated_new"] = inserted

    out_path = Path(args.report)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    print(json.dumps({"ok": True, "evaluated_new": inserted, "report": str(out_path)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
