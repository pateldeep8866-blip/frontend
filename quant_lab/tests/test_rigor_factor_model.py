import numpy as np
import pandas as pd

from quantlab.rigor.factor_model import fama_macbeth, residual_alpha


def test_fama_macbeth_recovers_factor_premia_on_synthetic_data():
    rng = np.random.default_rng(0)
    T = 200
    N = 40
    dates = pd.date_range("2023-01-01", periods=T, freq="D")
    assets = [f"A{i}" for i in range(N)]

    x1 = pd.DataFrame(rng.normal(size=(T, N)), index=dates, columns=assets)
    x2 = pd.DataFrame(rng.normal(size=(T, N)), index=dates, columns=assets)
    beta1 = 0.01
    beta2 = -0.005
    noise = pd.DataFrame(rng.normal(scale=0.02, size=(T, N)), index=dates, columns=assets)

    # returns_{t+1} = beta1*x1_t + beta2*x2_t + noise
    rets = (beta1 * x1 + beta2 * x2 + noise).shift(1).fillna(0.0)

    res = fama_macbeth(rets, {"x1": x1, "x2": x2}, horizon=1, nw_lags=5, min_assets=10)
    mb = res.mean_betas
    assert abs(mb["x1"] - beta1) < 0.003
    assert abs(mb["x2"] - beta2) < 0.003
    assert res.n_periods > 50


def test_residual_alpha_is_small_when_model_is_correct():
    rng = np.random.default_rng(1)
    T = 120
    N = 20
    dates = pd.date_range("2023-01-01", periods=T, freq="D")
    assets = [f"A{i}" for i in range(N)]

    x = pd.DataFrame(rng.normal(size=(T, N)), index=dates, columns=assets)
    beta = 0.01
    noise = pd.DataFrame(rng.normal(scale=0.01, size=(T, N)), index=dates, columns=assets)
    rets = (beta * x + noise).shift(1).fillna(0.0)

    fm = fama_macbeth(rets, {"x": x}, horizon=1, nw_lags=3, min_assets=8)
    ra = residual_alpha(rets, {"x": x}, fm.betas_ts, horizon=1, nw_lags=3)
    # Mean residual alpha should be close to 0 across assets.
    assert float(ra.alpha.abs().mean()) < 0.005

