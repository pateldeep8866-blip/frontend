from quantlab.sim.copilot import Copilot


def test_copilot_suggested_shares_respects_max_position_pct():
    cop = Copilot(short_window=2, long_window=3, max_position_pct=0.25, max_daily_loss_pct=0.02)
    equity = 10_000.0
    close = 102.0
    rec = cop.recommend(
        close=close,
        history_closes=[100.0, 101.0, 102.0],
        cash=equity,
        current_shares=0.0,
        equity=equity,
        daily_pnl_pct=0.0,
        halted=False,
    )

    assert rec.suggested_shares >= 0
    assert (rec.suggested_shares * close) <= (0.25 * equity + 1e-9)

