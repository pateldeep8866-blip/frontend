import os
import sys
import subprocess
from datetime import date, timedelta
from pathlib import Path

import pytest


if os.getenv("QUANT_PREFLIGHT_INNER") == "1":
    pytest.skip("Avoid recursion: quant_preflight runs pytest internally.", allow_module_level=True)


def _write_cached_csv(path: Path, *, start: date, end: date, base: float) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        return

    # Deterministic synthetic daily series with small variation (non-zero vol).
    import math

    rows = []
    dt = start
    i = 0
    while dt <= end:
        # Smooth drift + cycle
        px = base * math.exp(0.0005 * i + 0.01 * math.sin(i / 10.0))
        open_ = px * (1.0 - 0.0005)
        high = px * (1.0 + 0.0010)
        low = px * (1.0 - 0.0010)
        close = px
        adj = px
        vol = 1_000_000
        rows.append(
            f"{dt.isoformat()},{open_:.6f},{high:.6f},{low:.6f},{close:.6f},{adj:.6f},{vol}\n"
        )
        dt = dt + timedelta(days=1)
        i += 1

    path.write_text(
        "Date,Open,High,Low,Close,Adj Close,Volume\n" + "".join(rows),
        encoding="utf-8",
    )


def test_quant_preflight_main_subprocess(tmp_path: Path):
    # Seed a small offline cache for the preflight dry-run settings.
    root = Path(__file__).resolve().parents[1]
    cache_dir = root / "data" / "cache"
    provider = "alphavantage"
    cache_dir = cache_dir / provider

    start = date(2023, 1, 1)
    end = date(2023, 12, 31)
    interval = "1d"

    for ticker, base in [("SPY", 400.0), ("TLT", 100.0), ("GLD", 180.0)]:
        fname = f"{ticker}__{interval}__{start.isoformat()}__{end.isoformat()}.csv"
        _write_cached_csv(cache_dir / fname, start=start, end=end, base=base)

    # Prefer the local venv if present so required deps are available.
    py = root / ".venv" / "bin" / "python"
    python_exe = str(py) if py.exists() else sys.executable

    cmd = [
        python_exe,
        "-c",
        "import quant_preflight; raise SystemExit(quant_preflight.main())",
    ]
    env = dict(os.environ)
    env["QUANTLAB_DATA_PROVIDER"] = provider
    # Preflight dry-run uses offline caches, so no API key is required for this test.
    env["QUANTLAB_NO_NETWORK"] = "1"
    p = subprocess.run(cmd, cwd=str(root), env=env, capture_output=True, text=True)
    out = (p.stdout or "") + "\n" + (p.stderr or "")
    assert p.returncode == 0, out
    assert "Plan generated successfully" in out
