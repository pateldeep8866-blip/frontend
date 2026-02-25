from __future__ import annotations

import csv
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional


INDEX_COLUMNS = [
    "run_id",
    "created_utc",
    "ticker",
    "start",
    "end",
    "mode",
    "short",
    "long",
    "sharpe",
    "max_dd",
    "cagr",
    "benchmark_sharpe",
    "benchmark_cagr",
    "oos_sharpe",
    "oos_max_dd",
    "significant",
]


def _get(d: Dict[str, Any], *keys: str) -> Optional[Any]:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def update_run_index(run_dir: Path, metrics: Dict[str, Any], manifest: Dict[str, Any]) -> Path:
    """
    Update the run registry for the given run.

    Primary registry: SQLite (`data/quantlab_registry.db`) via `quantlab.registry`.

    Legacy (optional): CSV index at `reports/runs/index.csv`.
    - Disabled by default to keep the registry append-only and avoid destructive rewrites.
    - Enable by setting env var `QUANTLAB_LEGACY_INDEX_CSV=1`.
    """
    run_dir = Path(run_dir)
    index_path = run_dir.parent / "index.csv"

    # -----------------------
    # SQLite registry (v2)
    # -----------------------
    try:
        from quantlab.registry.writer import RegistryWriter

        RegistryWriter().log_run(run_dir=run_dir, manifest=manifest, metrics=metrics)
    except Exception as e:
        # Registry failures should not crash the research run, but they should not be silent.
        try:
            print(f"[WARN] registry write failed: {e}", file=sys.stderr, flush=True)
        except Exception:
            pass

    # -----------------------
    # Legacy CSV index (v1)
    # -----------------------
    if os.environ.get("QUANTLAB_LEGACY_INDEX_CSV", "").strip() not in {"1", "true", "yes"}:
        return index_path

    params = _get(manifest, "strategy", "parameters") or {}

    mode = str(metrics.get("mode") or params.get("mode") or "single")
    if mode not in {
        "single",
        "walkforward",
        "replay_game",
        "morning_signal_engine",
        "ensemble_engine",
        "ou_mean_reversion",
        "momentum_accel",
    }:
        mode = "single"

    if mode == "walkforward":
        short_val = "wf"
        long_val = "wf"
    else:
        short_val = params.get("short_window") or params.get("short") or ""
        long_val = params.get("long_window") or params.get("long") or ""

    strat = metrics.get("strategy") or {}
    bench = metrics.get("benchmark") or {}
    oos = metrics.get("oos") or (strat if mode == "walkforward" else {})

    def _cell(v: Any) -> str:
        if v is None:
            return ""
        s = str(v)
        if s.lower() in {"nan", "none"}:
            return ""
        return s

    significant = ""
    if mode == "walkforward":
        sig_any = (
            _get(metrics, "walkforward", "significant_any")
            if isinstance(metrics.get("walkforward"), dict)
            else None
        )
        if sig_any is None:
            sig_any = strat.get("significant_any")
        if sig_any is None:
            sig_any = oos.get("significant_any")
        if sig_any is not None:
            significant = "1" if bool(sig_any) else "0"

    row = {
        "run_id": manifest.get("run_id", ""),
        "created_utc": manifest.get("created_utc", ""),
        "ticker": params.get("ticker", ""),
        "start": params.get("start", ""),
        "end": params.get("end", ""),
        "mode": mode,
        "short": str(short_val),
        "long": str(long_val),
        "sharpe": _cell(strat.get("sharpe", "")),
        "max_dd": _cell(strat.get("max_drawdown", "")),
        "cagr": _cell(strat.get("cagr", "")),
        "benchmark_sharpe": _cell(bench.get("sharpe", "")),
        "benchmark_cagr": _cell(bench.get("cagr", "")),
        "oos_sharpe": _cell(oos.get("sharpe", "")) if mode == "walkforward" else "",
        "oos_max_dd": _cell(oos.get("max_drawdown", "")) if mode == "walkforward" else "",
        "significant": significant,
    }

    # Load existing rows (if any), update/append by run_id, then rewrite.
    rows = []
    if index_path.exists():
        with index_path.open("r", newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                rows.append(r)

    by_id = {r.get("run_id", ""): r for r in rows if r.get("run_id")}
    by_id[row["run_id"]] = row
    out_rows = list(by_id.values())

    # Stable-ish order: sort by created_utc then run_id.
    out_rows.sort(key=lambda r: (r.get("created_utc", ""), r.get("run_id", "")))

    with index_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=INDEX_COLUMNS)
        writer.writeheader()
        for r in out_rows:
            writer.writerow({c: r.get(c, "") for c in INDEX_COLUMNS})

    return index_path
