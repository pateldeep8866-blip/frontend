"""
Moving Average Crossover Backtest (research only).

Implements a simple long-only moving average crossover strategy:
- Buy when short SMA crosses above long SMA (golden cross).
- Sell when short SMA crosses below long SMA (death cross).

Data source: yfinance
Libraries: pandas, numpy, yfinance, matplotlib

Notes:
- Uses adjusted close prices by default ("Adj Close") when available.
- Signals are generated from end-of-bar prices. Trades are executed on the next bar
  at the same price series to avoid look-ahead bias (simple and consistent for
  adjusted data).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    import numpy as np  # type: ignore
    import pandas as pd  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    np = None  # type: ignore
    pd = None  # type: ignore

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    # Allow `python backtests/ma_crossover.py ...` to import `quantlab.*`.
    sys.path.insert(0, str(_ROOT))

from quantlab.data_cache import get_prices_cached  # noqa: E402
from quantlab.index import update_run_index  # noqa: E402
from quantlab.reporting.run_manifest import write_run_manifest  # noqa: E402
from quantlab.rigor.drift import drift_metrics  # noqa: E402
from quantlab.rigor.validation import block_bootstrap_ci, deflated_sharpe_probability, newey_west_t_stat_mean  # noqa: E402
from quantlab.stats import bh_fdr, compute_metrics, mean_return_t_stat  # noqa: E402
from quantlab.walkforward import run_walkforward  # noqa: E402

try:
    from quantlab.monitoring.drift import compute_drift_report  # noqa: E402
except Exception:  # pragma: no cover
    compute_drift_report = None  # type: ignore


@dataclass(frozen=True)
class BacktestConfig:
    ticker: str
    start: Optional[str] = None
    end: Optional[str] = None
    interval: str = "1d"
    short_window: int = 20
    long_window: int = 50
    initial_capital: float = 10_000.0
    commission: float = 0.0  # fraction (e.g., 0.001 == 10 bps)
    price_col: str = "Adj Close"
    annualization: int = 252
    risk_free_rate: float = 0.0  # annualized, decimal


def _select_price_series(df: pd.DataFrame, preferred: str) -> pd.Series:
    if preferred in df.columns and df[preferred].notna().any():
        s = df[preferred]
    elif "Close" in df.columns and df["Close"].notna().any():
        s = df["Close"]
    else:
        raise ValueError("No usable price column found (expected 'Adj Close' or 'Close').")

    s = s.astype(float).copy()
    s.name = "price"
    return s


def compute_signals(
    prices: pd.Series,
    short_window: int,
    long_window: int,
) -> pd.DataFrame:
    if short_window <= 0 or long_window <= 0:
        raise ValueError("Moving average windows must be positive integers.")
    if short_window >= long_window:
        raise ValueError("short_window must be < long_window.")

    df = pd.DataFrame(index=prices.index)
    df["price"] = prices

    df["sma_short"] = df["price"].rolling(window=short_window, min_periods=short_window).mean()
    df["sma_long"] = df["price"].rolling(window=long_window, min_periods=long_window).mean()

    # In-market signal (1 when short SMA > long SMA); keep 0 where MAs are not ready.
    ready = df["sma_short"].notna() & df["sma_long"].notna()
    df["signal"] = 0
    df.loc[ready, "signal"] = (df.loc[ready, "sma_short"] > df.loc[ready, "sma_long"]).astype(int)

    prev = df["signal"].shift(1).fillna(0).astype(int)
    df["buy_signal"] = (df["signal"] == 1) & (prev == 0)
    df["sell_signal"] = (df["signal"] == 0) & (prev == 1)

    # Execute on next bar to avoid look-ahead.
    # Next-bar execution: trade on bar t+1 based on signal from bar t.
    df["buy_exec"] = df["buy_signal"].shift(1, fill_value=False).astype(bool)
    df["sell_exec"] = df["sell_signal"].shift(1, fill_value=False).astype(bool)

    return df


def simulate_trades(
    signals: pd.DataFrame,
    initial_capital: float,
    commission: float = 0.0,
) -> tuple[pd.Series, pd.Series, pd.DataFrame]:
    if initial_capital <= 0:
        raise ValueError("initial_capital must be > 0.")
    if commission < 0 or commission >= 1:
        raise ValueError("commission must be in [0, 1).")

    cash = float(initial_capital)
    shares = 0.0

    equity = []
    position = []
    events = []

    for dt, row in signals.iterrows():
        price = float(row["price"])
        if not np.isfinite(price) or price <= 0:
            equity.append(float(cash))
            position.append(1 if shares > 0 else 0)
            continue

        # Sell first, then buy (rare but deterministic if both happen).
        if bool(row.get("sell_exec", False)) and shares > 0:
            gross = shares * price
            net = gross * (1.0 - commission)
            cash = net
            shares = 0.0
            events.append(
                {
                    "date": dt,
                    "action": "SELL",
                    "price": float(price),
                    "position": 0,
                    "equity": float(cash),
                    "reason": "MA_CROSS_DOWN",
                }
            )

        if bool(row.get("buy_exec", False)) and shares == 0 and cash > 0:
            spend = cash * (1.0 - commission)
            shares = spend / price
            cash = 0.0
            events.append(
                {
                    "date": dt,
                    "action": "BUY",
                    "price": float(price),
                    "position": 1,
                    "equity": float(shares * price),
                    "reason": "MA_CROSS_UP",
                }
            )

        equity.append(cash + shares * price)
        position.append(1 if shares > 0 else 0)

    equity_s = pd.Series(equity, index=signals.index, name="equity").astype(float)
    position_s = pd.Series(position, index=signals.index, name="position").astype(int)
    events_df = pd.DataFrame(events, columns=["date", "action", "price", "position", "equity", "reason"])
    return equity_s, position_s, events_df


def buy_and_hold_equity(prices: pd.Series, initial_capital: float) -> pd.Series:
    p = prices.dropna().astype(float)
    if p.empty:
        raise ValueError("Price series is empty.")
    return float(initial_capital) * (p / float(p.iloc[0]))


def evaluate_ma_crossover(
    prices: pd.Series,
    *,
    short_window: int,
    long_window: int,
    initial_capital: float,
    commission: float,
    annualization: int,
    risk_free_rate: float,
) -> dict[str, object]:
    signals = compute_signals(prices, short_window, long_window)
    equity, position, trade_events = simulate_trades(signals, initial_capital, commission=commission)
    signals = signals.copy()
    signals["position"] = position

    daily_returns = equity.pct_change().dropna()
    metrics = compute_metrics(equity, annualization=annualization, risk_free_rate=risk_free_rate)
    t_stat, p_value = mean_return_t_stat(daily_returns)

    return {
        "signals": signals,
        "equity": equity,
        "position": position,
        "trade_events": trade_events,
        "daily_returns": daily_returns,
        "metrics": metrics,
        "t_stat": float(t_stat),
        "p_value": float(p_value),
    }


def plot_equity_curve(
    equity: pd.Series,
    title: str,
    outfile: Path,
    show: bool = False,
) -> None:
    # Headless-safe plotting for artifact generation.
    import matplotlib

    if not show:
        matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(11, 5.5))
    equity.plot(ax=ax, lw=2)
    ax.set_title(title)
    ax.set_xlabel("Date")
    ax.set_ylabel("Equity")
    ax.grid(True, alpha=0.25)

    fig.tight_layout()
    fig.savefig(outfile, dpi=140)
    if show:
        plt.show()
    plt.close(fig)


def run_backtest(cfg: BacktestConfig) -> dict[str, object]:
    hist, data_path, data_sha256, cache_hit = get_prices_cached(
        cfg.ticker,
        start=cfg.start,
        end=cfg.end,
        interval=cfg.interval,
        strict=bool(args.strict),
    )
    prices = _select_price_series(hist, cfg.price_col)

    # Data provenance (captured by the data layer via df.attrs when available).
    meta = {}
    try:
        meta = dict(getattr(hist, "attrs", {}).get("quantlab_data") or {})
    except Exception:
        meta = {}

    prov_name = str(meta.get("provider_name") or "unknown")
    prov_ver = str(meta.get("provider_version") or "unknown")
    data_provenance = {
        "provider_name": prov_name,
        "provider_version": prov_ver,
        "files": {
            str(cfg.ticker).upper(): {
                "data_path": str(data_path),
                "data_sha256": str(data_sha256),
                "file_sha256": str(meta.get("file_sha256") or str(data_sha256)),
                "cache_hit": bool(cache_hit),
                "retrieval_timestamp": str(meta.get("retrieval_timestamp") or ""),
                "row_count": int(meta.get("row_count") or getattr(hist, "shape", [0])[0] or 0),
                "first_timestamp": str(meta.get("first_timestamp") or (hist.index.min().isoformat() if not hist.empty else "")),
                "last_timestamp": str(meta.get("last_timestamp") or (hist.index.max().isoformat() if not hist.empty else "")),
            }
        },
    }
    strat = evaluate_ma_crossover(
        prices,
        short_window=cfg.short_window,
        long_window=cfg.long_window,
        initial_capital=cfg.initial_capital,
        commission=cfg.commission,
        annualization=cfg.annualization,
        risk_free_rate=cfg.risk_free_rate,
    )

    return {
        "history": hist,
        "prices": prices,
        "signals": strat["signals"],
        "equity": strat["equity"],
        "position": strat["position"],
        "trade_events": strat["trade_events"],
        "daily_returns": strat["daily_returns"],
        "metrics": strat["metrics"],
        "t_stat": strat["t_stat"],
        "p_value": strat["p_value"],
        "data_path": data_path,
        "data_sha256": data_sha256,
        "cache_hit": cache_hit,
        "config": cfg,
    }


def _format_pct(x: float) -> str:
    if x is None or not np.isfinite(x):
        return "nan"
    return f"{x * 100:.2f}%"


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Moving average crossover backtest (research only).")
    p.add_argument("--ticker", required=True, help="Ticker symbol (e.g., AAPL)")
    p.add_argument("--start", default=None, help="Start date YYYY-MM-DD (optional)")
    p.add_argument("--end", default=None, help="End date YYYY-MM-DD (optional)")
    p.add_argument("--interval", default="1d", help="Data interval (default: 1d)")
    p.add_argument("--short", type=int, default=20, help="Short SMA window (default: 20)")
    p.add_argument("--long", type=int, default=50, help="Long SMA window (default: 50)")
    p.add_argument("--capital", type=float, default=10_000.0, help="Initial capital (default: 10000)")
    p.add_argument("--commission", type=float, default=0.0, help="Commission fraction per trade (default: 0.0)")
    p.add_argument("--price-col", default="Adj Close", help="Preferred price column (default: 'Adj Close')")
    p.add_argument("--risk-free", type=float, default=0.0, help="Annual risk-free rate (default: 0.0)")
    p.add_argument("--benchmark-ticker", default="SPY", help="Benchmark buy-and-hold ticker (default: SPY)")

    p.add_argument("--walkforward", action="store_true", help="Enable walk-forward optimization + OOS evaluation")
    p.add_argument("--train_years", type=int, default=5, help="Walk-forward training window size in years (default: 5)")
    p.add_argument("--test_months", type=int, default=6, help="Walk-forward test window size in months (default: 6)")
    p.add_argument(
        "--grid_short",
        default="10,15,20,30,40",
        help='Grid of short SMA windows (comma-separated, default: "10,15,20,30,40")',
    )
    p.add_argument(
        "--grid_long",
        default="50,75,100,125,150",
        help='Grid of long SMA windows (comma-separated, default: "50,75,100,125,150")',
    )

    p.add_argument("--robustness_grid", action="store_true", help="Evaluate full-period parameter grid and summarize sensitivity")
    p.add_argument("--save", action="store_true", help="No-op (artifacts are always saved into reports/runs/<run_id>/)")
    # Backward-compatible alias: `--plot` means "show".
    p.add_argument("--show", action="store_true", help="Show equity curve plot interactively")
    p.add_argument("--plot", action="store_true", help="Alias for --show (deprecated)")
    p.add_argument("--plot-out", default=None, help="Also save the equity plot to this path")
    p.add_argument("--strict", action="store_true", help="Enable strict validation (fail-fast)")
    args = p.parse_args(argv)

    if np is None or pd is None:  # pragma: no cover
        raise SystemExit(
            "Missing required dependencies. Install: python -m pip install -r requirements.txt"
        )

    if args.walkforward and args.robustness_grid:
        raise SystemExit("--walkforward and --robustness_grid are mutually exclusive.")

    def _parse_int_list(s: str) -> list[int]:
        out: list[int] = []
        for part in str(s or "").split(","):
            part = part.strip()
            if not part:
                continue
            try:
                v = int(part)
            except Exception:
                continue
            if v > 0 and v not in out:
                out.append(v)
        return out

    cfg = BacktestConfig(
        ticker=args.ticker,
        start=args.start,
        end=args.end,
        interval=args.interval,
        short_window=args.short,
        long_window=args.long,
        initial_capital=args.capital,
        commission=args.commission,
        price_col=args.price_col,
        risk_free_rate=args.risk_free,
    )

    mode = "walkforward" if bool(args.walkforward) else "single"

    # Load primary data (cached) once up front so the manifest can record the data hash.
    hist, data_path, data_sha256, cache_hit = get_prices_cached(
        cfg.ticker,
        start=cfg.start,
        end=cfg.end,
        interval=cfg.interval,
    )
    prices = _select_price_series(hist, cfg.price_col)

    # Data provenance (captured by the data layer via df.attrs when available).
    meta = {}
    try:
        meta = dict(getattr(hist, "attrs", {}).get("quantlab_data") or {})
    except Exception:
        meta = {}

    prov_name = str(meta.get("provider_name") or "unknown")
    prov_ver = str(meta.get("provider_version") or "unknown")
    data_provenance = {
        "provider_name": prov_name,
        "provider_version": prov_ver,
        "files": {
            str(cfg.ticker).upper(): {
                "data_path": str(data_path),
                "data_sha256": str(data_sha256),
                "file_sha256": str(meta.get("file_sha256") or str(data_sha256)),
                "cache_hit": bool(cache_hit),
                "retrieval_timestamp": str(meta.get("retrieval_timestamp") or ""),
                "row_count": int(meta.get("row_count") or getattr(hist, "shape", [0])[0] or 0),
                "first_timestamp": str(meta.get("first_timestamp") or (hist.index.min().isoformat() if not hist.empty else "")),
                "last_timestamp": str(meta.get("last_timestamp") or (hist.index.max().isoformat() if not hist.empty else "")),
            }
        },
    }

    grid_short = _parse_int_list(args.grid_short)
    grid_long = _parse_int_list(args.grid_long)

    # Run Pack v1: create a run directory and write a manifest early.
    strategy_params: dict[str, object] = {
        "mode": mode,
        "ticker": cfg.ticker,
        "start": cfg.start,
        "end": cfg.end,
        "interval": cfg.interval,
        "commission": cfg.commission,
        "risk_free_rate": cfg.risk_free_rate,
        "benchmark_ticker": str(args.benchmark_ticker or ""),
        "strict": bool(args.strict),
    }
    if mode == "single":
        strategy_params.update(
            {
                "short_window": int(cfg.short_window),
                "long_window": int(cfg.long_window),
            }
        )
        if args.robustness_grid:
            strategy_params.update(
                {
                    "robustness_grid": True,
                    "grid_short": grid_short,
                    "grid_long": grid_long,
                    "fdr_q": 0.10,
                    "max_dd_threshold": -0.35,
                }
            )
    else:
        strategy_params.update(
            {
                "train_years": int(args.train_years),
                "test_months": int(args.test_months),
                "grid_short": grid_short,
                "grid_long": grid_long,
                "fdr_q": 0.10,
                "max_dd_train_threshold": -0.35,
            }
        )

    # Composite code hash covers the strategy entrypoint + relevant QUANT_LAB modules.
    import quantlab.data_cache as _qdc  # noqa: E402
    import quantlab.index as _qindex  # noqa: E402
    import quantlab.reporting.run_manifest as _qrm  # noqa: E402
    import quantlab.stats as _qstats  # noqa: E402
    import quantlab.utils.hashing as _qhash  # noqa: E402
    import quantlab.walkforward as _qwf  # noqa: E402

    code_paths = [
        Path(__file__).resolve(),
        Path(_qdc.__file__).resolve(),
        Path(_qindex.__file__).resolve(),
        Path(_qrm.__file__).resolve(),
        Path(_qstats.__file__).resolve(),
        Path(_qhash.__file__).resolve(),
        Path(_qwf.__file__).resolve(),
    ]
    code_paths.append((_ROOT / "quantlab" / "data" / "__init__.py").resolve())
    code_paths.extend(sorted((_ROOT / "quantlab" / "data" / "providers").glob("*.py")))

    run_root = _ROOT / "reports" / "runs"
    run_dir, manifest = write_run_manifest(
        strategy_name="ma_crossover",
        parameters=strategy_params,
        data_path=Path(data_path),
        data_sha256=str(data_sha256),
        cache_hit=bool(cache_hit),
        data_source=str(prov_name),
        data_provenance=data_provenance,
        code_path=Path(__file__).resolve(),
        code_paths=code_paths,
        run_root=run_root,
        project_root=_ROOT,
    )

    def _jsonable_float(x: float) -> Optional[float]:
        try:
            xf = float(x)
        except Exception:
            return None
        return xf if np.isfinite(xf) else None

    def _clean_metrics(m: dict[str, float]) -> dict[str, Optional[float]]:
        return {k: _jsonable_float(v) for k, v in m.items()}

    def _write_signals_csv(signals: pd.DataFrame) -> None:
        out = pd.DataFrame(
            {
                "close": signals["price"],
                "ma_short": signals["sma_short"],
                "ma_long": signals["sma_long"],
                "signal": signals["signal"],
                "position": signals["position"],
            },
            index=signals.index,
        )
        out = out.reset_index()
        out = out.rename(columns={out.columns[0]: "date"})
        out.to_csv(run_dir / "signals.csv", index=False)

    def _write_trades_csv(trades: pd.DataFrame) -> None:
        t = trades.copy()
        if "date" in t.columns:
            t["date"] = pd.to_datetime(t["date"])
        t.to_csv(run_dir / "trades.csv", index=False)

    show = bool(args.show or args.plot)

    # Build benchmark series (buy-and-hold).
    bench_ticker = str(args.benchmark_ticker or "").strip().upper() or cfg.ticker
    if bench_ticker == cfg.ticker:
        bench_prices = prices
    else:
        bench_hist, _, _, _ = get_prices_cached(
            bench_ticker,
            start=cfg.start,
            end=cfg.end,
            interval=cfg.interval,
            strict=bool(args.strict),
        )
        bench_prices = _select_price_series(bench_hist, cfg.price_col)

    metrics_out: dict[str, object]
    equity_for_plot: pd.Series
    title: str
    trades_df: pd.DataFrame
    signals_df: pd.DataFrame

    if mode == "single":
        strat = evaluate_ma_crossover(
            prices,
            short_window=int(cfg.short_window),
            long_window=int(cfg.long_window),
            initial_capital=float(cfg.initial_capital),
            commission=float(cfg.commission),
            annualization=int(cfg.annualization),
            risk_free_rate=float(cfg.risk_free_rate),
        )

        equity = strat["equity"]
        signals_df = strat["signals"]
        trades_df = strat["trade_events"]
        trades_count = int((trades_df["action"] == "SELL").sum()) if not trades_df.empty else 0

        bench_equity = buy_and_hold_equity(bench_prices, float(cfg.initial_capital))
        bench_metrics = compute_metrics(bench_equity, annualization=cfg.annualization, risk_free_rate=cfg.risk_free_rate)

        strategy_metrics = _clean_metrics(strat["metrics"])
        strategy_metrics.update(
            {
                "trades_count": int(trades_count),
                "start_equity": _jsonable_float(equity.iloc[0]),
                "end_equity": _jsonable_float(equity.iloc[-1]),
                "t_stat": _jsonable_float(float(strat["t_stat"])),
                "p_value": _jsonable_float(float(strat["p_value"])),
            }
        )

        # Rigor: HAC t-stat, deflated Sharpe probability, block bootstrap CI, drift.
        rets = strat["daily_returns"].astype(float)
        nw_t, nw_p, nw_se = newey_west_t_stat_mean(rets.to_numpy(), lags=5)
        dsr_trials = max(1, len(grid_short) * len(grid_long)) if bool(args.robustness_grid) else 1
        dsr = deflated_sharpe_probability(
            rets.to_numpy(),
            annualization=cfg.annualization,
            risk_free_rate=cfg.risk_free_rate,
            n_trials=int(dsr_trials),
        )
        ci = block_bootstrap_ci(rets.to_numpy(), block_size=20, n_boot=400, seed=0)
        drift = drift_metrics(rets.tail(252).head(189).to_numpy(), rets.tail(63).to_numpy(), bins=10) if len(rets) >= 252 else {}

        # Monitoring drift report (feature shift + sharpe breakdown, deterministic).
        drift_payload = {"status": "unavailable", "drift_flag": False}
        if compute_drift_report is not None:
            try:
                dr = compute_drift_report(
                    spy_returns=prices.pct_change().dropna().astype(float),
                    strategy_returns=rets,
                    asof=rets.index.max(),
                )
                drift_payload = {
                    "drift_flag": bool(dr.drift_flag),
                    "ks_shift": dr.ks_shift,
                    "ic_decay": dr.ic_decay,
                    "sharpe_breakdown": dr.sharpe_breakdown,
                    "vol_regime": dr.vol_regime,
                }
            except Exception as e:
                drift_payload = {"status": "error", "error": str(e), "drift_flag": False}

        (run_dir / "drift_report.json").write_text(
            json.dumps(drift_payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        strategy_metrics.update(
            {
                "nw_t_stat": _jsonable_float(float(nw_t)),
                "nw_p_value": _jsonable_float(float(nw_p)),
                "deflated_sharpe_prob": _jsonable_float(float(dsr.get("prob", float("nan")))),
            }
        )

        if bool(args.strict):
            min_prob = float(os.environ.get("QUANTLAB_STRICT_MIN_DSR_PROB", "0.95"))
            prob = float(dsr.get("prob", float("nan")))
            if not np.isfinite(prob) or prob < float(min_prob):
                raise SystemExit(f"Strict mode: deflated Sharpe prob below threshold (prob={prob} < {min_prob}).")
            if not np.isfinite(float(nw_se)) or float(nw_se) <= 0:
                raise SystemExit("Strict mode: Newey-West HAC SE unavailable/invalid.")

        metrics_out = {
            "mode": "single",
            "strategy": strategy_metrics,
            "benchmark": {"ticker": bench_ticker, **_clean_metrics(bench_metrics)},
            "rigor": {
                "newey_west": {"t_stat_mean": float(nw_t), "p_value": float(nw_p), "se": float(nw_se)},
                "bootstrap_ci_mean_return": {"point": ci.point, "lo": ci.lo, "hi": ci.hi},
                "deflated_sharpe": dsr,
                "drift": drift,
            },
            "monitoring": {"drift": drift_payload},
        }

        # Robustness grid summary (optional).
        robustness_md_lines: list[str] = []
        if bool(args.robustness_grid):
            results = []
            for s in grid_short:
                for l in grid_long:
                    if int(s) >= int(l):
                        continue
                    r = evaluate_ma_crossover(
                        prices,
                        short_window=int(s),
                        long_window=int(l),
                        initial_capital=float(cfg.initial_capital),
                        commission=float(cfg.commission),
                        annualization=int(cfg.annualization),
                        risk_free_rate=float(cfg.risk_free_rate),
                    )
                    m = r["metrics"]
                    results.append(
                        {
                            "short": int(s),
                            "long": int(l),
                            "sharpe": float(m.get("sharpe", np.nan)),
                            "cagr": float(m.get("cagr", np.nan)),
                            "max_dd": float(m.get("max_drawdown", np.nan)),
                            "t_stat": float(r["t_stat"]),
                            "p_value": float(r["p_value"]),
                        }
                    )

            grid_df = pd.DataFrame(results)
            if grid_df.empty:
                raise SystemExit("Robustness grid produced no valid parameter combinations.")

            passes = bh_fdr(grid_df["p_value"].to_numpy(dtype=float), q=0.10)
            grid_df["passes_fdr"] = [bool(x) for x in passes]
            grid_df = grid_df.sort_values(["sharpe", "cagr"], ascending=False)
            grid_df.to_csv(run_dir / "grid_results.csv", index=False)

            # Stability note thresholds.
            sharpe_thr = 1.0
            max_dd_thr = -0.35
            stable = grid_df[(grid_df["sharpe"] >= sharpe_thr) & (grid_df["max_dd"] >= max_dd_thr)]

            robustness_md_lines.extend(
                [
                    "## Robustness Grid",
                    "",
                    f"- Grid size: `{len(grid_short)} x {len(grid_long)}` (valid combos: `{len(grid_df)}`)",
                    f"- FDR q: `0.10`  Sharpe threshold: `{sharpe_thr}`  Max DD threshold: `{max_dd_thr}`",
                    f"- Stable configs (Sharpe >= {sharpe_thr} and MaxDD >= {max_dd_thr}): `{len(stable)}/{len(grid_df)}`",
                    f"- Passes FDR: `{int(grid_df['passes_fdr'].sum())}/{len(grid_df)}`",
                    "",
                    "Top 10 configs by Sharpe:",
                    "",
                ]
            )

            top10 = grid_df.head(10)
            robustness_md_lines.append("| short | long | sharpe | cagr | max_dd | p_value | passes_fdr |")
            robustness_md_lines.append("|---:|---:|---:|---:|---:|---:|:---:|")
            for _, r in top10.iterrows():
                robustness_md_lines.append(
                    f"| {int(r['short'])} | {int(r['long'])} | {r['sharpe']:.3f} | {r['cagr']:.3f} | {r['max_dd']:.3f} | {r['p_value']:.3g} | {'Y' if bool(r['passes_fdr']) else 'N'} |"
                )
            robustness_md_lines.append("")

            metrics_out["robustness_grid"] = {
                "grid_short": grid_short,
                "grid_long": grid_long,
                "fdr_q": 0.10,
                "stable_count": int(len(stable)),
                "total_count": int(len(grid_df)),
                "sharpe_threshold": float(sharpe_thr),
                "max_dd_threshold": float(max_dd_thr),
            }

        equity_for_plot = equity
        title = f"{cfg.ticker} MA({cfg.short_window},{cfg.long_window}) Equity Curve"

        # Always write audit artifacts.
        _write_signals_csv(signals_df)
        _write_trades_csv(trades_df)

        extra_md = "\n".join(robustness_md_lines) if robustness_md_lines else ""

    else:
        def _eval_fn(p: pd.Series, s: int, l: int, capital: float) -> dict:
            return evaluate_ma_crossover(
                p,
                short_window=int(s),
                long_window=int(l),
                initial_capital=float(capital),
                commission=float(cfg.commission),
                annualization=int(cfg.annualization),
                risk_free_rate=float(cfg.risk_free_rate),
            )

        wf = run_walkforward(
            prices=prices,
            eval_fn=_eval_fn,
            grid_short=grid_short,
            grid_long=grid_long,
            train_years=int(args.train_years),
            test_months=int(args.test_months),
            initial_capital=float(cfg.initial_capital),
            commission=float(cfg.commission),
            annualization=int(cfg.annualization),
            risk_free_rate=float(cfg.risk_free_rate),
            max_dd_train_threshold=-0.35,
            fdr_q=0.10,
        )

        windows_df = wf["windows"]
        oos_equity = wf["oos_equity"]
        signals_df = wf["oos_signals"]
        trades_df = wf["oos_trades"]

        (run_dir / "walkforward_windows.csv").write_text(windows_df.to_csv(index=False), encoding="utf-8")
        oos_equity.to_frame("equity").to_csv(run_dir / "oos_equity.csv", index=True)

        # Audit artifacts (OOS).
        _write_signals_csv(signals_df)
        _write_trades_csv(trades_df)

        trades_count = int((trades_df["action"] == "SELL").sum()) if not trades_df.empty else 0

        oos_metrics = compute_metrics(oos_equity, annualization=cfg.annualization, risk_free_rate=cfg.risk_free_rate)

        # Benchmark aligned to OOS calendar for a fair comparison.
        bench_prices_aligned = bench_prices.reindex(oos_equity.index).ffill().dropna()
        bench_equity = buy_and_hold_equity(bench_prices_aligned, float(cfg.initial_capital))
        bench_metrics = compute_metrics(bench_equity, annualization=cfg.annualization, risk_free_rate=cfg.risk_free_rate)

        num_windows = int(wf["num_windows"])
        avg_oos_sharpe = float(windows_df["test_sharpe"].mean()) if not windows_df.empty else float("nan")
        worst_oos_dd = float(windows_df["test_max_drawdown"].min()) if not windows_df.empty else float("nan")
        sig_any = bool(windows_df["significant"].any()) if "significant" in windows_df.columns else False
        sig_windows = int(windows_df["significant"].sum()) if "significant" in windows_df.columns else 0

        strategy_metrics = _clean_metrics(oos_metrics)
        strategy_metrics.update(
            {
                "trades_count": int(trades_count),
                "start_equity": _jsonable_float(oos_equity.iloc[0]),
                "end_equity": _jsonable_float(oos_equity.iloc[-1]),
                "num_windows": int(num_windows),
                "avg_oos_sharpe": _jsonable_float(avg_oos_sharpe),
                "worst_oos_drawdown": _jsonable_float(worst_oos_dd),
                "significant_any": bool(sig_any),
                "significant_windows": int(sig_windows),
            }
        )

        # Rigor on stitched OOS returns.
        oos_rets = oos_equity.pct_change().dropna().astype(float)
        nw_t, nw_p, nw_se = newey_west_t_stat_mean(oos_rets.to_numpy(), lags=5)
        dsr = deflated_sharpe_probability(
            oos_rets.to_numpy(),
            annualization=cfg.annualization,
            risk_free_rate=cfg.risk_free_rate,
            n_trials=max(1, len(grid_short) * len(grid_long)),
        )
        ci = block_bootstrap_ci(oos_rets.to_numpy(), block_size=20, n_boot=400, seed=0)
        drift = (
            drift_metrics(oos_rets.tail(252).head(189).to_numpy(), oos_rets.tail(63).to_numpy(), bins=10)
            if len(oos_rets) >= 252
            else {}
        )

        drift_payload = {"status": "unavailable", "drift_flag": False}
        if compute_drift_report is not None:
            try:
                under = prices.pct_change().reindex(oos_rets.index).dropna().astype(float)
                dr = compute_drift_report(
                    spy_returns=under,
                    strategy_returns=oos_rets,
                    asof=oos_rets.index.max(),
                )
                drift_payload = {
                    "drift_flag": bool(dr.drift_flag),
                    "ks_shift": dr.ks_shift,
                    "ic_decay": dr.ic_decay,
                    "sharpe_breakdown": dr.sharpe_breakdown,
                    "vol_regime": dr.vol_regime,
                }
            except Exception as e:
                drift_payload = {"status": "error", "error": str(e), "drift_flag": False}

        (run_dir / "drift_report.json").write_text(
            json.dumps(drift_payload, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        strategy_metrics.update(
            {
                "nw_t_stat": _jsonable_float(float(nw_t)),
                "nw_p_value": _jsonable_float(float(nw_p)),
                "deflated_sharpe_prob": _jsonable_float(float(dsr.get("prob", float("nan")))),
            }
        )

        if bool(args.strict):
            min_prob = float(os.environ.get("QUANTLAB_STRICT_MIN_DSR_PROB", "0.95"))
            prob = float(dsr.get("prob", float("nan")))
            if not np.isfinite(prob) or prob < float(min_prob):
                raise SystemExit(f"Strict mode: deflated Sharpe prob below threshold (prob={prob} < {min_prob}).")
            if not np.isfinite(float(nw_se)) or float(nw_se) <= 0:
                raise SystemExit("Strict mode: Newey-West HAC SE unavailable/invalid.")

        metrics_out = {
            "mode": "walkforward",
            "strategy": strategy_metrics,  # OOS stitched metrics
            "oos": strategy_metrics,
            "benchmark": {"ticker": bench_ticker, **_clean_metrics(bench_metrics)},
            "rigor": {
                "newey_west": {"t_stat_mean": float(nw_t), "p_value": float(nw_p), "se": float(nw_se)},
                "bootstrap_ci_mean_return": {"point": ci.point, "lo": ci.lo, "hi": ci.hi},
                "deflated_sharpe": dsr,
                "drift": drift,
            },
            "monitoring": {"drift": drift_payload},
        }

        equity_for_plot = oos_equity
        title = f"{cfg.ticker} Walk-Forward OOS Equity"

        extra_md = "\n".join(
            [
                "## Walk-Forward",
                "",
                f"- Train years: `{int(args.train_years)}`  Test months: `{int(args.test_months)}`",
                f"- Grid short: `{grid_short}`",
                f"- Grid long: `{grid_long}`",
                f"- Train max drawdown constraint: `>= -0.35`",
                f"- FDR q: `0.10`",
                f"- Windows: `{num_windows}`  Significant windows: `{sig_windows}/{num_windows}`  NOT SIGNIFICANT windows: `{num_windows - sig_windows}`",
                "",
                "Artifacts:",
                "",
                "- `walkforward_windows.csv`",
                "- `oos_equity.csv`",
                "",
            ]
        )

    # Write metrics.json (always).
    (run_dir / "metrics.json").write_text(
        json.dumps(metrics_out, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    # Plot (always saved).
    plot_path = run_dir / "equity_curve.png"
    plot_equity_curve(equity_for_plot, title=title, outfile=plot_path, show=show)
    if args.plot_out:
        plot_equity_curve(equity_for_plot, title=title, outfile=Path(args.plot_out), show=False)

    def _fmt(x: Optional[float], kind: str = "float") -> str:
        if x is None or not np.isfinite(float(x)):
            return "nan"
        if kind == "pct":
            return f"{float(x) * 100:.2f}%"
        return f"{float(x):.3f}"

    strat_m = metrics_out["strategy"]
    bench_m = metrics_out["benchmark"]

    compare_lines = [
        "## Strategy vs Benchmark",
        "",
        f"Benchmark: `{bench_m.get('ticker', '')}` (buy-and-hold)",
        "",
        "| Metric | Strategy | Benchmark |",
        "|---|---:|---:|",
        f"| Total Return | {_fmt(strat_m.get('total_return'), 'pct')} | {_fmt(bench_m.get('total_return'), 'pct')} |",
        f"| CAGR | {_fmt(strat_m.get('cagr'), 'pct')} | {_fmt(bench_m.get('cagr'), 'pct')} |",
        f"| Ann. Vol | {_fmt(strat_m.get('annualized_vol'))} | {_fmt(bench_m.get('annualized_vol'))} |",
        f"| Sharpe | {_fmt(strat_m.get('sharpe'))} | {_fmt(bench_m.get('sharpe'))} |",
        f"| Sortino | {_fmt(strat_m.get('sortino'))} | {_fmt(bench_m.get('sortino'))} |",
        f"| Max Drawdown | {_fmt(strat_m.get('max_drawdown'), 'pct')} | {_fmt(bench_m.get('max_drawdown'), 'pct')} |",
        f"| Calmar | {_fmt(strat_m.get('calmar'))} | {_fmt(bench_m.get('calmar'))} |",
        f"| Hit Rate | {_fmt(strat_m.get('hit_rate'), 'pct')} | {_fmt(bench_m.get('hit_rate'), 'pct')} |",
        "",
    ]

    report_lines = [
        f"# Run Pack v1: {manifest['run_id']}",
        "",
        f"- Created (UTC): `{manifest['created_utc']}`",
        f"- Strategy: `ma_crossover`",
        f"- Mode: `{mode}`",
        f"- Ticker: `{cfg.ticker}`",
        f"- Period: `{cfg.start or 'max'}` -> `{cfg.end or 'latest'}`  Interval: `{cfg.interval}`",
        f"- Commission: `{cfg.commission}`  Risk-free (annual): `{cfg.risk_free_rate}`",
        "",
        *compare_lines,
        extra_md.strip(),
        "",
        "## Determinism Inputs",
        "",
        f"- Data source: `{manifest.get('data_source')}`  Cache hit: `{manifest.get('cache_hit')}`",
        f"- Data path: `{manifest['data_path']}`",
        f"- Data sha256: `{manifest['data_sha256']}`",
        f"- Code sha256: `{manifest['code_hash']}`",
        f"- Composite code sha256: `{manifest.get('composite_code_hash')}`",
        f"- Config sha256: `{manifest['config_hash']}`",
        "",
        "## Files",
        "",
        "- `run_manifest.json`",
        "- `metrics.json`",
        "- `signals.csv`",
        "- `trades.csv`",
        "- `equity_curve.png`",
        "- `report.md`",
    ]
    (run_dir / "report.md").write_text("\n".join([l for l in report_lines if l is not None]) + "\n", encoding="utf-8")

    # Update research ops index (append/update).
    update_run_index(run_dir, metrics_out, manifest)

    print(f"Run directory: {run_dir}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
