from quantlab.stats import bh_fdr


def test_bh_fdr_monotone_rejections():
    # Sorted p-values should produce a rejection pattern that is a prefix of True then False.
    pvals = [0.30, 0.001, 0.08, 0.02, 0.90, 0.04, 0.15]
    rej = bh_fdr(pvals, q=0.10)
    order = sorted(range(len(pvals)), key=lambda i: pvals[i])
    rej_sorted = [bool(rej[i]) for i in order]

    seen_false = False
    for r in rej_sorted:
        if not r:
            seen_false = True
        else:
            assert not seen_false

