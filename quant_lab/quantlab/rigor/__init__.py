"""Mathematically rigorous research primitives (deterministic, testable).

This package contains self-contained statistical/optimization utilities used to
validate strategies and portfolio construction in a science-first manner.

Constraints:
- Research-only, paper-only
- Deterministic (seeded randomness where applicable)
- No silent failures: functions raise on structural issues and return explicit
  results for statistical uncertainty.
"""

from quantlab.rigor.bandit import UCB1Ensemble  # noqa: F401
from quantlab.rigor.covariance import ledoit_wolf_cov  # noqa: F401
from quantlab.rigor.drift import drift_metrics  # noqa: F401
from quantlab.rigor.factor_model import fama_macbeth, residual_alpha  # noqa: F401
from quantlab.rigor.features import momentum_acceleration  # noqa: F401
from quantlab.rigor.ic import rank_ic, rolling_ic_decay  # noqa: F401
from quantlab.rigor.optimization import mean_variance_weights, risk_parity_weights  # noqa: F401
from quantlab.rigor.ou import ou_half_life  # noqa: F401
from quantlab.rigor.pbo import probability_of_backtest_overfitting  # noqa: F401
from quantlab.rigor.validation import (  # noqa: F401
    block_bootstrap_ci,
    deflated_sharpe_probability,
    newey_west_t_stat_mean,
)
