from __future__ import annotations

import itertools
import math
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Sequence, Tuple

import numpy as np


def _as_matrix(perf: Any) -> np.ndarray:
    A = np.asarray(perf, dtype=float)
    if A.ndim != 2:
        raise ValueError("perf must be 2D: (segments x strategies)")
    if A.shape[0] < 4 or A.shape[1] < 2:
        raise ValueError("perf must have at least 4 segments and 2 strategies")
    if not np.isfinite(A).all():
        raise ValueError("perf contains NaN/inf")
    return A


def _percentile_rank(values: np.ndarray, chosen_index: int) -> float:
    """
    Percentile rank in (0,1) with mid-rank continuity correction.
    """
    s = int(values.size)
    v = float(values[chosen_index])
    less = float(np.sum(values < v))
    equal = float(np.sum(values == v))
    rank = (less + 0.5 * equal) / float(s)
    # Clip away from 0/1 for logit stability.
    eps = 1.0 / (10.0 * s)
    return float(min(max(rank, eps), 1.0 - eps))


@dataclass(frozen=True)
class PBOResult:
    pbo: float
    logits: np.ndarray
    ranks: np.ndarray
    n_splits: int


def probability_of_backtest_overfitting(
    perf: Any,
    *,
    seed: int = 0,
    max_combinations: Optional[int] = 2000,
) -> PBOResult:
    """
    Probability of Backtest Overfitting (PBO) via combinatorial symmetric CV (CSCV).

    Input:
      perf[segment, strategy] = performance metric in each segment (e.g., Sharpe).

    Procedure:
      - split segments into equal halves (all combinations or a deterministic sample)
      - choose best strategy on training half
      - compute its percentile rank on test half
      - logit transform rank -> lambda
      - PBO = P(lambda < 0)
    """
    A = _as_matrix(perf)
    S, K = int(A.shape[0]), int(A.shape[1])
    half = S // 2
    if S % 2 != 0:
        # Drop last segment to keep symmetric halves deterministic.
        A = A[: S - 1, :]
        S = int(A.shape[0])
        half = S // 2

    combos = list(itertools.combinations(range(S), half))
    if max_combinations is not None and len(combos) > int(max_combinations):
        rng = np.random.default_rng(int(seed))
        idx = rng.choice(len(combos), size=int(max_combinations), replace=False)
        combos = [combos[int(i)] for i in sorted(idx)]

    logits = np.empty(len(combos), dtype=float)
    ranks = np.empty(len(combos), dtype=float)

    all_idx = np.arange(S, dtype=int)
    for i, train_idx in enumerate(combos):
        train_mask = np.zeros(S, dtype=bool)
        train_mask[list(train_idx)] = True
        test_mask = ~train_mask

        train_perf = A[train_mask, :].mean(axis=0)
        best = int(np.argmax(train_perf))
        test_perf = A[test_mask, :].mean(axis=0)

        r = _percentile_rank(test_perf, best)
        ranks[i] = r
        logits[i] = float(math.log(r / (1.0 - r)))

    pbo = float(np.mean(logits < 0.0))
    return PBOResult(pbo=pbo, logits=logits, ranks=ranks, n_splits=int(len(combos)))

