from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Dict, Optional

try:
    import pandas as pd  # type: ignore
except ModuleNotFoundError:  # pragma: no cover
    pd = None  # type: ignore


@dataclass(frozen=True)
class RegimeResult:
    label: str  # risk_on / risk_off / neutral
    confidence: float  # [0, 1]
    method: str
    inputs: Dict[str, Any]


def detect_regime(
    spy_returns: "pd.Series",
    *,
    asof: "pd.Timestamp",
) -> RegimeResult:
    """
    Regime detection from SPY log returns.

    Preference:
    - hmmlearn (2-state Gaussian HMM) if available (deterministic seed)
    - else deterministic proxy based on 63d return and 63d vol vs historical quantiles
    """
    if pd is None:  # pragma: no cover
        raise ModuleNotFoundError("pandas is required for regime detection.")

    r = spy_returns.dropna().astype(float)
    r = r.loc[r.index <= asof]
    if r.empty:
        return RegimeResult(label="neutral", confidence=0.0, method="empty", inputs={})

    # Try HMM if available.
    try:
        from hmmlearn.hmm import GaussianHMM  # type: ignore

        x = r.to_numpy().reshape(-1, 1)
        # Fit on last ~3 years of daily returns if possible.
        if x.shape[0] > 756:
            x_fit = x[-756:]
        else:
            x_fit = x
        model = GaussianHMM(
            n_components=2,
            covariance_type="diag",
            n_iter=200,
            random_state=0,
        )
        model.fit(x_fit)
        post = model.predict_proba(x_fit)
        state = int(post[-1].argmax())
        conf = float(post[-1][state])

        means = [float(m[0]) for m in model.means_]
        vars_ = [float(v[0]) for v in model.covars_]
        # Define risk_off as lower mean or higher variance.
        risk_off_state = int(sorted(range(2), key=lambda i: (means[i], -vars_[i]))[0])
        label = "risk_off" if state == risk_off_state else "risk_on"

        return RegimeResult(
            label=label,
            confidence=float(min(max(conf, 0.0), 1.0)),
            method="hmmlearn",
            inputs={
                "means": means,
                "vars": vars_,
                "state": state,
                "risk_off_state": risk_off_state,
                "asof": asof.isoformat(),
            },
        )
    except Exception:
        pass

    # Deterministic proxy fallback.
    sqrt252 = math.sqrt(252.0)
    r63 = float(r.tail(63).sum())
    ret63 = float(math.exp(r63) - 1.0)
    vol63 = float(r.tail(63).std(ddof=0) * sqrt252) if len(r) >= 2 else float("nan")
    vol_series = r.rolling(63).std(ddof=0) * sqrt252
    vol_med = float(vol_series.median()) if vol_series.notna().any() else float("nan")
    vol_p75 = float(vol_series.quantile(0.75)) if vol_series.notna().any() else float("nan")

    label = "neutral"
    if math.isfinite(ret63) and math.isfinite(vol63) and math.isfinite(vol_med) and (ret63 > 0.0) and (vol63 < vol_med):
        label = "risk_on"
    if (math.isfinite(ret63) and ret63 < 0.0) or (math.isfinite(vol63) and math.isfinite(vol_p75) and vol63 > vol_p75):
        label = "risk_off"

    # Confidence heuristic: distance from thresholds.
    conf = 0.55
    if label == "risk_on":
        conf = 0.65 + min(0.30, max(0.0, ret63) / 0.15)
    elif label == "risk_off":
        conf = 0.70 + min(0.25, abs(ret63) / 0.15) if math.isfinite(ret63) else 0.70
        if math.isfinite(vol63) and math.isfinite(vol_p75) and vol_p75 > 0:
            conf = max(conf, 0.70 + min(0.25, max(0.0, (vol63 / vol_p75) - 1.0)))

    return RegimeResult(
        label=label,
        confidence=float(min(max(conf, 0.0), 1.0)),
        method="proxy",
        inputs={
            "asof": asof.isoformat(),
            "ret63": ret63,
            "vol63": vol63,
            "vol_median": vol_med,
            "vol_p75": vol_p75,
        },
    )

