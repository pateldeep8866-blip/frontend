from quantlab.morning.signals import compute_signals


def test_signal_scoring_identical_inputs_identical_scores():
    feature_rows = {
        "AAA": {
            "mom_63": 0.10,
            "mom_252": 0.20,
            "ma_short": 101.0,
            "ma_long": 100.0,
            "volatility": 0.15,
            "drawdown": -0.02,
            "corr_spy_63": 0.80,
        },
        "BBB": {
            "mom_63": 0.10,
            "mom_252": 0.20,
            "ma_short": 101.0,
            "ma_long": 100.0,
            "volatility": 0.15,
            "drawdown": -0.02,
            "corr_spy_63": 0.80,
        },
        "CCC": {
            "mom_63": -0.05,
            "mom_252": 0.00,
            "ma_short": 99.0,
            "ma_long": 100.0,
            "volatility": 0.30,
            "drawdown": -0.10,
            "corr_spy_63": 0.95,
        },
    }

    returns_lookback = {
        "AAA": [0.001] * 63,
        "BBB": [0.001] * 63,
        "CCC": [-0.001] * 63,
    }

    rows = compute_signals(feature_rows, returns_lookback, fdr_q=0.10)
    by_t = {r.ticker: r for r in rows}
    assert abs(by_t["AAA"].score - by_t["BBB"].score) < 1e-12
    assert abs(by_t["AAA"].p_value - by_t["BBB"].p_value) < 1e-12
    assert bool(by_t["AAA"].passes_fdr) == bool(by_t["BBB"].passes_fdr)

