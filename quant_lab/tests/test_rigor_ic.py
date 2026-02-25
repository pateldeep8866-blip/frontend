import numpy as np
import pandas as pd

from quantlab.rigor.ic import rank_ic, rolling_ic_decay


def test_rank_ic_positive_when_scores_predict_returns():
    rng = np.random.default_rng(0)
    T = 50
    N = 30
    dates = pd.date_range("2023-01-01", periods=T, freq="D")
    assets = [f"A{i}" for i in range(N)]

    scores = pd.DataFrame(rng.normal(size=(T, N)), index=dates, columns=assets)
    # Forward returns correlated with scores
    fwd = scores * 0.01 + pd.DataFrame(rng.normal(scale=0.005, size=(T, N)), index=dates, columns=assets)

    res = rank_ic(scores, fwd, min_obs=10)
    assert res.n > 10
    assert res.mean > 0.2


def test_rolling_ic_decay_shapes():
    rng = np.random.default_rng(1)
    T = 120
    N = 20
    dates = pd.date_range("2023-01-01", periods=T, freq="D")
    assets = [f"A{i}" for i in range(N)]
    scores = pd.DataFrame(rng.normal(size=(T, N)), index=dates, columns=assets)
    rets = scores * 0.01 + pd.DataFrame(rng.normal(scale=0.02, size=(T, N)), index=dates, columns=assets)

    out = rolling_ic_decay(scores, rets, horizons=(1, 5, 20), window=60, min_obs=8)
    assert list(out.columns) == ["ic_h1", "ic_h5", "ic_h20"]
    assert out.shape[0] == T
    # Some values should be finite.
    assert np.isfinite(out["ic_h1"].dropna().to_numpy()).any()

