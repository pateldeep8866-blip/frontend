from __future__ import annotations

"""
Lightweight exchange calendar utilities (research-only).

We avoid heavy dependencies to keep QUANT_LAB deterministic/offline-friendly.
The NYSE holiday set is an approximation that covers the major regularly-scheduled
market closures. Rare one-off closures (e.g., national days of mourning) are not
included and may trigger strict calendar failures. That's intended behavior for
`--strict` mode (fail loudly).
"""

from datetime import date, timedelta
from typing import Iterable, List


def _nearest_weekday(d: date) -> date:
    # Observance similar to pandas.tseries.holiday.nearest_workday:
    # - Saturday -> Friday
    # - Sunday -> Monday
    if d.weekday() == 5:  # Saturday
        return d - timedelta(days=1)
    if d.weekday() == 6:  # Sunday
        return d + timedelta(days=1)
    return d


def _to_date(ts) -> date:
    # Accept pandas Timestamp/date/datetime.
    try:
        return ts.date()
    except Exception:
        return date.fromisoformat(str(ts)[:10])


def nyse_holidays(start, end) -> List["object"]:
    """
    Return a list of holiday dates (as pandas Timestamps if pandas is available).
    """
    import pandas as pd  # type: ignore
    from pandas.tseries.holiday import (  # type: ignore
        AbstractHolidayCalendar,
        Holiday,
        nearest_workday,
        MO,
        TH,
        GoodFriday,
    )
    from pandas.tseries.offsets import DateOffset  # type: ignore

    class _NYSEHolidayCalendar(AbstractHolidayCalendar):
        rules = [
            Holiday("NewYearsDay", month=1, day=1, observance=nearest_workday),
            Holiday("MLK", month=1, day=1, offset=DateOffset(weekday=MO(3))),
            Holiday("PresidentsDay", month=2, day=1, offset=DateOffset(weekday=MO(3))),
            GoodFriday,
            Holiday("MemorialDay", month=5, day=31, offset=DateOffset(weekday=MO(-1))),
            Holiday("IndependenceDay", month=7, day=4, observance=nearest_workday),
            Holiday("LaborDay", month=9, day=1, offset=DateOffset(weekday=MO(1))),
            Holiday("Thanksgiving", month=11, day=1, offset=DateOffset(weekday=TH(4))),
            Holiday("Christmas", month=12, day=25, observance=nearest_workday),
        ]

    s = pd.Timestamp(_to_date(start))
    e = pd.Timestamp(_to_date(end))
    hol = _NYSEHolidayCalendar().holidays(start=s, end=e).normalize()

    # Juneteenth became a market holiday starting in 2022 (observed nearest weekday).
    years = range(int(s.year), int(e.year) + 1)
    june = []
    for y in years:
        if int(y) < 2022:
            continue
        obs = _nearest_weekday(date(int(y), 6, 19))
        june.append(pd.Timestamp(obs))
    if june:
        hol = hol.union(pd.DatetimeIndex(june)).sort_values()

    return [pd.Timestamp(x).normalize() for x in hol]


def nyse_trading_days(start, end):
    """
    Trading-day index for NYSE-like instruments (Mon-Fri excluding major holidays).
    """
    import pandas as pd  # type: ignore
    from pandas.tseries.offsets import CustomBusinessDay  # type: ignore

    s = pd.Timestamp(_to_date(start))
    e = pd.Timestamp(_to_date(end))
    hol = nyse_holidays(s, e)
    cbd = CustomBusinessDay(holidays=hol)
    # Inclusive endpoints.
    return pd.date_range(s, e, freq=cbd).normalize()

