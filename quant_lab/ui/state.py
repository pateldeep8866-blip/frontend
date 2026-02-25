from __future__ import annotations

import csv
import json
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence


def _f(x: Any, default: float = float("nan")) -> float:
    try:
        return float(x)
    except Exception:
        return float(default)


def _i(x: Any, default: int = 0) -> int:
    try:
        return int(float(x))
    except Exception:
        return int(default)


def _b(x: Any) -> bool:
    s = str(x).strip().lower()
    return s in {"1", "true", "yes", "y", "t"}


@dataclass(frozen=True)
class PickRow:
    ticker: str
    rank: int
    score: float
    vol: float
    mom_63: float
    mom_252: float
    corr_spy: float
    t_stat: float
    p_value: float
    passes_fdr: bool
    reasons: str


@dataclass(frozen=True)
class AllocationRow:
    ticker: str
    target_weight: float
    target_shares_placeholder: str
    vol: float
    risk_proxy: float


@dataclass(frozen=True)
class RegimeInfo:
    label: str
    confidence: float
    method: str
    inputs: Dict[str, Any]


@dataclass(frozen=True)
class RunPack:
    run_dir: Path
    manifest: Dict[str, Any]
    picks: List[PickRow]
    allocation: List[AllocationRow]
    regime: RegimeInfo
    metrics: Dict[str, Any]


def find_latest_run_dir(run_root: Path) -> Optional[Path]:
    run_root = Path(run_root)
    if not run_root.exists():
        return None

    candidates: List[Path] = []
    for p in run_root.iterdir():
        if not p.is_dir():
            continue
        if (p / "run_manifest.json").exists():
            candidates.append(p)

    if not candidates:
        return None

    def _key(p: Path) -> tuple[str, str]:
        # Prefer created_utc if parseable; else fallback to directory name.
        created = ""
        try:
            obj = json.loads((p / "run_manifest.json").read_text(encoding="utf-8"))
            created = str(obj.get("created_utc", ""))
        except Exception:
            created = ""
        return (created, p.name)

    candidates.sort(key=_key)
    return candidates[-1]


def _read_csv_dicts(path: Path) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    with Path(path).open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows.append({str(k): ("" if v is None else str(v)) for k, v in r.items()})
    return rows


def load_run_pack(run_dir: Path) -> RunPack:
    run_dir = Path(run_dir)
    manifest = json.loads((run_dir / "run_manifest.json").read_text(encoding="utf-8"))

    picks_path = run_dir / "picks.csv"
    alloc_path = run_dir / "allocation.csv"
    regime_path = run_dir / "regime.json"
    metrics_path = run_dir / "metrics.json"

    picks_rows = _read_csv_dicts(picks_path) if picks_path.exists() else []
    allocation_rows = _read_csv_dicts(alloc_path) if alloc_path.exists() else []

    picks: List[PickRow] = []
    for r in picks_rows:
        # Backward/forward compatible column names.
        vol = r.get("vol", r.get("volatility", ""))
        picks.append(
            PickRow(
                ticker=str(r.get("ticker", "")).upper(),
                rank=_i(r.get("rank", 0)),
                score=_f(r.get("score", float("nan"))),
                vol=_f(vol),
                mom_63=_f(r.get("mom_63", float("nan"))),
                mom_252=_f(r.get("mom_252", float("nan"))),
                corr_spy=_f(r.get("corr_spy", float("nan"))),
                t_stat=_f(r.get("t_stat", float("nan"))),
                p_value=_f(r.get("p_value", float("nan"))),
                passes_fdr=_b(r.get("passes_fdr", "0")),
                reasons=str(r.get("reasons", "")),
            )
        )

    allocation: List[AllocationRow] = []
    for r in allocation_rows:
        tw = r.get("target_weight", r.get("weight", "0"))
        risk_proxy = r.get("risk_proxy", r.get("risk_contribution_proxy", ""))
        allocation.append(
            AllocationRow(
                ticker=str(r.get("ticker", "")).upper(),
                target_weight=_f(tw, 0.0),
                target_shares_placeholder=str(r.get("target_shares_placeholder", "")),
                vol=_f(r.get("vol", float("nan"))),
                risk_proxy=_f(risk_proxy, float("nan")),
            )
        )

    regime_obj = json.loads(regime_path.read_text(encoding="utf-8")) if regime_path.exists() else {}
    regime = RegimeInfo(
        label=str(regime_obj.get("label", "neutral")),
        confidence=_f(regime_obj.get("confidence", 0.0), 0.0),
        method=str(regime_obj.get("method", "")),
        inputs=dict(regime_obj.get("inputs", {}) or {}),
    )

    metrics = json.loads(metrics_path.read_text(encoding="utf-8")) if metrics_path.exists() else {}

    return RunPack(
        run_dir=run_dir,
        manifest=manifest,
        picks=picks,
        allocation=allocation,
        regime=regime,
        metrics=metrics,
    )


