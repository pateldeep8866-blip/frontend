from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional, Sequence, Tuple

import numpy as np


def _clean_floats(xs: Iterable[Any]) -> np.ndarray:
    vals = []
    for x in xs:
        try:
            xf = float(x)
        except Exception:
            continue
        if math.isfinite(xf):
            vals.append(xf)
    return np.asarray(vals, dtype=float)


def _norm_pvalue_two_sided(z: float) -> float:
    zz = abs(float(z))
    p = math.erfc(zz / math.sqrt(2.0))  # 2*(1 - Phi(|z|))
    return float(min(max(p, 0.0), 1.0))


def newey_west_se_mean(x: Sequence[float], *, lags: Optional[int] = None) -> float:
    """
    Newey-West HAC standard error for the sample mean of `x`.

    Uses Bartlett kernel with `lags` (if None: Andrews(1991) rule-of-thumb).
    """
    xs = _clean_floats(x)
    n = int(xs.size)
    if n < 2:
        return float("inf")

    mu = float(xs.mean())
    e = xs - mu

    if lags is None:
        # Common deterministic lag choice for HAC.
        lags = int(math.floor(4.0 * (n / 100.0) ** (2.0 / 9.0)))
    L = int(max(0, min(int(lags), n - 1)))

    gamma0 = float(np.dot(e, e) / n)
    hac = gamma0
    for l in range(1, L + 1):
        w = 1.0 - (l / (L + 1.0))
        cov = float(np.dot(e[l:], e[:-l]) / n)
        hac += 2.0 * w * cov

    var_mean = hac / n
    if var_mean <= 0.0 or not math.isfinite(var_mean):
        return float("inf")
    return float(math.sqrt(var_mean))


def newey_west_t_stat_mean(x: Sequence[float], *, lags: Optional[int] = None) -> Tuple[float, float, float]:
    """
    Newey-West t-stat and (normal-approx) p-value for mean(x) vs 0.

    Returns: (t_stat, p_value, se)
    """
    xs = _clean_floats(x)
    n = int(xs.size)
    if n < 2:
        return 0.0, 1.0, float("inf")
    mu = float(xs.mean())
    se = float(newey_west_se_mean(xs, lags=lags))
    if not math.isfinite(se) or se <= 0.0:
        return 0.0, 1.0, float("inf")
    t = mu / se
    p = _norm_pvalue_two_sided(t)
    return float(t), float(p), float(se)


@dataclass(frozen=True)
class BootstrapCI:
    point: float
    lo: float
    hi: float
    samples: np.ndarray


def block_bootstrap_ci(
    x: Sequence[float],
    *,
    statistic: Callable[[np.ndarray], float] = lambda a: float(np.mean(a)),
    block_size: int = 10,
    n_boot: int = 1000,
    seed: int = 0,
    alpha: float = 0.05,
) -> BootstrapCI:
    """
    Moving block bootstrap confidence interval for a statistic on a 1D series.

    Deterministic given `seed`.
    """
    xs = _clean_floats(x)
    n = int(xs.size)
    if n == 0:
        raise ValueError("block_bootstrap_ci: empty input series")
    if int(block_size) <= 0:
        raise ValueError("block_bootstrap_ci: block_size must be > 0")
    if int(n_boot) <= 0:
        raise ValueError("block_bootstrap_ci: n_boot must be > 0")
    if not (0.0 < float(alpha) < 1.0):
        raise ValueError("block_bootstrap_ci: alpha must be in (0,1)")

    b = int(min(int(block_size), n))
    k = int(math.ceil(n / b))

    rng = np.random.default_rng(int(seed))
    # Start indices for blocks.
    max_start = int(n - b)
    starts = np.arange(max_start + 1, dtype=int) if max_start >= 0 else np.array([0], dtype=int)

    boots = np.empty(int(n_boot), dtype=float)
    for i in range(int(n_boot)):
        idx_parts = []
        for _ in range(k):
            s = int(rng.choice(starts))
            idx_parts.append(np.arange(s, s + b, dtype=int))
        idx = np.concatenate(idx_parts)[:n]
        boots[i] = float(statistic(xs[idx]))

    point = float(statistic(xs))
    lo_q = float(alpha / 2.0)
    hi_q = float(1.0 - alpha / 2.0)
    lo = float(np.quantile(boots, lo_q))
    hi = float(np.quantile(boots, hi_q))
    return BootstrapCI(point=point, lo=lo, hi=hi, samples=boots)


