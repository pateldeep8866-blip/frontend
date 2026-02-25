from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence

import numpy as np


@dataclass
class UCB1Ensemble:
    """
    Deterministic multi-armed bandit (UCB1) for ensemble weighting.

    - No randomness required (deterministic by design).
    - Use rewards that are past-only (e.g., realized next-period returns).
    """

    n_arms: int
    explore_coef: float = 1.0

    def __post_init__(self) -> None:
        if int(self.n_arms) <= 0:
            raise ValueError("n_arms must be > 0")
        if float(self.explore_coef) < 0:
            raise ValueError("explore_coef must be >= 0")
        self.counts = np.zeros(int(self.n_arms), dtype=int)
        self.sums = np.zeros(int(self.n_arms), dtype=float)

    def select(self) -> int:
        # Pull each arm once deterministically.
        for i in range(int(self.n_arms)):
            if int(self.counts[i]) == 0:
                return i

        t = int(self.counts.sum())
        avg = self.sums / np.maximum(self.counts, 1)
        bonus = float(self.explore_coef) * np.sqrt(2.0 * math.log(float(t)) / self.counts)
        ucb = avg + bonus
        # Deterministic tie-break: smallest index.
        return int(np.argmax(ucb))

    def update(self, arm: int, reward: float) -> None:
        a = int(arm)
        if a < 0 or a >= int(self.n_arms):
            raise ValueError("invalid arm index")
        r = float(reward)
        if not math.isfinite(r):
            raise ValueError("reward must be finite")
        self.counts[a] += 1
        self.sums[a] += r

    def average_rewards(self) -> np.ndarray:
        return self.sums / np.maximum(self.counts, 1)

    def weights(self, *, floor: float = 1e-6) -> np.ndarray:
        """
        Convert learned average rewards into a simplex weight vector (deterministic).
        """
        avg = self.average_rewards()
        # Shift to non-negative and avoid all-zeros.
        m = float(np.min(avg))
        w = avg - m
        w = np.maximum(w, 0.0) + float(floor)
        w = w / float(np.sum(w))
        return w

