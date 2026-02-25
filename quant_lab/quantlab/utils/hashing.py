from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Optional, Tuple


def sha256_bytes(data: bytes) -> str:
    """Return the SHA-256 hex digest of raw bytes."""
    h = hashlib.sha256()
    h.update(data)
    return h.hexdigest()


def sha256_json(obj: Any) -> str:
    """
    Stable SHA-256 of a JSON-serializable object.

    - Dict keys are sorted at all nesting levels.
    - No insignificant whitespace.
    - ASCII-escaped output for stable encoding.
    """
    payload = json.dumps(
        obj,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    ).encode("utf-8")
    return sha256_bytes(payload)


def sha256_file(path: Path) -> str:
    """Return the SHA-256 hex digest of a file's raw bytes."""
    return sha256_bytes(Path(path).read_bytes())


def composite_code_hash(
    paths: Iterable[Path],
    *,
    project_root: Optional[Path] = None,
) -> Tuple[str, list[str]]:
    """
    Compute a single SHA-256 over a set of code files.

    - Paths are resolved and de-duplicated.
    - Paths are sorted by a stable string (relative to project_root if provided).
    - Composite hash is over a JSON payload of (path, file_sha256) pairs.

    Returns: (composite_hash, sorted_rel_paths)
    """
    items = []
    seen = set()
    root = Path(project_root).resolve() if project_root is not None else None

    for p in paths:
        rp = Path(p).resolve()
        if rp in seen:
            continue
        seen.add(rp)
        rel = str(rp)
        if root is not None:
            try:
                rel = str(rp.relative_to(root))
            except Exception:
                rel = str(rp)
        items.append((rel, sha256_file(rp)))

    items.sort(key=lambda x: x[0])
    payload = json.dumps(items, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return sha256_bytes(payload), [p for p, _ in items]
