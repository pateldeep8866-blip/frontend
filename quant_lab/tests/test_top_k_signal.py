import pandas as pd

import quantlab.data_cache as dc
from quantlab.strategies.top_k_signal import compute_top_k_signals


def _synthetic_ohlcv(idx: pd.DatetimeIndex, *, start_price: float, daily_drift: float, volume: float) -> pd.DataFrame:
    # Deterministic trending series.
    t = pd.Series(range(len(idx)), index=idx, dtype=float)
    close = start_price * (1.0 + daily_drift) ** t
    df = pd.DataFrame(index=idx)
    df["Open"] = close * 0.999
    df["High"] = close * 1.002
    df["Low"] = close * 0.998
    df["Close"] = close
    df["Volume"] = float(volume)
    return df


def test_compute_top_k_signals_smoke(tmp_path, monkeypatch):
    start = "2020-01-01"
    end = "2021-12-31"
    idx = pd.bdate_range(start=start, end=end)

    # Redirect cache paths into pytest temp dir so we don't touch repo cache.
    def _tmp_cache_path(
        ticker: str,
        start: str,
        end: str,
        interval: str = "1d",
        *,
        provider_name=None,
        project_root=None,
    ):
        p = tmp_path / f"{ticker.upper()}__{interval}__{start}__{end}.csv"
        p.parent.mkdir(parents=True, exist_ok=True)
        return p

    monkeypatch.setattr(dc, "get_cache_path", _tmp_cache_path)

    # Create three synthetic tickers with distinct trends.
    for t, drift in [("AAA", 0.0010), ("BBB", 0.0003), ("CCC", -0.0004)]:
        df = _synthetic_ohlcv(idx, start_price=100.0, daily_drift=drift, volume=1_000_000.0)
        path = dc.get_cache_path(t, start, end, "1d")
        df.to_csv(path, index=True, date_format="%Y-%m-%dT%H:%M:%S", float_format="%.10f")

    out1 = compute_top_k_signals(["AAA", "BBB", "CCC"], start=start, end=end, k=2)
    out2 = compute_top_k_signals(["AAA", "BBB", "CCC"], start=start, end=end, k=2)

    assert list(out1.columns) == list(out2.columns)
    pd.testing.assert_frame_equal(out1, out2)

    assert len(out1) == 2
    assert {"ticker", "rank", "score", "prob_up", "model_type"}.issubset(out1.columns)
    assert out1["score"].notna().all()
    assert out1["prob_up"].notna().all()
    assert (out1["score"].diff().fillna(0.0) <= 0.0).all()

    # Make sure model metadata is attached for downstream auditability.
    assert "model" in out1.attrs
    assert out1.attrs["model"]["universe_size"] == 3
