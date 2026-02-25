from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Tuple

import numpy as np


def _as_2d_array(x: Any) -> np.ndarray:
    a = np.asarray(x, dtype=float)
    if a.ndim != 2:
        raise ValueError("Expected 2D array (T x N) for returns matrix")
    if a.shape[0] < 2 or a.shape[1] < 1:
        raise ValueError("Returns matrix must have shape (T>=2, N>=1)")
    if not np.isfinite(a).all():
        raise ValueError("Returns matrix contains NaN/inf")
    return a


@dataclass(frozen=True)
class ShrunkCov:
    cov: np.ndarray
    shrinkage: float
    mu: float


def _oas_shrinkage_intensity(sample_cov: np.ndarray, n_obs: int) -> float:
    """
    Oracle Approximating Shrinkage (OAS) intensity for shrinkage to mu*I.

    This is deterministic, closed-form, and produces a Ledoit-Wolf-class shrinkage
    estimator (well-conditioned covariance). Used here to avoid heavy deps.
    """
    p = int(sample_cov.shape[0])
    mu = float(np.trace(sample_cov) / p)
    tr_s2 = float(np.sum(sample_cov**2))
    tr_s = float(np.trace(sample_cov))

    # Guard degenerate case.
    if tr_s2 <= 0.0:
        return 1.0

    num = (1.0 - 2.0 / p) * tr_s2 + tr_s * tr_s
    den = (n_obs + 1.0 - 2.0 / p) * (tr_s2 - (tr_s * tr_s) / p)
    if den <= 0.0 or not math.isfinite(den):
        return 1.0
    shrink = float(min(max(num / den, 0.0), 1.0))
    return shrink


def ledoit_wolf_cov(returns: Any) -> ShrunkCov:
    """
    Shrink sample covariance toward scaled identity using a deterministic shrinkage intensity.

    Returns:
      ShrunkCov(cov=..., shrinkage in [0,1], mu)

    Note: We use a closed-form OAS shrinkage intensity as a stable, dependency-free
    estimator in the Ledoit-Wolf family. This produces a well-conditioned PSD covariance.
    """
    X = _as_2d_array(returns)
    T, N = int(X.shape[0]), int(X.shape[1])

    # Center columns.
    Xc = X - X.mean(axis=0, keepdims=True)
    S = (Xc.T @ Xc) / float(T)
    mu = float(np.trace(S) / float(N))
    shrink = _oas_shrinkage_intensity(S, T)
    F = mu * np.eye(N, dtype=float)
    C = shrink * F + (1.0 - shrink) * S
    # Symmetrize numeric noise.
    C = 0.5 * (C + C.T)
    return ShrunkCov(cov=C, shrinkage=float(shrink), mu=mu)


def ensure_psd(cov: np.ndarray, *, eps: float = 1e-12) -> np.ndarray:
    """
    Project to PSD by clipping eigenvalues (deterministic).
    """
    A = np.asarray(cov, dtype=float)
    if A.ndim != 2 or A.shape[0] != A.shape[1]:
        raise ValueError("ensure_psd expects a square matrix")
    w, V = np.linalg.eigh(0.5 * (A + A.T))
    w = np.maximum(w, float(eps))
    B = (V * w) @ V.T
    return 0.5 * (B + B.T)

