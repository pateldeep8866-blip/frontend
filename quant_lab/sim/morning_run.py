from __future__ import annotations

"""
Morning Signal Engine (Paper/Research Only).

Offline-first design:
- Loads historical OHLCV via `quantlab.data_cache.get_prices_cached()` for each ticker in a fixed universe.
- Computes deterministic features/signals/regime/portfolio plan.
- Writes a deterministic run pack under `reports/runs/<run_id>/`.

Example:
  python sim/morning_run.py --start 2015-01-01 --end 2026-02-15 --asof 2026-02-15 --k 5
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    # Allow `python sim/morning_run.py ...` to import `quantlab.*`.
    sys.path.insert(0, str(_ROOT))

from quantlab.index import update_run_index
from quantlab.data.providers.base import DataIntegrityError
from quantlab.governance.capital import apply_capital_governance
from quantlab.monitoring.drift import compute_drift_report
from quantlab.morning.data import UniversePrices, load_universe_prices
from quantlab.morning.features import UniverseFeatures, compute_feature_snapshot
from quantlab.morning.portfolio import build_portfolio, select_picks
from quantlab.morning.regime import RegimeResult, detect_regime
from quantlab.morning.reporting import (
    plot_equity_curve,
    write_allocation_csv,
    write_metrics_json,
    write_picks_csv,
    write_regime_json,
    write_report_md,
)
from quantlab.morning.signals import SignalRow, compute_signals
from quantlab.morning.risk import RiskResult, apply_risk_constraints
from quantlab.morning.universe import DEFAULT_UNIVERSE
from quantlab.reporting.run_manifest import write_run_manifest
from quantlab.utils.hashing import sha256_json
from quantlab.strategies.single_pick_engine import score_universe as single_pick_score_universe
from quantlab.strategies.single_pick_engine import write_pick_artifact as single_pick_write_artifact

# Rigor / validation primitives (research-only).
from quantlab.rigor.covariance import ledoit_wolf_cov
from quantlab.rigor.drift import drift_metrics
from quantlab.rigor.factor_model import fama_macbeth, residual_alpha
from quantlab.rigor.ic import rank_ic, rolling_ic_decay
from quantlab.rigor.optimization import mean_variance_weights, risk_parity_weights
from quantlab.rigor.ou import ou_half_life
from quantlab.rigor.validation import block_bootstrap_ci, deflated_sharpe_probability, newey_west_t_stat_mean


def _parse_csv_list(s: Optional[str]) -> Optional[list[str]]:
    if s is None:
        return None
    items = [x.strip().upper() for x in str(s).split(",")]
    items = [x for x in items if x]
    return items or None


def _composite_data_sha256(data_files: Dict[str, Dict[str, Any]]) -> str:
    payload = {t: str(data_files[t].get("data_sha256", "")) for t in sorted(data_files.keys())}
    return sha256_json(payload)


def _cov_annualized_from_returns(
    returns_by_ticker: Dict[str, Any],
    tickers: Sequence[str],
    *,
    lookback: int = 252,
    annualization: int = 252,
) -> Optional[Dict[str, Dict[str, float]]]:
    """
    Compute annualized covariance matrix (dict-of-dicts) from per-ticker return series.

    Uses pandas if available; returns None if not enough data.
    """
    try:
        import pandas as pd  # type: ignore
    except ModuleNotFoundError:
        return None

    series = []
    for t in tickers:
        r = returns_by_ticker.get(t)
        if r is None:
            continue
        try:
            s = r.tail(int(lookback)).rename(str(t))
        except Exception:
            continue
        series.append(s)

    if not series:
        return None

    df = pd.concat(series, axis=1).dropna()
    if df.shape[0] < 2:
        return None

    cov = df.cov(ddof=0) * float(annualization)
    out: Dict[str, Dict[str, float]] = {}
    for i in cov.index:
        out[str(i)] = {str(j): float(cov.loc[i, j]) for j in cov.columns}
    return out


def _portfolio_equity_backcast(
    closes_by_ticker: Dict[str, Any],
    weights: Dict[str, float],
) -> Optional[tuple[Sequence[Any], Sequence[float]]]:
    """
    Build a simple historical "backcast" equity proxy using *today's* weights.

    This is not a forecast and is not used for selection; it's a visual audit artifact.
    """
    try:
        import pandas as pd  # type: ignore
    except ModuleNotFoundError:
        return None

    tickers = [t for t in weights.keys() if t != "CASH" and float(weights.get(t, 0.0)) > 0.0]
    if not tickers:
        return None

    series = []
    for t in tickers:
        c = closes_by_ticker.get(t)
        if c is None:
            continue
        try:
            series.append(c.rename(str(t)).astype(float))
        except Exception:
            continue

    if not series:
        return None

    df = pd.concat(series, axis=1, join="inner").dropna()
    if df.empty:
        return None

    # Normalize each leg to 1.0 at the first common date.
    norm = df / df.iloc[0]
    cash_w = float(weights.get("CASH", 0.0))
    eq = pd.Series(0.0, index=norm.index)
    for t in norm.columns:
        eq = eq + float(weights.get(str(t), 0.0)) * norm[str(t)]
    eq = eq + cash_w  # constant cash leg
    return list(eq.index), [float(x) for x in eq.values]


def _load_prev_allocation_weights(
    project_root: Path,
    *,
    engine_type: str,
) -> tuple[Optional[str], Optional[Dict[str, float]]]:
    """
    Optional helper for turnover governance.

    Uses the append-only SQLite registry to locate the latest run for `engine_type`,
    then loads its `allocation.csv` weights as the prior weights snapshot.

    Returns: (prev_run_id, prev_weights) where prev_weights includes CASH if present.
    """
    import sqlite3
    import csv

    try:
        from quantlab.registry.db import get_default_db
    except Exception:
        return None, None

    db = get_default_db()
    if not db.path.exists():
        return None, None

    conn = sqlite3.connect(str(db.path))
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(
            "SELECT run_id FROM runs WHERE engine_type = ? ORDER BY timestamp DESC, run_id DESC LIMIT 1;",
            (str(engine_type),),
        )
        row = cur.fetchone()
        if not row:
            return None, None
        run_id = str(row["run_id"])
    finally:
        conn.close()

    alloc_path = Path(project_root) / "reports" / "runs" / run_id / "allocation.csv"
    if not alloc_path.exists():
        return run_id, None

    weights: Dict[str, float] = {}
    try:
        with alloc_path.open("r", newline="", encoding="utf-8") as f:
            r = csv.DictReader(f)
            fields = set(r.fieldnames or [])
            wcol = "target_weight" if "target_weight" in fields else ("weight" if "weight" in fields else None)
            if wcol is None or "ticker" not in fields:
                return run_id, None
            for row in r:
                t = str(row.get("ticker", "")).strip().upper()
                if not t:
                    continue
                try:
                    w = float(row.get(wcol, "0") or 0.0)
                except Exception:
                    continue
                if math.isfinite(w):
                    weights[t] = float(w)
    except Exception:
        return run_id, None

    if not weights:
        return run_id, None
    return run_id, weights


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Morning Signal Engine (research-only, paper-only).")
    p.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    p.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    p.add_argument("--asof", default=None, help="As-of date for snapshot (YYYY-MM-DD). Defaults to --end")
    p.add_argument("--k", type=int, default=5, help="Top-K picks by score (after regime filter)")
    p.add_argument("--interval", default="1d", help="Data interval (default 1d)")
    p.add_argument("--universe", default=None, help="Comma-separated universe override (default built-in)")

    p.add_argument("--short", type=int, default=20, help="Short moving average window")
    p.add_argument("--long", type=int, default=50, help="Long moving average window")
    p.add_argument("--fdr_q", type=float, default=0.10, help="Benjamini–Hochberg FDR q (default 0.10)")

    p.add_argument("--max_weight_per_asset", type=float, default=0.25)
    p.add_argument("--max_portfolio_vol", type=float, default=0.18)
    p.add_argument("--max_drawdown_limit", type=float, default=-0.10)

    # Capital governance (paper-only).
    p.add_argument("--risk_off_scale", type=float, default=1.0, help="Scale risky exposure in risk_off (default: 1.0)")
    p.add_argument("--vol_target", type=float, default=None, help="Optional vol target (annualized). Scales down only.")
    p.add_argument("--max_turnover", type=float, default=None, help="Optional max turnover cap vs previous plan (0..1).")

    # Statistical hard mode: fail loudly on missing rigor computations / calendar gaps.
    p.add_argument("--strict", action="store_true", help="Enable strict validation (fail-fast)")
    p.add_argument(
        "--skip_single_pick",
        action="store_true",
        help="Skip single-pick sidecar artifact (reduces extra data pulls).",
    )
    return p.parse_args(argv)


def run_engine(args: argparse.Namespace) -> tuple[Path, Dict[str, Any]]:
    project_root = Path(__file__).resolve().parents[1]
    run_root = project_root / "reports" / "runs"
    data_root = project_root / "data" / "cache"

    universe = _parse_csv_list(args.universe) or list(DEFAULT_UNIVERSE)
    asof = args.asof or args.end

    prices: UniversePrices = load_universe_prices(
        universe,
        start=args.start,
        end=args.end,
        interval=args.interval,
        project_root=project_root,
        strict=bool(args.strict),
    )

    feats: UniverseFeatures = compute_feature_snapshot(
        prices,
        asof=asof,
        short_window=int(args.short),
        long_window=int(args.long),
        spy_ticker="SPY",
    )

    regime: RegimeResult = detect_regime(feats.returns["SPY"], asof=feats.asof)

    feature_rows = feats.features
    returns_lookback = {t: feats.returns[t].tail(63).tolist() for t in feature_rows if t in feats.returns}

    signals: List[SignalRow] = compute_signals(feature_rows, returns_lookback, fdr_q=float(args.fdr_q))

    pick_rows, pick_notes = select_picks(signals, regime=regime, k=int(args.k))
    plan = build_portfolio(pick_rows)
    if pick_notes:
        plan.notes.extend(pick_notes)

    cov_annualized = _cov_annualized_from_returns(feats.returns, plan.picks, lookback=252, annualization=252)

    risk: RiskResult = apply_risk_constraints(
        plan.base_weights,
        max_weight_per_asset=float(args.max_weight_per_asset),
        max_portfolio_vol=float(args.max_portfolio_vol),
        max_drawdown_limit=float(args.max_drawdown_limit),
        cov_annualized=cov_annualized,
    )

    # Capital governance: optional turnover cap (requires previous plan) and regime-conditioned scaling.
    prev_run_id: Optional[str] = None
    prev_weights: Optional[Dict[str, float]] = None
    if args.max_turnover is not None:
        try:
            mt = float(args.max_turnover)
        except Exception:
            mt = float("nan")
        if math.isfinite(mt) and mt > 0:
            prev_run_id, prev_weights = _load_prev_allocation_weights(project_root, engine_type="morning_signal_engine")

    gov = apply_capital_governance(
        risk.weights,
        regime_label=regime.label,
        regime_confidence=regime.confidence,
        max_weight_per_asset=float(args.max_weight_per_asset),
        risk_off_scale=float(args.risk_off_scale),
        vol_target=None if args.vol_target is None else float(args.vol_target),
        cov_annualized=cov_annualized,
        max_turnover=None if args.max_turnover is None else float(args.max_turnover),
        prev_weights=prev_weights,
    )

    # Final weights + recompute portfolio vol / concentration on the governed portfolio.
    from quantlab.morning.risk import portfolio_vol_from_cov

    risky_final = {k: float(v) for k, v in gov.weights.items() if k != "CASH"}
    final_port_vol = float("nan")
    if cov_annualized is not None and risky_final:
        final_port_vol = float(portfolio_vol_from_cov(risky_final, cov_annualized))
    final_hhi = float(sum((float(v) ** 2) for k, v in gov.weights.items() if k != "CASH"))

    risk_final = RiskResult(
        weights=dict(gov.weights),
        portfolio_vol=float(final_port_vol),
        concentration_hhi=float(final_hhi),
        risk_actions=list(risk.risk_actions) + list(gov.actions),
        risk_budget=dict(risk.risk_budget),
        kill_switch_rules=list(risk.kill_switch_rules),
    )

    data_sha256 = _composite_data_sha256(prices.data_files)
    cache_hit_all = all(bool(v.get("cache_hit", False)) for v in prices.data_files.values()) if prices.data_files else None

    parameters = {
        "mode": "morning_signal_engine",
        "ticker": "UNIVERSE",
        "universe": universe,
        "start": args.start,
        "end": args.end,
        "asof": asof,
        "interval": args.interval,
        "k": int(args.k),
        "short_window": int(args.short),
        "long_window": int(args.long),
        "fdr_q": float(args.fdr_q),
        "max_weight_per_asset": float(args.max_weight_per_asset),
        "max_portfolio_vol": float(args.max_portfolio_vol),
        "max_drawdown_limit": float(args.max_drawdown_limit),
        "risk_off_scale": float(args.risk_off_scale),
        "vol_target": None if args.vol_target is None else float(args.vol_target),
        "max_turnover": None if args.max_turnover is None else float(args.max_turnover),
        "strict": bool(args.strict),
    }

    code_path = Path(__file__).resolve()
    code_paths = [code_path]
    code_paths.extend(sorted((project_root / "quantlab" / "morning").glob("*.py")))
    code_paths.append(project_root / "quantlab" / "data" / "__init__.py")
    code_paths.extend(sorted((project_root / "quantlab" / "data" / "providers").glob("*.py")))
    code_paths.append(project_root / "quantlab" / "rigor" / "__init__.py")
    code_paths.extend(sorted((project_root / "quantlab" / "rigor").glob("*.py")))
    code_paths.extend(
        [
            project_root / "quantlab" / "data_cache.py",
            project_root / "quantlab" / "stats.py",
            project_root / "quantlab" / "index.py",
            project_root / "quantlab" / "reporting" / "run_manifest.py",
            project_root / "quantlab" / "utils" / "hashing.py",
            project_root / "quantlab" / "strategies" / "single_pick_engine.py",
        ]
    )

    # Data provenance for run_manifest: provider + per-ticker file hashes + integrity metadata.
    prov_name = "unknown"
    prov_ver = "unknown"
    for _t in sorted(prices.data_files.keys()):
        v = prices.data_files.get(_t) or {}
        if v.get("provider_name"):
            prov_name = str(v.get("provider_name"))
        if v.get("provider_version"):
            prov_ver = str(v.get("provider_version"))
        if prov_name != "unknown" and prov_ver != "unknown":
            break

    data_provenance = {
        "provider_name": prov_name,
        "provider_version": prov_ver,
        "files": prices.data_files,
    }

    run_dir, manifest = write_run_manifest(
        strategy_name="morning_signal_engine",
        parameters=parameters,
        data_path=data_root,
        data_sha256=data_sha256,
        cache_hit=cache_hit_all,
        data_source=str(prov_name),
        data_provenance=data_provenance,
        code_path=code_path,
        code_paths=code_paths,
        run_root=run_root,
        project_root=project_root,
        extra_manifest_fields={
            # Placeholder; filled in after single-pick computation and rewritten.
            "single_pick": None,
        },
    )

    # -------------------------
    # Single Pick Engine (audit)
    # -------------------------
    skip_single_pick_env = str(os.environ.get("QUANTLAB_SKIP_SINGLE_PICK", "")).strip().lower() in {
        "1",
        "true",
        "yes",
    }
    skip_single_pick = bool(getattr(args, "skip_single_pick", False)) or bool(skip_single_pick_env)
    single_pick_payload: Optional[Dict[str, Any]] = None
    if not skip_single_pick:
        try:
            sp_df = single_pick_score_universe(universe, asof)
            single_pick_write_artifact(str(manifest.get("run_id", run_dir.name)), sp_df)
            top = sp_df.iloc[0]
            single_pick_payload = {
                "ticker": str(top.get("ticker")),
                "composite": float(top.get("composite")),
                "momentum_score": float(top.get("momentum_score")),
                "mean_reversion_score": float(top.get("mean_reversion_score")),
            }
            try:
                print(
                    f"Top single pick: {single_pick_payload['ticker']}, composite={single_pick_payload['composite']:.6f}",
                    flush=True,
                )
            except Exception:
                pass
        except Exception as e:
            # Do not crash the Morning Plan; log for visibility.
            try:
                (run_dir / "single_pick_error.txt").write_text(str(e) + "\n", encoding="utf-8")
            except Exception:
                pass
            single_pick_payload = None

    # Persist into run_manifest.json for provenance.
    try:
        import json as _json

        mp = run_dir / "run_manifest.json"
        obj = _json.loads(mp.read_text(encoding="utf-8"))
        obj["single_pick"] = single_pick_payload
        mp.write_text(_json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        manifest["single_pick"] = single_pick_payload
    except Exception:
        pass

    # -------------------------
    # Rigor / Diagnostics Pack
    # -------------------------
    rigor_errors: list[str] = []
    rigor_summary: Dict[str, Any] = {}
    spy_returns_for_monitoring = None
    score_ic_for_monitoring = None
    try:
        import pandas as pd  # type: ignore
        import numpy as np  # type: ignore

        # Build aligned close/return panels across the universe (up to asof).
        closes_df = pd.concat({t: s.astype(float) for t, s in feats.closes.items()}, axis=1, join="inner").sort_index()
        returns_df = pd.concat({t: s.astype(float) for t, s in feats.returns.items()}, axis=1, join="inner").sort_index()
        if "SPY" in returns_df.columns:
            spy_returns_for_monitoring = returns_df["SPY"].dropna().astype(float)

        # Feature time series (cross-sectional factors).
        mom63 = returns_df.rolling(63, min_periods=63).sum()
        trend = closes_df.rolling(int(args.short), min_periods=int(args.short)).mean() - closes_df.rolling(int(args.long), min_periods=int(args.long)).mean()
        vol63 = returns_df.rolling(63, min_periods=63).std(ddof=0) * float(np.sqrt(252.0))
        dd = (closes_df / closes_df.cummax()) - 1.0

        def _cs_z(df: pd.DataFrame) -> pd.DataFrame:
            mu = df.mean(axis=1)
            sd = df.std(axis=1, ddof=0)
            out = df.sub(mu, axis=0)
            sd = sd.replace(0.0, np.nan)
            out = out.div(sd, axis=0)
            return out.replace([np.inf, -np.inf], np.nan)

        z_mom = _cs_z(mom63)
        z_trend = _cs_z(trend)
        z_risk = -_cs_z(vol63)
        z_dd = -_cs_z(dd.abs())
        score = 0.35 * z_mom + 0.35 * z_trend + 0.20 * z_risk + 0.10 * z_dd

        # Rank IC series for two primary factors.
        fwd = returns_df.shift(-1)
        ic_mom = rank_ic(mom63, fwd, min_obs=5)
        ic_score = rank_ic(score, fwd, min_obs=5)
        score_ic_for_monitoring = pd.Series(ic_score.ic).sort_index()
        ic_rows = []
        for dt in sorted(set(ic_mom.ic.keys()) | set(ic_score.ic.keys())):
            ic_rows.append(
                {
                    "date": str(dt),
                    "ic_mom63": f"{ic_mom.ic.get(dt, float('nan')):.6f}" if dt in ic_mom.ic else "",
                    "ic_score": f"{ic_score.ic.get(dt, float('nan')):.6f}" if dt in ic_score.ic else "",
                }
            )
        if ic_rows:
            import csv

            with (run_dir / "ic.csv").open("w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=["date", "ic_mom63", "ic_score"])
                w.writeheader()
                for r in ic_rows:
                    w.writerow(r)

        # Rolling IC decay for the composite score.
        ic_decay = rolling_ic_decay(score, returns_df, horizons=(1, 5, 20), window=252, min_obs=5)
        ic_decay.to_csv(run_dir / "ic_decay.csv", index=True)

        # Fama-MacBeth factor premia (screening-level cross-sectional model).
        fm_exposures = {
            "mom63": mom63,
            "trend": trend,
            "risk": -vol63,
            "dd": -dd.abs(),
        }
        fm = fama_macbeth(returns_df, fm_exposures, horizon=1, nw_lags=5, min_assets=5)
        (run_dir / "factor_premia.json").write_text(
            json.dumps(
                {
                    "n_periods": int(fm.n_periods),
                    "mean_betas": fm.mean_betas,
                    "t_stats_nw": fm.t_stats_nw,
                    "p_values": fm.p_values,
                },
                indent=2,
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )

        ra = residual_alpha(returns_df, fm_exposures, fm.betas_ts, horizon=1, nw_lags=5)
        ra_df = pd.DataFrame(
            {
                "ticker": ra.alpha.index.astype(str),
                "alpha": ra.alpha.astype(float).to_numpy(),
                "t_stat": ra.t_stat.reindex(ra.alpha.index).astype(float).to_numpy(),
                "p_value": ra.p_value.reindex(ra.alpha.index).astype(float).to_numpy(),
            }
        )
        ra_df.to_csv(run_dir / "residual_alpha.csv", index=False)

        # OU half-life diagnostic on SPY log-price (mean reversion proxy).
        spy_close = closes_df["SPY"].dropna().astype(float) if "SPY" in closes_df.columns else None
        if spy_close is not None and not spy_close.empty:
            ou = ou_half_life(np.log(spy_close.to_numpy()))
            (run_dir / "ou_half_life.json").write_text(json.dumps(ou.__dict__, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        # Drift detection on SPY returns: recent vs prior window.
        if "SPY" in returns_df.columns:
            r_spy = returns_df["SPY"].dropna().astype(float)
            if len(r_spy) >= 252:
                base = r_spy.iloc[-252:-63].to_numpy()
                recent = r_spy.iloc[-63:].to_numpy()
                (run_dir / "drift_spy.json").write_text(
                    json.dumps(drift_metrics(base, recent, bins=10), indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )

        # Portfolio covariance shrinkage + alternative optimizers for picks.
        pick_syms = [t for t in risk_final.weights.keys() if t != "CASH" and float(risk_final.weights.get(t, 0.0)) > 0.0]
        if pick_syms:
            R = returns_df[pick_syms].dropna().tail(252)
            if R.shape[0] >= 30 and R.shape[1] >= 2:
                sc = ledoit_wolf_cov(R.to_numpy())
                mu = R.mean(axis=0).to_numpy(dtype=float)
                mv = mean_variance_weights(mu, sc.cov, max_weight=float(args.max_weight_per_asset))
                rp = risk_parity_weights(sc.cov, max_weight=float(args.max_weight_per_asset))

                w_base = {t: float(risk_final.weights.get(t, 0.0)) for t in pick_syms}
                w_mv = {t: float(mv.weights[i]) for i, t in enumerate(pick_syms)}
                w_rp = {t: float(rp.weights[i]) for i, t in enumerate(pick_syms)}

                w_df = pd.DataFrame(
                    [
                        {"ticker": t, "base_weight": w_base.get(t, 0.0), "mv_weight": w_mv.get(t, 0.0), "rp_weight": w_rp.get(t, 0.0)}
                        for t in pick_syms
                    ]
                )
                w_df.to_csv(run_dir / "optimizer_weights.csv", index=False)
                (run_dir / "cov_shrinkage.json").write_text(
                    json.dumps({"shrinkage": sc.shrinkage, "mu": sc.mu}, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )

        rigor_summary = {
            "ic_mean_mom63": float(ic_mom.mean) if ic_mom.n else float("nan"),
            "ic_mean_score": float(ic_score.mean) if ic_score.n else float("nan"),
            "factor_premia_n_periods": int(fm.n_periods),
        }
    except Exception as e:
        rigor_errors.append(str(e))

    if rigor_errors:
        (run_dir / "rigor_errors.json").write_text(
            json.dumps({"errors": rigor_errors}, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        if bool(args.strict):
            raise SystemExit(f"Strict mode: rigor diagnostics failed ({len(rigor_errors)} error(s)). See: {run_dir / 'rigor_errors.json'}")

    # Artifacts.
    write_picks_csv(run_dir / "picks.csv", signals)

    vols = {t: float(feature_rows.get(t, {}).get("volatility", float("nan"))) for t in risk_final.weights.keys() if t != "CASH"}
    vols["CASH"] = 0.0
    write_allocation_csv(run_dir / "allocation.csv", risk_final.weights, vols, portfolio_vol=risk_final.portfolio_vol)

    write_regime_json(run_dir / "regime.json", regime)

    governance_payload: Dict[str, Any] = {
        "prev_run_id": prev_run_id,
        "max_turnover": None if args.max_turnover is None else float(args.max_turnover),
        "turnover_before": gov.turnover_before,
        "turnover_alpha": gov.turnover_alpha,
        "risk_off_scale": float(args.risk_off_scale),
        "vol_target": None if args.vol_target is None else float(args.vol_target),
        "regime_scale": float(gov.regime_scale),
        "actions": list(gov.actions),
        "final_weights": dict(risk_final.weights),
    }
    (run_dir / "governance.json").write_text(
        json.dumps(governance_payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    metrics: Dict[str, Any] = {
        "mode": "morning_signal_engine",
        "asof": asof,
        "universe_size": len(universe),
        "features_count": len(feature_rows),
        "count_pass_fdr": int(sum(1 for s in signals if s.passes_fdr)),
        "count_picks": int(len(plan.picks)),
        "count_picks_pass_fdr": int(sum(1 for s in pick_rows if s.passes_fdr)),
        "regime": {"label": regime.label, "confidence": regime.confidence, "method": regime.method},
        "portfolio": {
            "weights": risk_final.weights,
            "portfolio_vol": risk_final.portfolio_vol,
            "concentration_hhi": risk_final.concentration_hhi,
            "cash_weight": float(risk_final.weights.get("CASH", 0.0)),
        },
        "governance": governance_payload,
        "notes": {"portfolio": plan.notes},
        "risk_actions": list(risk_final.risk_actions),
        "rigor": {"summary": rigor_summary, "errors": rigor_errors},
    }

    if single_pick_payload is not None:
        metrics["single_pick"] = dict(single_pick_payload)

    # Plot a deterministic audit artifact: a historical backcast equity proxy using today's weights.
    portfolio_rigor_payload: Optional[Dict[str, Any]] = None
    strategy_returns_for_monitoring = None
    backcast = _portfolio_equity_backcast(feats.closes, risk_final.weights)
    if backcast is None:
        # Always create a file for the run pack even if data is missing.
        plot_equity_curve([asof], [1.0], run_dir / "equity_curve.png", title="Portfolio Backcast (Constant Weights, Paper Only)")
    else:
        dates, equity = backcast
        plot_equity_curve(dates, equity, run_dir / "equity_curve.png", title="Portfolio Backcast (Constant Weights, Paper Only)")
        # Additional rigor stats on the backcast return series (screening-level).
        try:
            import numpy as np  # type: ignore

            eq = np.asarray(equity, dtype=float)
            rets = (eq[1:] / eq[:-1]) - 1.0
            rets = rets[np.isfinite(rets)]
            if rets.size >= 30:
                nw_t, nw_p, nw_se = newey_west_t_stat_mean(rets.tolist(), lags=5)
                dsr = deflated_sharpe_probability(rets.tolist(), n_trials=max(1, len(universe)))
                ci = block_bootstrap_ci(rets.tolist(), block_size=20, n_boot=400, seed=0)
                portfolio_rigor_payload = {
                    "nw_t_stat_mean": float(nw_t),
                    "nw_p_value": float(nw_p),
                    "nw_se": float(nw_se),
                    "deflated_sharpe": dsr,
                    "bootstrap_ci_mean_return": {"point": ci.point, "lo": ci.lo, "hi": ci.hi},
                }
                (run_dir / "portfolio_rigor.json").write_text(
                    json.dumps(
                        portfolio_rigor_payload,
                        indent=2,
                        sort_keys=True,
                    )
                    + "\n",
                    encoding="utf-8",
                )

                # For monitoring: daily return series from the backcast equity (DatetimeIndex).
                try:
                    import pandas as pd  # type: ignore

                    dt_idx = pd.to_datetime(list(dates))[1:]
                    r = (eq[1:] / eq[:-1]) - 1.0
                    rr = pd.Series(r, index=dt_idx).astype(float)
                    rr = rr.replace([np.inf, -np.inf], np.nan).dropna()
                    strategy_returns_for_monitoring = rr
                except Exception:
                    strategy_returns_for_monitoring = None
        except Exception as e:
            (run_dir / "portfolio_rigor_error.txt").write_text(str(e) + "\n", encoding="utf-8")
            if bool(args.strict):
                raise SystemExit(f"Strict mode: portfolio rigor computation failed: {e}")

    # Strict-mode checks: require key rigor computations to exist.
    if bool(args.strict):
        if portfolio_rigor_payload is None:
            raise SystemExit("Strict mode: portfolio_rigor.json was not produced (insufficient data or computation failure).")
        try:
            dsr_prob = float((portfolio_rigor_payload.get("deflated_sharpe") or {}).get("prob"))
        except Exception:
            dsr_prob = float("nan")
        min_prob = float(os.environ.get("QUANTLAB_STRICT_MIN_DSR_PROB", "0.95"))
        if not math.isfinite(dsr_prob) or dsr_prob < float(min_prob):
            raise SystemExit(f"Strict mode: deflated Sharpe prob below threshold (prob={dsr_prob} < {min_prob}).")
        try:
            se = float(portfolio_rigor_payload.get("nw_se"))
        except Exception:
            se = float("inf")
        if not math.isfinite(se) or se <= 0:
            raise SystemExit("Strict mode: Newey-West HAC SE unavailable/invalid.")

    # Monitoring drift report (deterministic, no SciPy): KS shift, IC decay, Sharpe breakdown, vol regime.
    drift_payload: Dict[str, Any] = {"status": "skipped"}
    try:
        import pandas as pd  # type: ignore

        spy_r = spy_returns_for_monitoring
        if spy_r is None:
            spy_r = feats.returns.get("SPY")
        if spy_r is None:
            raise ValueError("SPY returns missing for drift monitoring")

        ic_s = score_ic_for_monitoring
        strat_r = strategy_returns_for_monitoring

        asof_ts = pd.Timestamp(asof)
        dr = compute_drift_report(
            spy_returns=spy_r.dropna().astype(float),
            score_ic=ic_s,
            strategy_returns=strat_r,
            asof=asof_ts,
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

    # Enrich metrics now that all artifacts are computed.
    metrics.setdefault("monitoring", {})
    metrics["monitoring"]["drift"] = drift_payload
    if portfolio_rigor_payload is not None:
        metrics.setdefault("rigor", {})
        metrics["rigor"]["portfolio_rigor"] = portfolio_rigor_payload
        # Registry expects `rigor.deflated_sharpe.prob` when present.
        metrics["rigor"]["deflated_sharpe"] = dict(portfolio_rigor_payload.get("deflated_sharpe") or {})

    # Write metrics + report after all computed sections are available.
    write_metrics_json(run_dir / "metrics.json", metrics)

    write_report_md(
        run_dir / "report.md",
        run_id=str(manifest.get("run_id", "")),
        created_utc=str(manifest.get("created_utc", "")),
        asof=asof,
        universe=universe,
        regime=regime,
        top_picks=pick_rows,
        risk=risk_final,
        metrics=metrics,
        data_files=prices.data_files,
        manifest=manifest,
    )

    # Index update.
    update_run_index(run_dir, metrics, manifest)

    return run_dir, manifest


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    try:
        run_engine(args)
    except DataIntegrityError as e:
        # Fail fast with explicit messaging.
        raise SystemExit(
            "Data integrity error detected. Aborting Morning Plan.\n"
            f"- Error: {e}\n"
            "- Fix the data source/cache and re-run.\n"
        )
    except ModuleNotFoundError as e:
        msg = str(e)
        raise SystemExit(
            "Missing dependency for Morning Signal Engine.\n"
            f"- Error: {msg}\n"
            "- Install requirements.txt dependencies (pandas/numpy/yfinance/matplotlib).\n"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
