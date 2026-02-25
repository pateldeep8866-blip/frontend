import json
from pathlib import Path

from quantlab.reporting.run_manifest import write_run_manifest
from quantlab.utils.hashing import sha256_bytes, sha256_json


def test_run_manifest_written_with_required_keys(tmp_path: Path):
    code_path = tmp_path / "code.py"
    code_path.write_text("print('hello')\n", encoding="utf-8")

    data_path = tmp_path / "data.csv"
    data_bytes = b"col\n1\n"
    data_path.write_bytes(data_bytes)
    data_sha256 = sha256_bytes(data_bytes)

    params = {
        "ticker": "AAPL",
        "start": "2020-01-01",
        "end": "2020-12-31",
        "interval": "1d",
        "short_window": 20,
        "long_window": 50,
        "commission": 0.0,
        "risk_free_rate": 0.0,
    }

    run_root = tmp_path / "runs"
    run_dir, manifest = write_run_manifest(
        strategy_name="ma_crossover",
        parameters=params,
        data_path=data_path,
        data_sha256=data_sha256,
        code_path=code_path,
        run_root=run_root,
        project_root=tmp_path,
        created_utc="2026-02-16T13:05:00.123456Z",
    )

    assert run_dir.exists()
    manifest_path = run_dir / "run_manifest.json"
    assert manifest_path.exists()

    loaded = json.loads(manifest_path.read_text(encoding="utf-8"))
    for k in [
        "run_id",
        "created_utc",
        "strategy",
        "python_version",
        "dependency_versions",
        "data_path",
        "data_sha256",
        "code_hash",
        "config_hash",
    ]:
        assert k in loaded

    expected_config_hash = sha256_json({"strategy_name": "ma_crossover", "parameters": params})
    assert loaded["config_hash"] == expected_config_hash
    assert loaded["data_sha256"] == data_sha256

