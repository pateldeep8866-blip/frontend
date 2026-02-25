import math

import numpy as np

from quantlab.rigor.ou import ou_half_life


def test_ou_half_life_reasonable_for_mean_reverting_process():
    # Simulate AR(1): x_{t+1} = phi x_t + eps, with phi<1 -> mean reverting.
    rng = np.random.default_rng(0)
    phi = 0.95
    n = 2000
    x = np.zeros(n, dtype=float)
    eps = rng.normal(0.0, 1.0, size=n)
    for t in range(1, n):
        x[t] = phi * x[t - 1] + eps[t]

    res = ou_half_life(x)
    # For Δx_t = (phi-1)x_{t-1} + eps, b ~ (phi-1)
    expected = math.log(2.0) / (1.0 - phi)
    assert math.isfinite(res.half_life)
    assert res.half_life > 0
    # Loose tolerance (noise + finite sample).
    assert abs(res.half_life - expected) / expected < 0.35

