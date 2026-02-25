from __future__ import annotations

"""
QUANT_LAB Preflight (research/paper-only)
========================================

This script performs an end-to-end preflight to ensure the quant stack is usable:
1) Verifies Python + required dependencies are available.
2) Runs the full test suite (`pytest -q`).
3) Runs the Morning Signal Engine (dry run) via `sim/morning_run.py`.
4) Validates generated research artifacts (picks/allocation/regime + registry update).
5) Prints a clear summary report.

Determinism / Safety:
- If the preflight fails after generating artifacts, it rolls back the newly-created
  run directory and removes any new cache files created during the failed attempt.
- If everything validates cleanly, outputs are kept.

Example usage:
  # Recommended (venv):
  #   python -m venv .venv
  #   source .venv/bin/activate
  #   python -m pip install -r requirements.txt
  python quant_preflight.py

  # Use different dry-run settings (optional):
  #   QUANT_PREFLIGHT_START=2015-01-01 QUANT_PREFLIGHT_END=2026-02-16 QUANT_PREFLIGHT_ASOF=2026-02-16 \\
  #   QUANT_PREFLIGHT_UNIVERSE=SPY,QQQ,IWM,TLT,GLD \\
  #   python quant_preflight.py
"""

import csv
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from importlib import import_module
from importlib import metadata
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


PROJECT_ROOT = Path(__file__).resolve().parent


REQUIRED_MODULES = [
    "pandas",
    "numpy",
    "requests",
    "matplotlib",
    "pytest",
]


DEFAULT_DRYRUN = {
    "start": "2023-01-01",
    "end": "2023-12-31",
    "asof": "2023-12-31",
    "k": "5",
    "interval": "1d",
    # Keep small and offline-friendly by default. Must include SPY for regime.
    "universe": "SPY,TLT,GLD",
}


def _log(msg: str) -> None:
    print(msg, flush=True)


def _info(step: str, msg: str) -> None:
    _log(f"[INFO] {step}: {msg}")


def _ok(step: str, msg: str) -> None:
    _log(f"[ OK ] {step}: {msg}")


def _err(step: str, msg: str) -> None:
    _log(f"[ERR ] {step}: {msg}")


def _is_finite(x: Any) -> bool:
    try:
        xf = float(x)
    except Exception:
        return False
    return math.isfinite(xf)


def _read_bytes_if_exists(path: Path) -> Optional[bytes]:
    try:
        return Path(path).read_bytes()
    except FileNotFoundError:
        return None


def _set_mpl_cache_env(env: Dict[str, str]) -> None:
    # Avoid matplotlib cache warnings when ~/.matplotlib isn't writable.
    tmp = tempfile.mkdtemp(prefix="quantlab-mplcache-")
    env["MPLCONFIGDIR"] = tmp


def _dist_version(dist: str) -> Optional[str]:
    try:
        return metadata.version(dist)
    except Exception:
        return None


def verify_environment() -> None:
    step = "env"
    _info(step, f"Project root: {PROJECT_ROOT}")
    _info(step, f"Python: {sys.version.splitlines()[0]}")
    _info(step, f"Executable: {sys.executable}")

    if sys.version_info < (3, 10):
        raise RuntimeError("Python >= 3.10 is required.")

    missing: List[str] = []
    versions: Dict[str, Optional[str]] = {}
    # Make matplotlib import quiet.
    os.environ.setdefault("MPLCONFIGDIR", tempfile.mkdtemp(prefix="quantlab-mplcache-"))

    for mod in REQUIRED_MODULES:
        try:
            import_module(mod)
            versions[mod] = _dist_version(mod)
        except Exception:
            missing.append(mod)

    if missing:
        _err(step, f"Missing required modules: {', '.join(missing)}")
        _err(step, "Install exactly:")
        _log(f"  {sys.executable} -m pip install -r requirements.txt")
        _log("")
        _log("If you want an isolated env:")
        _log(f"  {sys.executable} -m venv .venv")
        _log("  source .venv/bin/activate")
        _log("  python -m pip install -r requirements.txt")
        raise RuntimeError("Missing dependencies.")

    # Print dependency snapshot (best-effort).
    snap = " ".join([f"{k}={versions.get(k) or 'unknown'}" for k in REQUIRED_MODULES])
    _ok(step, f"Dependencies OK: {snap}")

    # Provider selection is required for the operational data layer.
    prov = (os.environ.get("QUANTLAB_DATA_PROVIDER") or "").strip().lower()
    if not prov:
        raise RuntimeError(
            "QUANTLAB_DATA_PROVIDER is required (alphavantage/finnhub/stockdata).\n"
            "Example:\n"
            "  export QUANTLAB_DATA_PROVIDER=alphavantage\n"
            "  export ALPHAVANTAGE_API_KEY=... (only needed if downloading)\n"
        )


