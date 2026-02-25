from __future__ import annotations

"""
Run Morning Plan across multiple providers and compare outputs.

This script runs `sim/morning_run.py` once per provider (alphavantage, finnhub,
stockdata), then aggregates and compares key research outputs.

Research-only, paper-only:
- No order routing
- No live brokerage actions
- Deterministic comparison artifacts

Example:
  python sim/provider_compare.py \
    --start 2015-01-01 \
    --end 2026-02-20 \
    --asof 2026-02-20 \
    --k 5
"""

import argparse
import csv
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

_ROOT = Path(__file__).resolve().parents[1]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from quantlab.utils.hashing import sha256_bytes, sha256_json

ALLOWED_PROVIDERS = ("alphavantage", "finnhub", "stockdata")
PROVIDER_KEY_ENV = {
    "alphavantage": "ALPHAVANTAGE_API_KEY",
    "finnhub": "FINNHUB_API_KEY",
    "stockdata": "STOCKDATA_API_KEY",
}


@dataclass(frozen=True)
class ProviderRunSummary:
    provider: str
    run_id: str
    run_dir: Path
    regime_label: str
    regime_confidence: float
    top_picks: List[str]
    top_score: float
    score_std: float
    score_range: float
    pass_fdr_count: int
    cash_weight: float
    max_weight: float
    max_weight_ticker: str
    concentration_hhi: float
    portfolio_vol: float


@dataclass(frozen=True)
class ProviderFailure:
    provider: str
    reason: str


def _iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse_provider_list(raw: str) -> List[str]:
    vals = [str(x).strip().lower() for x in str(raw).split(",")]
    vals = [x for x in vals if x]
    if not vals:
        raise ValueError("providers list is empty")
    uniq: List[str] = []
    for v in vals:
        if v not in ALLOWED_PROVIDERS:
            raise ValueError(
                f"Unsupported provider {v!r}. Allowed: {', '.join(ALLOWED_PROVIDERS)}"
            )
        if v not in uniq:
            uniq.append(v)
    return uniq


def _list_run_dirs(run_root: Path) -> Dict[str, Path]:
    out: Dict[str, Path] = {}
    if not run_root.exists():
        return out
    for p in run_root.iterdir():
        if p.is_dir() and (p / "run_manifest.json").exists():
            out[p.name] = p
    return out


def _latest_by_created_utc(run_dirs: Iterable[Path]) -> Optional[Path]:
    best: Optional[tuple[str, str, Path]] = None
    for d in run_dirs:
        created = ""
        try:
            obj = json.loads((Path(d) / "run_manifest.json").read_text(encoding="utf-8"))
            created = str(obj.get("created_utc", "")) or ""
        except Exception:
            created = ""
        key = (created, Path(d).name, Path(d))
        if best is None or key > best:
            best = key
    return None if best is None else best[2]


def _provider_key_missing(provider: str, *, env: Optional[Dict[str, str]] = None) -> Optional[str]:
    env_key = PROVIDER_KEY_ENV[str(provider)]
    source = env if env is not None else dict(os.environ)
    if str(source.get(env_key, "")).strip():
        return None
    return env_key


def _to_float(x: Any, default: float = float("nan")) -> float:
    try:
        v = float(x)
    except Exception:
        return default
    return v if math.isfinite(v) else default


