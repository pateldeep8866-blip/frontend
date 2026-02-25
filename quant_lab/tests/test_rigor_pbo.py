import numpy as np

from quantlab.rigor.pbo import probability_of_backtest_overfitting


def test_pbo_low_when_one_strategy_dominates():
    # Strategy 0 dominates in every segment.
    perf = np.array(
        [
            [2.0, 0.5, 0.1],
            [1.8, 0.2, 0.0],
            [2.2, 0.1, -0.2],
            [1.9, 0.3, 0.2],
            [2.1, 0.4, 0.1],
            [2.0, 0.1, 0.0],
            [2.3, 0.2, -0.1],
            [1.7, 0.3, 0.1],
        ],
        dtype=float,
    )
    res = probability_of_backtest_overfitting(perf, seed=0, max_combinations=None)
    assert 0.0 <= res.pbo <= 1.0
    assert res.pbo < 0.2