def _maybe_reexec_into_venv() -> None:
    """
    If the current interpreter is missing deps but a local `.venv` exists, re-run preflight
    under the venv interpreter so `python quant_preflight.py` works out of the box.
    """
    # Prevent loops.
    if os.getenv("QUANT_PREFLIGHT_REEXEC") == "1":
        return

    vpy = PROJECT_ROOT / ".venv" / "bin" / "python"
    try:
        if not vpy.exists():
            return
    except Exception:
        return

    # Detect whether we're already inside a venv.
    base_prefix = getattr(sys, "base_prefix", sys.prefix)
    if str(getattr(sys, "prefix", "")) and str(sys.prefix) != str(base_prefix):
        return

    missing: List[str] = []
    for mod in REQUIRED_MODULES:
        try:
            import_module(mod)
        except Exception:
            missing.append(mod)

    if not missing:
        return

    _info("env", f"Re-running under venv interpreter due to missing deps: {', '.join(missing)}")
    _info("env", f"Using: {vpy}")
    env = dict(os.environ)
    env["QUANT_PREFLIGHT_REEXEC"] = "1"
    _set_mpl_cache_env(env)
    cmd = [str(vpy), str(PROJECT_ROOT / "quant_preflight.py")]
    p = subprocess.run(cmd, cwd=str(PROJECT_ROOT), env=env)
    raise SystemExit(int(p.returncode))


def run_pytest() -> None:
    step = "tests"
    _info(step, "Running pytest -q")
    env = dict(os.environ)
    # Prevent recursion: the preflight test itself is skipped under this flag.
    env["QUANT_PREFLIGHT_INNER"] = "1"
    _set_mpl_cache_env(env)

    cmd = [sys.executable, "-m", "pytest", "-q"]
    p = subprocess.run(cmd, cwd=str(PROJECT_ROOT), env=env, capture_output=True, text=True)
    if p.returncode != 0:
        _err(step, "pytest failed")
        if p.stdout:
            _log(p.stdout.rstrip())
        if p.stderr:
            _log(p.stderr.rstrip())
        raise RuntimeError("Test suite failed.")
    _ok(step, "All tests passed")


@dataclass(frozen=True)
class RunCapture:
    run_dir: Path
    run_id: str


def _list_run_dirs(run_root: Path) -> Dict[str, Path]:
    out: Dict[str, Path] = {}
    if not run_root.exists():
        return out
    for p in run_root.iterdir():
        if not p.is_dir():
            continue
        if (p / "run_manifest.json").exists():
            out[p.name] = p
    return out


def _latest_by_created_utc(run_dirs: Iterable[Path]) -> Optional[Path]:
    best: Optional[Tuple[str, str, Path]] = None
    for d in run_dirs:
        created = ""
        try:
            obj = json.loads((Path(d) / "run_manifest.json").read_text(encoding="utf-8"))
            created = str(obj.get("created_utc", "")) or ""
        except Exception:
            created = ""
        key = (created, Path(d).name, Path(d))
        if best is None or key > best:
            best = key
    return None if best is None else best[2]


