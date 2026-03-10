# Morning Plan (Paper/Research Only): 20260225T025845Z_bcd8dd3e

This is a probabilistic research note. It does not guarantee profits and is not trading advice.

- Created (UTC): `2026-02-25T02:58:45.668027Z`
- As-of date: `2023-12-31`
- Universe size: `3`

## Hypothesis

Cross-sectional trend + momentum with risk-aware sizing produces a higher probability of positive drift than chance,
subject to regime filtering and conservative risk constraints.

## Regime

- Label: `risk_on`
- Confidence: `0.86` (method: `proxy`)

## Ranked Picks (Top)

| Rank | Ticker | Score | Vol | Mom(63) | Corr(SPY) | p-value | FDR | Reason |
|---:|---|---:|---:|---:|---:|---:|:---:|---|
| 1 | SPY | 0.164 | 0.011 | 0.032 | 1.000 | 1.17e-08 | Y | score=0.164 (z_mom=1.35, z_trend=-1.37, z_risk=0.66, z_dd=0.39); p(one-sided)=1.17e-08 FDR=Y |
| 2 | GLD | 0.014 | 0.011 | 0.032 | 1.000 | 1.17e-08 | Y | score=0.014 (z_mom=-1.04, z_trend=0.37, z_risk=0.76, z_dd=0.98); p(one-sided)=1.17e-08 FDR=Y |
| 3 | TLT | -0.178 | 0.011 | 0.032 | 1.000 | 1.17e-08 | Y | score=-0.178 (z_mom=-0.31, z_trend=1.00, z_risk=-1.41, z_dd=-1.37); p(one-sided)=1.17e-08 FDR=Y |

## Allocation Plan (Target Weights)

| Ticker | Weight |
|---|---:|
| GLD | 33.333% |
| SPY | 33.333% |
| TLT | 33.333% |

## Risk Budget + Guardrails

- Max weight/asset: `0.25`
- Max portfolio vol (annualized): `0.18`
- Max drawdown limit (advisory): `-0.10`

Risk actions applied:
- cap_weight: SPY clipped to 0.25
- cap_weight: GLD clipped to 0.25
- cap_weight: TLT clipped to 0.25
- cap_weight: SPY clipped to 0.25
- cap_weight: GLD clipped to 0.25
- cap_weight: TLT clipped to 0.25

Capital governance actions applied:
- cap_weight: SPY clipped to 0.25
- cap_weight: GLD clipped to 0.25
- cap_weight: TLT clipped to 0.25

Kill-switch rules (paper-only):
- ADVISORY: if paper drawdown <= -10%, halt adding risk and reassess.
- ADVISORY: if est. portfolio vol > 18%, reduce exposure (increase CASH).

## Uncertainty Notes

- p-values are computed from a normal approximation to the mean-return t-statistic (screening-level inference).
- Multiple testing is controlled using Benjamini–Hochberg FDR at q=0.10 across the universe.
- Scores and allocations are sensitive to lookback choice, data revisions, and regime shifts.

## Monitoring (Drift)

- Drift flag: `False`
- KS shift: `D=0.015873015873015928` threshold=`0.2` drift=`False`
- Vol regime: ratio=`1.0000514522251078` threshold=`1.5` drift=`False`
- IC decay: recent=`` baseline=`` drift=`False`
- Sharpe breakdown: recent=`11.261068120974066` baseline=`11.259195910651211` drift=`False`

## Determinism Inputs

- Data source: `alphavantage`  Cache hit (all): `True`
- Composite data sha256: `5af9ce994461d3a4e12cfc3c0f0762dfcfd7c911cca1f1b90947d64566ab43d2`
- Code sha256: `885db3bd37af43df54106f1813e6d155a02ee2846335f75b80b2581e7f6049c0`
- Composite code sha256: `3adf2cee7338038964aa175ecb7abef845d68bd6c7aa43f09e757bcd713ff96d`
- Config sha256: `e536d4d9d86f973e6b04eb1f37f94f45b34e54b3dcd756eaf492962e6dbea1e5`

Data files (sha256):
- GLD: `8425ea945980731c113d3ada062d210f62b575e11cfe51588bd77564e7545ef1` (data/cache/alphavantage/GLD__1d__2023-01-01__2023-12-31.csv)
- SPY: `4f88808110ec7da40727c3c215de44e386afc20b7354c69c9743400097a3f524` (data/cache/alphavantage/SPY__1d__2023-01-01__2023-12-31.csv)
- TLT: `6239ecdb7d5f6bf7b5b246367566fddfd4dba80f369acad284b5b328a0263726` (data/cache/alphavantage/TLT__1d__2023-01-01__2023-12-31.csv)

## Artifacts

- `picks.csv`, `allocation.csv`, `regime.json`, `metrics.json`, `report.md`, `equity_curve.png`
