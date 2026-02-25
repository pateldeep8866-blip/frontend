from datetime import datetime

from quantlab.live.replay_provider import ReplayProvider


def test_provider_tick_format_replay():
    bars = {
        "SPY": [
            (datetime(2020, 1, 1, 0, 0, 0), 100.0),
            (datetime(2020, 1, 2, 0, 0, 0), 101.0),
        ]
    }
    ticks = []

    def on_tick(t):
        ticks.append(t)

    p = ReplayProvider(start="2020-01-01", end="2020-01-03", speed=0.0, offline=True, async_mode=False, bars_by_symbol=bars)
    p.connect()
    p.subscribe(["SPY"])
    p.start_stream(on_tick)

    assert len(ticks) == 2
    for t in ticks:
        assert set(t.keys()) == {"symbol", "ts", "last", "bid", "ask"}
        assert isinstance(t["symbol"], str) and t["symbol"] == "SPY"
        assert isinstance(t["ts"], datetime)
        assert isinstance(t["last"], float) and t["last"] > 0
        assert t["bid"] is None or isinstance(t["bid"], float)
        assert t["ask"] is None or isinstance(t["ask"], float)


def test_provider_replay_asof_fallback_to_last_bar():
    bars = {
        "SPY": [
            (datetime(2020, 1, 1, 0, 0, 0), 100.0),
            (datetime(2020, 1, 2, 0, 0, 0), 101.0),
        ]
    }
    ticks = []

    def on_tick(t):
        ticks.append(t)

    # asof is beyond last bar -> provider should still emit a deterministic non-empty stream
    # (falls back to the last available bar).
    p = ReplayProvider(
        start="2020-01-01",
        end="2020-01-03",
        asof="2020-01-10",
        speed=0.0,
        offline=True,
        async_mode=False,
        bars_by_symbol=bars,
    )
    p.connect()
    p.subscribe(["SPY"])
    p.start_stream(on_tick)

    assert len(ticks) == 1
    assert ticks[0]["ts"] == datetime(2020, 1, 2, 0, 0, 0)
    info = p.stream_info()
    assert int(info.get("tick_count", 0)) == 1
