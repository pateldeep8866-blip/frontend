from pathlib import Path
from datetime import datetime, timedelta

from quantlab.stats import bh_fdr
from quantlab.utils.hashing import composite_code_hash
from quantlab.walkforward import stitch_indexed_values


def test_bh_fdr_monotonic():
    pvals = [0.20, 0.001, 0.07, 0.02, 0.90, 0.04]
    rej = bh_fdr(pvals, q=0.10)
    order = sorted(range(len(pvals)), key=lambda i: pvals[i])
    rej_sorted = [rej[i] for i in order]

    # BH should reject a prefix of sorted p-values (monotone).
    seen_false = False
    for r in rej_sorted:
        if not bool(r):
            seen_false = True
        else:
            assert not seen_false


def test_walkforward_stitch_length():
    base = datetime(2020, 1, 1)
    idx1 = [base + timedelta(days=i) for i in range(5)]
    idx2 = [base + timedelta(days=4 + i) for i in range(5)]  # overlaps one date

    s1 = list(zip(idx1, [float(i) for i in range(5)]))
    s2 = list(zip(idx2, [float(100 + i) for i in range(5)]))

    stitched = stitch_indexed_values([s1, s2])
    assert len(stitched) == len(s1) + len(s2) - 1
    # Overlap keeps first occurrence.
    overlap_dt = base + timedelta(days=4)
    overlap_val = dict(stitched)[overlap_dt]
    assert overlap_val == dict(s1)[overlap_dt]


def test_composite_code_hash_changes_when_module_changes(tmp_path: Path):
    a = tmp_path / "a.py"
    b = tmp_path / "b.py"
    a.write_text("x = 1\n", encoding="utf-8")
    b.write_text("y = 2\n", encoding="utf-8")

    h1, files1 = composite_code_hash([a, b], project_root=tmp_path)
    b.write_text("y = 3\n", encoding="utf-8")
    h2, files2 = composite_code_hash([a, b], project_root=tmp_path)

    assert h1 != h2
    assert files1 == files2 == ["a.py", "b.py"]
