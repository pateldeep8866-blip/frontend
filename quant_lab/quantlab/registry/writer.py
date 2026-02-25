from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from quantlab.registry.db import RegistryDB, get_default_db
from quantlab.registry.promotion import decide_promotion_state


def _iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _as_float(x: Any) -> Optional[float]:
    try:
        v = float(x)
    except Exception:
        return None
    if v != v:  # NaN
        return None
    if v == float("inf") or v == float("-inf"):
        return None
    return v


def _get(d: Dict[str, Any], *keys: str) -> Any:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _extract_provider(manifest: Dict[str, Any]) -> str:
    dp = manifest.get("data_provenance") if isinstance(manifest.get("data_provenance"), dict) else {}
    prov = str((dp or {}).get("provider_name") or "").strip()
    if prov:
        return prov
    ds = str(manifest.get("data_source") or "").strip()
    return ds or "unknown"


def _extract_regime(metrics: Dict[str, Any]) -> str:
    # Morning engine stores regime in metrics['regime'].
    r = metrics.get("regime")
    if isinstance(r, dict):
        lbl = str(r.get("label") or "").strip()
        return lbl
    return ""


def _extract_deflated_sharpe_prob(metrics: Dict[str, Any]) -> Optional[float]:
    # Strategies/ensemble store rigor.deflated_sharpe.prob
    rig = metrics.get("rigor")
    if not isinstance(rig, dict):
        return None
    ds = rig.get("deflated_sharpe")
    if not isinstance(ds, dict):
        return None
    return _as_float(ds.get("prob"))


def _extract_pbo(metrics: Dict[str, Any]) -> Optional[float]:
    rig = metrics.get("rigor")
    if not isinstance(rig, dict):
        return None
    pbo = rig.get("pbo")
    if isinstance(pbo, dict):
        return _as_float(pbo.get("pbo"))
    return None


def _drift_flag_from_metrics(metrics: Dict[str, Any]) -> Optional[bool]:
    mon = metrics.get("monitoring")
    if isinstance(mon, dict):
        d0 = mon.get("drift")
        if isinstance(d0, dict) and "drift_flag" in d0:
            try:
                return bool(d0.get("drift_flag"))
            except Exception:
                return None
    rig = metrics.get("rigor")
    if not isinstance(rig, dict):
        return None
    d = rig.get("drift")
    if not isinstance(d, dict):
        return None
    psi = _as_float(d.get("psi"))
    z = _as_float(d.get("mean_shift_z"))
    if psi is None and z is None:
        return None
    # Conservative default thresholds.
    if psi is not None and psi >= 0.10:
        return True
    if z is not None and abs(z) >= 2.0:
        return True
    return False


def _extract_oos_block(metrics: Dict[str, Any]) -> Dict[str, Any]:
    # Walk-forward runs often store OOS metrics under 'oos'.
    oos = metrics.get("oos")
    if isinstance(oos, dict) and oos:
        return oos
    # Otherwise use 'strategy'.
    strat = metrics.get("strategy")
    if isinstance(strat, dict) and strat:
        return strat
    return {}


@dataclass(frozen=True)
class DiagnosticRow:
    metric_name: str
    value: str
    threshold: str
    status: str  # PASS/FAIL/INFO


