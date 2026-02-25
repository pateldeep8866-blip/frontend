import json
from pathlib import Path

from ui.state import load_latest_run_pack


def _write_min_run(run_dir: Path, *, created_utc: str) -> None:
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "run_manifest.json").write_text(
        json.dumps(
            {
                "run_id": run_dir.name,
                "created_utc": created_utc,
                "strategy": {"name": "morning_signal_engine", "parameters": {"mode": "morning_signal_engine"}},
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "picks.csv").write_text(
        "ticker,rank,score,vol,mom_63,mom_252,corr_spy,t_stat,p_value,passes_fdr,reasons\n"
        "SPY,1,1.0,0.2,0.1,0.2,1.0,2.0,0.01,1,ok\n",
        encoding="utf-8",
    )
    (run_dir / "allocation.csv").write_text(
        "ticker,target_weight,target_shares_placeholder,vol,risk_proxy\n"
        "SPY,0.25,,0.2,0.9\n"
        "CASH,0.75,,0.0,\n",
        encoding="utf-8",
    )
    (run_dir / "regime.json").write_text(
        json.dumps({"label": "risk_on", "confidence": 0.8, "method": "proxy", "inputs": {}}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (run_dir / "metrics.json").write_text(
        json.dumps({"mode": "morning_signal_engine", "asof": "2026-02-15"}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def test_plan_loader_loads_newest_run_pack(tmp_path: Path):
    run_root = tmp_path / "runs"
    _write_min_run(run_root / "20260216T100000Z_aaaaaaaa", created_utc="2026-02-16T10:00:00Z")
    _write_min_run(run_root / "20260216T110000Z_bbbbbbbb", created_utc="2026-02-16T11:00:00Z")

    plan = load_latest_run_pack(run_root)
    assert plan is not None
    assert plan.run_dir.name.endswith("bbbbbbbb")
    assert plan.regime.label == "risk_on"
    assert plan.picks[0].ticker == "SPY"
    assert abs(plan.allocation[0].target_weight - 0.25) < 1e-12

