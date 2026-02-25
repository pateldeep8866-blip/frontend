import numpy as np

from quantlab.rigor.vol import ewma_vol


def test_ewma_vol_length_and_positive():
    r = np.array([0.01, -0.005, 0.002, 0.0, 0.003] * 50, dtype=float)
    out = ewma_vol(r, lambda_=0.94, annualization=252)
    assert out.vol.shape[0] == r.shape[0]
    assert float(out.vol[-1]) > 0.0

