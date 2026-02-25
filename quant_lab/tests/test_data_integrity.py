import pandas as pd
import pytest

from quantlab.data.providers.base import DataIntegrityError, standardize_ohlcv_columns, validate_ohlcv_df


def _ok_df() -> pd.DataFrame:
    idx = pd.to_datetime(["2023-01-02", "2023-01-03", "2023-01-04"])
    df = pd.DataFrame(
        {
            "Open": [100.0, 101.0, 102.0],
            "High": [101.0, 102.0, 103.0],
            "Low": [99.0, 100.0, 101.0],
            "Close": [100.5, 101.5, 102.5],
            "Volume": [1_000_000, 1_100_000, 900_000],
        },
        index=idx,
    )
    return df


def test_duplicate_rows_detection():
    df = _ok_df()
    dup = pd.concat([df.iloc[:1], df.iloc[:1], df.iloc[1:]], axis=0)
    dup = standardize_ohlcv_columns(dup)
    with pytest.raises(DataIntegrityError):
        validate_ohlcv_df(dup, symbol="SPY", interval="1d")


def test_invalid_ohlc_detection_high_lt_low():
    df = _ok_df()
    df.loc[df.index[0], "High"] = 98.0
    df = standardize_ohlcv_columns(df)
    with pytest.raises(DataIntegrityError):
        validate_ohlcv_df(df, symbol="SPY", interval="1d")


def test_invalid_ohlc_detection_close_outside_range():
    df = _ok_df()
    df.loc[df.index[1], "Close"] = 200.0
    df = standardize_ohlcv_columns(df)
    with pytest.raises(DataIntegrityError):
        validate_ohlcv_df(df, symbol="SPY", interval="1d")


def test_empty_dataset_detection():
    idx = pd.to_datetime([])
    df = pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"], index=idx)
    df = standardize_ohlcv_columns(df)
    with pytest.raises(DataIntegrityError):
        validate_ohlcv_df(df, symbol="SPY", interval="1d")

