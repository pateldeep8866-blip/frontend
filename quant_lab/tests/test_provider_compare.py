from sim.provider_compare import _overlap_stats, _provider_key_missing, _weight_distance_l1


def test_overlap_stats_jaccard():
    a = ["AAPL", "MSFT", "NVDA", "SPY", "TLT"]
    b = ["MSFT", "NVDA", "QQQ", "TLT", "XLE"]
    out = _overlap_stats(a, b)
    assert int(out["intersection"]) == 3
    assert int(out["union"]) == 7
    assert abs(float(out["jaccard"]) - (3.0 / 7.0)) < 1e-12


def test_weight_distance_l1():
    wa = {"AAPL": 0.25, "MSFT": 0.25, "CASH": 0.50}
    wb = {"AAPL": 0.10, "NVDA": 0.40, "CASH": 0.50}
    # |0.25-0.10| + |0.25-0| + |0-0.40| + |0.50-0.50| = 0.8
    assert abs(_weight_distance_l1(wa, wb) - 0.8) < 1e-12


def test_provider_key_missing():
    env = {
        "ALPHAVANTAGE_API_KEY": "",
        "FINNHUB_API_KEY": "abc",
        "STOCKDATA_API_KEY": "",
    }
    assert _provider_key_missing("alphavantage", env=env) == "ALPHAVANTAGE_API_KEY"
    assert _provider_key_missing("finnhub", env=env) is None
    assert _provider_key_missing("stockdata", env=env) == "STOCKDATA_API_KEY"
