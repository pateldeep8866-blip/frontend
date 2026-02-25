import numpy as np

from quantlab.rigor.optimization import mean_variance_weights, risk_parity_weights


def test_mean_variance_weights_respect_constraints():
    mu = np.array([0.1, 0.2, 0.3, 0.4], dtype=float)
    cov = np.eye(4, dtype=float)
    res = mean_variance_weights(mu, cov, max_weight=0.60)
    w = res.weights
    assert w.shape == (4,)
    assert abs(float(w.sum()) - 1.0) < 1e-12
    assert float(w.min()) >= -1e-12
    assert float(w.max()) <= 0.60 + 1e-12
    # Higher expected return should get >= weight than lower, absent tight caps.
    assert w[3] >= w[2] >= w[1] >= w[0]


def test_risk_parity_diagonal_matches_inverse_vol():
    # Diagonal cov: risk parity == inverse vol normalized.
    cov = np.diag([1.0, 4.0]).astype(float)
    res = risk_parity_weights(cov, max_weight=1.0, tol=1e-10, max_iter=5000)
    w = res.weights
    inv_vol = np.array([1.0, 0.5], dtype=float)
    inv_vol = inv_vol / inv_vol.sum()
    assert abs(float(w.sum()) - 1.0) < 1e-12
    assert np.allclose(w, inv_vol, atol=1e-2)

