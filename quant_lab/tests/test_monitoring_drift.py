import pandas as pd

from quantlab.monitoring.drift import (
    ic_decay_detection,
    ks_shift_test,
    ks_statistic,
    sharpe_breakdown_detection,
    vol_regime_change_detection,
)


def test_ks_statistic_extreme_shift():
    x = [0.0] * 10
    y = [1.0] * 10
    d = ks_statistic(x, y)
    assert abs(d - 1.0) < 1e-12


def test_ks_shift_test_flags_drift():
    s = pd.Series([0.0, 0.0, 0.0, 0.0, 10.0, 10.0], index=pd.date_range("2020-01-01", periods=6, freq="D"))
    out = ks_shift_test(s, baseline_window=4, recent_window=2, ks_threshold=0.5)
    assert out["status"] == "ok"
    assert out["drift"] is True
    assert float(out["ks_d"]) >= 0.99


def test_vol_regime_change_flags_drift():
    # Baseline low-vol returns, recent high-vol returns.
    vals = [0.001, -0.001, 0.001, -0.001, 0.01, -0.01]
    s = pd.Series(vals, index=pd.date_range("2020-01-01", periods=len(vals), freq="D"))
    out = vol_regime_change_detection(s, baseline_window=4, recent_window=2, vol_ratio_threshold=2.0)
    assert out["status"] == "ok"
    assert out["drift"] is True
    assert float(out["vol_ratio"]) >= 5.0


def test_sharpe_breakdown_flags_drift():
    # Baseline slightly positive, recent negative.
    vals = [0.01, 0.0, 0.01, 0.0, -0.02, -0.02]
    s = pd.Series(vals, index=pd.date_range("2020-01-01", periods=len(vals), freq="D"))
    out = sharpe_breakdown_detection(s, baseline_window=4, recent_window=2, min_recent_sharpe=0.0, max_drop=0.1)
    assert out["status"] == "ok"
    assert out["drift"] is True


def test_ic_decay_detection_flags_drift():
    vals = [0.10, 0.10, 0.10, 0.10, -0.01, -0.01]
    s = pd.Series(vals, index=pd.date_range("2020-01-01", periods=len(vals), freq="D"))
    out = ic_decay_detection(s, baseline_window=4, recent_window=2, min_recent_ic=0.0, min_ratio=0.5)
    assert out["status"] == "ok"
    assert out["drift"] is True

