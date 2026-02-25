from __future__ import annotations

import csv
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from quantlab.morning.regime import RegimeResult
from quantlab.morning.signals import SignalRow
from quantlab.morning.risk import RiskResult


def _placeholder_png_bytes() -> bytes:
    # Minimal valid 1x1 PNG (transparent) for environments without matplotlib.
    return (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR"
        b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc`\x00\x00\x00\x02\x00\x01\xe2!\xbc3"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )


def plot_equity_curve(dates: Sequence[Any], equity: Sequence[float], outpath: Path, *, title: str) -> bool:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        outpath.write_bytes(_placeholder_png_bytes())
        return False

    fig, ax = plt.subplots(figsize=(11, 5.5))
    ax.plot(list(dates), list(equity), lw=2)
    ax.set_title(title)
    ax.set_xlabel("Date")
    ax.set_ylabel("Equity (proxy)")
    ax.grid(True, alpha=0.25)
    fig.tight_layout()
    fig.savefig(outpath, dpi=140)
    plt.close(fig)
    return True


def write_csv(path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fieldnames})


def write_picks_csv(path: Path, picks: Sequence[SignalRow]) -> None:
    rows = []
    for rank, p in enumerate(picks, start=1):
        rows.append(
            {
                "ticker": p.ticker,
                "rank": int(rank),
                "score": f"{p.score:.6f}",
                # Column name is `vol` (not `volatility`) for cockpit compatibility.
                "vol": f"{p.volatility:.6f}",
                "mom_63": f"{p.mom_63:.6f}",
                "mom_252": f"{p.mom_252:.6f}",
                "corr_spy": f"{p.corr_spy:.6f}",
                "t_stat": f"{p.t_stat:.6f}",
                "p_value": f"{p.p_value:.6g}",
                "passes_fdr": "1" if p.passes_fdr else "0",
                "reasons": p.reasons,
            }
        )
    write_csv(
        path,
        rows,
        fieldnames=[
            "ticker",
            "rank",
            "score",
            "vol",
            "mom_63",
            "mom_252",
            "corr_spy",
            "t_stat",
            "p_value",
            "passes_fdr",
            "reasons",
        ],
    )


def write_allocation_csv(
    path: Path,
    weights: Dict[str, float],
    vols: Dict[str, float],
    *,
    portfolio_vol: Optional[float] = None,
) -> None:
    pv = float(portfolio_vol) if portfolio_vol is not None else float("nan")
    rows = []
    wmap = dict(weights or {})
    # Always include CASH row for auditability (even if 0).
    if "CASH" not in {str(k).upper() for k in wmap.keys()}:
        wmap["CASH"] = 0.0
    # Normalize key casing for deterministic output.
    norm = {str(k).upper(): float(v) for k, v in wmap.items()}
    for t, w in sorted(norm.items(), key=lambda kv: kv[0]):
        v = float(vols.get(t, float("nan")))
        rc = ""
        if pv == pv and pv > 0 and t != "CASH" and v == v:
            rc = f"{(float(w) * v / pv):.6f}"
        rows.append(
            {
                "ticker": t,
                "target_weight": f"{float(w):.6f}",
                # Shares are computed at execution time from live/replay prices.
                "target_shares_placeholder": "",
                "vol": f"{v:.6f}" if v == v else "",
                "risk_proxy": rc,
            }
        )
    write_csv(
        path,
        rows,
        fieldnames=[
            "ticker",
            "target_weight",
            "target_shares_placeholder",
            "vol",
            "risk_proxy",
        ],
    )


def write_regime_json(path: Path, regime: RegimeResult) -> None:
    payload = asdict(regime)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_metrics_json(path: Path, metrics: Dict[str, Any]) -> None:
    path.write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_report_md(
    path: Path,
    *,
    run_id: str,
    created_utc: str,
    asof: str,
    universe: Sequence[str],
    regime: RegimeResult,
    top_picks: Sequence[SignalRow],
    risk: RiskResult,
    metrics: Dict[str, Any],
    data_files: Dict[str, Dict[str, Any]],
    manifest: Dict[str, Any],
) -> None:
    # No profit language; probabilistic/risk framing only.
    lines: List[str] = []
    lines.append(f"# Morning Plan (Paper/Research Only): {run_id}")
    lines.append("")
    lines.append("This is a probabilistic research note. It does not guarantee profits and is not trading advice.")
    lines.append("")
    lines.append(f"- Created (UTC): `{created_utc}`")
    lines.append(f"- As-of date: `{asof}`")
    lines.append(f"- Universe size: `{len(list(universe))}`")
    lines.append("")
    lines.append("## Hypothesis")
    lines.append("")
    lines.append("Cross-sectional trend + momentum with risk-aware sizing produces a higher probability of positive drift than chance,")
    lines.append("subject to regime filtering and conservative risk constraints.")
    lines.append("")
    lines.append("## Regime")
    lines.append("")
    lines.append(f"- Label: `{regime.label}`")
    lines.append(f"- Confidence: `{regime.confidence:.2f}` (method: `{regime.method}`)")
    lines.append("")
    lines.append("## Ranked Picks (Top)")
    lines.append("")
    lines.append("| Rank | Ticker | Score | Vol | Mom(63) | Corr(SPY) | p-value | FDR | Reason |")
    lines.append("|---:|---|---:|---:|---:|---:|---:|:---:|---|")
    for i, p in enumerate(top_picks, start=1):
        lines.append(
            f"| {i} | {p.ticker} | {p.score:.3f} | {p.volatility:.3f} | {p.mom_63:.3f} | {p.corr_spy:.3f} | {p.p_value:.3g} | {'Y' if p.passes_fdr else 'N'} | {p.reasons} |"
        )
    lines.append("")
    lines.append("## Allocation Plan (Target Weights)")
    lines.append("")
    lines.append("| Ticker | Weight |")
    lines.append("|---|---:|")
    for t, w in sorted(risk.weights.items(), key=lambda kv: kv[0]):
        lines.append(f"| {t} | {float(w):.3%} |")
    lines.append("")
    lines.append("## Risk Budget + Guardrails")
    lines.append("")
    lines.append(f"- Max weight/asset: `{risk.risk_budget['max_weight_per_asset']:.2f}`")
    lines.append(f"- Max portfolio vol (annualized): `{risk.risk_budget['max_portfolio_vol']:.2f}`")
    lines.append(f"- Max drawdown limit (advisory): `{risk.risk_budget['max_drawdown_limit']:.2f}`")
    if risk.risk_actions:
        lines.append("")
        lines.append("Risk actions applied:")
        for a in risk.risk_actions:
            lines.append(f"- {a}")

    gov = metrics.get("governance") if isinstance(metrics, dict) else None
    if isinstance(gov, dict):
        actions = gov.get("actions")
        if isinstance(actions, list) and actions:
            lines.append("")
            lines.append("Capital governance actions applied:")
            for a in actions:
                lines.append(f"- {a}")
        tb = gov.get("turnover_before")
        if tb is not None:
            try:
                lines.append(f"- Turnover vs prev plan (before cap): `{float(tb):.3f}`")
            except Exception:
                pass
    lines.append("")
    lines.append("Kill-switch rules (paper-only):")
    for r in risk.kill_switch_rules:
        lines.append(f"- {r}")
    lines.append("")
    lines.append("## Uncertainty Notes")
    lines.append("")
    lines.append("- p-values are computed from a normal approximation to the mean-return t-statistic (screening-level inference).")
    lines.append("- Multiple testing is controlled using Benjamini–Hochberg FDR at q=0.10 across the universe.")
    lines.append("- Scores and allocations are sensitive to lookback choice, data revisions, and regime shifts.")
    lines.append("")

    mon = metrics.get("monitoring") if isinstance(metrics, dict) else None
    if isinstance(mon, dict):
        drift = mon.get("drift")
        if isinstance(drift, dict) and drift:
            lines.append("## Monitoring (Drift)")
            lines.append("")
            lines.append(f"- Drift flag: `{bool(drift.get('drift_flag'))}`")
            ks = drift.get("ks_shift") if isinstance(drift.get("ks_shift"), dict) else {}
            vr = drift.get("vol_regime") if isinstance(drift.get("vol_regime"), dict) else {}
            ic = drift.get("ic_decay") if isinstance(drift.get("ic_decay"), dict) else {}
            sh = drift.get("sharpe_breakdown") if isinstance(drift.get("sharpe_breakdown"), dict) else {}
            if ks:
                lines.append(f"- KS shift: `D={ks.get('ks_d','')}` threshold=`{ks.get('ks_threshold','')}` drift=`{ks.get('drift','')}`")
            if vr:
                lines.append(f"- Vol regime: ratio=`{vr.get('vol_ratio','')}` threshold=`{vr.get('vol_ratio_threshold','')}` drift=`{vr.get('drift','')}`")
            if ic and ic.get("status") not in {None, "", "skipped"}:
                lines.append(f"- IC decay: recent=`{ic.get('ic_mean_recent','')}` baseline=`{ic.get('ic_mean_baseline','')}` drift=`{ic.get('drift','')}`")
            if sh and sh.get("status") not in {None, "", "skipped"}:
                lines.append(f"- Sharpe breakdown: recent=`{sh.get('sharpe_recent','')}` baseline=`{sh.get('sharpe_baseline','')}` drift=`{sh.get('drift','')}`")
            lines.append("")

    lines.append("## Determinism Inputs")
    lines.append("")
    lines.append(f"- Data source: `{manifest.get('data_source')}`  Cache hit (all): `{manifest.get('cache_hit')}`")
    lines.append(f"- Composite data sha256: `{manifest.get('data_sha256')}`")
    lines.append(f"- Code sha256: `{manifest.get('code_hash')}`")
    lines.append(f"- Composite code sha256: `{manifest.get('composite_code_hash')}`")
    lines.append(f"- Config sha256: `{manifest.get('config_hash')}`")
    lines.append("")
    lines.append("Data files (sha256):")
    for t in sorted(data_files.keys()):
        lines.append(f"- {t}: `{data_files[t].get('data_sha256','')}` ({data_files[t].get('data_path','')})")
    lines.append("")
    lines.append("## Artifacts")
    lines.append("")
    lines.append("- `picks.csv`, `allocation.csv`, `regime.json`, `metrics.json`, `report.md`, `equity_curve.png`")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
