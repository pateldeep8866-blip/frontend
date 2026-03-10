# Morning Plan (Paper/Research Only): 20260217T071527Z_c8032204

This is a probabilistic research note. It does not guarantee profits and is not trading advice.

- Created (UTC): `2026-02-17T07:15:27.698894Z`
- As-of date: `2026-02-17`
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

- Data source: `yfinance`  Cache hit (all): `False`
- Composite data sha256: `d294b20a015df572ff744c2051f238770f2edffa92ffd8c74dfa8eb34589d6d7`
- Code sha256: `0a789a9bd3bef8de5cbb9b69250cc297f7d0e96adccdd1d839f0c2961c88d12d`
- Composite code sha256: `d27e5e6b19918a0b75a8a156eec346871ff2bedf74cd848145e29c3171573fd6`
- Config sha256: `f00ce8f7691ec9827695f00d71eb4f24adea4f4f049c6e41c2a28a3b34ff0467`

Data files (sha256):
- DIA: `5a40577c5560f6fb2a2b6648a69b46dfbe5d251bb2f0da72cb0ca09964fdf2d3` (data/cache/DIA__1d__2015-01-01__2026-02-17.csv)
- GLD: `154c202b7dd50d3efe99c1eab342052d66eb363cf57040abd814f9a67c19f639` (data/cache/GLD__1d__2015-01-01__2026-02-17.csv)
- IWM: `5ae7420380893c71f495fb991bd3265bdb443a97f51be90376de49eca2fa64cb` (data/cache/IWM__1d__2015-01-01__2026-02-17.csv)
- QQQ: `7d109086927f6389e78a9a9f17c6eaf7a744b65d1a43ab15415f71cb8a5dbb3f` (data/cache/QQQ__1d__2015-01-01__2026-02-17.csv)
- SPY: `a8e0448b91763e977b0cf1faa5a7c786943032303ecb114ba9b5224964938106` (data/cache/SPY__1d__2015-01-01__2026-02-17.csv)
- TLT: `c283cf7a9e3c06344c5bc46bb6b9291000667ddeea079356a0f7844737b797fa` (data/cache/TLT__1d__2015-01-01__2026-02-17.csv)
- XLE: `07fc478400e142b4a4e2ebd20e345b2099ab471b37a0f3e50b5c75fe98f9d6b4` (data/cache/XLE__1d__2015-01-01__2026-02-17.csv)
- XLF: `2df7dc4ed59feabc40f06f9b73d0b3a12ef952f6d0f9369316392ed46aefcd92` (data/cache/XLF__1d__2015-01-01__2026-02-17.csv)
- XLI: `7bf0eb7817ad20bda42883871b01f4ee05471b9b73219af7e8ad77ec340b69ff` (data/cache/XLI__1d__2015-01-01__2026-02-17.csv)
- XLK: `73f139a01b57c94d8125e0ceaaf195c59942a17e8221a8e03a1211060545f0e5` (data/cache/XLK__1d__2015-01-01__2026-02-17.csv)
- XLP: `30d35a0aa168cca713a93cba3dcc0aa99c67d4013e784850ab1b52cfd629a1a4` (data/cache/XLP__1d__2015-01-01__2026-02-17.csv)
- XLV: `6e97e330514df6cc040c9bde0e6515b45a8a1e5dc4a7cf4c874e380ba916924b` (data/cache/XLV__1d__2015-01-01__2026-02-17.csv)
- XLY: `ade51e9dc84c69fe71e176efb8af6201a7651ef803746f30b6df26a1f1f2612b` (data/cache/XLY__1d__2015-01-01__2026-02-17.csv)

## Artifacts

- `picks.csv`, `allocation.csv`, `regime.json`, `metrics.json`, `report.md`, `equity_curve.png`