class RegistryWriter:
    """
    Append-only SQLite registry writer.

    Notes:
    - Respects env var `QUANTLAB_REGISTRY_DISABLE=1` to disable writes (used by preflight rollback).
    - Respects env var `QUANTLAB_REGISTRY_PATH` to override DB path (tests).
    """

    def __init__(self, db: Optional[RegistryDB] = None):
        self._db = db or get_default_db()

    @property
    def path(self) -> Path:
        return Path(self._db.path)

    def log_run(
        self,
        *,
        run_dir: Path,
        manifest: Dict[str, Any],
        metrics: Dict[str, Any],
        diagnostics: Optional[Iterable[DiagnosticRow]] = None,
    ) -> None:
        if os.environ.get("QUANTLAB_REGISTRY_DISABLE", "").strip() in {"1", "true", "yes"}:
            return

        run_id = str(manifest.get("run_id") or run_dir.name)
        engine_type = str(_get(manifest, "strategy", "name") or _get(manifest, "strategy_name") or metrics.get("mode") or "")
        created_utc = str(manifest.get("created_utc") or "")
        config_hash = str(manifest.get("config_hash") or "")
        code_hash = str(manifest.get("composite_code_hash") or "")
        data_sha = str(manifest.get("data_sha256") or "")
        provider = _extract_provider(manifest)
        regime = _extract_regime(metrics)

        oos = _extract_oos_block(metrics)
        oos_sharpe = _as_float(oos.get("sharpe"))
        cagr = _as_float(oos.get("cagr"))
        max_dd = _as_float(oos.get("max_drawdown"))

        deflated = _extract_deflated_sharpe_prob(metrics)
        pbo = _extract_pbo(metrics)
        drift = _drift_flag_from_metrics(metrics)

        drift_i = None if drift is None else (1 if drift else 0)

        now = _iso_utc_now()

        conn = self._db.connect()
        try:
            with conn:
                # Promotion state depends on history in the registry, so compute it before inserting
                # the current run's diagnostics.
                cand_hist = 0
                try:
                    cur = conn.execute(
                        """
                        SELECT COUNT(1) AS n
                        FROM diagnostics d
                        JOIN runs r ON r.run_id = d.run_id
                        WHERE r.engine_type = ?
                          AND d.metric_name = 'model_state'
                          AND d.value IN ('candidate', 'production');
                        """,
                        (engine_type,),
                    )
                    row = cur.fetchone()
                    cand_hist = int(row["n"] if row is not None else 0)
                except Exception:
                    cand_hist = 0

                promotion = decide_promotion_state(
                    engine_type=engine_type,
                    oos_sharpe=oos_sharpe,
                    deflated_sharpe_prob=deflated,
                    pbo=pbo,
                    drift_flag=drift,
                    candidate_history_count=cand_hist,
                )

                conn.execute(
                    """
                    INSERT OR IGNORE INTO runs(
                      run_id, engine_type, timestamp, config_hash, composite_code_hash, data_sha256, provider,
                      oos_sharpe, cagr, max_dd, deflated_sharpe, pbo, regime, drift_flag
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?);
                    """,
                    (
                        run_id,
                        engine_type,
                        created_utc,
                        config_hash,
                        code_hash,
                        data_sha,
                        provider,
                        oos_sharpe,
                        cagr,
                        max_dd,
                        deflated,
                        pbo,
                        regime,
                        drift_i,
                    ),
                )

                # Optional: ingest ensemble weights if present.
                ew_path = Path(run_dir) / "ensemble_weights.json"
                if ew_path.exists():
                    try:
                        obj = json.loads(ew_path.read_text(encoding="utf-8"))
                        avg = obj.get("avg_weights", {})
                        if isinstance(avg, dict):
                            for strat, w in avg.items():
                                wf = _as_float(w)
                                if wf is None:
                                    continue
                                conn.execute(
                                    """
                                    INSERT OR IGNORE INTO ensemble_weights(run_id, strategy_name, weight, regime, created_utc)
                                    VALUES (?,?,?,?,?);
                                    """,
                                    (run_id, str(strat), float(wf), regime, now),
                                )
                    except Exception:
                        # Registry should not crash the run if weights can't be parsed.
                        pass

                # Diagnostics rows (append-only).
                diag_rows = list(diagnostics or [])
                # Always log drift flag and provider as INFO diagnostics for traceability.
                diag_rows.append(DiagnosticRow("provider", provider, "", "INFO"))
                if drift is not None:
                    diag_rows.append(DiagnosticRow("drift_flag", str(int(drift)), "psi>=0.10 or |z|>=2", "INFO"))
                # Promotion workflow diagnostics.
                for d in promotion.diagnostics:
                    diag_rows.append(
                        DiagnosticRow(
                            metric_name=str(d.get("metric_name", "")),
                            value=str(d.get("value", "")),
                            threshold=str(d.get("threshold", "")),
                            status=str(d.get("status", "INFO")),
                        )
                    )

                for dr in diag_rows:
                    conn.execute(
                        """
                        INSERT INTO diagnostics(run_id, metric_name, value, threshold, status, created_utc)
                        VALUES (?,?,?,?,?,?);
                        """,
                        (run_id, str(dr.metric_name), str(dr.value), str(dr.threshold), str(dr.status), now),
                    )
        finally:
            conn.close()

    def count_runs(self) -> int:
        conn = self._db.connect()
        try:
            cur = conn.execute("SELECT COUNT(1) AS n FROM runs;")
            row = cur.fetchone()
            return int(row["n"] if row is not None else 0)
        finally:
            conn.close()

    def latest_runs(self, *, limit: int = 5) -> List[Dict[str, Any]]:
        conn = self._db.connect()
        try:
            cur = conn.execute(
                "SELECT run_id, engine_type, timestamp, oos_sharpe, cagr, max_dd, regime, drift_flag FROM runs "
                "ORDER BY timestamp DESC, run_id DESC LIMIT ?;",
                (int(limit),),
            )
            return [dict(r) for r in cur.fetchall()]
        finally:
            conn.close()
