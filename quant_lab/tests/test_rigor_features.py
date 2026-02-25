import numpy as np

from quantlab.rigor.features import log_returns, momentum_acceleration


def test_momentum_acceleration_zero_for_exponential_trend():
    # P_t = exp(a*t) -> log(P_t) linear -> second difference is 0.
    t = np.arange(0, 200, dtype=float)
    prices = np.exp(0.01 * t)
    acc = momentum_acceleration(prices)
    assert acc.shape[0] == prices.shape[0] - 2
    assert float(np.max(np.abs(acc))) < 1e-12


def test_log_returns_constant_for_exponential_trend():
    t = np.arange(0, 200, dtype=float)
    prices = np.exp(0.02 * t)
    r = log_returns(prices)
    assert r.shape[0] == prices.shape[0] - 1
    assert float(np.max(np.abs(r - 0.02))) < 1e-12

