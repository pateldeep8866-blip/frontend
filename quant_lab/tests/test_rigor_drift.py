import numpy as np

from quantlab.rigor.drift import drift_metrics


def test_drift_metrics_detect_mean_shift():
    rng = np.random.default_rng(0)
    baseline = rng.normal(0.0, 1.0, size=2000)
    recent = rng.normal(1.0, 1.0, size=500)
    m = drift_metrics(baseline, recent, bins=10)
    assert m["mean_shift_z"] > 0.5
    assert m["psi"] > 0.01

