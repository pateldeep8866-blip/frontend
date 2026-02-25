import numpy as np

from quantlab.rigor.validation import block_bootstrap_ci, deflated_sharpe_probability, newey_west_t_stat_mean


def test_newey_west_t_stat_returns_finite_outputs():
    rng = np.random.default_rng(0)
    x = rng.normal(0.001, 0.01, size=500)
    t, p, se = newey_west_t_stat_mean(x, lags=5)
    assert np.isfinite(t)
    assert 0.0 <= p <= 1.0
    assert np.isfinite(se) and se > 0


def test_block_bootstrap_ci_constant_series_collapses():
    x = np.full(200, 0.12345)
    ci = block_bootstrap_ci(x, block_size=20, n_boot=200, seed=0)
    assert abs(ci.point - 0.12345) < 1e-12
    assert abs(ci.lo - 0.12345) < 1e-12
    assert abs(ci.hi - 0.12345) < 1e-12


def test_deflated_sharpe_probability_positive_drift():
    rng = np.random.default_rng(1)
    r = rng.normal(0.001, 0.01, size=800)
    out = deflated_sharpe_probability(r, n_trials=20)
    assert 0.0 <= out["prob"] <= 1.0
    # Positive drift should have >50% probability under deflation in expectation.
    assert out["prob"] > 0.5