def run_morning_engine_dryrun(config: Dict[str, str]) -> Tuple[RunCapture, Dict[str, Any], bytes | None, List[Path], List[Path]]:
    """
    Run `sim/morning_run.py` and capture the created run dir.

    Returns:
      (run_capture, run_manifest, index_before_bytes (deprecated), new_run_dirs, new_cache_files)
    """
    step = "morning"
    run_root = PROJECT_ROOT / "reports" / "runs"
    run_root.mkdir(parents=True, exist_ok=True)

    cache_dir = PROJECT_ROOT / "data" / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    before_runs = _list_run_dirs(run_root)
    before_cache = {p.resolve() for p in cache_dir.glob("*.csv")}
    before_cache |= {p.resolve() for p in cache_dir.glob("*.meta.json")}

    start = config["start"]
    end = config["end"]
    asof = config.get("asof") or end
    universe = config["universe"]
    interval = config.get("interval", "1d")
    k = config.get("k", "5")

    cmd = [
        sys.executable,
        str(PROJECT_ROOT / "sim" / "morning_run.py"),
        "--start",
        start,
        "--end",
        end,
        "--asof",
        asof,
        "--k",
        str(k),
        "--interval",
        interval,
        "--universe",
        universe,
    ]

    _info(step, f"Running: {' '.join(cmd)}")
    env = dict(os.environ)
    _set_mpl_cache_env(env)
    # Preflight wants rollback capability; registry is append-only, so disable registry writes here
    # and insert into the registry only after outputs validate cleanly.
    env["QUANTLAB_REGISTRY_DISABLE"] = "1"
    p = subprocess.run(cmd, cwd=str(PROJECT_ROOT), env=env, capture_output=True, text=True)
    if p.stdout.strip():
        _log(p.stdout.rstrip())
    if p.stderr.strip():
        _log(p.stderr.rstrip())
    if p.returncode != 0:
        raise RuntimeError(f"Morning engine failed (exit={p.returncode}).")

    after_runs = _list_run_dirs(run_root)
    new_names = sorted(set(after_runs.keys()) - set(before_runs.keys()))
    if not new_names:
        # Fallback: pick latest directory by created_utc.
        latest = _latest_by_created_utc(after_runs.values())
        if latest is None:
            raise RuntimeError("Morning engine ran but no run directory was found.")
        run_dir = latest
    elif len(new_names) == 1:
        run_dir = after_runs[new_names[0]]
    else:
        # Multiple created; pick latest by created_utc.
        latest = _latest_by_created_utc([after_runs[n] for n in new_names])
        if latest is None:
            raise RuntimeError("Multiple run dirs created, and no latest could be determined.")
        run_dir = latest

    manifest_path = Path(run_dir) / "run_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    run_id = str(manifest.get("run_id") or Path(run_dir).name)

    # Capture new cache files so we can roll back if needed.
    after_cache = {p.resolve() for p in cache_dir.glob("*.csv")}
    after_cache |= {p.resolve() for p in cache_dir.glob("*.meta.json")}
    new_cache = sorted(list(after_cache - before_cache))

    new_run_dirs = [after_runs[n] for n in new_names] if new_names else []
    _ok(step, f"Run generated: {run_id} ({Path(run_dir)})")
    return RunCapture(run_dir=Path(run_dir), run_id=run_id), manifest, None, new_run_dirs, new_cache


def _rollback(
    *,
    run_dirs_to_remove: Sequence[Path],
    cache_files_to_remove: Sequence[Path],
) -> None:
    step = "rollback"

    # Remove run dirs created by this attempt.
    for d in run_dirs_to_remove:
        try:
            if d.exists() and d.is_dir():
                shutil.rmtree(d)
                _info(step, f"Removed run dir: {d}")
        except Exception as e:
            _err(step, f"Failed removing run dir {d}: {e}")

    # Remove any new cache files created by this attempt.
    for p in cache_files_to_remove:
        try:
            if p.exists() and p.is_file():
                p.unlink()
                _info(step, f"Removed cache file: {p}")
        except Exception as e:
            _err(step, f"Failed removing cache file {p}: {e}")


