import pandas as pd
import pytest
import numpy as np

import quantlab.data_cache as dc
from quantlab.data.providers.base import DataIntegrityError
from quantlab.strategies.single_pick_engine import compute_features, fetch_historical, score_universe


def _synthetic_ohlcv(idx: pd.DatetimeIndex, *, start_price: float, daily_drift: float, volume: float) -> pd.DataFrame:
    t = pd.Series(range(len(idx)), index=idx, dtype=float)
    close = start_price * (1.0 + daily_drift) ** t
    df = pd.DataFrame(index=idx)
    df["Open"] = close * 0.999
    df["High"] = close * 1.002
    df["Low"] = close * 0.998
    df["Close"] = close
    df["Adj Close"] = close
    df["Volume"] = float(volume)
    return df


def test_fetch_historical_returns_non_empty_df(tmp_path, monkeypatch):
    start = "2020-01-01"
    end = "2021-12-31"
    idx = pd.bdate_range(start=start, end=end)
    df = _synthetic_ohlcv(idx, start_price=100.0, daily_drift=0.0005, volume=1_000_000.0)

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
    path = dc.get_cache_path("AAA", start, end, "1d")
    df.to_csv(path, index=True, date_format="%Y-%m-%dT%H:%M:%S", float_format="%.10f")

    out = fetch_historical("AAA", start, end)
    assert not out.empty
    assert set(out.columns) == {"open", "high", "low", "close", "volume"}


def test_compute_features_numeric(tmp_path):
    idx = pd.bdate_range(start="2020-01-01", end="2021-12-31")
    df = _synthetic_ohlcv(idx, start_price=100.0, daily_drift=0.0005, volume=1_000_000.0)
    # normalize columns to expected compute_features input
    df = df.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
    feats = compute_features(df)
    for k in ["ret_5d", "ret_20d", "ret_60d", "vol_5d", "vol_20d", "avg_volume_20d"]:
        assert k in feats
        assert isinstance(float(feats[k]), float)


def test_score_universe_outputs_composite(tmp_path, monkeypatch):
    start = "2020-01-01"
    end = "2021-12-31"
    idx = pd.bdate_range(start=start, end=end)

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

    # The single-pick engine fetches ~3y history; seed a superset cache file.
    sup_start = "2018-12-31"
    sup_end = end
    sup_idx = pd.bdate_range(start=sup_start, end=sup_end)

    for t, drift in [("AAA", 0.0008), ("BBB", 0.0002), ("CCC", -0.0002)]:
        df = _synthetic_ohlcv(sup_idx, start_price=100.0, daily_drift=drift, volume=1_000_000.0)
        path = dc.get_cache_path(t, sup_start, sup_end, "1d")
        df.to_csv(path, index=True, date_format="%Y-%m-%dT%H:%M:%S", float_format="%.10f")

    out = score_universe(["AAA", "BBB", "CCC"], asof="2021-12-31")
    assert not out.empty
    assert set(["ticker", "composite", "momentum_score", "mean_reversion_score"]).issubset(out.columns)
    assert out.iloc[0]["ticker"]
    assert pd.notna(out.iloc[0]["composite"])


def test_abnormal_vol_triggers_integrity_error():
    idx = pd.bdate_range(start="2020-01-01", end="2020-06-30")
    # Highly volatile alternating log-returns (sigma should exceed 0.50).
    lr = pd.Series([0.0] + ([1.0, -1.0] * ((len(idx) - 1 + 1) // 2))[: len(idx) - 1], index=idx, dtype=float)
    close = 100.0 * np.exp(lr.cumsum())
    df = pd.DataFrame(
        {
            "open": close * 0.999,
            "high": close * 1.002,
            "low": close * 0.998,
            "close": close,
            "volume": 1_000_000.0,
        },
        index=idx,
    )
    with pytest.raises(DataIntegrityError):
        compute_features(df)
