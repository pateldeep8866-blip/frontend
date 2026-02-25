from quantlab.morning.portfolio import inverse_vol_weights
from quantlab.morning.risk import apply_risk_constraints


def test_portfolio_invvol_weights_sum_and_cap():
    vols = {"AAA": 0.10, "BBB": 0.20, "CCC": 0.30}
    w = inverse_vol_weights(vols)
    assert abs(sum(w.values()) - 1.0) < 1e-12

    risk = apply_risk_constraints(w, max_weight_per_asset=0.25, cov_annualized=None)
    # Risk result includes CASH residual; total should sum to 1.
    assert abs(sum(risk.weights.values()) - 1.0) < 1e-12
    for t, wt in risk.weights.items():
        if t == "CASH":
            continue
        assert wt <= 0.25 + 1e-12