def _sample_skew_kurt(x: np.ndarray) -> Tuple[float, float]:
    x = x.astype(float)
    n = int(x.size)
    if n < 4:
        return 0.0, 3.0
    mu = float(x.mean())
    m2 = float(np.mean((x - mu) ** 2))
    if m2 <= 0.0 or not math.isfinite(m2):
        return 0.0, 3.0
    m3 = float(np.mean((x - mu) ** 3))
    m4 = float(np.mean((x - mu) ** 4))
    skew = float(m3 / (m2 ** 1.5))
    kurt = float(m4 / (m2**2))
    if not math.isfinite(skew):
        skew = 0.0
    if not math.isfinite(kurt):
        kurt = 3.0
    return skew, kurt


def _sharpe_ratio(r: np.ndarray, annualization: int = 252, rf: float = 0.0) -> float:
    n = int(r.size)
    if n < 2:
        return float("nan")
    rf_daily = float(rf) / float(annualization)
    ex = r - rf_daily
    vol = float(ex.std(ddof=0))
    if vol <= 0.0 or not math.isfinite(vol):
        return float("nan")
    return float(math.sqrt(float(annualization)) * float(ex.mean()) / vol)


def deflated_sharpe_probability(
    returns: Sequence[float],
    *,
    annualization: int = 252,
    risk_free_rate: float = 0.0,
    n_trials: int = 1,
) -> dict[str, float]:
    """
    Deflated Sharpe Ratio probability (screening-level).

    Uses a Gumbel approximation for the expected max Sharpe under the null across `n_trials`
    and a non-normality adjusted Sharpe standard error (skew/kurt).
    """
    r = _clean_floats(returns)
    n = int(r.size)
    if n < 10:
        # Too little data for meaningful inference; return conservative values.
        return {
            "n": float(n),
            "sharpe": float("nan"),
            "sr_threshold": 0.0,
            "z": 0.0,
            "prob": 0.5,
            "skew": 0.0,
            "kurt": 3.0,
            "n_trials": float(int(max(1, n_trials))),
        }

    sr = _sharpe_ratio(r, annualization=annualization, rf=risk_free_rate)
    skew, kurt = _sample_skew_kurt(r)

    # Standard error of Sharpe with skew/kurt adjustment (Bailey & Lopez de Prado style).
    # Guard against negative due to numerical issues.
    denom = max(1.0, float(n - 1))
    se2 = (1.0 - skew * sr + ((kurt - 1.0) / 4.0) * (sr**2)) / denom
    if not math.isfinite(se2) or se2 <= 0.0:
        se2 = 1.0 / denom
    se = float(math.sqrt(se2))

    M = int(max(1, int(n_trials)))
    if M <= 1:
        sr_star = 0.0
    else:
        # Under the null, Sharpe approx N(0, sigma0^2) with sigma0 ~ 1/sqrt(n-1)
        sigma0 = float(1.0 / math.sqrt(denom))
        u = float(math.sqrt(2.0 * math.log(float(M))))
        # Finite-sample correction for expected maximum of Gaussians (Gumbel location).
        c = float((math.log(math.log(float(M))) + math.log(4.0 * math.pi)) / (2.0 * u))
        sr_star = sigma0 * (u - c)

    z = 0.0 if not math.isfinite(sr) else float((sr - sr_star) / se)
    # One-sided probability Sharpe exceeds adjusted threshold.
    prob = float(0.5 * math.erfc(-z / math.sqrt(2.0)))  # Phi(z)
    prob = float(min(max(prob, 0.0), 1.0))

    return {
        "n": float(n),
        "sharpe": float(sr),
        "sr_threshold": float(sr_star),
        "z": float(z),
        "prob": float(prob),
        "skew": float(skew),
        "kurt": float(kurt),
        "n_trials": float(M),
    }

