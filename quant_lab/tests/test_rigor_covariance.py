import numpy as np

from quantlab.rigor.covariance import ledoit_wolf_cov


def test_ledoit_wolf_cov_is_psd_and_shrinkage_in_range():
    rng = np.random.default_rng(0)
    X = rng.normal(0.0, 0.01, size=(60, 5))
    res = ledoit_wolf_cov(X)
    assert 0.0 <= res.shrinkage <= 1.0
    C = res.cov
    assert C.shape == (5, 5)
    assert np.allclose(C, C.T, atol=1e-12)
    # PSD check (allow tiny numerical negatives)
    w = np.linalg.eigvalsh(C)
    assert float(w.min()) >= -1e-10

