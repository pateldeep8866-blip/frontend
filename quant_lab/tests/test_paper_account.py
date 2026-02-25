from datetime import datetime

import pytest

from quantlab.sim.account import PaperAccount


def test_buy_then_sell_updates_cash_and_position():
    acct = PaperAccount(cash=1000.0)
    acct.set_time(datetime(2020, 1, 1))
    acct.buy("ABC", shares=10, price=10.0, commission=0.0)

    assert pytest.approx(acct.cash, rel=0, abs=1e-9) == 900.0
    assert pytest.approx(acct.shares("ABC"), rel=0, abs=1e-9) == 10.0

    acct.set_time(datetime(2020, 1, 2))
    acct.sell("ABC", shares=5, price=20.0, commission=0.0)

    assert pytest.approx(acct.cash, rel=0, abs=1e-9) == 1000.0
    assert pytest.approx(acct.shares("ABC"), rel=0, abs=1e-9) == 5.0
    assert len(acct.trade_log) == 2

