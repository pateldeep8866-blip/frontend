from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Sequence, Tuple

from quantlab.stats import bh_fdr, mean_return_t_stat


def _is_finite(x: Any) -> bool:
    try:
        xf = float(x)
    except Exception:
        return False
    return math.isfinite(xf)


def zscore_map(values: Dict[str, float]) -> Dict[str, float]:
    xs = [float(v) for v in values.values() if _is_finite(v)]
    if not xs:
        return {k: 0.0 for k in values}
    mu = sum(xs) / float(len(xs))
    var = sum((x - mu) ** 2 for x in xs) / float(len(xs))
    sd = math.sqrt(var)
    if sd == 0.0:
        return {k: 0.0 for k in values}
    out: Dict[str, float] = {}
    for k, v in values.items():
        out[k] = 0.0 if not _is_finite(v) else (float(v) - mu) / sd
    return out


def _one_sided_p_from_t(t: float) -> float:
    # H0: mean=0, H1: mean>0. Normal approximation.
    return 0.5 * math.erfc(float(t) / math.sqrt(2.0))


@dataclass(frozen=True)
class SignalRow:
    ticker: str
    score: float
    volatility: float
    mom_63: float
    mom_252: float
    corr_spy: float
    p_value: float
    passes_fdr: bool
    t_stat: float
    reasons: str


def compute_signals(
    feature_rows: Dict[str, Dict[str, float]],
    returns_lookback: Dict[str, Sequence[float]],
    *,
    fdr_q: float = 0.10,
) -> List[SignalRow]:
    """
    Composite scoring per ticker using weighted z-scores, plus FDR support flags.
    """
    # Build raw feature vectors.
    mom = {t: float(feature_rows[t].get("mom_63", float("nan"))) for t in feature_rows}
    trend = {t: float(feature_rows[t].get("ma_short", float("nan"))) - float(feature_rows[t].get("ma_long", float("nan"))) for t in feature_rows}
    vol = {t: float(feature_rows[t].get("volatility", float("nan"))) for t in feature_rows}
    dd = {t: abs(float(feature_rows[t].get("drawdown", float("nan")))) for t in feature_rows}
    corr = {t: float(feature_rows[t].get("corr_spy_63", float("nan"))) for t in feature_rows}
    mom252 = {t: float(feature_rows[t].get("mom_252", float("nan"))) for t in feature_rows}

    z_mom = zscore_map(mom)
    z_trend = zscore_map(trend)
    z_risk = {t: -v for t, v in zscore_map(vol).items()}
    z_dd = {t: -v for t, v in zscore_map(dd).items()}

    # Uncertainty: mean-return t-stat and one-sided p-value for positive drift.
    t_stats: Dict[str, float] = {}
    p_vals: Dict[str, float] = {}
    for t in feature_rows:
        rets = returns_lookback.get(t, [])
        t_stat, _ = mean_return_t_stat(rets)
        p_one = _one_sided_p_from_t(t_stat)
        t_stats[t] = float(t_stat)
        p_vals[t] = float(min(max(p_one, 0.0), 1.0))

    rejects = bh_fdr([p_vals[t] for t in feature_rows], q=float(fdr_q))
    tickers = list(feature_rows.keys())
    passes = {t: bool(r) for t, r in zip(tickers, rejects)}

    out: List[SignalRow] = []
    for t in tickers:
        score = 0.35 * z_mom[t] + 0.35 * z_trend[t] + 0.20 * z_risk[t] + 0.10 * z_dd[t]
        reason = (
            f"score={score:.3f} (z_mom={z_mom[t]:.2f}, z_trend={z_trend[t]:.2f}, z_risk={z_risk[t]:.2f}, z_dd={z_dd[t]:.2f}); "
            f"p(one-sided)={p_vals[t]:.3g} FDR={'Y' if passes[t] else 'N'}"
        )
        out.append(
            SignalRow(
                ticker=str(t),
                score=float(score),
                volatility=float(vol.get(t, float("nan"))),
                mom_63=float(mom.get(t, float("nan"))),
                mom_252=float(mom252.get(t, float("nan"))),
                corr_spy=float(corr.get(t, float("nan"))),
                p_value=float(p_vals[t]),
                passes_fdr=bool(passes[t]),
                t_stat=float(t_stats[t]),
                reasons=reason,
            )
        )

    out.sort(key=lambda r: (r.passes_fdr, r.score), reverse=True)
    return out

