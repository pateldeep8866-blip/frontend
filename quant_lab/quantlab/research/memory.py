from __future__ import annotations

import sqlite3
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, Iterable


MEM_DB = Path("/Users/juanramirez/NOVA/NOVA_LAB/QUANT_LAB/data/research_memory.db")


def _conn() -> sqlite3.Connection:
    MEM_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(MEM_DB)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS research_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            event_type TEXT NOT NULL,
            sentiment REAL,
            severity REAL,
            time_horizon TEXT,
            title TEXT,
            source_url TEXT,
            source_domain TEXT,
            source_confidence REAL,
            published_utc TEXT,
            generated_utc TEXT,
            regime TEXT,
            asset_class TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS event_outcomes (
            event_id INTEGER,
            ticker TEXT,
            return_1d REAL,
            return_5d REAL,
            return_20d REAL,
            measured_utc TEXT
        )
        """
    )
    conn.commit()
    return conn


def store_events(events: Iterable, regime: str, registry: Dict[str, Dict[str, str]]) -> int:
    items = list(events)
    if not items:
        return 0
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    conn = _conn()
    rows = []
    for ev in items:
        d = asdict(ev)
        asset_class = registry.get(d.get("ticker", ""), {}).get("asset_class", "unknown")
        rows.append(
            (
                d.get("ticker"),
                d.get("event_type"),
                d.get("sentiment"),
                d.get("severity"),
                d.get("time_horizon"),
                d.get("title"),
                d.get("source_url"),
                d.get("source_domain"),
                d.get("source_confidence"),
                d.get("published_utc"),
                now,
                regime,
                asset_class,
            )
        )
    conn.executemany(
        """
        INSERT INTO research_events (
            ticker,event_type,sentiment,severity,time_horizon,title,source_url,
            source_domain,source_confidence,published_utc,generated_utc,regime,asset_class
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        """,
        rows,
    )
    conn.commit()
    n = len(rows)
    conn.close()
    return n


def event_effectiveness(event_type: str, regime: str, asset_class: str, lookback_days: int = 365) -> float:
    """Return multiplicative prior in [0.7, 1.3] based on historic 5d outcomes.

    If no linked outcomes exist yet, returns 1.0 (neutral).
    """
    since = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).isoformat().replace("+00:00", "Z")
    conn = _conn()
    row = conn.execute(
        """
        SELECT AVG(o.return_5d)
        FROM research_events e
        JOIN event_outcomes o ON o.event_id = e.id
        WHERE e.event_type = ?
          AND e.regime = ?
          AND e.asset_class = ?
          AND e.generated_utc >= ?
          AND o.return_5d IS NOT NULL
        """,
        (event_type, regime, asset_class, since),
    ).fetchone()
    conn.close()
    avg5 = row[0] if row else None
    if avg5 is None:
        return 1.0
    # Map average outcome to a bounded multiplier.
    # +5% avg -> 1.2, -5% avg -> 0.8 (clamped).
    mult = 1.0 + max(-0.2, min(0.2, float(avg5) * 4.0))
    return max(0.7, min(1.3, mult))
