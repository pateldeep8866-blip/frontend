# Run Pack v1: 20260217T063759Z_e09125fa

- Created (UTC): `2026-02-17T06:37:59.402881Z`
- Strategy: `ma_crossover`
- Mode: `walkforward`
- Ticker: `SPY`
- Period: `2015-01-01` -> `2026-02-16`  Interval: `1d`
- Commission: `0.0`  Risk-free (annual): `0.0`

## Strategy vs Benchmark

Benchmark: `SPY` (buy-and-hold)

| Metric | Strategy | Benchmark |
|---|---:|---:|
| Total Return | 39.71% | 130.75% |
| CAGR | 5.62% | 14.66% |
| Ann. Vol | 0.085 | 0.206 |
| Sharpe | 0.689 | 0.769 |
| Sortino | 0.949 | 1.086 |
| Max Drawdown | -15.28% | -33.72% |
| Calmar | 0.368 | 0.435 |
| Hit Rate | 17.71% | 55.08% |

## Walk-Forward

- Train years: `5`  Test months: `6`
- Grid short: `[10, 15, 20, 30, 40]`
- Grid long: `[50, 75, 100, 125, 150]`
- Train max drawdown constraint: `>= -0.35`
- FDR q: `0.10`
- Windows: `13`  Significant windows: `3/13`  NOT SIGNIFICANT windows: `10`

Artifacts:

- `walkforward_windows.csv`
- `oos_equity.csv`

## Determinism Inputs

- Data source: `yfinance`  Cache hit: `True`
- Data path: `data/cache/SPY__1d__2015-01-01__2026-02-16.csv`
- Data sha256: `60ef502308542c4062bd43924150ea2a6ca336d8689e2c832cbe2ca2ebcf8c8a`
- Code sha256: `fbb09f8a2a7170fbba496f881a1ed86e341e22fdaf11bab466ba0552b437bb6a`
- Composite code sha256: `3d1de58abf3ab8c1fc8d1b1d7842f518cb619526135702eea8874deeb4c36b2b`
- Config sha256: `67c9869d78d177acac233996f49c85042fb088111e44d46d1c7d2df5c916f10d`

## Files

- `run_manifest.json`
- `metrics.json`
- `signals.csv`
- `trades.csv`
- `equity_curve.png`
- `report.md`