def load_latest_run_pack(run_root: Path) -> Optional[RunPack]:
    latest = find_latest_run_dir(run_root)
    if latest is None:
        return None
    return load_run_pack(latest)


def run_morning_plan(
    *,
    start: str,
    end: str,
    asof: Optional[str],
    k: int,
    universe: Sequence[str],
    interval: str = "1d",
    short_window: int = 20,
    long_window: int = 50,
    fdr_q: float = 0.10,
    max_weight_per_asset: float = 0.25,
    max_portfolio_vol: float = 0.18,
    max_drawdown_limit: float = -0.10,
) -> RunPack:
    """
    Programmatic entrypoint used by the cockpit.
    Runs the Morning Signal Engine and returns the created run pack.

    Implementation note:
    - Prefer in-process execution to keep UI integration simple.
    - If the current interpreter is missing core quant dependencies (e.g., yfinance),
      fall back to running the engine via the project venv interpreter if available.
    """
    project_root = Path(__file__).resolve().parents[1]
    run_root = project_root / "reports" / "runs"
    run_root.mkdir(parents=True, exist_ok=True)

    before = {p.name for p in run_root.iterdir() if p.is_dir()}

    argv = [
        "--start",
        str(start),
        "--end",
        str(end),
        "--k",
        str(int(k)),
        "--interval",
        str(interval),
        "--short",
        str(int(short_window)),
        "--long",
        str(int(long_window)),
        "--fdr_q",
        str(float(fdr_q)),
        "--max_weight_per_asset",
        str(float(max_weight_per_asset)),
        "--max_portfolio_vol",
        str(float(max_portfolio_vol)),
        "--max_drawdown_limit",
        str(float(max_drawdown_limit)),
        "--universe",
        ",".join(list(universe)),
    ]
    if asof is not None and str(asof).strip():
        argv.extend(["--asof", str(asof)])

    # If the UI interpreter is missing quant deps, run the engine in the project venv.
    missing: List[str] = []
    for mod in ("pandas", "numpy", "matplotlib", "yfinance"):
        try:
            __import__(mod)
        except ModuleNotFoundError:
            missing.append(mod)

    if missing:
        venv_py = project_root / ".venv" / "bin" / "python"
        if not venv_py.exists():
            raise RuntimeError(
                "Morning Signal Engine dependencies are missing in the current Python interpreter.\n"
                f"- Missing: {', '.join(missing)}\n"
                f"- Current: {sys.executable}\n"
                "- Fix: create a venv and install dependencies:\n"
                "  python -m venv .venv\n"
                "  .venv/bin/python -m pip install -r requirements.txt\n"
                "- Or run the cockpit with the venv interpreter:\n"
                "  .venv/bin/python ui/cockpit.py\n"
            )

        cmd = [str(venv_py), str(project_root / "sim" / "morning_run.py"), *argv]
        proc = subprocess.run(
            cmd,
            cwd=str(project_root),
            capture_output=True,
            text=True,
        )
        if proc.returncode != 0:
            out = (proc.stdout or "").strip()
            err = (proc.stderr or "").strip()
            details: List[str] = []
            if out:
                details.append("STDOUT:\n" + out)
            if err:
                details.append("STDERR:\n" + err)
            tail = ("\n" + "\n".join(details)) if details else ""
            raise RuntimeError(
                "Morning Signal Engine failed (venv subprocess).\n"
                f"- Command: {' '.join(cmd)}"
                + tail
            )
    else:
        # Per spec: run programmatically by importing and calling `main()` when possible.
        from sim.morning_run import main as morning_main

        rc = int(morning_main(argv))
        if rc != 0:
            raise RuntimeError(f"Morning Signal Engine failed with exit code {rc}")

    after = {p.name for p in run_root.iterdir() if p.is_dir()}
    created = sorted(list(after - before))
    if not created:
        # Fallback: just load latest.
        rp = load_latest_run_pack(run_root)
        if rp is None:
            raise RuntimeError("Morning Signal Engine ran but no run pack was found.")
        return rp

    run_dir = run_root / created[-1]
    return load_run_pack(run_dir)
