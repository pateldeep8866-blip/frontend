from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Callable, Hashable, Iterable, List, Sequence, Tuple

try:
    import pandas as pd  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    pd = None  # type: ignore

from quantlab.stats import bh_fdr, mean_return_t_stat


@dataclass(frozen=True)
class WalkForwardWindow:
    train_start: pd.Timestamp
    train_end: pd.Timestamp
    test_start: pd.Timestamp
    test_end: pd.Timestamp


def stitch_indexed_values(parts: Iterable[Iterable[Tuple[Hashable, float]]]) -> List[Tuple[Hashable, float]]:
    """
    Stitch a sequence of (index, value) iterables, removing overlapping indices.

    Keeps the first occurrence of a duplicate index and returns results sorted by index.
    This is a pure-Python helper used for deterministic tests and as a conceptual mirror
    of the pandas-based `stitch_equity_series`.
    """
    seen = set()
    out: List[Tuple[Hashable, float]] = []
    for part in parts:
        for k, v in part:
            if k in seen:
                continue
            seen.add(k)
            out.append((k, float(v)))
    out.sort(key=lambda kv: kv[0])
    return out


def generate_walkforward_windows(
    dates: pd.DatetimeIndex,
    *,
    train_years: int,
    test_months: int,
) -> list[WalkForwardWindow]:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for walk-forward windows.")
    if not isinstance(dates, pd.DatetimeIndex):
        raise ValueError("dates must be a DatetimeIndex")
    if dates.empty:
        return []
    if train_years <= 0 or test_months <= 0:
        raise ValueError("train_years and test_months must be positive")

    idx = dates.sort_values()
    windows: list[WalkForwardWindow] = []

    train_start_target = idx[0]
    while True:
        train_start_pos = int(idx.searchsorted(train_start_target, side="left"))
        if train_start_pos >= len(idx):
            break
        train_start = idx[train_start_pos]

        train_end_target = train_start + pd.DateOffset(years=int(train_years))
        train_end_pos = int(idx.searchsorted(train_end_target, side="right") - 1)
        if train_end_pos <= train_start_pos:
            break
        train_end = idx[train_end_pos]

        test_start_pos = train_end_pos + 1
        if test_start_pos >= len(idx):
            break
        test_start = idx[test_start_pos]

        test_end_target = test_start + pd.DateOffset(months=int(test_months))
        test_end_pos = int(idx.searchsorted(test_end_target, side="right") - 1)
        if test_end_pos < test_start_pos:
            break
        test_end = idx[test_end_pos]

        windows.append(
            WalkForwardWindow(
                train_start=pd.Timestamp(train_start),
                train_end=pd.Timestamp(train_end),
                test_start=pd.Timestamp(test_start),
                test_end=pd.Timestamp(test_end),
            )
        )

        # Advance the rolling window by the test period.
        train_start_target = train_start + pd.DateOffset(months=int(test_months))

    return windows


