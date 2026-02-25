from quantlab.live.providers import compute_target_shares_from_weights


def test_live_rebalance_weight_to_shares_respects_caps_and_cash():
    equity = 10_000.0
    weights = {"AAA": 0.60, "BBB": 0.30, "CASH": 0.10}  # AAA above cap
    prices = {"AAA": 100.0, "BBB": 50.0}

    targets, residual = compute_target_shares_from_weights(
        equity=equity,
        weights=weights,
        prices=prices,
        max_weight_per_asset=0.25,
        commission=0.0,
    )

    # Spend should not exceed equity.
    spend = targets["AAA"] * prices["AAA"] + targets["BBB"] * prices["BBB"]
    assert spend <= equity + 1e-9
    assert residual >= -1e-9

    # Per-asset spend should not exceed cap * equity (flooring shares prevents overshoot).
    assert targets["AAA"] * prices["AAA"] <= 0.25 * equity + 1e-9
    assert targets["BBB"] * prices["BBB"] <= 0.25 * equity + 1e-9

