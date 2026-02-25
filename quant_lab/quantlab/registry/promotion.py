from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class PromotionThresholds:
    # Experimental -> Candidate
    min_oos_sharpe: float = 0.50
    max_pbo: float = 0.25
    min_deflated_sharpe_prob: float = 0.95

    # Candidate -> Production
    min_candidate_runs: int = 3


@dataclass(frozen=True)
class PromotionResult:
    state: str  # experimental/candidate/production
    diagnostics: List[Dict[str, Any]]


def _diag(name: str, value: Any, threshold: Any, ok: Optional[bool]) -> Dict[str, Any]:
    status = "INFO"
    if ok is True:
        status = "PASS"
    elif ok is False:
        status = "FAIL"
    return {"metric_name": name, "value": value, "threshold": threshold, "status": status}


def decide_promotion_state(
    *,
    engine_type: str,
    oos_sharpe: Optional[float],
    deflated_sharpe_prob: Optional[float],
    pbo: Optional[float],
    drift_flag: Optional[bool],
    candidate_history_count: int,
    thresholds: PromotionThresholds = PromotionThresholds(),
) -> PromotionResult:
    """
    Deterministic, rules-based promotion workflow.

    Notes:
    - If required inputs are missing, promotion does not happen (stays experimental).
    - No auto-promotion to production without satisfying *all* criteria.
    """
    diags: List[Dict[str, Any]] = []

    # Gate: required metrics must exist.
    have_all = (oos_sharpe is not None) and (deflated_sharpe_prob is not None) and (pbo is not None)
    diags.append(_diag("promotion_inputs_present", int(bool(have_all)), "1", bool(have_all)))

    cand_ok = False
    if have_all:
        cand_ok = (
            float(oos_sharpe) >= float(thresholds.min_oos_sharpe)
            and float(deflated_sharpe_prob) >= float(thresholds.min_deflated_sharpe_prob)
            and float(pbo) <= float(thresholds.max_pbo)
        )
    diags.append(_diag("rule_oos_sharpe", oos_sharpe, f">={thresholds.min_oos_sharpe}", None if not have_all else (float(oos_sharpe) >= float(thresholds.min_oos_sharpe))))
    diags.append(_diag("rule_deflated_sharpe_prob", deflated_sharpe_prob, f">={thresholds.min_deflated_sharpe_prob}", None if not have_all else (float(deflated_sharpe_prob) >= float(thresholds.min_deflated_sharpe_prob))))
    diags.append(_diag("rule_pbo", pbo, f"<={thresholds.max_pbo}", None if not have_all else (float(pbo) <= float(thresholds.max_pbo))))

    # Drift gate for production only.
    drift_ok = (drift_flag is False) if drift_flag is not None else True
    diags.append(_diag("rule_no_drift", int(0 if drift_flag else 1) if drift_flag is not None else "", "no drift", drift_ok))

    state = "experimental"
    if cand_ok:
        state = "candidate"
        # Promotion to production requires sustained candidate performance and no drift.
        if int(candidate_history_count) >= int(thresholds.min_candidate_runs) and bool(drift_ok):
            state = "production"

    diags.append(_diag("model_state", state, "ruleset_v1", None))

    return PromotionResult(state=state, diagnostics=diags)