def validate_research_outputs(run: RunCapture) -> Tuple[List[Dict[str, Any]], Dict[str, float], Dict[str, Any]]:
    step = "validate"
    run_dir = Path(run.run_dir)

    picks_path = run_dir / "picks.csv"
    alloc_path = run_dir / "allocation.csv"
    regime_path = run_dir / "regime.json"
    metrics_path = run_dir / "metrics.json"
    manifest_path = run_dir / "run_manifest.json"

    for p in [picks_path, alloc_path, regime_path, metrics_path, manifest_path]:
        if not p.exists():
            raise RuntimeError(f"Missing artifact: {p}")

    # run_manifest.json: provider provenance must be present
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    dp = manifest.get("data_provenance", None)
    if not isinstance(dp, dict) or not dp:
        raise RuntimeError("run_manifest.json missing data_provenance (provider metadata)")
    prov_name = str(dp.get("provider_name", "")).strip()
    if not prov_name:
        raise RuntimeError("run_manifest.json data_provenance.provider_name is missing/empty")
    prov_ver = str(dp.get("provider_version", "")).strip()
    if not prov_ver:
        raise RuntimeError("run_manifest.json data_provenance.provider_version is missing/empty")

    files = dp.get("files", None)
    if not isinstance(files, dict) or not files:
        raise RuntimeError("run_manifest.json data_provenance.files is missing/empty")
    total_rows = 0
    for sym, info in files.items():
        if not isinstance(info, dict):
            raise RuntimeError(f"run_manifest.json data_provenance.files[{sym!r}] is not an object")
        rc = info.get("row_count", info.get("rows", None))
        try:
            rci = int(rc)
        except Exception:
            raise RuntimeError(f"run_manifest.json row_count invalid for {sym}: {rc!r}")
        if rci <= 0:
            raise RuntimeError(f"run_manifest.json row_count <= 0 for {sym}: {rci}")
        total_rows += rci
        sha = str(info.get("file_sha256") or info.get("data_sha256") or "").strip()
        if not sha:
            raise RuntimeError(f"run_manifest.json missing file sha256 for {sym}")
        rt = str(info.get("retrieval_timestamp") or "").strip()
        if not rt:
            raise RuntimeError(f"run_manifest.json missing retrieval_timestamp for {sym}")
        ft = str(info.get("first_timestamp") or "").strip()
        lt = str(info.get("last_timestamp") or "").strip()
        if not ft or not lt:
            raise RuntimeError(f"run_manifest.json missing first/last timestamp for {sym}")

    if total_rows <= 0:
        raise RuntimeError("run_manifest.json data_provenance total row_count is <= 0")

    # picks.csv
    with picks_path.open("r", newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        rows = list(r)
        fields = set(r.fieldnames or [])

    if not rows:
        raise RuntimeError("picks.csv has no rows")

    ticker_col = "ticker" if "ticker" in fields else ("tickers" if "tickers" in fields else None)
    if ticker_col is None:
        raise RuntimeError("picks.csv missing ticker column")
    if "score" not in fields:
        raise RuntimeError("picks.csv missing score column")

    fdr_col = None
    if "FDR" in fields:
        fdr_col = "FDR"
    elif "fdr" in fields:
        fdr_col = "fdr"
    elif "passes_fdr" in fields:
        fdr_col = "passes_fdr"
    else:
        raise RuntimeError("picks.csv missing FDR indicator column (expected FDR/fdr/passes_fdr)")

    for i, row in enumerate(rows[: min(25, len(rows))], start=1):
        t = str(row.get(ticker_col, "")).strip()
        if not t:
            raise RuntimeError(f"picks.csv row {i}: empty ticker")

        sc = row.get("score", "")
        try:
            scf = float(sc)
        except Exception:
            raise RuntimeError(f"picks.csv row {i}: score not numeric: {sc!r}")
        if not math.isfinite(scf):
            raise RuntimeError(f"picks.csv row {i}: score is not finite")

        fdr_val = str(row.get(fdr_col, "")).strip().upper()
        if fdr_col in {"FDR", "fdr"}:
            if fdr_val not in {"Y", "N"}:
                raise RuntimeError(f"picks.csv row {i}: FDR must be Y/N, got {fdr_val!r}")
        else:
            # passes_fdr: accept 0/1/true/false -> map to Y/N.
            if fdr_val in {"1", "TRUE", "T", "YES", "Y"}:
                pass
            elif fdr_val in {"0", "FALSE", "F", "NO", "N"}:
                pass
            else:
                raise RuntimeError(f"picks.csv row {i}: passes_fdr must be 0/1, got {fdr_val!r}")

    # allocation.csv
    with alloc_path.open("r", newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        arows = list(r)
        afields = set(r.fieldnames or [])

    if not arows:
        raise RuntimeError("allocation.csv has no rows")

    wcol = "target_weight" if "target_weight" in afields else ("weight" if "weight" in afields else None)
    if wcol is None:
        raise RuntimeError("allocation.csv missing weight column (target_weight/weight)")
    if "ticker" not in afields:
        raise RuntimeError("allocation.csv missing ticker column")

    weights: Dict[str, float] = {}
    wsum = 0.0
    has_cash = False
    for i, row in enumerate(arows, start=1):
        t = str(row.get("ticker", "")).strip().upper()
        if not t:
            raise RuntimeError(f"allocation.csv row {i}: empty ticker")
        if t == "CASH":
            has_cash = True
        w = row.get(wcol, "")
        try:
            wf = float(w)
        except Exception:
            raise RuntimeError(f"allocation.csv row {i}: weight not numeric: {w!r}")
        if not math.isfinite(wf) or wf < -1e-9:
            raise RuntimeError(f"allocation.csv row {i}: invalid weight: {wf}")
        weights[t] = wf
        wsum += wf

    if not has_cash:
        raise RuntimeError("allocation.csv missing CASH row")
    if abs(wsum - 1.0) > 1e-3:
        raise RuntimeError(f"allocation weights do not sum to ~1 (sum={wsum:.6f})")

    # regime.json
    regime = json.loads(regime_path.read_text(encoding="utf-8"))
    label = str(regime.get("label", "")).strip()
    conf = regime.get("confidence", None)
    if not label:
        raise RuntimeError("regime.json missing/empty label")
    try:
        conf_f = float(conf)
    except Exception:
        raise RuntimeError("regime.json confidence not numeric")
    if not (0.0 <= conf_f <= 1.0):
        raise RuntimeError(f"regime.json confidence out of bounds: {conf_f}")

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    port = metrics.get("portfolio", {}) if isinstance(metrics, dict) else {}
    if not isinstance(port, dict):
        raise RuntimeError("metrics.json missing portfolio dict")
    pv = port.get("portfolio_vol", None)
    if pv is None:
        raise RuntimeError("metrics.json missing portfolio_vol")
    try:
        pvf = float(pv)
    except Exception:
        raise RuntimeError("metrics.json portfolio_vol not numeric")
    if not math.isfinite(pvf) or pvf <= 0:
        raise RuntimeError(f"metrics.json portfolio_vol invalid: {pvf}")

    # Additional sanity: ensure top pick vols are finite and not 0.
    vol_col = "vol" if "vol" in fields else ("volatility" if "volatility" in fields else None)
    if vol_col is None:
        raise RuntimeError("picks.csv missing vol column (vol/volatility)")
    some_nonzero_vol = False
    for i, row in enumerate(rows[: min(10, len(rows))], start=1):
        v = row.get(vol_col, "")
        try:
            vf = float(v)
        except Exception:
            continue
        if math.isfinite(vf) and vf > 0:
            some_nonzero_vol = True
            break
    if not some_nonzero_vol:
        raise RuntimeError("Sanity check failed: pick vol is zero/NaN for top rows")

    # single_pick.csv (required for Morning Plan run packs)
    sp_path = run_dir / "single_pick.csv"
    if not sp_path.exists():
        raise RuntimeError(f"Missing artifact: {sp_path}")
    with sp_path.open("r", newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        srows = list(r)
        sfields = set(r.fieldnames or [])
    if not srows:
        raise RuntimeError("single_pick.csv has no rows")
    for req in ["ticker", "composite", "momentum_score", "mean_reversion_score", "asof", "generated_utc"]:
        if req not in sfields:
            raise RuntimeError(f"single_pick.csv missing column: {req}")
    sp0 = srows[0]
    sp_t = str(sp0.get("ticker", "")).strip().upper()
    if not sp_t:
        raise RuntimeError("single_pick.csv: empty ticker")
    try:
        sp_c = float(sp0.get("composite", "nan"))
    except Exception:
        raise RuntimeError("single_pick.csv: composite not numeric")
    if not math.isfinite(sp_c):
        raise RuntimeError("single_pick.csv: composite is NaN/inf")

    _ok(step, "Artifacts validated")
    return rows, weights, metrics


def _insert_registry_entry(run_dir: Path, manifest: Dict[str, Any], metrics: Dict[str, Any]) -> None:
    """
    Insert into the append-only SQLite registry.
    """
    from quantlab.registry.writer import RegistryWriter

    RegistryWriter().log_run(run_dir=Path(run_dir), manifest=manifest, metrics=metrics)


def validate_registry(run: RunCapture) -> None:
    step = "registry"
    try:
        import sqlite3
    except Exception as e:  # pragma: no cover
        raise RuntimeError(f"sqlite3 unavailable: {e}")

    from quantlab.registry.db import get_default_db

    db = get_default_db()
    if not db.path.exists():
        raise RuntimeError(f"Registry DB missing: {db.path}")
    conn = sqlite3.connect(str(db.path))
    try:
        cur = conn.execute("SELECT run_id FROM runs WHERE run_id = ? LIMIT 1;", (str(run.run_id),))
        row = cur.fetchone()
        if not row:
            raise RuntimeError(f"Run ID not found in registry: {run.run_id}")
    finally:
        conn.close()
    _ok(step, f"Run ID present in registry: {run.run_id}")


def print_summary(picks: List[Dict[str, Any]], weights: Dict[str, float]) -> None:
    step = "summary"
    _log("")
    _log("=== QUANT_LAB PREFLIGHT SUMMARY ===")
    _log("Plan generated successfully")
    _log("")
    _log("Top picks:")
    shown = 0
    for row in picks:
        t = str(row.get("ticker", "")).strip().upper()
        if not t:
            continue
        try:
            sc = float(row.get("score", "nan"))
        except Exception:
            continue
        _log(f"  {t:>5}  score={sc: .3f}  p={row.get('p_value','')}  fdr={row.get('passes_fdr', row.get('FDR',''))}")
        shown += 1
        if shown >= 5:
            break

    _log("")
    _log("Portfolio weights:")
    for t, w in sorted(weights.items(), key=lambda kv: (-float(kv[1]), kv[0])):
        _log(f"  {t:>5}  {float(w):.2%}")
    _log("")
    _ok(step, "Done")


def _load_dryrun_config() -> Dict[str, str]:
    cfg = dict(DEFAULT_DRYRUN)
    # Environment overrides.
    for k in ["start", "end", "asof", "k", "interval", "universe"]:
        env_k = f"QUANT_PREFLIGHT_{k.upper()}"
        if env_k in os.environ and str(os.environ[env_k]).strip():
            cfg[k] = str(os.environ[env_k]).strip()
    return cfg


def main(argv: Optional[Sequence[str]] = None) -> int:
    # Normalize cwd so relative paths work even if called from elsewhere.
    os.chdir(PROJECT_ROOT)
    if str(PROJECT_ROOT) not in sys.path:
        sys.path.insert(0, str(PROJECT_ROOT))

    _maybe_reexec_into_venv()
    verify_environment()
    run_pytest()

    cfg = _load_dryrun_config()
    run_capture: Optional[RunCapture] = None
    new_run_dirs: List[Path] = []
    new_cache_files: List[Path] = []

    try:
        run_capture, manifest, _deprecated, new_run_dirs, new_cache_files = run_morning_engine_dryrun(cfg)
        picks, weights, metrics = validate_research_outputs(run_capture)
        _insert_registry_entry(run_capture.run_dir, manifest, metrics)
        validate_registry(run_capture)
        print_summary(picks, weights)
        return 0
    except Exception as e:
        _err("preflight", f"Failed: {e}")
        if run_capture is not None:
            # If we couldn't reliably detect new dirs by diff, fall back to removing the run dir we validated.
            if not new_run_dirs:
                new_run_dirs = [Path(run_capture.run_dir)]
        _rollback(run_dirs_to_remove=new_run_dirs, cache_files_to_remove=new_cache_files)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