def stitch_equity_series(series_list: Iterable[pd.Series]) -> pd.Series:
    """
    Concatenate a list of equity series, removing any overlapping timestamps.
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for walk-forward stitching.")
    parts = [s.dropna().astype(float) for s in series_list if s is not None and not s.empty]
    if not parts:
        return pd.Series(dtype=float, name="equity")
    combined = pd.concat(parts)
    combined = combined[~combined.index.duplicated(keep="first")]
    combined = combined.sort_index()
    combined.name = parts[0].name if parts[0].name else "equity"
    return combined


def run_walkforward(
    *,
    prices: pd.Series,
    eval_fn: Callable[[pd.Series, int, int, float], dict],
    grid_short: list[int],
    grid_long: list[int],
    train_years: int,
    test_months: int,
    initial_capital: float,
    commission: float,
    annualization: int,
    risk_free_rate: float,
    max_dd_train_threshold: float = -0.35,
    fdr_q: float = 0.10,
) -> dict:
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for walk-forward evaluation.")
    if not isinstance(prices.index, pd.DatetimeIndex):
        raise ValueError("prices index must be a DatetimeIndex")

    windows = generate_walkforward_windows(prices.index, train_years=train_years, test_months=test_months)
    if not windows:
        raise ValueError("Not enough data to form any walk-forward windows.")

    oos_equity_parts: list[pd.Series] = []
    oos_signals_parts: list[pd.DataFrame] = []
    oos_trades_parts: list[pd.DataFrame] = []
    window_rows = []

    rolling_capital = float(initial_capital)

    for w in windows:
        train_prices = prices.loc[w.train_start : w.train_end]
        test_prices = prices.loc[w.test_start : w.test_end]

        # Evaluate grid on TRAIN only.
        grid_results = []
        for s in grid_short:
            for l in grid_long:
                if int(s) <= 0 or int(l) <= 0 or int(s) >= int(l):
                    continue
                r = eval_fn(train_prices, int(s), int(l), float(initial_capital))
                rets = r["daily_returns"]
                t_stat, p_val = mean_return_t_stat(rets)
                m = r["metrics"]
                grid_results.append(
                    {
                        "short": int(s),
                        "long": int(l),
                        "sharpe": float(m.get("sharpe", float("nan"))),
                        "max_drawdown": float(m.get("max_drawdown", float("nan"))),
                        "t_stat": float(t_stat),
                        "p_value": float(p_val),
                        "metrics": m,
                    }
                )

        if not grid_results:
            raise ValueError("Grid produced no valid (short,long) combinations.")

        # Risk filter: reject if max_drawdown < threshold (i.e., worse than allowed).
        risk_ok = [
            g
            for g in grid_results
            if math.isfinite(float(g["max_drawdown"])) and float(g["max_drawdown"]) >= float(max_dd_train_threshold)
        ]
        candidates = risk_ok if risk_ok else grid_results

        pvals = [c["p_value"] for c in candidates]
        rejects = bh_fdr(pvals, q=float(fdr_q))
        for c, rej in zip(candidates, rejects):
            c["passes_fdr"] = bool(rej)

        sig = [c for c in candidates if c.get("passes_fdr", False)]
        chosen_pool = sig if sig else candidates
        def _key(x: dict) -> tuple[float, float]:
            s = float(x.get("sharpe", float("-inf")))
            if not math.isfinite(s):
                s = float("-inf")
            dd = float(x.get("max_drawdown", float("nan")))
            dd_tie = -abs(dd) if math.isfinite(dd) else float("-inf")
            return s, dd_tie

        chosen = max(chosen_pool, key=_key)

        significant = bool(chosen.get("passes_fdr", False)) if sig else False

        # TEST only: run chosen params, chaining capital.
        test_res = eval_fn(test_prices, int(chosen["short"]), int(chosen["long"]), float(rolling_capital))
        test_equity = test_res["equity"]
        rolling_capital = float(test_equity.iloc[-1])

        oos_equity_parts.append(test_equity)
        oos_signals_parts.append(test_res["signals"])
        oos_trades_parts.append(test_res["trade_events"])

        train_metrics = chosen["metrics"]
        test_metrics = test_res["metrics"]

        row = {
            "train_start": w.train_start.isoformat(),
            "train_end": w.train_end.isoformat(),
            "test_start": w.test_start.isoformat(),
            "test_end": w.test_end.isoformat(),
            "chosen_short": int(chosen["short"]),
            "chosen_long": int(chosen["long"]),
            "significant": bool(significant),
            "significance": "SIGNIFICANT" if bool(significant) else "NOT_SIGNIFICANT",
            "t_stat": float(chosen["t_stat"]),
            "p_value": float(chosen["p_value"]),
        }
        for k, v in (train_metrics or {}).items():
            row[f"train_{k}"] = float(v)
        for k, v in (test_metrics or {}).items():
            row[f"test_{k}"] = float(v)

        window_rows.append(
            row
        )

    oos_equity = stitch_equity_series(oos_equity_parts)
    oos_signals = pd.concat([df for df in oos_signals_parts if df is not None and not df.empty]).sort_index()
    oos_signals = oos_signals[~oos_signals.index.duplicated(keep="first")]
    trades_parts = [df for df in oos_trades_parts if df is not None and not df.empty]
    if trades_parts:
        oos_trades = pd.concat(trades_parts).sort_index().reset_index(drop=True)
    else:
        oos_trades = pd.DataFrame(columns=["date", "action", "price", "position", "equity", "reason"])

    windows_df = pd.DataFrame(window_rows)
    return {
        "windows": windows_df,
        "oos_equity": oos_equity,
        "oos_signals": oos_signals,
        "oos_trades": oos_trades,
        "num_windows": int(len(window_rows)),
    }
