"""
Momentum Acceleration Backtest (research only).

Strategy (long-only, next-bar execution):
- Compute log-price momentum over short/long windows:
    mom_s = log(P_t) - log(P_{t-short})
    mom_l = log(P_t) - log(P_{t-long})
- Compute acceleration proxy: Δ^2 log(P_t)
- Enter long when mom_s > mom_l AND accel > 0
- Exit when mom_s < mom_l OR accel < 0

Deterministic run packs; no execution authority.
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
    sys.path.insert(0, str(_ROOT))

from quantlab.data_cache import get_prices_cached  # noqa: E402
from quantlab.index import update_run_index  # noqa: E402
from quantlab.reporting.run_manifest import write_run_manifest  # noqa: E402
from quantlab.rigor.drift import drift_metrics  # noqa: E402
from quantlab.rigor.features import momentum_acceleration  # noqa: E402
from quantlab.rigor.validation import block_bootstrap_ci, deflated_sharpe_probability, newey_west_t_stat_mean  # noqa: E402
from quantlab.stats import compute_metrics, mean_return_t_stat  # noqa: E402
from quantlab.walkforward import run_walkforward  # noqa: E402


@dataclass(frozen=True)
class BacktestConfig:
    ticker: str
    start: Optional[str] = None
    end: Optional[str] = None
    interval: str = "1d"
    short_window: int = 20
    long_window: int = 60
    initial_capital: float = 10_000.0
    commission: float = 0.0
    price_col: str = "Adj Close"
    annualization: int = 252
    risk_free_rate: float = 0.0


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


def compute_signals(prices: pd.Series, short_window: int, long_window: int) -> pd.DataFrame:
    if int(short_window) <= 1 or int(long_window) <= 2:
        raise ValueError("Windows must be > 1.")
    if int(short_window) >= int(long_window):
        raise ValueError("short_window must be < long_window.")

    df = pd.DataFrame(index=prices.index)
    df["price"] = prices.astype(float)
    lp = np.log(df["price"])
    df["mom_short"] = lp - lp.shift(int(short_window))
    df["mom_long"] = lp - lp.shift(int(long_window))
    df["accel"] = lp.diff().diff()

    ready = df["mom_short"].notna() & df["mom_long"].notna() & df["accel"].notna()

    pos = 0
    buy = []
    sell = []
    position = []
    for ms, ml, a, ok in zip(df["mom_short"].tolist(), df["mom_long"].tolist(), df["accel"].tolist(), ready.tolist()):
        b = False
        s = False
        if not ok:
            buy.append(False)
            sell.append(False)
            position.append(int(pos))
            continue
        if pos == 0 and float(ms) > float(ml) and float(a) > 0.0:
            pos = 1
            b = True
        elif pos == 1 and (float(ms) < float(ml) or float(a) < 0.0):
            pos = 0
            s = True
        buy.append(bool(b))
        sell.append(bool(s))
        position.append(int(pos))

    df["buy_signal"] = buy
    df["sell_signal"] = sell
    df["signal"] = position
    # Next-bar execution: trade on bar t+1 based on signal from bar t.
    df["buy_exec"] = df["buy_signal"].shift(1, fill_value=False).astype(bool)
    df["sell_exec"] = df["sell_signal"].shift(1, fill_value=False).astype(bool)
    return df


def simulate_trades(signals: pd.DataFrame, initial_capital: float, commission: float = 0.0) -> tuple[pd.Series, pd.Series, pd.DataFrame]:
    cash = float(initial_capital)
    shares = 0.0
    eq = []
    pos = []
    events = []

    for dt, row in signals.iterrows():
        price = float(row["price"])
        if not np.isfinite(price) or price <= 0:
            eq.append(float(cash))
            pos.append(1 if shares > 0 else 0)
            continue

        if bool(row.get("sell_exec", False)) and shares > 0:
            gross = shares * price
            net = gross * (1.0 - float(commission))
            cash = net
            shares = 0.0
            events.append({"date": dt, "action": "SELL", "price": float(price), "position": 0, "equity": float(cash), "reason": "MOM_ACCEL_EXIT"})

        if bool(row.get("buy_exec", False)) and shares == 0 and cash > 0:
            spend = cash * (1.0 - float(commission))
            shares = spend / price
            cash = 0.0
            events.append({"date": dt, "action": "BUY", "price": float(price), "position": 1, "equity": float(shares * price), "reason": "MOM_ACCEL_ENTRY"})

        eq.append(float(cash + shares * price))
        pos.append(1 if shares > 0 else 0)

    equity = pd.Series(eq, index=signals.index, name="equity").astype(float)
    position = pd.Series(pos, index=signals.index, name="position").astype(int)
    trades = pd.DataFrame(events)
    return equity, position, trades


def evaluate_strategy(
    prices: pd.Series,
    short_window: int,
    long_window: int,
    initial_capital: float,
    *,
    commission: float,
    annualization: int,
    risk_free_rate: float,
) -> dict[str, object]:
    sig = compute_signals(prices, short_window=short_window, long_window=long_window)
    equity, position, trades = simulate_trades(sig, initial_capital=initial_capital, commission=commission)
    sig = sig.copy()
    sig["position"] = position
    rets = equity.pct_change().dropna()
    m = compute_metrics(equity, annualization=annualization, risk_free_rate=risk_free_rate)
    t_stat, p_val = mean_return_t_stat(rets.tolist())
    nw_t, nw_p, nw_se = newey_west_t_stat_mean(rets.to_numpy(), lags=5)
    dsr = deflated_sharpe_probability(rets.to_numpy(), annualization=annualization, risk_free_rate=risk_free_rate, n_trials=1)
    ci = block_bootstrap_ci(rets.to_numpy(), block_size=20, n_boot=400, seed=0)
    drift = drift_metrics(rets.tail(252).head(189).to_numpy(), rets.tail(63).to_numpy()) if len(rets) >= 252 else {}

    # Acceleration diagnostic (2nd derivative log-price).
    acc = momentum_acceleration(prices.to_numpy(dtype=float))
    acc_mean = float(np.mean(acc)) if acc.size else float("nan")
    acc_std = float(np.std(acc, ddof=0)) if acc.size else float("nan")

    return {
        "signals": sig,
        "equity": equity,
        "position": position,
        "trade_events": trades,
        "daily_returns": rets,
        "metrics": m,
        "t_stat": float(t_stat),
        "p_value": float(p_val),
        "nw_t_stat": float(nw_t),
        "nw_p_value": float(nw_p),
        "nw_se": float(nw_se),
        "deflated_sharpe": dsr,
        "bootstrap_ci_mean": {"point": ci.point, "lo": ci.lo, "hi": ci.hi},
        "drift": drift,
        "accel": {"mean": acc_mean, "std": acc_std, "n": int(acc.size)},
    }


def buy_and_hold_equity(prices: pd.Series, initial_capital: float) -> pd.Series:
    prices = prices.dropna().astype(float)
    if prices.empty:
        raise ValueError("Empty price series for benchmark.")
    shares = float(initial_capital) / float(prices.iloc[0])
    equity = shares * prices
    equity.name = "benchmark_equity"
    return equity


def plot_equity(equity: pd.Series, outfile: Path, *, title: str, show: bool) -> None:
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


def main(argv: Optional[list[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Momentum acceleration backtest (research only).")
    p.add_argument("--ticker", required=True)
    p.add_argument("--start", default=None)
    p.add_argument("--end", default=None)
    p.add_argument("--interval", default="1d")
    p.add_argument("--short", type=int, default=20)
    p.add_argument("--long", type=int, default=60)
    p.add_argument("--capital", type=float, default=10_000.0)
    p.add_argument("--commission", type=float, default=0.0)
    p.add_argument("--price-col", default="Adj Close")
    p.add_argument("--risk-free", type=float, default=0.0)
    p.add_argument("--benchmark-ticker", default="SPY")

    p.add_argument("--walkforward", action="store_true")
    p.add_argument("--train_years", type=int, default=5)
    p.add_argument("--test_months", type=int, default=6)
    p.add_argument("--grid_short", default="10,15,20,30,40")
    p.add_argument("--grid_long", default="50,75,100,125,150")

    p.add_argument("--save", action="store_true")
    p.add_argument("--show", action="store_true")
    p.add_argument("--plot", action="store_true")
    p.add_argument("--strict", action="store_true", help="Enable strict validation (fail-fast)")
    args = p.parse_args(argv)

    if np is None or pd is None:  # pragma: no cover
        raise SystemExit("Missing dependencies. Install: python -m pip install -r requirements.txt")

    cfg = BacktestConfig(
        ticker=str(args.ticker).upper(),
        start=args.start,
        end=args.end,
        interval=args.interval,
        short_window=int(args.short),
        long_window=int(args.long),
        initial_capital=float(args.capital),
        commission=float(args.commission),
        price_col=str(args.price_col),
        risk_free_rate=float(args.risk_free),
    )

    hist, data_path, data_sha256, cache_hit = get_prices_cached(
        cfg.ticker,
        start=cfg.start,
        end=cfg.end,
        interval=cfg.interval,
        strict=bool(args.strict),
    )
    prices = _select_price_series(hist, cfg.price_col)

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
            cfg.ticker: {
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
            if v > 1 and v not in out:
                out.append(v)
        return out

    grid_short = _parse_int_list(args.grid_short)
    grid_long = _parse_int_list(args.grid_long)

    strategy_params: dict[str, object] = {
        "mode": "momentum_accel",
        "ticker": cfg.ticker,
        "start": cfg.start,
        "end": cfg.end,
        "interval": cfg.interval,
        "commission": cfg.commission,
        "risk_free_rate": cfg.risk_free_rate,
        "benchmark_ticker": str(args.benchmark_ticker or ""),
        "strict": bool(args.strict),
        "short_window": int(cfg.short_window),
        "long_window": int(cfg.long_window),
        "walkforward": bool(args.walkforward),
        "train_years": int(args.train_years),
        "test_months": int(args.test_months),
        "grid_short": grid_short,
        "grid_long": grid_long,
    }

    import quantlab.data_cache as _qdc  # noqa: E402
    import quantlab.index as _qindex  # noqa: E402
    import quantlab.reporting.run_manifest as _qrm  # noqa: E402
    import quantlab.rigor.features as _qfeat  # noqa: E402
    import quantlab.rigor.validation as _qval  # noqa: E402
    import quantlab.stats as _qstats  # noqa: E402
    import quantlab.utils.hashing as _qhash  # noqa: E402
    import quantlab.walkforward as _qwf  # noqa: E402

    code_paths = [
        Path(__file__).resolve(),
        Path(_qdc.__file__).resolve(),
        Path(_qindex.__file__).resolve(),
        Path(_qrm.__file__).resolve(),
        Path(_qfeat.__file__).resolve(),
        Path(_qval.__file__).resolve(),
        Path(_qstats.__file__).resolve(),
        Path(_qhash.__file__).resolve(),
        Path(_qwf.__file__).resolve(),
    ]

    run_root = _ROOT / "reports" / "runs"
    run_dir, manifest = write_run_manifest(
        strategy_name="momentum_accel",
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

    show = bool(args.show or args.plot)
    mode = "walkforward" if bool(args.walkforward) else "single"

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
        res = evaluate_strategy(
            prices,
            short_window=int(cfg.short_window),
            long_window=int(cfg.long_window),
            initial_capital=float(cfg.initial_capital),
            commission=float(cfg.commission),
            annualization=int(cfg.annualization),
            risk_free_rate=float(cfg.risk_free_rate),
        )

        equity = res["equity"]
        trades_df = res["trade_events"]
        signals_df = res["signals"]

        bench_equity = buy_and_hold_equity(bench_prices, float(cfg.initial_capital))
        bench_metrics = compute_metrics(bench_equity, annualization=cfg.annualization, risk_free_rate=cfg.risk_free_rate)

        strat_metrics = dict(res["metrics"])
        strat_metrics.update(
            {
                "t_stat": float(res["t_stat"]),
                "p_value": float(res["p_value"]),
                "nw_t_stat": float(res["nw_t_stat"]),
                "nw_p_value": float(res["nw_p_value"]),
                "deflated_sharpe_prob": float(res["deflated_sharpe"]["prob"]),
            }
        )

        if bool(args.strict):
            min_prob = float(os.environ.get("QUANTLAB_STRICT_MIN_DSR_PROB", "0.95"))
            prob = float(res["deflated_sharpe"].get("prob", float("nan")))
            if not np.isfinite(prob) or prob < float(min_prob):
                raise SystemExit(f"Strict mode: deflated Sharpe prob below threshold (prob={prob} < {min_prob}).")
            nw_se = float(res.get("nw_se", float("inf")))
            if not np.isfinite(nw_se) or nw_se <= 0:
                raise SystemExit("Strict mode: Newey-West HAC SE unavailable/invalid.")
            ci = res.get("bootstrap_ci_mean") or {}
            for k in ("point", "lo", "hi"):
                v = float(ci.get(k, float("nan")))
                if not np.isfinite(v):
                    raise SystemExit(f"Strict mode: bootstrap CI invalid ({k}={v}).")

        metrics_out = {
            "mode": "single",
            "strategy": strat_metrics,
            "benchmark": {"ticker": bench_ticker, **bench_metrics},
            "rigor": {
                "bootstrap_ci_mean_return": res["bootstrap_ci_mean"],
                "deflated_sharpe": res["deflated_sharpe"],
                "drift": res["drift"],
                "accel": res["accel"],
            },
        }
        equity_for_plot = equity
        title = f"Momentum Accel Equity ({cfg.ticker})"

    else:
        def _eval_fn(p: pd.Series, s: int, l: int, capital: float) -> dict:
            return evaluate_strategy(
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

        oos_equity = wf["oos_equity"]
        oos_metrics = compute_metrics(oos_equity, annualization=cfg.annualization, risk_free_rate=cfg.risk_free_rate)
        oos_rets = oos_equity.pct_change().dropna()
        dsr = deflated_sharpe_probability(oos_rets.to_numpy(), annualization=cfg.annualization, risk_free_rate=cfg.risk_free_rate, n_trials=max(1, len(grid_short) * len(grid_long)))
        nw_t, nw_p, nw_se = newey_west_t_stat_mean(oos_rets.to_numpy(), lags=5)
        ci = block_bootstrap_ci(oos_rets.to_numpy(), block_size=20, n_boot=400, seed=0)
        drift = drift_metrics(oos_rets.tail(252).head(189).to_numpy(), oos_rets.tail(63).to_numpy()) if len(oos_rets) >= 252 else {}

        bench_equity = buy_and_hold_equity(bench_prices.loc[oos_equity.index], float(cfg.initial_capital))
        bench_metrics = compute_metrics(bench_equity, annualization=cfg.annualization, risk_free_rate=cfg.risk_free_rate)

        metrics_out = {
            "mode": "walkforward",
            "strategy": oos_metrics,
            "benchmark": {"ticker": bench_ticker, **bench_metrics},
            "walkforward": {"num_windows": int(wf["num_windows"])},
            "rigor": {
                "newey_west": {"t_stat_mean": float(nw_t), "p_value": float(nw_p), "se": float(nw_se)},
                "bootstrap_ci_mean_return": {"point": ci.point, "lo": ci.lo, "hi": ci.hi},
                "deflated_sharpe": dsr,
                "drift": drift,
            },
        }

        if bool(args.strict):
            min_prob = float(os.environ.get("QUANTLAB_STRICT_MIN_DSR_PROB", "0.95"))
            prob = float(dsr.get("prob", float("nan")))
            if not np.isfinite(prob) or prob < float(min_prob):
                raise SystemExit(f"Strict mode: deflated Sharpe prob below threshold (prob={prob} < {min_prob}).")
            if not np.isfinite(float(nw_se)) or float(nw_se) <= 0:
                raise SystemExit("Strict mode: Newey-West HAC SE unavailable/invalid.")

        equity_for_plot = oos_equity
        title = f"Momentum Accel OOS Equity ({cfg.ticker})"
        trades_df = wf["oos_trades"]
        signals_df = wf["oos_signals"]

        wf["windows"].to_csv(run_dir / "walkforward_windows.csv", index=False)
        oos_equity.rename("equity").to_csv(run_dir / "oos_equity.csv", header=True)

    sig_out = signals_df.copy().reset_index().rename(columns={signals_df.index.name or "index": "date"})
    sig_out.to_csv(run_dir / "signals.csv", index=False)

    if "date" in trades_df.columns:
        trades_df = trades_df.copy()
        trades_df["date"] = pd.to_datetime(trades_df["date"])
    trades_df.to_csv(run_dir / "trades.csv", index=False)

    (run_dir / "metrics.json").write_text(json.dumps(metrics_out, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    report = []
    report.append(f"# Momentum Acceleration Backtest (Paper/Research Only): {manifest.get('run_id','')}")
    report.append("")
    report.append("This is research-only and does not guarantee profits.")
    report.append("")
    report.append(f"- Ticker: `{cfg.ticker}`")
    report.append(f"- Mode: `{metrics_out.get('mode')}`")
    report.append(f"- Data sha256: `{manifest.get('data_sha256')}`")
    report.append(f"- Composite code sha256: `{manifest.get('composite_code_hash')}`")
    (run_dir / "report.md").write_text("\n".join(report), encoding="utf-8")

    plot_equity(equity_for_plot, run_dir / "equity_curve.png", title=title, show=show)

    update_run_index(run_dir, metrics_out, manifest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
