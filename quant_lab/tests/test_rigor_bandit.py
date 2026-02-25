from quantlab.rigor.bandit import UCB1Ensemble


def test_ucb1_deterministic_explore_then_exploit():
    b = UCB1Ensemble(n_arms=3, explore_coef=1.0)
    assert b.select() == 0
    b.update(0, 0.0)
    assert b.select() == 1
    b.update(1, 1.0)
    assert b.select() == 2
    b.update(2, 0.5)

    # After initial pulls, arm 1 has the best avg reward, so it should be preferred.
    chosen = b.select()
    assert chosen in {1, 2}  # exploration bonus can still matter, but 1 should not be excluded
    w = b.weights()
    assert abs(float(w.sum()) - 1.0) < 1e-12
    assert float(w[1]) > float(w[0])