def _load_csv_rows(path: Path) -> tuple[List[Dict[str, str]], List[str]]:
    with path.open("r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fields = list(reader.fieldnames or [])
    return rows, fields


def _load_provider_run_summary(provider: str, run_dir: Path, *, top_k: int) -> ProviderRunSummary:
    manifest_path = run_dir / "run_manifest.json"
    picks_path = run_dir / "picks.csv"
    alloc_path = run_dir / "allocation.csv"
    regime_path = run_dir / "regime.json"
    metrics_path = run_dir / "metrics.json"

    for req in [manifest_path, picks_path, alloc_path, regime_path, metrics_path]:
        if not req.exists():
            raise RuntimeError(f"{provider}: required artifact missing: {req}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    run_id = str(manifest.get("run_id") or run_dir.name)

    picks_rows, pick_fields = _load_csv_rows(picks_path)
    if not picks_rows:
        raise RuntimeError(f"{provider}: picks.csv has no rows")

    if "ticker" not in pick_fields or "score" not in pick_fields:
        raise RuntimeError(f"{provider}: picks.csv missing ticker/score")

    def _rank_key(r: Dict[str, str]) -> tuple[int, str]:
        try:
            rv = int(float(r.get("rank", "999999")))
        except Exception:
            rv = 999999
        return rv, str(r.get("ticker", ""))

    picks_sorted = sorted(picks_rows, key=_rank_key)
    k = max(1, int(top_k))
    top_rows = picks_sorted[:k]
    top_picks = [str(r.get("ticker", "")).strip().upper() for r in top_rows if str(r.get("ticker", "")).strip()]
    top_scores = [_to_float(r.get("score", "nan")) for r in top_rows]
    top_scores = [x for x in top_scores if math.isfinite(x)]

    pass_fdr = 0
    for r in top_rows:
        v = str(r.get("passes_fdr", "")).strip().lower()
        if v in {"1", "true", "y", "yes"}:
            pass_fdr += 1

    score_std = float("nan")
    score_range = float("nan")
    if top_scores:
        mu = sum(top_scores) / float(len(top_scores))
        var = sum((x - mu) ** 2 for x in top_scores) / float(len(top_scores))
        score_std = math.sqrt(var)
        score_range = max(top_scores) - min(top_scores)

    alloc_rows, alloc_fields = _load_csv_rows(alloc_path)
    if "ticker" not in alloc_fields:
        raise RuntimeError(f"{provider}: allocation.csv missing ticker")
    wcol = "target_weight" if "target_weight" in alloc_fields else ("weight" if "weight" in alloc_fields else None)
    if wcol is None:
        raise RuntimeError(f"{provider}: allocation.csv missing target_weight/weight")
    weights: Dict[str, float] = {}
    for r in alloc_rows:
        t = str(r.get("ticker", "")).strip().upper()
        if not t:
            continue
        w = _to_float(r.get(wcol, "nan"))
        if not math.isfinite(w):
            continue
        weights[t] = w

    cash_weight = float(weights.get("CASH", 0.0))
    risky_items = [(t, float(w)) for t, w in weights.items() if t != "CASH" and float(w) > 0.0]
    if risky_items:
        max_weight_ticker, max_weight = max(risky_items, key=lambda x: x[1])
    else:
        max_weight_ticker, max_weight = "CASH", float(cash_weight)
    concentration_hhi = sum(float(w) * float(w) for _, w in risky_items)

    regime = json.loads(regime_path.read_text(encoding="utf-8"))
    regime_label = str(regime.get("label", ""))
    regime_conf = _to_float(regime.get("confidence", "nan"))

    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    port = metrics.get("portfolio") if isinstance(metrics, dict) else {}
    if not isinstance(port, dict):
        port = {}
    portfolio_vol = _to_float(port.get("portfolio_vol", "nan"))

    top_score = top_scores[0] if top_scores else float("nan")
    return ProviderRunSummary(
        provider=provider,
        run_id=run_id,
        run_dir=run_dir,
        regime_label=regime_label,
        regime_confidence=regime_conf,
        top_picks=top_picks,
        top_score=top_score,
        score_std=score_std,
        score_range=score_range,
        pass_fdr_count=int(pass_fdr),
        cash_weight=float(cash_weight),
        max_weight=float(max_weight),
        max_weight_ticker=str(max_weight_ticker),
        concentration_hhi=float(concentration_hhi),
        portfolio_vol=float(portfolio_vol),
    )


def _weight_distance_l1(a: Dict[str, float], b: Dict[str, float]) -> float:
    keys = set(a.keys()) | set(b.keys())
    return float(sum(abs(float(a.get(k, 0.0)) - float(b.get(k, 0.0))) for k in sorted(keys)))


def _overlap_stats(a: Sequence[str], b: Sequence[str]) -> Dict[str, float]:
    sa = {str(x).upper().strip() for x in a if str(x).strip()}
    sb = {str(x).upper().strip() for x in b if str(x).strip()}
    inter = len(sa & sb)
    union = len(sa | sb)
    jaccard = float(inter) / float(union) if union > 0 else 0.0
    return {"intersection": float(inter), "union": float(union), "jaccard": float(jaccard)}


def _load_allocation_weights(run_dir: Path) -> Dict[str, float]:
    path = Path(run_dir) / "allocation.csv"
    rows, fields = _load_csv_rows(path)
    wcol = "target_weight" if "target_weight" in fields else ("weight" if "weight" in fields else None)
    if wcol is None:
        return {}
    out: Dict[str, float] = {}
    for r in rows:
        t = str(r.get("ticker", "")).strip().upper()
        if not t:
            continue
        w = _to_float(r.get(wcol, "nan"))
        if math.isfinite(w):
            out[t] = float(w)
    return out


def _run_single_provider(
    provider: str,
    *,
    start: str,
    end: str,
    asof: Optional[str],
    k: int,
    interval: str,
    universe: Optional[str],
    strict: bool,
    python_exe: str,
    project_root: Path,
) -> ProviderRunSummary:
    run_root = project_root / "reports" / "runs"
    run_root.mkdir(parents=True, exist_ok=True)
    before = _list_run_dirs(run_root)

    cmd = [
        python_exe,
        str(project_root / "sim" / "morning_run.py"),
        "--start",
        str(start),
        "--end",
        str(end),
        "--k",
        str(int(k)),
        "--interval",
        str(interval),
        "--skip_single_pick",
    ]
    if asof:
        cmd.extend(["--asof", str(asof)])
    if universe:
        cmd.extend(["--universe", str(universe)])
    if strict:
        cmd.append("--strict")

    env = dict(os.environ)
    env["QUANTLAB_DATA_PROVIDER"] = str(provider)

    print(f"[provider={provider}] running Morning Plan...", flush=True)
    proc = subprocess.run(
        cmd,
        cwd=str(project_root),
        env=env,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        out = (proc.stdout or "").strip()
        err = (proc.stderr or "").strip()
        details = []
        if out:
            details.append("STDOUT:\n" + out)
        if err:
            details.append("STDERR:\n" + err)
        raise RuntimeError(
            f"Morning Plan failed for provider={provider} (code={proc.returncode}).\n"
            + ("\n".join(details) if details else "")
        )

    after = _list_run_dirs(run_root)
    new_dirs = [after[n] for n in sorted(set(after.keys()) - set(before.keys()))]
    if not new_dirs:
        raise RuntimeError(f"provider={provider}: could not detect newly created run directory")
    run_dir = _latest_by_created_utc(new_dirs)
    if run_dir is None:
        raise RuntimeError(f"provider={provider}: could not resolve latest run directory")

    summary = _load_provider_run_summary(provider, run_dir, top_k=int(k))
    print(
        f"[provider={provider}] run_id={summary.run_id} top_pick={summary.top_picks[0] if summary.top_picks else 'N/A'}",
        flush=True,
    )
    return summary


def _write_csv(path: Path, rows: List[Dict[str, Any]], fields: List[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in fields})


def _write_compare_artifacts(
    summaries: Sequence[ProviderRunSummary],
    failures: Sequence[ProviderFailure],
    *,
    start: str,
    end: str,
    asof: str,
    k: int,
    interval: str,
    universe: Optional[str],
    project_root: Path,
) -> Path:
    provider_order = [s.provider for s in summaries]
    failed_order = [f.provider for f in failures]
    payload = {
        "created_utc": _iso_utc_now(),
        "providers": provider_order,
        "failed_providers": failed_order,
        "start": str(start),
        "end": str(end),
        "asof": str(asof),
        "k": int(k),
        "interval": str(interval),
        "universe": str(universe or ""),
        "run_ids": [s.run_id for s in summaries],
    }
    compare_hash = sha256_json(payload)[:10]
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    compare_id = f"{ts}_{compare_hash}"
    out_dir = project_root / "reports" / "provider_compare" / compare_id
    out_dir.mkdir(parents=True, exist_ok=False)

    summary_rows: List[Dict[str, Any]] = []
    for s in summaries:
        summary_rows.append(
            {
                "provider": s.provider,
                "run_id": s.run_id,
                "regime_label": s.regime_label,
                "regime_confidence": f"{s.regime_confidence:.6f}",
                "top_pick": s.top_picks[0] if s.top_picks else "",
                "top_score": f"{s.top_score:.8f}" if math.isfinite(s.top_score) else "",
                "score_std_topk": f"{s.score_std:.8f}" if math.isfinite(s.score_std) else "",
                "score_range_topk": f"{s.score_range:.8f}" if math.isfinite(s.score_range) else "",
                "pass_fdr_count_topk": int(s.pass_fdr_count),
                "cash_weight": f"{s.cash_weight:.8f}",
                "max_weight_ticker": s.max_weight_ticker,
                "max_weight": f"{s.max_weight:.8f}",
                "concentration_hhi": f"{s.concentration_hhi:.8f}",
                "portfolio_vol": f"{s.portfolio_vol:.8f}" if math.isfinite(s.portfolio_vol) else "",
            }
        )
    _write_csv(
        out_dir / "provider_summary.csv",
        summary_rows,
        [
            "provider",
            "run_id",
            "regime_label",
            "regime_confidence",
            "top_pick",
            "top_score",
            "score_std_topk",
            "score_range_topk",
            "pass_fdr_count_topk",
            "cash_weight",
            "max_weight_ticker",
            "max_weight",
            "concentration_hhi",
            "portfolio_vol",
        ],
    )

    # Pairwise overlap + allocation distance.
    pair_rows: List[Dict[str, Any]] = []
    alloc_by_provider: Dict[str, Dict[str, float]] = {
        s.provider: _load_allocation_weights(s.run_dir) for s in summaries
    }
    for i, a in enumerate(summaries):
        for j, b in enumerate(summaries):
            if j <= i:
                continue
            ov = _overlap_stats(a.top_picks, b.top_picks)
            l1 = _weight_distance_l1(alloc_by_provider[a.provider], alloc_by_provider[b.provider])
            pair_rows.append(
                {
                    "provider_a": a.provider,
                    "provider_b": b.provider,
                    "topk_intersection": int(ov["intersection"]),
                    "topk_union": int(ov["union"]),
                    "topk_jaccard": f"{ov['jaccard']:.8f}",
                    "alloc_l1_distance": f"{l1:.8f}",
                }
            )
    _write_csv(
        out_dir / "pairwise_comparison.csv",
        pair_rows,
        ["provider_a", "provider_b", "topk_intersection", "topk_union", "topk_jaccard", "alloc_l1_distance"],
    )

    failure_rows = [{"provider": f.provider, "reason": f.reason} for f in failures]
    _write_csv(
        out_dir / "skipped_providers.csv",
        failure_rows,
        ["provider", "reason"],
    )

    # Deterministic JSON summary.
    summary_json = {
        "compare_id": compare_id,
        "created_utc": payload["created_utc"],
        "config": {
            "providers": provider_order,
            "failed_providers": failed_order,
            "start": str(start),
            "end": str(end),
            "asof": str(asof),
            "k": int(k),
            "interval": str(interval),
            "universe": str(universe or ""),
        },
        "runs": [
            {
                "provider": s.provider,
                "run_id": s.run_id,
                "run_dir": str(s.run_dir),
                "regime_label": s.regime_label,
                "regime_confidence": s.regime_confidence,
                "top_picks": list(s.top_picks),
                "top_score": s.top_score,
                "pass_fdr_count_topk": s.pass_fdr_count,
                "cash_weight": s.cash_weight,
                "max_weight_ticker": s.max_weight_ticker,
                "max_weight": s.max_weight,
                "concentration_hhi": s.concentration_hhi,
                "portfolio_vol": s.portfolio_vol,
            }
            for s in summaries
        ],
        "failures": failure_rows,
        "pairwise": pair_rows,
    }
    (out_dir / "comparison.json").write_text(
        json.dumps(summary_json, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    # Simple markdown desk-note.
    lines: List[str] = []
    lines.append(f"# Provider Comparison: {compare_id}")
    lines.append("")
    lines.append(f"- Created (UTC): `{payload['created_utc']}`")
    lines.append(f"- Date range: `{start}` -> `{end}` as-of `{asof}`")
    lines.append(f"- Providers: `{', '.join(provider_order)}`")
    if failed_order:
        lines.append(f"- Skipped providers: `{', '.join(failed_order)}`")
    lines.append(f"- Top-K: `{int(k)}`")
    lines.append("")
    if failures:
        lines.append("## Skipped Providers")
        lines.append("")
        lines.append("| Provider | Reason |")
        lines.append("|---|---|")
        for f in failures:
            lines.append(f"| {f.provider} | {f.reason} |")
        lines.append("")

    lines.append("## Provider Summary")
    lines.append("")
    lines.append("| Provider | Run ID | Regime | Conf | Top Pick | Top Score | FDR Pass (Top-K) | Cash | Max Weight | Port Vol |")
    lines.append("|---|---|---|---:|---|---:|---:|---:|---:|---:|")
    for s in summaries:
        lines.append(
            f"| {s.provider} | {s.run_id} | {s.regime_label} | {s.regime_confidence:.2f} | {s.top_picks[0] if s.top_picks else ''} | "
            f"{s.top_score:.4f} | {s.pass_fdr_count} | {s.cash_weight:.2%} | {s.max_weight:.2%} ({s.max_weight_ticker}) | "
            f"{s.portfolio_vol:.2%} |"
        )
    lines.append("")
    lines.append("## Pairwise Agreement")
    lines.append("")
    lines.append("| Provider A | Provider B | Top-K Intersection | Jaccard | Allocation L1 Distance |")
    lines.append("|---|---|---:|---:|---:|")
    for r in pair_rows:
        lines.append(
            f"| {r['provider_a']} | {r['provider_b']} | {r['topk_intersection']} | {float(r['topk_jaccard']):.3f} | "
            f"{float(r['alloc_l1_distance']):.3f} |"
        )
    lines.append("")
    lines.append("## Determinism")
    lines.append("")
    raw = (out_dir / "comparison.json").read_bytes()
    lines.append(f"- comparison_json_sha256: `{sha256_bytes(raw)}`")
    lines.append("")
    (out_dir / "report.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    return out_dir


def parse_args(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run Morning Plan across providers and compare outputs.")
    p.add_argument("--start", required=True, help="Start date (YYYY-MM-DD)")
    p.add_argument("--end", required=True, help="End date (YYYY-MM-DD)")
    p.add_argument("--asof", default=None, help="As-of date (default: --end)")
    p.add_argument("--k", type=int, default=5, help="Top-K picks to compare")
    p.add_argument("--interval", default="1d", help="Data interval (default: 1d)")
    p.add_argument("--universe", default="", help="Optional comma-separated universe override")
    p.add_argument(
        "--providers",
        default="alphavantage,finnhub,stockdata",
        help="Comma-separated providers (subset/order of alphavantage,finnhub,stockdata)",
    )
    p.add_argument(
        "--require_all",
        action="store_true",
        help="Fail if any provider is missing keys or fails to run.",
    )
    p.add_argument("--strict", action="store_true", help="Pass --strict to morning_run.py")
    return p.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    providers = _parse_provider_list(str(args.providers))

    start = str(args.start)
    end = str(args.end)
    asof = str(args.asof or args.end)
    k = int(args.k)
    interval = str(args.interval)
    universe = str(args.universe).strip() or None
    strict = bool(args.strict)
    require_all = bool(args.require_all)

    summaries: List[ProviderRunSummary] = []
    failures: List[ProviderFailure] = []
    for provider in providers:
        missing_key = _provider_key_missing(provider)
        if missing_key is not None:
            reason = f"missing_api_key:{missing_key}"
            print(f"[provider={provider}] skipped ({reason})", flush=True)
            failures.append(ProviderFailure(provider=provider, reason=reason))
            if require_all:
                raise RuntimeError(
                    f"Provider comparison aborted because --require_all is set and {provider} has no key ({missing_key})."
                )
            continue

        try:
            summary = _run_single_provider(
                provider,
                start=start,
                end=end,
                asof=asof,
                k=k,
                interval=interval,
                universe=universe,
                strict=strict,
                python_exe=sys.executable,
                project_root=_ROOT,
            )
            summaries.append(summary)
        except Exception as e:
            reason = str(e).replace("\n", " | ").strip()
            print(f"[provider={provider}] skipped (run_failed)", flush=True)
            failures.append(ProviderFailure(provider=provider, reason=reason))
            if require_all:
                raise

    if not summaries:
        details = "; ".join([f"{f.provider}:{f.reason}" for f in failures]) or "no providers succeeded"
        raise RuntimeError(f"Provider comparison failed: {details}")

    out_dir = _write_compare_artifacts(
        summaries,
        failures,
        start=start,
        end=end,
        asof=asof,
        k=k,
        interval=interval,
        universe=universe,
        project_root=_ROOT,
    )

    print(f"Provider comparison completed: {out_dir}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
