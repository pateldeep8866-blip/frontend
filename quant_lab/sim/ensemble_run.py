"""
Multi-Strategy Ensemble Research Run (paper-only).

Runs multiple strategies in walk-forward OOS mode on a single ticker, then builds a
deterministic ensemble using a multi-armed bandit (UCB1).

Artifacts are written as a deterministic run pack under:
  reports/runs/<run_id>/

Example:
  python sim/ensemble_run.py --ticker SPY --start 2010-01-01 --end 2026-02-15 --train_years 5 --test_months 6
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Sequence

try:
    import numpy as np  # type: ignore
    import pandas as pd  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    np = None  # type: ignore
    pd = None  # type: ignore

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from backtests.ma_crossover import evaluate_ma_crossover  # noqa: E402
from backtests.momentum_accel import evaluate_strategy as eval_mom_accel  # noqa: E402
from backtests.ou_mean_reversion import evaluate_strategy as eval_ou_mr  # noqa: E402
from quantlab.data_cache import get_prices_cached  # noqa: E402
from quantlab.index import update_run_index  # noqa: E402
from quantlab.reporting.run_manifest import write_run_manifest  # noqa: E402
from quantlab.rigor.bandit import UCB1Ensemble  # noqa: E402
from quantlab.rigor.covariance import ledoit_wolf_cov  # noqa: E402
from quantlab.rigor.drift import drift_metrics  # noqa: E402
from quantlab.rigor.optimization import mean_variance_weights, risk_parity_weights  # noqa: E402
from quantlab.rigor.pbo import probability_of_backtest_overfitting  # noqa: E402
from quantlab.rigor.validation import block_bootstrap_ci, deflated_sharpe_probability, newey_west_t_stat_mean  # noqa: E402
from quantlab.stats import compute_metrics  # noqa: E402
from quantlab.walkforward import run_walkforward  # noqa: E402

try:
    from quantlab.monitoring.drift import compute_drift_report  # noqa: E402
except Exception:  # pragma: no cover
    compute_drift_report = None  # type: ignore


def _select_price_series(df: pd.DataFrame, preferred: str = "Adj Close") -> pd.Series:
    if preferred in df.columns and df[preferred].notna().any():
        s = df[preferred]
    elif "Close" in df.columns and df["Close"].notna().any():
        s = df["Close"]
    else:
        raise ValueError("No usable price column found (expected 'Adj Close' or 'Close').")
    s = s.astype(float).copy()
    s.name = "price"
    return s


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


def _equity_from_returns(index: pd.DatetimeIndex, returns: pd.Series, initial_capital: float) -> pd.Series:
    r = returns.reindex(index).fillna(0.0).astype(float)
    eq = float(initial_capital) * (1.0 + r).cumprod()
    eq.name = "equity"
    return eq


def plot_equity(equity: pd.Series, outpath: Path, *, title: str) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(11, 5.5))
    equity.plot(ax=ax, lw=2)
    ax.set_title(title)
    ax.set_xlabel("Date")
    ax.set_ylabel("Equity")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(outpath, dpi=140)
    plt.close(fig)


def _segment_perf_matrix(returns_df: pd.DataFrame, *, n_segments: int = 10) -> np.ndarray:
    """
    Build a (segments x strategies) Sharpe-like matrix from aligned daily returns.
    """
    X = returns_df.dropna()
    if X.shape[0] < n_segments * 10:
        n_segments = max(4, int(X.shape[0] // 20))
    n_segments = int(max(4, n_segments))

    n = int(X.shape[0])
    seg_len = int(max(5, n // n_segments))
    segments = []
    for i in range(n_segments):
        a = i * seg_len
        b = n if i == n_segments - 1 else min(n, (i + 1) * seg_len)
        if b - a < 5:
            continue
        seg = X.iloc[a:b, :]
        mu = seg.mean(axis=0).to_numpy(dtype=float)
        sd = seg.std(axis=0, ddof=0).to_numpy(dtype=float)

        # Avoid RuntimeWarning from np.where evaluating both branches eagerly.
        sharpe = np.zeros_like(mu, dtype=float)
        np.divide(mu, sd, out=sharpe, where=(sd > 0))
        segments.append(sharpe)

    A = np.asarray(segments, dtype=float)
    if A.ndim != 2 or A.shape[0] < 4:
        raise ValueError("Not enough data to compute PBO segments.")
    return A


def run(argv: Optional[Sequence[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Multi-strategy ensemble run (paper-only).")
    p.add_argument("--ticker", default="SPY")
    p.add_argument("--start", required=True)
    p.add_argument("--end", required=True)
    p.add_argument("--interval", default="1d")
    p.add_argument("--capital", type=float, default=10_000.0)
    p.add_argument("--commission", type=float, default=0.0)
    p.add_argument("--risk-free", type=float, default=0.0)

    p.add_argument("--train_years", type=int, default=5)
    p.add_argument("--test_months", type=int, default=6)
    p.add_argument("--grid_short", default="10,15,20,30,40")
    p.add_argument("--grid_long", default="50,75,100,125,150")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--strict", action="store_true", help="Enable strict validation (fail-fast)")
    args = p.parse_args(argv)

    if np is None or pd is None:  # pragma: no cover
        raise SystemExit("Missing dependencies. Install: python -m pip install -r requirements.txt")

    ticker = str(args.ticker).upper().strip()

    hist, data_path, data_sha256, cache_hit = get_prices_cached(
        ticker,
        start=args.start,
        end=args.end,
        interval=args.interval,
        strict=bool(args.strict),
    )
    prices = _select_price_series(hist)

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
            ticker: {
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

    params: Dict[str, Any] = {
        "mode": "ensemble_engine",
        "ticker": ticker,
        "start": args.start,
        "end": args.end,
        "interval": args.interval,
        "capital": float(args.capital),
        "commission": float(args.commission),
        "risk_free_rate": float(args.risk_free),
        "train_years": int(args.train_years),
        "test_months": int(args.test_months),
        "grid_short": grid_short,
        "grid_long": grid_long,
        "seed": int(args.seed),
        "strategies": ["ma_crossover", "ou_mean_reversion", "momentum_accel"],
        "strict": bool(args.strict),
    }

    # Composite code hash should include all strategy implementations used.
    import quantlab.data_cache as _qdc  # noqa: E402
    import quantlab.reporting.run_manifest as _qrm  # noqa: E402
    import quantlab.stats as _qstats  # noqa: E402
    import quantlab.walkforward as _qwf  # noqa: E402
    import quantlab.rigor.bandit as _qbandit  # noqa: E402
    import quantlab.rigor.pbo as _qpbo  # noqa: E402
    import quantlab.rigor.validation as _qval  # noqa: E402
    import quantlab.rigor.covariance as _qcov  # noqa: E402
    import quantlab.rigor.optimization as _qopt  # noqa: E402
    import quantlab.rigor.drift as _qdrift  # noqa: E402
    import backtests.ma_crossover as _ma  # noqa: E402
    import backtests.ou_mean_reversion as _ou  # noqa: E402
    import backtests.momentum_accel as _mom  # noqa: E402

    code_paths = [
        Path(__file__).resolve(),
        Path(_qdc.__file__).resolve(),
        Path(_qrm.__file__).resolve(),
        Path(_qstats.__file__).resolve(),
        Path(_qwf.__file__).resolve(),
        Path(_qbandit.__file__).resolve(),
        Path(_qpbo.__file__).resolve(),
        Path(_qval.__file__).resolve(),
        Path(_qcov.__file__).resolve(),
        Path(_qopt.__file__).resolve(),
        Path(_qdrift.__file__).resolve(),
        Path(_ma.__file__).resolve(),
        Path(_ou.__file__).resolve(),
        Path(_mom.__file__).resolve(),
    ]

    run_dir, manifest = write_run_manifest(
        strategy_name="ensemble_engine",
        parameters=params,
        data_path=Path(data_path),
        data_sha256=str(data_sha256),
        cache_hit=bool(cache_hit),
        data_source=str(prov_name),
        data_provenance=data_provenance,
        code_path=Path(__file__).resolve(),
        code_paths=code_paths,
        run_root=_ROOT / "reports" / "runs",
        project_root=_ROOT,
    )

    annualization = 252

    # Walk-forward OOS per strategy.
    def _wf_ma(p: pd.Series) -> pd.Series:
        def _eval(pr: pd.Series, s: int, l: int, capital: float) -> dict:
            return evaluate_ma_crossover(
                pr,
                short_window=int(s),
                long_window=int(l),
                initial_capital=float(capital),
                commission=float(args.commission),
                annualization=annualization,
                risk_free_rate=float(args.risk_free),
            )

        wf = run_walkforward(
            prices=p,
            eval_fn=_eval,
            grid_short=grid_short,
            grid_long=grid_long,
            train_years=int(args.train_years),
            test_months=int(args.test_months),
            initial_capital=float(args.capital),
            commission=float(args.commission),
            annualization=annualization,
            risk_free_rate=float(args.risk_free),
            max_dd_train_threshold=-0.35,
            fdr_q=0.10,
        )
        return wf["oos_equity"]

    def _wf_ou(p: pd.Series) -> pd.Series:
        def _eval(pr: pd.Series, s: int, l: int, capital: float) -> dict:
            return eval_ou_mr(
                pr,
                short_window=int(s),
                long_window=int(l),
                initial_capital=float(capital),
                commission=float(args.commission),
                annualization=annualization,
                risk_free_rate=float(args.risk_free),
            )

        wf = run_walkforward(
            prices=p,
            eval_fn=_eval,
            grid_short=grid_short,
            grid_long=grid_long,
            train_years=int(args.train_years),
            test_months=int(args.test_months),
            initial_capital=float(args.capital),
            commission=float(args.commission),
            annualization=annualization,
            risk_free_rate=float(args.risk_free),
            max_dd_train_threshold=-0.35,
            fdr_q=0.10,
        )
        return wf["oos_equity"]

    def _wf_mom(p: pd.Series) -> pd.Series:
        def _eval(pr: pd.Series, s: int, l: int, capital: float) -> dict:
            return eval_mom_accel(
                pr,
                short_window=int(s),
                long_window=int(l),
                initial_capital=float(capital),
                commission=float(args.commission),
                annualization=annualization,
                risk_free_rate=float(args.risk_free),
            )

        wf = run_walkforward(
            prices=p,
            eval_fn=_eval,
            grid_short=grid_short,
            grid_long=grid_long,
            train_years=int(args.train_years),
            test_months=int(args.test_months),
            initial_capital=float(args.capital),
            commission=float(args.commission),
            annualization=annualization,
            risk_free_rate=float(args.risk_free),
            max_dd_train_threshold=-0.35,
            fdr_q=0.10,
        )
        return wf["oos_equity"]

    oos_ma = _wf_ma(prices)
    oos_ou = _wf_ou(prices)
    oos_mom = _wf_mom(prices)

    # Align OOS returns
    rets = pd.DataFrame(
        {
            "ma_crossover": oos_ma.pct_change(),
            "ou_mean_reversion": oos_ou.pct_change(),
            "momentum_accel": oos_mom.pct_change(),
        }
    ).dropna()

    # Bandit ensemble: choose one strategy per day deterministically.
    bandit = UCB1Ensemble(n_arms=rets.shape[1])
    chosen = []
    ens_ret = []
    cols = list(rets.columns)
    for dt, row in rets.iterrows():
        arm = bandit.select()
        r = float(row.iloc[arm])
        bandit.update(arm, r)
        chosen.append(cols[arm])
        ens_ret.append(r)

    ens = pd.Series(ens_ret, index=rets.index, name="ensemble_return").astype(float)
    equity = _equity_from_returns(ens.index, ens, float(args.capital))

    # PBO using segment Sharpe-like matrix across strategies.
    perf_mat = _segment_perf_matrix(rets, n_segments=10)
    pbo = probability_of_backtest_overfitting(perf_mat, seed=int(args.seed), max_combinations=2000)

    # Covariance shrinkage across strategy returns and alternative weights.
    sc = ledoit_wolf_cov(rets.to_numpy())
    mu = rets.mean(axis=0).to_numpy(dtype=float)
    mv = mean_variance_weights(mu, sc.cov, max_weight=1.0)
    rp = risk_parity_weights(sc.cov, max_weight=1.0)

    # Drift + deflated Sharpe on ensemble returns.
    drift = {}
    if len(ens) >= 252:
        drift = drift_metrics(ens.iloc[-252:-63].to_numpy(), ens.iloc[-63:].to_numpy(), bins=10)
    dsr = deflated_sharpe_probability(ens.to_numpy(), n_trials=int(len(rets.columns)))

    # Metrics
    strat_metrics = compute_metrics(equity)
    per_strat = {c: compute_metrics(_equity_from_returns(rets.index, rets[c].astype(float), float(args.capital))) for c in rets.columns}

    metrics: Dict[str, Any] = {
        "mode": "ensemble_engine",
        "strategy": strat_metrics,
        "strategies": per_strat,
        "rigor": {
            "deflated_sharpe": dsr,
            "pbo": {"pbo": float(pbo.pbo), "n_splits": int(pbo.n_splits)},
            "drift": drift,
            "cov_shrinkage": {"shrinkage": float(sc.shrinkage), "mu": float(sc.mu)},
            "mv_weights": {c: float(mv.weights[i]) for i, c in enumerate(rets.columns)},
            "rp_weights": {c: float(rp.weights[i]) for i, c in enumerate(rets.columns)},
        },
    }

    # Artifacts
    rets_out = rets.copy()
    rets_out["ensemble_return"] = ens
    rets_out["chosen"] = chosen
    rets_out.to_csv(run_dir / "oos_returns.csv", index=True)

    eq_out = pd.DataFrame({"equity": equity.astype(float), "ensemble_return": ens.astype(float), "chosen": chosen}, index=equity.index)
    eq_out.to_csv(run_dir / "ensemble_equity.csv", index=True)

    (run_dir / "ensemble_weights.json").write_text(
        json.dumps({"avg_weights": {c: float(bandit.weights()[i]) for i, c in enumerate(cols)}, "counts": {c: int(bandit.counts[i]) for i, c in enumerate(cols)}}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (run_dir / "pbo.json").write_text(
        json.dumps({"pbo": float(pbo.pbo), "n_splits": int(pbo.n_splits)}, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (run_dir / "metrics.json").write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    plot_equity(equity, run_dir / "equity_curve.png", title=f"Ensemble OOS Equity ({ticker})")

    report = []
    report.append(f"# Ensemble Engine (Paper/Research Only): {manifest.get('run_id','')}")
    report.append("")
    report.append("This is a research artifact. It does not guarantee profits.")
    report.append("")
    report.append(f"- Ticker: `{ticker}`")
    report.append(f"- Strategies: `{', '.join(rets.columns)}`")
    report.append(f"- PBO: `{pbo.pbo:.3f}`")
    report.append(f"- Deflated Sharpe prob: `{dsr.get('prob', float('nan'))}`")
    report.append("")
    (run_dir / "report.md").write_text("\n".join(report), encoding="utf-8")

    update_run_index(run_dir, metrics, manifest)
    return 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    return run(argv)


if __name__ == "__main__":
    raise SystemExit(main())
