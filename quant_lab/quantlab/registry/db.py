from __future__ import annotations

import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


def registry_path(*, project_root: Optional[Path] = None) -> Path:
    """
    Default registry DB location:
      <project_root>/data/quantlab_registry.db
    """
    if project_root is None:
        project_root = Path(__file__).resolve().parents[2]
    return Path(project_root) / "data" / "quantlab_registry.db"


@dataclass(frozen=True)
class RegistryDB:
    path: Path

    def connect(self) -> sqlite3.Connection:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.path))
        conn.row_factory = sqlite3.Row
        # Safety: enforce append-only at the DB layer and keep history.
        conn.execute("PRAGMA foreign_keys = ON;")
        try:
            conn.execute("PRAGMA journal_mode = WAL;")
        except Exception:
            pass
        self._init_schema(conn)
        return conn

    def _init_schema(self, conn: sqlite3.Connection) -> None:
        # Runs table: one row per run_id.
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS runs (
              run_id TEXT PRIMARY KEY,
              engine_type TEXT,
              timestamp TEXT,
              config_hash TEXT,
              composite_code_hash TEXT,
              data_sha256 TEXT,
              provider TEXT,
              oos_sharpe REAL,
              cagr REAL,
              max_dd REAL,
              deflated_sharpe REAL,
              pbo REAL,
              regime TEXT,
              drift_flag INTEGER
            );
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS diagnostics (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id TEXT,
              metric_name TEXT,
              value TEXT,
              threshold TEXT,
              status TEXT,
              created_utc TEXT
            );
            """
        )

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ensemble_weights (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              run_id TEXT,
              strategy_name TEXT,
              weight REAL,
              regime TEXT,
              created_utc TEXT
            );
            """
        )

        # Append-only enforcement: block UPDATE/DELETE.
        for table in ("runs", "diagnostics", "ensemble_weights"):
            conn.execute(
                f"""
                CREATE TRIGGER IF NOT EXISTS {table}_no_update
                BEFORE UPDATE ON {table}
                BEGIN
                  SELECT RAISE(ABORT, '{table} is append-only (UPDATE not allowed)');
                END;
                """
            )
            conn.execute(
                f"""
                CREATE TRIGGER IF NOT EXISTS {table}_no_delete
                BEFORE DELETE ON {table}
                BEGIN
                  SELECT RAISE(ABORT, '{table} is append-only (DELETE not allowed)');
                END;
                """
            )

        # Helpful indexes.
        conn.execute("CREATE INDEX IF NOT EXISTS runs_engine_ts ON runs(engine_type, timestamp);")
        conn.execute("CREATE INDEX IF NOT EXISTS diag_run ON diagnostics(run_id);")
        conn.execute("CREATE INDEX IF NOT EXISTS ew_run ON ensemble_weights(run_id);")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ew_unique ON ensemble_weights(run_id, strategy_name);"
        )

        conn.commit()


def get_default_db() -> RegistryDB:
    override = os.environ.get("QUANTLAB_REGISTRY_PATH", "").strip()
    if override:
        return RegistryDB(path=Path(override).expanduser().resolve())
    return RegistryDB(path=registry_path())

