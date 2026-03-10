# Morning Plan (Paper/Research Only): 20260217T063605Z_45b10d46

This is a probabilistic research note. It does not guarantee profits and is not trading advice.

- Created (UTC): `2026-02-17T06:36:05.411291Z`
- As-of date: `2026-02-16`
- Universe size: `13`

## Hypothesis

Cross-sectional trend + momentum with risk-aware sizing produces a higher probability of positive drift than chance,
subject to regime filtering and conservative risk constraints.

## Regime

- Label: `risk_on`
- Confidence: `0.65` (method: `proxy`)

## Ranked Picks (Top)

| Rank | Ticker | Score | Vol | Mom(63) | Corr(SPY) | p-value | FDR | Reason |
|---:|---|---:|---:|---:|---:|---:|:---:|---|
| 1 | XLP | 0.637 | 0.122 | 0.154 | -0.065 | 0.00588 | Y | score=0.637 (z_mom=1.24, z_trend=-0.05, z_risk=0.76, z_dd=0.65); p(one-sided)=0.00588 FDR=Y |
| 2 | GLD | 1.131 | 0.353 | 0.181 | 0.187 | 0.155 | N | score=1.131 (z_mom=1.57, z_trend=3.27, z_risk=-2.80, z_dd=-0.04); p(one-sided)=0.155 FDR=N |
| 3 | XLI | 0.506 | 0.156 | 0.124 | 0.767 | 0.0572 | N | score=0.506 (z_mom=0.88, z_trend=0.26, z_risk=0.24, z_dd=0.61); p(one-sided)=0.0572 FDR=N |
| 4 | XLE | 0.475 | 0.220 | 0.194 | 0.138 | 0.0396 | N | score=0.475 (z_mom=1.73, z_trend=-0.10, z_risk=-0.75, z_dd=0.53); p(one-sided)=0.0396 FDR=N |
| 5 | IWM | 0.166 | 0.194 | 0.080 | 0.816 | 0.208 | N | score=0.166 (z_mom=0.34, z_trend=0.22, z_risk=-0.35, z_dd=0.39); p(one-sided)=0.208 FDR=N |

## Allocation Plan (Target Weights)

| Ticker | Weight |
|---|---:|
| CASH | 5.270% |
| GLD | 10.420% |
| IWM | 18.957% |
| XLE | 16.736% |
| XLI | 23.617% |
| XLP | 25.000% |

## Risk Budget + Guardrails

- Max weight/asset: `0.25`
- Max portfolio vol (annualized): `0.18`
- Max drawdown limit (advisory): `-0.10`

Risk actions applied:
- cap_weight: XLP clipped to 0.25

Kill-switch rules (paper-only):
- ADVISORY: if paper drawdown <= -10%, halt adding risk and reassess.
- ADVISORY: if est. portfolio vol > 18%, reduce exposure (increase CASH).

## Uncertainty Notes

- p-values are computed from a normal approximation to the mean-return t-statistic (screening-level inference).
- Multiple testing is controlled using Benjamini–Hochberg FDR at q=0.10 across the universe.
- Scores and allocations are sensitive to lookback choice, data revisions, and regime shifts.

## Determinism Inputs

- Data source: `yfinance`  Cache hit (all): `True`
- Composite data sha256: `6700a1fb7c38456f60c575ba5b4c5895850be2223d1707dbae34df822909e379`
- Code sha256: `0a789a9bd3bef8de5cbb9b69250cc297f7d0e96adccdd1d839f0c2961c88d12d`
- Composite code sha256: `d27e5e6b19918a0b75a8a156eec346871ff2bedf74cd848145e29c3171573fd6`
- Config sha256: `4669fe1b8d6577437047ffe66366df469a79508d991af3b51ca524c099cb9f7c`

Data files (sha256):
- DIA: `a35c945880bb80e602bcfda59bda540d0f4ae85e9323a14b1a2445b691f20e0e` (data/cache/DIA__1d__2015-01-01__2026-02-16.csv)
- GLD: `154c202b7dd50d3efe99c1eab342052d66eb363cf57040abd814f9a67c19f639` (data/cache/GLD__1d__2015-01-01__2026-02-16.csv)
- IWM: `2c8d68e1470e1070581e0ab203b6c325dc8e87a45fadcf1d6647d0c4cbd53699` (data/cache/IWM__1d__2015-01-01__2026-02-16.csv)
- QQQ: `6c788ce4ff7c9c783d85b8f7fde695ce6fa7b23563bfa1b4aae193ebde646a0b` (data/cache/QQQ__1d__2015-01-01__2026-02-16.csv)
- SPY: `60ef502308542c4062bd43924150ea2a6ca336d8689e2c832cbe2ca2ebcf8c8a` (data/cache/SPY__1d__2015-01-01__2026-02-16.csv)
- TLT: `ff3a12aeefb60230b493de729d1f0599b35ecb7465e0194120f03156b5a5c87b` (data/cache/TLT__1d__2015-01-01__2026-02-16.csv)
- XLE: `54ccf484252ae1647b49e095e065302ab8395c3b9765db831503fabf5e42fbc8` (data/cache/XLE__1d__2015-01-01__2026-02-16.csv)
- XLF: `23a2cae0e655db0413d51dbfbdf21b5e5192ee9479580d93d07d53a6ab32cb41` (data/cache/XLF__1d__2015-01-01__2026-02-16.csv)
- XLI: `1911e36dd4c625489a31420da6d45bb3cddb2a95d1b04b9d92f3016816942386` (data/cache/XLI__1d__2015-01-01__2026-02-16.csv)
- XLK: `acf9b6eb84c978039e4a90678f0db5cfc25a8c81eaf78a933a861cdaf03bd2b7` (data/cache/XLK__1d__2015-01-01__2026-02-16.csv)
- XLP: `af64184d1126caa4e81b8b5ed378f4f442496f9e814b8b10b3cc8b5344443600` (data/cache/XLP__1d__2015-01-01__2026-02-16.csv)
- XLV: `9950f71dca82f0e1e417b1132b113987929bb1eb13a2e07a2fe854c77037b46c` (data/cache/XLV__1d__2015-01-01__2026-02-16.csv)
- XLY: `0646dd3c21e5013a7e77fcaddc6cffdf2100f5425dc2552ef1882f2a3108daee` (data/cache/XLY__1d__2015-01-01__2026-02-16.csv)

## Artifacts

- `picks.csv`, `allocation.csv`, `regime.json`, `metrics.json`, `report.md`, `equity_curve.png`
