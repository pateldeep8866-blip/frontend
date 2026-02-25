from __future__ import annotations

import json
import platform
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from quantlab.utils.hashing import composite_code_hash, sha256_bytes, sha256_json


def _iso_utc_now() -> str:
    # Include microseconds for uniqueness; always normalize to Z.
    now = datetime.now(timezone.utc)
    return now.isoformat().replace("+00:00", "Z")


def _timestamp_utc(created_utc_iso: str) -> str:
    # created_utc_iso is ISO with Z; parse minimal by slicing for seconds.
    # Example: 2026-02-16T13:05:00.123456Z -> 20260216T130500Z
    base = created_utc_iso.split(".")[0]  # drop fractional seconds if present
    dt = datetime.fromisoformat(base.replace("Z", "+00:00"))
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _dist_version(dist_name: str) -> Optional[str]:
    try:
        return metadata.version(dist_name)
    except Exception:
        return None


def write_run_manifest(
    *,
    strategy_name: str,
    parameters: Dict[str, Any],
    data_path: Path,
    data_sha256: str,
    cache_hit: Optional[bool] = None,
    data_source: str = "yfinance",
    data_provenance: Optional[Dict[str, Any]] = None,
    code_path: Path,
    code_paths: Optional[list[Path]] = None,
    run_root: Path = Path("reports") / "runs",
    project_root: Optional[Path] = None,
    created_utc: Optional[str] = None,
    extra_manifest_fields: Optional[Dict[str, Any]] = None,
) -> Tuple[Path, Dict[str, Any]]:
    """
    Create `reports/runs/<run_id>/` and write `run_manifest.json`.

    Returns: (run_dir, manifest_dict)
    """
    created_utc_iso = created_utc or _iso_utc_now()

    config = {
        "strategy_name": strategy_name,
        "parameters": parameters,
    }
    config_hash = sha256_json(config)

    ts = _timestamp_utc(created_utc_iso)
    short = sha256_bytes(f"{created_utc_iso}|{config_hash}".encode("utf-8"))[:8]
    run_id = f"{ts}_{short}"

    run_dir = Path(run_root) / run_id
    run_dir.mkdir(parents=True, exist_ok=False)

    code_bytes = Path(code_path).read_bytes()
    code_hash = sha256_bytes(code_bytes)

    composite_hash, composite_files = composite_code_hash(
        code_paths or [code_path],
        project_root=project_root,
    )

    dep_versions = {
        "pandas": _dist_version("pandas"),
        "numpy": _dist_version("numpy"),
        "yfinance": _dist_version("yfinance"),
        "matplotlib": _dist_version("matplotlib"),
    }

    def _maybe_rel(p: Path) -> str:
        p = Path(p).resolve()
        if project_root is None:
            return str(p)
        try:
            return str(p.relative_to(Path(project_root).resolve()))
        except Exception:
            return str(p)

    manifest: Dict[str, Any] = {
        "run_id": run_id,
        "created_utc": created_utc_iso,
        "strategy": {"name": strategy_name, "parameters": parameters},
        "python_version": platform.python_version(),
        "dependency_versions": dep_versions,
        "dependency_snapshot": dep_versions,
        "data_path": _maybe_rel(data_path),
        "data_sha256": data_sha256,
        "cache_hit": cache_hit,
        "data_source": data_source,
        "data_provenance": data_provenance or {},
        "code_path": _maybe_rel(code_path),
        "code_hash": code_hash,
        "composite_code_hash": composite_hash,
        "composite_code_files": composite_files,
        "config_hash": config_hash,
    }

    if isinstance(extra_manifest_fields, dict) and extra_manifest_fields:
        # Keep keys deterministic by merging into top-level manifest.
        for k in sorted(extra_manifest_fields.keys()):
            manifest[k] = extra_manifest_fields[k]

    (run_dir / "run_manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return run_dir, manifest
