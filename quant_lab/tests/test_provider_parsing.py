import json

import pytest

from quantlab.data.providers.base import DataIntegrityError


def test_alphavantage_rate_limit_note(monkeypatch):
    from quantlab.data.providers.alphavantage_provider import AlphaVantageProvider

    class _Resp:
        status_code = 200

        def json(self):
            return {"Note": "Rate limit"}

    def _get(*args, **kwargs):
        return _Resp()

    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "redacted")
    monkeypatch.setattr("requests.get", _get, raising=False)

    p = AlphaVantageProvider()
    with pytest.raises(DataIntegrityError):
        p.get_prices("SPY", start="2020-01-01", end="2020-02-01", interval="1d")


def test_alphavantage_information_is_error(monkeypatch):
    from quantlab.data.providers.alphavantage_provider import AlphaVantageProvider

    class _Resp:
        status_code = 200

        def json(self):
            return {"Information": "Thank you for using Alpha Vantage! Please visit premium plans."}

    def _get(*args, **kwargs):
        return _Resp()

    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "redacted")
    monkeypatch.setattr("requests.get", _get, raising=False)

    p = AlphaVantageProvider()
    with pytest.raises(DataIntegrityError):
        p.get_prices("SPY", start="2020-01-01", end="2020-02-01", interval="1d")


def test_alphavantage_fallback_to_daily(monkeypatch):
    from quantlab.data.providers.alphavantage_provider import AlphaVantageProvider

    class _Resp:
        def __init__(self, payload):
            self.status_code = 200
            self._payload = payload

        def json(self):
            return self._payload

    adjusted_missing = {"Meta Data": {"1. Information": "Adjusted endpoint unavailable"}}
    daily_ok = {
        "Meta Data": {"1. Information": "Daily Prices"},
        "Time Series (Daily)": {
            "2020-01-02": {
                "1. open": "100.0",
                "2. high": "101.0",
                "3. low": "99.0",
                "4. close": "100.5",
                "5. volume": "123456",
            },
            "2020-01-03": {
                "1. open": "100.5",
                "2. high": "102.0",
                "3. low": "100.0",
                "4. close": "101.5",
                "5. volume": "223456",
            },
        },
    }

    def _get(*args, **kwargs):
        fn = str((kwargs.get("params") or {}).get("function", ""))
        if fn == "TIME_SERIES_DAILY_ADJUSTED":
            return _Resp(adjusted_missing)
        if fn == "TIME_SERIES_DAILY":
            return _Resp(daily_ok)
        return _Resp({})

    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "redacted")
    monkeypatch.setattr("requests.get", _get, raising=False)

    p = AlphaVantageProvider()
    df = p.get_prices("SPY", start="2020-01-01", end="2020-02-01", interval="1d")
    assert not df.empty
    assert "Close" in df.columns
    assert "Volume" in df.columns
    assert float(df["Close"].iloc[-1]) > 0.0


def test_finnhub_mismatched_lengths(monkeypatch):
    from quantlab.data.providers.finnhub_provider import FinnhubProvider

    class _Resp:
        status_code = 200

        def json(self):
            return {"s": "ok", "t": [1, 2], "o": [1], "h": [1], "l": [1], "c": [1], "v": [1]}

    def _get(*args, **kwargs):
        return _Resp()

    monkeypatch.setenv("FINNHUB_API_KEY", "redacted")
    monkeypatch.setattr("requests.get", _get, raising=False)

    p = FinnhubProvider()
    with pytest.raises(DataIntegrityError):
        p.get_prices("SPY", start="2020-01-01", end="2020-02-01", interval="1d")
